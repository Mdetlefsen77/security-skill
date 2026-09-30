Procedimiento de promoción de artefactos (solo código de confianza del lado del padre; el
cazador o verificador nunca ejecuta estos pasos, solo los conoce como referencia):

Antes de que el sandbox arranque, el padre abre y retiene descriptores de directorio de
confianza, no heredables, para las raíces scratch/ y artifacts/ del agente. Registra de
antemano qué nombres de archivo relativos a scratch espera como artefactos, más un límite
explícito de bytes por archivo y un límite acumulativo. Esos descriptores nunca se pasan al
agente ni al sandbox. Cuando el sandbox y todos sus procesos terminaron, el padre promueve cada
archivo esperado, uno por uno:

1. Rechace la ruta declarada si es absoluta, vacía, contiene `.` o `..`, o cualquier componente
   es un enlace simbólico.
2. Llegue hasta el padre inmediato del archivo recorriendo cada componente desde el descriptor
   de la raíz scratch retenida, con operaciones relativas al directorio que nunca sigan enlaces
   simbólicos. Nunca vuelva a abrir por ruta de texto en ningún paso.
3. Abra el archivo en modo no bloqueante, sin seguir enlaces simbólicos.
4. Antes de copiar una sola línea, verifique con `fstat` que es un archivo regular, que su
   contador de enlaces (link count) es exactamente uno, y que su tamaño está dentro de los
   límites por archivo y acumulativo registrados de antemano.
5. Vuelva a aplicar esos mismos límites mientras lee del descriptor — no confíe solo en el
   `fstat` inicial.
6. Copie exactamente el tamaño verificado, repita el `fstat`, y rechace la copia si la
   identidad, el tipo, el contador de enlaces, o el tamaño cambiaron entre la verificación y el
   copiado.
7. Del lado del destino, recorra cada componente del padre desde el descriptor de la raíz
   artifacts retenida, sin seguir enlaces simbólicos. Cada componente que ya exista debe ser un
   directorio real; cree los que falten de forma exclusiva y vuelva a abrirlos y verificarlos sin
   seguir enlaces antes de continuar.
8. Cree el archivo de destino de forma exclusiva (falla si ya existe), sin seguir enlaces.
   Verifique que lo que quedó abierto es un archivo regular con contador de enlaces exactamente
   uno, y copie desde el descriptor de origen ya verificado sin volver a abrir ninguna de las
   dos rutas por texto.
9. En sistemas no POSIX, use las APIs equivalentes que ofrezcan las mismas garantías contra
   condiciones de carrera — el objetivo es el resultado, no la sintaxis de una plataforma
   específica.
10. Nunca copie de forma recursiva, nunca use comodines sobre scratch, nunca extraiga un
    archivo comprimido dentro de artifacts, y nunca abra ni promueva un enlace simbólico, FIFO,
    socket, dispositivo, directorio, archivo con múltiples enlaces duros, o un archivo que
    exceda cualquiera de los límites registrados.
11. Si cualquiera de estas comprobaciones no está disponible, no se puede aplicar, o falla,
    descarte esa entrada de scratch sin promoverla. Si esa evidencia era decisiva para un
    candidato, regístrelo como `needs_validation` con el bloqueador exacto de promoción — nunca
    la fuerce igual ni la reemplace por una suposición.
