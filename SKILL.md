---
name: risk-led-security-audit
description: Guía de seguridad y auditoría de vulnerabilidades guiada por riesgo de negocio para bases de código, APIs, servicios, herramientas CLI, librerías y agentes de IA. Utilícela para preguntas de seguridad, revisiones enfocadas, investigación de vulnerabilidades, auditorías de seguridad o pruebas de penetración. Ejecute el flujo de trabajo completo solo para solicitudes explícitas de auditoría de código o pruebas de penetración, revisiones completas/exhaustivas/de extremo a extremo, o artefactos de informe solicitados.
---

# Auditoría de seguridad guiada por riesgo

Encuentre violaciones reales de un límite de confianza, priorizadas por el riesgo de negocio que representan, y entregue a los propietarios la evidencia fuente, la reproducción segura, y la corrección efectiva más pequeña. Este es un flujo de trabajo defensivo, primero fuente, que invierte el orden habitual de una auditoría exhaustiva: en lugar de enumerar cada combinación posible de superficie y control antes de cazar, empieza modelando qué puede salir mal y para quién, y dedica el esfuerzo de caza donde ese daño sería mayor. Un candidato sin un principal, activo o resultado concreto afectado no es un hallazgo confirmado, sin importar cuán interesante parezca el código.

## Modos de operación

Cargar esta habilidad no autoriza el flujo de trabajo completo ni la creación de archivos.

- **Modo de guía**: para preguntas de seguridad, revisión de un fragmento puntual, metodología, triaje, o investigación de un hallazgo específico, use solo las partes relevantes de esta habilidad. No inicie el registro de amenazas, no cree un directorio de salida, no escriba artefactos de auditoría. Puede lanzar agentes enfocados cuando ayude; sus resultados vuelven a la conversación actual, no a un archivo.
- **Modo de auditoría completa**: use el flujo de trabajo completo cuando se pida explícitamente auditar o hacer pruebas de penetración a una base de código, una revisión de seguridad completa/exhaustiva/de punta a punta, o artefactos de informe.
- **Modo diff**: invocación no interactiva acotada a los archivos cambiados en un diff de Git, pensada para CI, pre-push, o como gate antes de archivar un cambio de OpenSpec. Mismo rigor de las seis fases, reconocimiento inicial acotado al alcance del diff. Se invoca como comando, no cargando la habilidad en una conversación — ver [reference/diff-mode.md](reference/diff-mode.md) y `scripts/audit-diff.cjs`.

Si la solicitud admite ambas lecturas, pregunte antes de crear archivos o de iniciar el flujo completo.

## Terminología de la plataforma

Neutral respecto al agente concreto que use la plataforma:

- **Padre**: el agente que coordina la ejecución, mantiene el registro de amenazas y es dueño del estado compartido.
- **Cazador**: agente delegado que investiga una amenaza asignada — lee código, ejecuta comprobaciones locales acotadas, y devuelve candidatos o cierra la amenaza como investigada.
- **Verificador**: agente delegado que nunca cazó el candidato que revisa. Intenta refutarlo antes de confirmarlo.
- **Crítico de riesgo**: agente delegado que, después de cada ola, relee el registro de amenazas junto con lo que la ola encontró, y decide si algo debe subir de prioridad, cerrarse, o agregarse como amenaza nueva.

Use las capacidades de delegación de su plataforma (subagentes, Task tool, o equivalente) conservando estos cuatro roles y su aislamiento de escritura.

## El principio central: modele la amenaza antes de cazar

Antes de mirar una sola línea de código en busca de vulnerabilidades, construya un **registro de amenazas**: una lista corta de "esto podría salir mal, le pasaría a este actor, y nos costaría esto". No es un ejercicio académico — es lo que decide en qué orden se gasta cada agente. Una amenaza con puntaje de riesgo alto (por ejemplo, "un contribuyente accede al expediente de otro contribuyente") consume presupuesto de caza antes que una de riesgo bajo ("un admin interno ve un mensaje de log ligeramente verboso"), incluso si las dos viven en el mismo archivo.

Esto es deliberadamente distinto de una auditoría por cobertura exhaustiva:

- No se enumera cada combinación de superficie de entrada × control × clase de ataque antes de empezar. Se enumeran amenazas — que pueden abarcar varias superficies a la vez si comparten el mismo actor y el mismo activo.
- La prioridad no es fija: se recalcula después de cada ola de caza, a la luz de lo que realmente se encontró.
- La declaración final de cobertura no es "cerramos el 100% de las celdas de la matriz" sino "esto es lo que investigamos, esto es lo que quedó afuera, y esto es lo que estimamos que arriesga cada cosa que no llegamos a mirar" — ordenado por riesgo, no por orden alfabético de archivo.

El resto de esta habilidad y sus archivos complementarios (`phases/`, `prompts/`, `schemas/` y `reference/`; ver la sección "Mapa de archivos") implementan esto en fases concretas.

## Seguridad de ejecución universal

Se aplica en ambos modos. La inspección del código fuente es de solo lectura. Toda compilación, prueba, proceso, navegador, emulador, fuzzer o procesamiento de fixtures controlado por el objetivo corre únicamente dentro de un entorno aislado forzado por el sistema operativo, con:

- sin red externa, salvo un espacio de nombres de loopback aislado para tráfico cliente/servidor puramente local;
- un entorno vacío con lista de permitidos explícita de variables seguras;
- objetivo y toolchain de solo lectura; el proceso controlado por el objetivo escribe únicamente en su `scratch/` asignado;
- archivos de secretos presentes en el árbol del objetivo (`.env`, `.env.*` y similares, versionados o no) enmascarados dentro del sandbox, porque el montaje de solo lectura no impide leerlos;
- límites explícitos y bajos de CPU, memoria, procesos, tamaño de archivo, disco y tiempo de reloj.

Si no puede aplicar cada uno de estos controles, no ejecute código del objetivo: represente la capacidad faltante como `needs_validation` con un plan de validación seguro, y siga adelante con el resto de la auditoría. La promoción de un resultado de `scratch/` a un artefacto conservado sigue exactamente el procedimiento de [reference/write-isolation.md](reference/write-isolation.md) — no lo repita en ningún otro archivo.

Use siempre principales, fixtures y secretos ficticios. Nunca sondee endpoints desplegados, identidades de producción, datos de otros usuarios reales, ni gaste cuota paga de terceros. Si el hecho decisivo vive fuera del código fuente o del fixture aislado, es `needs_validation`, no una suposición.

## Configuración de auditoría completa

Antes de empezar, resuelva:

- **Objetivo**: raíz absoluta del repositorio bajo revisión.
- **Nombre del repo**: identificador estable desde el directorio o el remoto de Git.
- **Directorio de salida**: fuera del objetivo por defecto, en `~/risk-led-security-audit/<nombre-repo>/run-<N>`. Solo dentro del objetivo si el usuario lo pide explícitamente y el padre confirma que el control de versiones ignora ese directorio completo.
- **Referencia de fuente**: el commit revisado, y si el árbol de trabajo tiene cambios sin confirmar.
- **Piso de riesgo**: el puntaje de riesgo por debajo del cual una amenaza no vale la pena cazar en esta ejecución (ver Planificación por riesgo). Por defecto, deje que el padre lo proponga según el tamaño del objetivo, y declárelo en el informe.
- **Scope cross-repo** (opcional): un identificador corto (`personal`, `cliente-x`) que determina qué archivo de patrones compartidos en [reference/cross-repo.md](reference/cross-repo.md) se consulta y se alimenta. Nunca comparta un scope entre repos de distinta confidencialidad — ver reference/cross-repo.md antes de fijar esto.

## Planificación por riesgo

### El registro de amenazas

[phases/1-threat-model.md](phases/1-threat-model.md) define cómo se construye `threat-register.json`: qué agentes de reconocimiento lo alimentan, la forma exacta de cada entrada, y cómo se calcula el puntaje inicial de riesgo. El padre es el único que escribe este archivo.

### Olas de caza y recalibración

[phases/2-hunting.md](phases/2-hunting.md) define cómo se asignan cazadores a las amenazas de mayor puntaje, qué puede investigar un cazador dentro de una amenaza (no está limitado a una sola clase de ataque: sigue el actor y el activo a través de todos los caminos que encuentre), y cómo el crítico de riesgo recalibra el registro después de cada ola.

### Regla de parada

Deje de cazar cuando ocurra lo primero de esto:

1. El presupuesto de agentes se agota (ver abajo).
2. Ninguna amenaza abierta en el registro supera el piso de riesgo configurado.
3. El usuario fijó un número máximo de olas y se alcanzó.

Nunca declare la auditoría "completa" en el sentido de haber agotado toda superficie posible — declare qué amenazas se investigaron, con qué disposición, y liste el resto del registro ordenado por riesgo residual como una brecha explícita, no como un detalle menor del informe.

### Presupuesto

Un puntaje de riesgo no es un número mágico: úselo solo para ordenar la cola, no para prometer una cantidad exacta de hallazgos. Antes de lanzar la primera ola, reserve:

- el reconocimiento inicial y la primera construcción del registro de amenazas;
- un crítico de riesgo por cada ola de caza;
- al menos una asignación de verificador por cada candidato que razonablemente espere encontrar.

Si el presupuesto no alcanza para esas reservas mínimas, no lance cazadores: pida más presupuesto, un piso de riesgo más alto (para investigar menos amenazas pero con la misma rigurosidad), o un alcance más chico. Nunca reduzca la rigurosidad de validación para estirar el presupuesto — reduzca cuántas amenazas se investigan, nunca cuán bien se investiga cada una.

## Principios fundamentales

Estos no cambian sin importar cuántas amenazas se investiguen:

- **Límite y resultado, siempre.** Nombre el principal de menor confianza, la acción aceptada, el control esperado, el límite cruzado, el activo afectado, y el resultado concreto. Una desviación de buena práctica sin esto es hardening, no un hallazgo.
- **`confirmed` exige reproducción local acotada.** Nunca declare `confirmed` solo por lectura de código; necesita un resultado observado dentro del sandbox.
- **`needs_validation` no tiene severidad.** Es una hipótesis fundamentada en el código fuente con un hecho externo faltante, nunca un hallazgo de baja confianza disfrazado.
- **La severidad general nunca supera el impacto demostrado.** Probabilidad e impacto se califican por separado y por lo que la evidencia realmente estableció.
- **El verificador nunca es el cazador.** Sin excepción, incluso bajo presión de presupuesto — si no alcanza para verificar, el candidato queda sin validar, no se publica.
- **La corrección propuesta es la más pequeña que hace cumplir el invariante**, no un consejo genérico de blindaje.

## Flujo de trabajo de auditoría completa

1. **Modelo de amenazas**: reconocimiento del objetivo y construcción de `architecture.md` y `threat-register.json` — [phases/1-threat-model.md](phases/1-threat-model.md).
2. **Olas de caza priorizadas por riesgo**: asignación de cazadores a las amenazas de mayor puntaje, recalibración por un crítico de riesgo después de cada ola — [phases/2-hunting.md](phases/2-hunting.md).
3. **Validación adversarial**: cada candidato único va a un verificador fresco que intenta refutarlo — [phases/3-verification.md](phases/3-verification.md).
4. **Salida estructurada**: registros finales `confirmed`/`needs_validation`/`rejected` en `findings.json`, validados contra `schemas/findings.schema.json` — [phases/4-reporting.md](phases/4-reporting.md).
5. **Verificación final independiente**: agentes frescos revisan los registros finales antes del informe — [phases/3-verification.md](phases/3-verification.md).
6. **Informe orientado a riesgo**: `REPORT.md` lidera con qué riesgo se redujo y qué riesgo residual queda, no con un porcentaje de cobertura de matriz — [phases/4-reporting.md](phases/4-reporting.md).

La trazabilidad entre repositorios — sembrar amenazas a partir de patrones ya vistos en otros repos del mismo scope, y alimentar esos patrones con lo que esta ejecución confirme — se define completa en [reference/cross-repo.md](reference/cross-repo.md) y ocurre dentro de las Fases 1 y 5 de arriba, no como una fase separada.

No termine la ejecución a mitad de una fase. Los únicos dos estados finales válidos son: todos los artefactos de la Fase 6 escritos con los validadores aprobando (`validate-findings.cjs`, `validate-threat-register.cjs --final`, y `validate-cross-repo.cjs` si hay scope cross-repo), o `run_status: "incomplete"` con la razón exacta y la brecha de riesgo residual declarada en el informe.

## Mapa de archivos

| Carpeta | Qué contiene | Quién lo lee |
|---|---|---|
| `phases/` | Una guía por etapa, en orden: [1-threat-model.md](phases/1-threat-model.md), [2-hunting.md](phases/2-hunting.md), [3-verification.md](phases/3-verification.md) (Fases 3 y 5) y [4-reporting.md](phases/4-reporting.md) (Fases 4 y 6) | El padre |
| `prompts/` | Los textos que van textuales en el prompt de cada agente delegado: reconocimiento, cazador, crítico de riesgo, verificadores y procedimiento de promoción. Son la única copia de esos textos | Los agentes delegados, a través del padre |
| `schemas/` | Contratos de `findings.json`, `threat-register.json` y el store cross-repo | El padre, los validadores y los agentes que producen registros |
| `validators/` | Los tres validadores y el motor de schema que comparten | El padre, al cierre de cada fase |
| `reference/` | Temas transversales: aislamiento de escritura, trazabilidad cross-repo, catálogo de clases de ataque y modo diff | Quien los necesite en cualquier fase |
| `scripts/` | `audit-diff.cjs` (modo diff) y `promote.cjs` (promoción de artefactos) | El padre, o CI en modo diff |
| `tests/` | Pruebas de validadores, scripts e integridad de la documentación (`npm test`) | Quien mantiene la skill; no forman parte del procedimiento |

## Antipatrones

1. Tratar el registro de amenazas como una lista fija: si una ola descubre una amenaza nueva y no se agrega al registro, la auditoría empezó a mentir sobre su propio alcance.
2. Usar el puntaje de riesgo inicial como excusa para no revisar nada más una vez que aparece un hallazgo grande — la recalibración existe para redirigir esfuerzo, no para cerrar la caza apenas hay algo que mostrar.
3. Declarar cobertura completa cuando lo que en realidad pasó es que se llegó al piso de riesgo o se agotó el presupuesto.
4. Elevar una desviación de buena práctica o un comportamiento de despliegue deducido a hallazgo de seguridad.
5. Asignar severidad a un registro `needs_validation`.
6. Que el mismo agente cace y verifique el mismo candidato, bajo cualquier justificación de presupuesto.
7. Publicar un hallazgo cuya reproducción local nunca se ejecutó.
8. Escribir el informe antes de que la verificación final independiente termine para todos los registros retenidos.
