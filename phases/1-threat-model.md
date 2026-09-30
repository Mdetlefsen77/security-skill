# Modelo de amenazas

### Fase 1: Reconocimiento y construcción del registro de amenazas

El padre inicializa `run-metadata.json`, aplica la restricción de presupuesto (ver `SKILL.md`), crea las raíces `scratch/` de los agentes, y solo entonces lanza el reconocimiento. El reconocimiento lee el objetivo y el estado de compilación/configuración disponible localmente; no contacta endpoints desplegados, proveedores de identidad, ni otros servicios compartidos.

Lance los siguientes agentes `research` en paralelo. Devuelven hechos estructurados al padre; no escriben archivos.

**Agente 1a — Producto, actores y confianza**

Texto completo en [prompts/recon-1a-actors.md](../prompts/recon-1a-actors.md); va textual en el prompt del agente, sin editarlo.

**Agente 1b — Activos y por qué importan**

Texto completo en [prompts/recon-1b-assets.md](../prompts/recon-1b-assets.md); va textual en el prompt del agente, sin editarlo.

**Agente 1c — Superficies de entrada y límites**

Texto completo en [prompts/recon-1c-surfaces.md](../prompts/recon-1c-surfaces.md); va textual en el prompt del agente, sin editarlo.

**Agente 1d — Viabilidad de ejecución local**

Texto completo en [prompts/recon-1d-execution.md](../prompts/recon-1d-execution.md); va textual en el prompt del agente, sin editarlo.

Agregue agentes de reconocimiento enfocados cuando el objetivo tenga subsistemas o dominios materialmente distintos (por ejemplo, un backend HTTP y un pipeline de agentes de IA en el mismo repo) que estos cuatro no cubran bien.

## Síntesis del registro de amenazas

El padre — o un agente `research` dedicado si el objetivo es grande — combina los hallazgos de reconocimiento en entradas de amenaza. Una amenaza no es una celda de una matriz: es una oración con esta forma: *"un <actor> podría <acción sobre un activo>, violando <invariante>, lo que costaría <consecuencia de negocio>"*. Una sola amenaza puede abarcar varias superficies de entrada si comparten actor e invariante.

No liste amenazas genéricas de checklist ("podría haber XSS"). Cada entrada nace de un hecho concreto de reconocimiento: un actor real identificado por el Agente 1a, un activo real identificado por el Agente 1b, y al menos una ruta de entrada real identificada por el Agente 1c — o de un patrón ya confirmado en otro repositorio del mismo scope, según [reference/cross-repo.md](../reference/cross-repo.md), cuando el stack del objetivo actual coincide con el `stack_signals` de ese patrón.

### Estimación de riesgo inicial

Antes de cazar, cada amenaza recibe una estimación *a priori* de riesgo — no una severidad. La severidad solo existe después de confirmar un hallazgo (ver `SKILL.md`, Principios fundamentales); esta estimación sirve únicamente para ordenar en qué orden se cazan las amenazas.

Califique **probabilidad** y **daño** por separado, cada una en cuatro niveles, a partir de hechos de reconocimiento:

**Probabilidad** (¿qué tan alcanzable es el camino?)
- `baja`: requiere un rol administrativo o interno para siquiera intentarlo.
- `media`: requiere autenticación de un usuario ordinario.
- `alta`: alcanzable sin autenticación, o el control de autorización visible parece débil o inconsistente entre rutas paralelas al mismo efecto.
- `crítica`: no hay ningún control de autorización visible en el código fuente para esta ruta.

**Daño** (¿qué tan grave si ocurre?)
- `bajo`: afecta solo al propio principal, o expone detalle interno no secreto.
- `medio`: afecta a un conjunto acotado de otros usuarios o a un recurso de valor limitado.
- `alto`: afecta datos o acciones de la lista de activos del Agente 1b, para más de un principal.
- `crítico`: compromete un activo de máximo valor (datos personales o financieros masivos, ejecución de código, integridad de un registro legal/oficial) o afecta a todos los usuarios.

Cruce ambos valores en esta tabla para obtener el `priority_tier` inicial:

| Probabilidad ↓ / Daño → | bajo | medio | alto | crítico |
|---|---|---|---|---|
| baja | low | low | medium | high |
| media | low | medium | high | high |
| alta | medium | high | high | critical |
| crítica | high | high | critical | critical |

Esta tabla es la única fuente de verdad para derivar `priority_tier` a partir de probabilidad y daño — no la recalcule con otro criterio en otro archivo.

## `threat-register.json`

El padre escribe `<directorio-salida>/threat-register.json` como un arreglo JSON de nivel superior. Cada entrada:

```json
{
  "threat_id": "TH-001",
  "actor": "usuario autenticado sin rol administrativo",
  "asset": "expediente de otro contribuyente",
  "invariant": "un usuario solo puede leer o escribir expedientes de los que es titular",
  "why_it_matters": "acceso indebido a datos personales/fiscales de terceros",
  "candidate_starting_paths": ["repo/relative/path"],
  "initial_estimate": {
    "likelihood": "low|medium|high|critical",
    "likelihood_reason": "...",
    "impact": "low|medium|high|critical",
    "impact_reason": "...",
    "priority_tier": "low|medium|high|critical"
  },
  "current_estimate": {
    "likelihood": "low|medium|high|critical",
    "impact": "low|medium|high|critical",
    "priority_tier": "low|medium|high|critical",
    "last_updated_wave": 0
  },
  "status": "queued|in_progress|investigated|deferred|closed_no_finding",
  "source": "reconnaissance|hunter_discovered|risk_critic_added|cross_repo_pattern",
  "wave_assigned": null,
  "agent_id": null,
  "reviewed_paths": [],
  "checks": [],
  "linked_candidate_fingerprints": [],
  "unresolved": [],
  "reassessment_log": [
    {"wave": 1, "previous": {"likelihood": "...", "impact": "...", "priority_tier": "..."}, "reason": "..."}
  ]
}
```

El contrato exacto es `schemas/threat-register.schema.json`, y `validate-threat-register.cjs` lo valida junto con las reglas de este archivo (hash de `threat_id`, tabla de prioridad, orden). `checks` y `unresolved` son opcionales y los completa el padre al consolidar cada ola ([phases/2-hunting.md](2-hunting.md)). Cada entrada de `reassessment_log` guarda la estimación anterior en `previous`; la nueva es la que queda en `current_estimate`.

`threat_id` es estable entre ejecuciones para la misma amenaza: derívelo como un hash corto y determinista de la clave canónica `actor::asset::invariant` (normalizada a Unicode NFC), truncado a 16 caracteres hexadecimales — por ejemplo `sha256("usuario autenticado sin rol administrativo::expediente de otro contribuyente::un usuario solo puede leer o escribir expedientes de los que es titular")` truncado. Esto da un identificador corto y legible en logs (`a3f1c9d20b7e4488`) que es reproducible entre ejecuciones sin depender de un contador que cambiaría de corrida a corrida. Los ejemplos de esta habilidad usan `TH-001` como abreviatura ilustrativa por legibilidad — en un registro real, ese campo contiene el hash truncado, no un contador. `current_estimate` empieza igual a `initial_estimate` y solo cambia cuando el crítico de riesgo lo recalibra en [phases/2-hunting.md](2-hunting.md); `reassessment_log` registra cada cambio con la ola y la razón fundamentada en código fuente o en un candidato encontrado. `source` distingue una amenaza nacida del reconocimiento inicial, una que un cazador descubrió sobre la marcha, una que el crítico de riesgo agregó, o una sembrada a partir de un patrón cross-repo ya confirmado en otro repo del mismo scope ([reference/cross-repo.md](../reference/cross-repo.md)) — las cuatro entran al mismo registro y compiten por la misma cola de prioridad.

Ordene el registro por `current_estimate.priority_tier` (crítico primero) y, dentro del mismo nivel, por `initial_estimate.priority_tier` como desempate estable — nunca por orden alfabético de `threat_id`, que no tiene relación con el riesgo.

## Entrada de ejecuciones anteriores

Si existe un `threat-register.json` y un `findings.json` de una ejecución anterior compatible, léalos antes de sintetizar el registro actual:

- Una amenaza anterior con la misma `threat_id` cuyo código fuente relevante no cambió conserva su `current_estimate` y su historial; no la reevalúe desde cero.
- Si el código fuente relevante cambió, reabra la amenaza con `status: "queued"` y registre en `reassessment_log` que el código cambió — no asuma que el veredicto anterior sigue vigente.
- Un hallazgo `confirmed` anterior vinculado a una amenaza sin cambios se traslada al conjunto de candidatos actuales siguiendo el mismo mecanismo de verificación fresca que describe [3-verification.md](3-verification.md); no se excluye de una futura recalibración de esa amenaza.
- Si no hay registro anterior compatible, declárelo en el resumen de cobertura final. Nunca dé a entender que una sola ejecución agota el riesgo del objetivo.

## `architecture.md`

Sintetice `<directorio-salida>/architecture.md`, con un tope de aproximadamente 800 palabras: producto, actores y su nivel de confianza, activos identificados y por qué importan, superficies de entrada principales, y un resumen de las amenazas de mayor prioridad con una oración cada una. Este archivo se le da completo a cada cazador y verificador; no incluya aquí el detalle de asignación de cada amenaza — eso vive en `threat-register.json`.
