# Trazabilidad cross-repo

Un patrón de falla que se confirmó en un repositorio suele existir en otros repositorios que comparten stack, librería, o simplemente el mismo desarrollador escribiendo el mismo tipo de código dos veces. Esta habilidad, tal como está descrita en `SKILL.md` y los archivos de `phases/`, audita un repositorio por vez. Este archivo agrega la capa que conecta esas ejecuciones entre sí.

## Antes que nada: el scope

`cross-repo-patterns.json` es un archivo que persiste **fuera** de cualquier repositorio individual y se lee/escribe en cada ejecución. Eso significa que, si alguna vez audita repos de más de un cliente, organización, o proyecto con distinto nivel de confidencialidad, **nunca use el mismo archivo para todos** — mezclaría el mecanismo de una falla de un cliente en el contexto de otro, incluso si el nombre del repo no aparece (`validate-cross-repo.cjs` rechaza eso, pero solo detecta el nombre del repo, no filtra intención).

Configure un `pattern_scope` explícito antes de la Fase 1 — un identificador corto y estable (`personal`, `cliente-dgr`, `kolektor`, lo que corresponda) — y derive la ruta del store como `~/risk-led-security-audit/cross-repo-patterns-<pattern_scope>.json`. Sin un scope explícito, el store por defecto es `~/risk-led-security-audit/cross-repo-patterns-default.json` — adecuado solo para repos propios sin restricciones de confidencialidad entre sí. Si no está seguro de si dos repos pueden compartir scope, no lo comparta.

## Qué es un patrón

Un patrón describe un **mecanismo de falla**, no una instancia. La pregunta que responde `description` es "¿cómo falla este tipo de código en general?", nunca "¿qué encontramos en el repo X?". Vea `schemas/cross-repo.schema.json` para el contrato exacto; en criollo:

- `pattern_id`: slug estable (`no-rate-limit-on-credentials-login`).
- `description` y `technique`: genéricas, sin nombrar ningún repo — `validate-cross-repo.cjs` rechaza el archivo si el nombre de un repo listado en `occurrences` aparece filtrado ahí.
- `stack_signals`: pistas de tecnología/arquitectura que ayudan a reconocer si el patrón podría aplicar a un repo nuevo antes de cazarlo desde cero (nombres de librería, tipo de auth, framework).
- `occurrences`: la única parte del patrón que sí identifica repos — cada entrada es `{repo, fingerprint, verdict_at_time, run_id, date}`, apuntando al registro real en el `findings.json` de ese repo.

## Cuándo se consulta (Fase 1)

Al reconocer el objetivo (`phases/1-threat-model.md`), después de identificar el stack en el Agente 1a, lea `cross-repo-patterns.json` del scope activo si existe. Para cada patrón cuyos `stack_signals` coincidan con hechos reales del objetivo actual, siembre una amenaza en `threat-register.json` directamente, con `source: "cross_repo_pattern"` y un `initial_estimate` que parta de un piso más alto que el de una amenaza recién descubierta — ya sabe que este mecanismo de falla existe en código similar, no está adivinando. Esto no reemplaza el reconocimiento normal; lo complementa, permitiendo ir directo a verificar un mecanismo conocido en vez de redescubrirlo de cero.

## Cuándo se alimenta (Fase 5)

Cuando un registro llega a verificación final ([phases/3-verification.md](../phases/3-verification.md), Fase 5) con veredicto `confirmed` o `needs_validation`, el verificador de esa fase compara su `root_cause`/`claimed_root_cause` contra las `description` de los patrones existentes en el scope activo:

El verificador no escribe archivos: devuelve su decisión en el campo `cross_repo` de su resultado, con una de estas formas.

```json
{"action": "link", "pattern_id": "<pattern_id existente>"}
{"action": "new", "pattern_id": "<slug-nuevo>", "description": "...", "technique": "...", "stack_signals": ["..."]}
```

El padre la aplica:

- **`link`, coincide con un patrón existente**: agrega una entrada a `occurrences` de ese patrón con el repo, fingerprint, veredicto y fecha actuales, y agrega `pattern_id` al registro en `findings.json` (campo opcional, ver `schemas/findings.schema.json`).
- **`new`, no coincide con ninguno**: crea la entrada en el store con el `pattern_id`, la `description`/`technique` genéricas (sin datos del repo actual más allá de lo que ya vive en `occurrences`) y `stack_signals` propuestos, y agrega `pattern_id` al registro.

Si dos verificadores de la misma ejecución proponen `new` para el mismo mecanismo, el padre los unifica en un solo patrón antes de escribir. Para que eso sea posible, cada prompt de Fase 5 incluye los mecanismos que los otros verificadores de la ejecución están evaluando.

Esta decisión la toma el verificador de Fase 5 porque ya está leyendo el registro completo con ojos frescos — no agregue un agente nuevo solo para esto. El match es semántico (mismo mecanismo, no el mismo texto exacto), así que el verificador debe leer las `description` existentes, no comparar strings.

Ejecute `node <directorio-skill>/validators/validate-cross-repo.cjs <ruta-al-store>` después de cada escritura, igual que con los otros validadores.

## Cómo se reporta

`REPORT.md` (Fase 6) agrega una sección **Patrones cross-repo** cuando algún registro de esta ejecución tiene `pattern_id`: por cada patrón, liste su `technique`, cuántas otras ocurrencias tiene y en qué repos (solo si esos repos están en el mismo scope y por lo tanto ya son mutuamente visibles), y si alguno de esos otros repos comparte `stack_signals` con el objetivo actual sin tener todavía una ocurrencia — eso es una pista concreta de "probablemente valga la pena auditar ese repo también para este mecanismo específico", no una afirmación de que la falla existe ahí.

## Lo que este archivo no hace

No ejecuta nada automáticamente en otro repositorio. No es un scanner que corre solo. Es un registro compartido de mecanismos de falla que una persona (o un agente, en una ejecución futura y separada) puede consultar antes de auditar el siguiente repositorio del mismo scope — la trazabilidad es de conocimiento, no de ejecución.
