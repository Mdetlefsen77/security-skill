# Caza de vulnerabilidades

### Fase 2: Olas de caza priorizadas por riesgo

Al inicio de cada ola, el padre ordena `threat-register.json` por `current_estimate.priority_tier` (crítico primero) usando `initial_estimate.priority_tier` como desempate estable, y toma las amenazas `queued` de mayor prioridad hasta agotar el cupo de cazadores de esta ola. Una amenaza cuyo `current_estimate.priority_tier` esté por debajo del piso de riesgo configurado (ver `SKILL.md`) no se asigna — queda `queued` para que el informe final la liste como riesgo residual no investigado.

Un cazador puede recibir varias amenazas si comparten actor y activo — no fragmente el mismo actor atacando el mismo activo entre dos cazadores distintos, porque eso les impide ver el cuadro completo. Antes de lanzar, el padre marca cada amenaza asignada como `in_progress`, fija un `agent_id` canónico en minúsculas, y crea las raíces `scratch/`/`artifacts/` de ese cazador según [reference/write-isolation.md](../reference/write-isolation.md).

## Lo que un cazador puede investigar

A diferencia de una auditoría por clase de ataque, un cazador **no** recibe una única técnica a buscar. Recibe una amenaza — un actor, un activo, un invariante — y la libertad de seguir cualquier camino de código que pueda violar ese invariante, sin importar en qué categoría técnica caiga el defecto. Esto es deliberado: un atacante real no se limita a una clase de ataque, y confinar a un cazador a "solo busque inyección" en una amenaza que en realidad se rompe por un problema de lógica de negocio hace que el cazador vea el problema y lo descarte por no encajar en su mandato.

Dicho esto, un cazador no tiene por qué reinventar cada técnica desde cero. Puede consultar los catálogos de técnicas en `reference/attack-classes.md` (y los archivos complementarios de dominio, si existen) como una biblioteca de referencia — "estas son formas conocidas en que este tipo de código falla" — no como una lista que deba agotar antes de cerrar la amenaza. Si el invariante de la amenaza es "un usuario no puede leer expedientes ajenos", el bloque de control de acceso del catálogo es un buen punto de partida; si nada de ahí aplica pero el cazador encuentra un camino distinto que igual rompe el mismo invariante, ese hallazgo cuenta exactamente igual.

## Prompt requerido del cazador

Cada prompt de cazador contiene, en este orden:

1. Un preámbulo de rol: el objetivo del cazador es determinar si alguna de sus amenazas asignadas tiene un camino de código real que la concrete, y debe devolver exactamente un objeto JSON con el contrato de resultado estructurado al final de este prompt.
2. `architecture.md` textual.
3. Las entradas completas de `threat-register.json` asignadas a este cazador: `threat_id`, `actor`, `asset`, `invariant`, `why_it_matters`, `candidate_starting_paths`.
4. [prompts/hunter-method.md](../prompts/hunter-method.md).
5. [prompts/promotion-procedure.md](../prompts/promotion-procedure.md).
6. [prompts/candidate-gate.md](../prompts/candidate-gate.md).
7. Los `threat_id` de otras amenazas actualmente en curso con otros cazadores en esta misma ola, para que este cazador no duplique investigación si tropieza con el mismo actor/activo por otro camino — puede reportarlo como relacionado, pero no lo investiga.
8. Las rutas únicas de scratch/artifact, el ID de agente seguro, la lista de permitidos y límites de bytes para la promoción, y el contrato de resultado estructurado de [prompts/hunter-result.md](../prompts/hunter-result.md). Las ramas `confirmed` y `needs_validation` de `schemas/findings.schema.json` pueden ir textuales o como ruta que el cazador lee, si el cazador tiene acceso de lectura a la skill.

## Resultado estructurado del cazador

Texto completo en [prompts/hunter-result.md](../prompts/hunter-result.md); va textual en el prompt del agente, sin editarlo. Es el último bloque de cada prompt de cazador.

## Consolidación del padre

El padre valida cada resultado, lo mapea a exactamente un `threat_id` asignado, y actualiza solo esa entrada del registro: copia `reviewed_paths`, `checks`, fingerprints de candidatos (a `linked_candidate_fingerprints`) y hechos sin resolver (a `unresolved`), fija `status: "investigated"` para las disposiciones `investigated` y `candidate`, y deja `in_progress` una disposición `blocked` hasta decidir si vuelve a `queued`. Un resultado fallido o malformado deja esa amenaza en `queued` para reasignación en la siguiente ola en vez de perderla en silencio. Agrega cada entrada de `threats_discovered` al registro con `status: "queued"` y `source: "hunter_discovered"`, usando el `initial_estimate` que el propio cazador fundamentó y derivando `priority_tier` con la tabla de [phases/1-threat-model.md](1-threat-model.md) — igual que con cualquier amenaza sembrada en el reconocimiento. Nunca la agrega sin puntaje, porque entonces nunca competiría de forma justa por un turno de caza.

## Crítico de riesgo posterior a la ola

Inmediatamente después de cada ola, gaste la invocación reservada en un crítico de riesgo `research` fresco. Recibe `architecture.md`, el registro de amenazas completo, los candidatos y disposiciones de esta ola, y el registro de recalibraciones anteriores. Lee código fuente pero no ejecuta nada ni escribe archivos. Devuelve el JSON definido en su prompt.

Texto completo en [prompts/risk-critic.md](../prompts/risk-critic.md); va textual en el prompt del agente, sin editarlo.

El crítico solo propone `new_likelihood`/`new_impact` con su razón — el padre deriva `priority_tier` con la misma tabla de [phases/1-threat-model.md](1-threat-model.md), nunca aceptando un `priority_tier` que el crítico calcule por su cuenta con otro criterio. Razones típicas para recalibrar: un candidato `high` confirmado en una amenaza sube la prioridad de amenazas relacionadas con el mismo componente; una amenaza investigada a fondo sin nada que la sustente baja su probabilidad; un hecho de reconocimiento que se pasó por alto cambia el activo real en juego.

`stop_recommended` es la propia opinión del crítico, no la regla de parada — el padre decide si sigue cazando según la regla de `SKILL.md` (presupuesto, piso de riesgo, o techo de olas), comparando el registro ya actualizado. El padre aplica `reassessments` y `new_threats` al registro, agrega cada `reassessment` a `reassessment_log` con el número de ola, y resuelve `close_no_further_work` según el estado de cada amenaza: una `queued` cuya evidencia respalde realmente que no vale la pena cazarla pasa a `closed_no_finding`; una que ya está `investigated` conserva ese estado (y sus candidatos vinculados), y el cierre solo significa que no vuelve a asignarse en olas siguientes, lo que se registra en `reassessment_log`. Vuelva a ordenar la cola por el `priority_tier` recalculado antes de armar la siguiente ola.

## Presupuesto por ola

Antes de asignar cada ola, confirme que el presupuesto restante cubre: los cazadores de esta ola, el crítico de riesgo inmediato posterior, y la reserva de verificación para los candidatos que ya existen más una estimación razonable de los que esta ola podría producir. Si no alcanza, reduzca el tamaño de la ola tomando amenazas en orden de prioridad — nunca omita el crítico posterior a la ola para estirar el cupo de cazadores; sin recalibración, el resto de la ejecución sigue cazando con prioridades obsoletas. Si ni siquiera una ola mínima con su crítico y su reserva de verificación caben en el presupuesto restante, deténgase, marque las amenazas de mayor prioridad aún `queued` como parte del riesgo residual del informe, y fije `run_status: "incomplete"` con la razón `budget_cannot_fund_wave_and_reassessment`.
