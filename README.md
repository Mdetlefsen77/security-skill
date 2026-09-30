# risk-led-security-audit

Skill de auditoría de seguridad para agentes de código, con un enfoque guiado por riesgo de negocio: en vez de enumerar cada combinación posible de superficie × límite × clase de ataque antes de cazar, empieza modelando qué actor podría dañar qué activo y con qué consecuencia, y dedica el presupuesto de caza a las amenazas de mayor riesgo primero. Incluye trazabilidad cross-repo: un patrón de falla confirmado en un repo se registra en un store compartido (por scope, nunca mezclando clientes u organizaciones distintas) para acelerar y priorizar la auditoría de otros repos con el mismo stack. Ver `SKILL.md` para el razonamiento completo y `reference/cross-repo.md` para la trazabilidad entre repos.

Creada por **Martin Detlefsen**.

## Estructura

```
risk-led-security-audit/
├── SKILL.md          modos, principios, presupuesto, flujo de seis fases y mapa de archivos
├── phases/           guía del padre, en orden
├── prompts/          textos que van textuales a cada agente delegado
├── schemas/          contratos JSON de los artefactos
├── validators/       validadores sin dependencias y su motor de schema
├── reference/        temas transversales
├── scripts/          modo diff y promoción de artefactos
└── tests/            pruebas (npm test)
```

| Archivo | Contenido |
|---|---|
| `SKILL.md` | Modos, principio de riesgo primero, presupuesto, principios fundamentales, las seis fases y el mapa de archivos |
| `phases/1-threat-model.md` | Fase 1: reconocimiento orientado a actores y activos, estimación de riesgo inicial y contrato de `threat-register.json` |
| `phases/2-hunting.md` | Fase 2: olas de caza priorizadas por riesgo, armado del prompt del cazador, consolidación y crítico de riesgo |
| `phases/3-verification.md` | Fases 3 y 5: verificación adversarial de candidatos y verificación final de los registros |
| `phases/4-reporting.md` | Fases 4 y 6: `findings.json` con sus validaciones e informe orientado a riesgo |
| `prompts/recon-1a-actors.md` … `recon-1d-execution.md` | Los cuatro agentes de reconocimiento de la Fase 1 |
| `prompts/hunter-method.md`, `candidate-gate.md`, `hunter-result.md` | Método de caza, puerta de candidatos y contrato de resultado del cazador |
| `prompts/risk-critic.md` | Crítico de riesgo posterior a cada ola |
| `prompts/verifier-phase3.md`, `verifier-phase5.md` | Verificador de candidatos y verificador final, con la decisión cross-repo |
| `prompts/promotion-procedure.md` | Procedimiento de promoción de artefactos, única copia normativa |
| `schemas/findings.schema.json` | Contrato de `findings.json`, con `threat_id` hacia la amenaza de origen y `pattern_id` opcional |
| `schemas/threat-register.schema.json` | Contrato de `threat-register.json`: estimaciones, estados, `checks`, `unresolved` y `reassessment_log` |
| `schemas/cross-repo.schema.json` | Contrato del store `cross-repo-patterns-<scope>.json` |
| `validators/schema-engine.cjs` | Motor de JSON Schema compartido por los tres validadores |
| `validators/validate-findings.cjs` | Estructura y reglas semánticas de `findings.json`: traza `entrypoint+ → propagation* → sink+`, severidad ≤ impacto, fingerprints únicos, `threat_id` existente, contenido legible |
| `validators/validate-threat-register.cjs` | Hash de `threat_id`, `priority_tier` contra la tabla de la Fase 1, orden, coherencia entre estado y evidencia, cruce con `findings.json`, y `--final` al cierre |
| `validators/validate-cross-repo.cjs` | Store cross-repo, incluido que ningún nombre de repo se filtre a los campos genéricos |
| `reference/write-isolation.md` | Qué aísla el sandbox y qué no, raíces y propiedad, y uso de `scripts/promote.cjs` |
| `reference/cross-repo.md` | Store de patrones compartido entre repos: scope, consulta en la Fase 1 y alimentación en la Fase 5 |
| `reference/attack-classes.md` | Catálogo de técnicas por clase de ataque |
| `reference/diff-mode.md` | Modo diff: auditoría acotada a un `git diff`, para CI o como gate de OpenSpec |
| `scripts/audit-diff.cjs` | Wrapper del modo diff: calcula el alcance, invoca `claude -p` y decide el código de salida |
| `scripts/promote.cjs` | Implementación de referencia (Linux) de la promoción: `init` declara artefactos y límites, `promote` los copia |
| `tests/` | 63 pruebas sin dependencias: los tres validadores, `promote.cjs` y la integridad de la documentación (links, anchors, rutas citadas, nombres de archivo anteriores). Se corren con `npm test` |

## Pendiente

- La tabla de probabilidad × daño de `phases/1-threat-model.md` es un punto de partida razonable, no algo calibrado con datos empíricos de más auditorías. La primera auditoría completa real mostró un caso a revisar: probabilidad `crítica` × daño `bajo` da `high`, lo que pone endpoints de diagnóstico al mismo nivel que un IDOR.
- No hay una implementación de referencia del sandbox de ejecución: el padre arma el comando con la herramienta de aislamiento de su plataforma, respetando los controles de `SKILL.md`. `scripts/promote.cjs` cubre solo la promoción de artefactos.
- Sin archivos de dominio adicionales todavía (por ejemplo, uno específico para pipelines de agentes de IA) — se pueden agregar como referencias opcionales desde `reference/attack-classes.md` cuando una amenaza real los necesite.
- El modo diff (`scripts/audit-diff.cjs`) no fue corrido todavía contra una invocación real de `claude -p` (las pruebas usaron un binario simulado para validar el alcance, los permisos y la lógica de códigos de salida sin gastar presupuesto) — antes de usarlo como gate de CI, corra unas cuantas veces en modo `informative` contra diffs reales y revise el `REPORT.md` resultante.

## Instalación

```bash
npx skills add /ruta/a/la/carpeta/que/contiene/risk-led-security-audit --skill risk-led-security-audit
```

## Licencia

MIT — ver `LICENSE.txt`.
