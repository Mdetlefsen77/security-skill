# Verificación adversarial

Este archivo reúne las dos fases a cargo de verificadores, que nunca participaron en la caza del candidato que revisan. Corren en momentos distintos: la Fase 3 después de cada ola de caza y su crítico de riesgo; la Fase 5 después de escribir `findings.json` ([4-reporting.md](4-reporting.md), Fase 4) y antes del informe (Fase 6).

### Fase 3: Validar cada candidato de forma adversarial

Cuando la ola de caza y su crítico de riesgo terminan, consolide los candidatos por fingerprint estable y causa raíz. Cada candidato único va a un verificador `general` fresco que no participó en la caza de esa amenaza. El verificador puede leer los artefactos que dejó el cazador, pero debe releer por su cuenta cada ubicación de código fuente citada y reproducir de forma independiente cualquier comprobación decisiva que pueda ejecutar de forma segura — no le alcanza con confiar en la palabra del cazador.

Asigne a cada verificador un `agent_id` único canónico y sus raíces `scratch/`/`artifacts/` según [reference/write-isolation.md](../reference/write-isolation.md). El verificador escribe solo en `scratch/` y nunca escribe artefactos conservados. Recibe: el candidato completo, la entrada de `threat-register.json` que lo originó, los hechos de `architecture.md` necesarios para interpretar el camino, [prompts/promotion-procedure.md](../prompts/promotion-procedure.md), y las ramas `confirmed`, `needs_validation` y `rejected` de `schemas/findings.schema.json` (textuales o como ruta que el verificador lee). No recibe la conclusión de ningún otro verificador.

#### Prompt del verificador de candidatos

Texto completo en [prompts/verifier-phase3.md](../prompts/verifier-phase3.md); va textual en el prompt del agente, sin editarlo.

El padre verifica que el verificador haya conservado el mismo fingerprint, salvo que identifique una causa raíz genuinamente distinta. Descarte un resultado malformado o envuelto en prosa sin repararlo — vuelva a intentar con un verificador fresco si el presupuesto lo permite; si no, la amenaza queda `investigated` con el fingerprint en `linked_candidate_fingerprints` y el motivo en `unresolved`, y entra al riesgo residual del informe final. Nunca lo publique en `findings.json` sin veredicto de un verificador.

### Fase 5: Verificar los registros finales con ojos frescos

Lance un verificador `research` fresco por cada registro final `confirmed` y `needs_validation`, en paralelo. Este verificador revisa el registro estructurado tal como quedó escrito, no la redacción original del cazador ni del verificador de la Fase 3, y permanece dentro de los límites fuente/local.

No existe un modo abreviado que fusione esta fase con la Fase 3, ni siquiera bajo presión de presupuesto: si el presupuesto no alcanza para una segunda verificación independiente, la forma correcta de ajustar es subir el piso de riesgo (investigar menos amenazas, pero cada una con el mismo rigor), nunca saltear esta fase para las amenazas que sí se investigaron.

El prompt del verificador, con las comprobaciones para `confirmed` y `needs_validation`, está en [prompts/verifier-phase5.md](../prompts/verifier-phase5.md). Cada prompt lleva además el registro a revisar, `architecture.md`, la amenaza de origen, las rutas de los artefactos promovidos que cita el registro y, si hay scope cross-repo, el store actual y los mecanismos que evalúan los otros verificadores de la ejecución.

Cada verificador devuelve exactamente `{"decision":"verified","fingerprint":"...","cross_repo":{...}}` o `{"decision":"replace","reason":"...","record":{...},"cross_repo":{...}}`, sin prosa alrededor. `cross_repo` lleva la decisión de trazabilidad descrita abajo y en [reference/cross-repo.md](../reference/cross-repo.md); se omite solo cuando la ejecución no tiene scope cross-repo. No aplique un reemplazo que promueva el veredicto o cambie materialmente la causa raíz, el resultado observado, o la severidad, sin dárselo a un nuevo verificador independiente que no haya participado antes en ese candidato. Si el presupuesto o la independencia necesaria no están disponibles, quite el registro en disputa de `findings.json`, deje su amenaza `investigated` con el fingerprint en `linked_candidate_fingerprints` y el motivo en `unresolved`, y fije `run_status: "incomplete"`.

Fije `run_status: "complete"` solo cuando cada amenaza investigada tenga una disposición final y cada registro conservado haya pasado la Fase 5.

Cuando un registro `confirmed` o `needs_validation` termina esta fase, el mismo verificador compara su causa raíz contra el store de patrones cross-repo del scope activo y devuelve su decisión en `cross_repo`; el padre la aplica al store y a `findings.json` según [reference/cross-repo.md](../reference/cross-repo.md). Es parte de la Fase 5, no un paso aparte.
