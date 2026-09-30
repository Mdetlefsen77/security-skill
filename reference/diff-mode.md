# Modo diff: `scripts/audit-diff.cjs`

Un tercer modo de invocación, además de guía y auditoría completa (ver
`SKILL.md`): audita solo lo que cambió en un diff de Git, de forma
no interactiva, invocable con un solo comando. Pensado para correr en CI, en
un pre-push local, o como gate antes de archivar un cambio de OpenSpec —
casos donde nadie va a estar apretando "sí" a cada permiso, y donde auditar
el repositorio completo en cada corrida sería demasiado lento y caro.

Este modo **no reemplaza** la auditoría completa. Es deliberadamente más
angosto: audita la superficie que tocó el diff, no el repositorio entero, así
que no reconstruye el modelo de amenazas completo del sistema ni encuentra
nada fuera de esa superficie. Úselo como una red de contención continua entre
auditorías completas periódicas, no como su reemplazo.

## Qué hace, en una frase

Calcula qué archivos cambiaron (`git diff`), arma un `scope.json` con esa
lista, invoca `claude -p` en modo headless con un system prompt que instruye
a la habilidad a correr sus 6 fases pero con el reconocimiento de la Fase 1
acotado a esos archivos, y decide un código de salida a partir del
`findings.json` resultante.

Todo el rigor de la habilidad se mantiene: registro de amenazas, olas de
caza priorizadas por riesgo, verificador que nunca es el cazador,
`confirmed` exige reproducción local, aislamiento de escritura de
`reference/write-isolation.md`. Lo único que cambia es el alcance del reconocimiento
inicial.

## Uso básico

```bash
# Auditar lo que cambió respecto al último commit (árbol de trabajo vs HEAD)
node scripts/audit-diff.cjs --repo /ruta/al/repo --diff HEAD --allow-write

# Auditar lo que está en stage antes de comitear
node scripts/audit-diff.cjs --repo /ruta/al/repo --staged --allow-write

# Auditar un rango (por ejemplo, todo lo que trae una rama de PR sobre main)
node scripts/audit-diff.cjs --repo /ruta/al/repo --diff-range main..mi-rama --allow-write

# Ver el alcance y el comando que se ejecutaría, sin gastar presupuesto ni tocar nada
node scripts/audit-diff.cjs --repo /ruta/al/repo --diff HEAD --dry-run
```

`--allow-write` es obligatorio para una corrida real (no `--dry-run`): es una
confirmación explícita de que el agente puede escribir dentro del directorio
de salida de esta corrida. Sin ella, el wrapper se detiene antes de invocar
`claude`, para que nunca corra por accidente con permisos de escritura que
nadie autorizó a propósito.

## Modo informativo vs. modo gate

- **`--mode informative`** (por defecto): corre la auditoría, escribe los
  artefactos, imprime un resumen. El proceso siempre termina con código 0
  salvo error real (findings.json ausente o inválido). Úselo primero, en
  varias corridas reales, antes de conectar nada como gate — necesita ver
  cuántos falsos positivos produce en su base de código concreta antes de
  dejar que bloquee algo.
- **`--mode gate`**: mismo comportamiento, pero el proceso termina con
  código 1 si hay al menos un hallazgo `confirmed` con severidad igual o
  mayor a `--fail-on` (por defecto `high`). Recién entonces tiene sentido
  usarlo como paso obligatorio de CI o como gate antes de archivar un cambio
  de OpenSpec.

Un hallazgo `needs_validation` nunca bloquea el gate — por diseño de la
habilidad, no tiene severidad asignada (ver "Principios fundamentales" en
`SKILL.md`). Queda en el reporte para revisión humana, no en el camino
crítico de CI.

## Integración con OpenSpec

```bash
node scripts/audit-diff.cjs --repo /ruta/al/repo \
  --diff-range main..mi-rama \
  --openspec mi-cambio \
  --mode gate --fail-on high --allow-write
```

`--openspec` **no cambia el alcance de archivos auditados** — eso lo sigue
decidiendo `--diff`/`--diff-range`/`--staged`. Lo que hace es leer
`openspec/changes/<nombre>/proposal.md` y `design.md` y agregarlos como
contexto de intención al prompt, para que el modelo de amenazas entienda qué
se pretendía lograr con el cambio. El registro de amenazas y los hallazgos
siguen basándose únicamente en lo que el código en el alcance realmente
hace — el proposal nunca se toma como prueba de que el código ya lo cumple.

Para usarlo como gate de archivado de un cambio de OpenSpec, corra este
comando en el paso previo a `openspec archive` (o al equivalente en su CI) y
condicione el archivado al código de salida.

## Qué produce

En el directorio de salida (`--output`, o por defecto
`~/risk-led-security-audit/<repo>/diff-run-<timestamp>/`):

- `scope.json` — el alcance exacto que se auditó (archivos, referencias base
  y de cabeza, piso de riesgo, scope cross-repo, cambio de OpenSpec si se dio
  uno). Es lo primero que revisar si un resultado sorprende.
- `diff-mode-prompt.md` — el system prompt exacto que se le agregó a la
  habilidad para esta corrida. Útil para depurar por qué el agente investigó
  (o no investigó) algo.
- `architecture.md`, `threat-register.json`, `findings.json`, `REPORT.md`, y
  el resto de los artefactos que ya define `phases/4-reporting.md` para
  cualquier auditoría completa — el modo diff no inventa un formato de salida
  propio.

## Permisos que el wrapper le da al agente

No usa un bypass total de permisos. La invocación de `claude -p` recibe:

- `Read`, `Grep`, `Glob` sin restricción — el agente necesita poder leer
  cualquier archivo del repo para entender el contexto de lo que cambió,
  aunque el registro de amenazas deba trazarse a los archivos del diff.
- `Write` únicamente dentro del directorio de salida de esta corrida
  específica — nunca sobre el repo objetivo ni sobre la carpeta de la
  habilidad.
- `Bash` únicamente para invocar los validadores de esta habilidad
  (`validate-findings.cjs`, `validate-threat-register.cjs`,
  `validate-cross-repo.cjs`) — no un shell abierto.
- `--permission-mode acceptEdits --permission-prompts none`, porque el punto
  de este modo es correr sin una persona presente. Si su entorno de CI
  requiere una postura aún más restrictiva, pase `--claude-bin` apuntando a
  un wrapper propio que ajuste estas banderas antes de reenviar la llamada.

Esto sigue el mismo principio de "sandbox forzado, no confianza" que ya
exige `SKILL.md` para la ejecución de código del objetivo — acá se aplica al
propio proceso auditor, no solo a lo que el proceso auditor ejecuta del
objetivo.

## Código de salida del wrapper

| Código | Significado |
|---|---|
| `0` | Corrida completa y válida. En modo gate, además, ningún hallazgo `confirmed` alcanzó `--fail-on`. |
| `1` | Modo gate: al menos un hallazgo `confirmed` con severidad ≥ `--fail-on`. |
| `2` | Error de la corrida en sí: `findings.json` ausente, no es JSON válido, o no pasó `validate-findings.cjs` o `validate-threat-register.cjs --final`. Un `2` nunca significa "el código está bien" — significa que no se pudo confiar en el resultado, y debe tratarse como falla dura en cualquier pipeline, esté en modo informativo o gate. |

## Límites conocidos, a propósito

- Requiere Git. No hay alcance por diff sin control de versiones — para eso
  está el modo de auditoría completa.
- El alcance se deriva de nombres de archivo, no de análisis de flujo de
  datos entre el diff y el resto del repo. Un cambio pequeño que abre una
  ruta de explotación en un archivo que el diff no toca (por ejemplo, un
  cambio de validación en un archivo que habilita un sink ya existente en
  otro) puede quedar fuera de una corrida en modo diff. La auditoría
  completa periódica sigue siendo necesaria por esta razón — el modo diff es
  una red de contención continua, no un reemplazo.
- No reevalúa ni reescribe hallazgos de corridas anteriores — cada corrida en
  modo diff es independiente. Si quiere que la caza cross-repo entre en
  juego, configure `--pattern-scope` igual que en la auditoría completa.
