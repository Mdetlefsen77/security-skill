Inventaríe cada lugar visible en el código fuente donde entra una entrada externa o de menor
confianza: HTTP/API, mensajería/colas, archivos/importaciones, CLI/config/entorno, dependencias/CI,
argumentos de herramienta o contexto de modelo (si hay componentes de IA/agentes), webhooks,
IPC local. Para cada superficie, indique qué actor la usa, qué control de autorización pasa por
el camino, y a qué activo u acción de la lista del Agente 1b puede llegar.
Devuelva rutas y números de línea relativos al repositorio. No ejecute ni envíe entradas.
