# Aislamiento de escritura

Este archivo explica el procedimiento de sandbox y promoción de artefactos. El texto normativo del procedimiento vive en `prompts/promotion-procedure.md`, que `phases/2-hunting.md` y `phases/3-verification.md` incluyen textual en cada prompt de cazador o verificador. Si necesita corregir un paso, corríjalo únicamente ahí.

## Por qué existe

Un cazador o verificador ejecuta, dentro del sandbox, código y fixtures que en última instancia vienen del objetivo que está auditando — que puede ser hostil o simplemente estar mal formado. Cuando ese proceso termina, su directorio `scratch/` sigue estando bajo control del objetivo, no del padre: nada le impidió crear un symlink que apunte fuera del sandbox, un hardlink a un archivo del host, un socket, o un archivo que cambia de contenido entre el momento en que se lo inspecciona y el momento en que se lo copia. "Promover" ese contenido a un artefacto conservado es la única vez que algo cruza del lado del objetivo al lado del padre — y por eso es el único punto donde vale la pena una lista de verificación estricta en vez de confiar en el criterio del agente que ejecutó el sandbox.

## Qué aísla y qué no

El sandbox forzado por el sistema operativo aísla al **proceso del objetivo**: lo que un cazador o verificador compila, prueba o ejecuta. No aísla al **agente** en sí. Un cazador corre con los permisos de la plataforma que lo lanzó, y que escriba solo en su `scratch/` depende de que cumpla su prompt, no de un control técnico. Cuando la plataforma lo permita, lance cazadores y verificadores con permisos de escritura restringidos a su raíz `agents/<id-agente>/scratch/`. Si no lo permite, declárelo en el alcance del informe; y en ningún caso trate los archivos de `scratch/` como confiables, que es justamente lo que asume el procedimiento de promoción de abajo.

## Raíces y propiedad

Cada cazador o verificador recibe una raíz única bajo `<directorio-salida>/agents/<id-agente>/`, con `scratch/` y `artifacts/` como subdirectorios separados. El ID de agente es canónico en minúsculas, coincide con `^[a-z0-9][a-z0-9_-]{0,63}$`, y no es un nombre de dispositivo reservado de Windows (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`). El agente y cualquier proceso controlado por el objetivo solo pueden escribir en `scratch/`. El directorio `artifacts/` es propiedad exclusiva del padre: nunca se expone al sandbox, y solo el código de promoción de confianza del lado del padre puede leerlo o escribirlo. Ningún agente puede tocar archivos compartidos, el código fuente objetivo, artefactos ya conservados, o el directorio de otro agente. `/tmp` y el directorio personal del host nunca son una alternativa de escritura válida.

## El procedimiento

El texto normativo está en [prompts/promotion-procedure.md](../prompts/promotion-procedure.md), porque va textual en cada prompt de cazador y verificador. Es la única copia: corríjalo ahí.

## Implementación de referencia

`scripts/promote.cjs` implementa este procedimiento para Linux, sin dependencias externas y con pruebas en `tests/promote.test.cjs`:

```sh
# antes de lanzar al agente: raíces y artefactos esperados, con sus límites
node <directorio-skill>/scripts/promote.cjs init <directorio-salida> <id-agente> --files harness-1.cjs,output-1.txt [--per-file 65536] [--total 262144]
# cuando el sandbox y el agente terminaron
node <directorio-skill>/scripts/promote.cjs promote <directorio-salida> <id-agente>
```

`init` escribe `agents/<id-agente>/expected-artifacts.json` fuera de `scratch/`, así que el agente no puede alterar la lista. `promote` imprime `{"promoted", "absent", "rejected"}` y sale con 1 si rechazó algo. Solo acepta nombres planos (sin subdirectorios), que es más estricto que el procedimiento. En otras plataformas no promueve nada y la evidencia queda como `needs_validation` (paso 11).

## Registro de una comprobación reproducida

Cuando registre el comando y la entrada exacta de una comprobación local, anote también los límites del sandbox usados y solo los nombres de variables de entorno de la lista de permitidos junto con valores seguros no secretos — nunca el entorno ambiente completo, variables heredadas, credenciales, estado de sesión, o rutas del host que no correspondan. Arranque siempre desde un entorno vacío en vez de intentar limpiar uno después de ejecutar.
