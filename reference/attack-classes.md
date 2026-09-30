# Clases de ataque

#### Biblioteca de técnicas, no una asignación fija

Como ya dice [phases/2-hunting.md](../phases/2-hunting.md), un cazador no recibe una clase de ataque como mandato exclusivo: recibe una amenaza (actor, activo, invariante) y consulta esta lista como catálogo de formas conocidas en que ese tipo de código suele fallar. No fuerce una clase que no tiene nada que ver con el activo en juego, y no descarte un hallazgo real solo porque no encaja prolijamente en ninguna categoría de abajo — para eso está **Wildcard**, al final.

Use `confirmed` solo cuando la evidencia del código fuente y una comprobación local acotada establezcan el límite completo y un resultado real sobre el activo de la amenaza. Use `needs_validation` cuando el hecho decisivo dependa de algo fuera del código fuente y del sandbox — un comportamiento de la plataforma de despliegue, del proveedor de hosting, de un servicio de terceros — y dígalo explícitamente en vez de asumirlo en cualquier dirección.

## Injection

Cualquier punto donde una entrada de menor confianza termina formando parte de un comando, consulta, o instrucción que otro componente va a interpretar. El error casi nunca está en el primer lugar donde se usa el dato — está en el segundo o tercer lugar, donde alguien asumió que ya venía limpio.

- Consultas a bases de datos armadas por concatenación de strings en vez de parámetros — buscar esto en capas de acceso a datos escritas a mano, fuera del ORM.
- Comandos de shell, rutas de archivo, o argumentos de un binario externo construidos con datos que vinieron de un formulario o de una API.
- Renderizado de HTML sin escapar en cualquier lugar que no sea el flujo normal del framework (emails generados a mano, PDFs, exportaciones, logs que después se muestran en un panel).
- El mismo dato guardado "seguro" en un paso y reinterpretado como código, ruta, o comando en un paso posterior de otro módulo — mensajes de cola, tareas programadas, webhooks salientes.
- Metadatos que nadie trata como entrada: nombres de campo, claves de un objeto JSON, encabezados HTTP, nombres de archivo subidos.

Pregunta guía: si este valor viniera de un actor hostil, ¿en qué intérprete termina, y ese intérprete distingue datos de instrucciones?

## Access control

No alcanza con que exista un chequeo de permiso — hay que verificar que sea el chequeo correcto, sobre el recurso correcto, en cada camino que llega a ese recurso.

- Dos rutas de código distintas llegan al mismo cambio de estado, pero cada una implementa su propio chequeo de permiso — ¿son realmente equivalentes, o una quedó desactualizada?
- Un campo del cuerpo de la petición (`ownerId`, `tenantId`, `role`) que el cliente puede mandar y que el servidor usa sin volver a verificarlo contra la sesión real.
- Operaciones en lote o de importación/exportación masiva: el chequeo de permiso de la operación individual no siempre se replica cuando la misma acción se hace para 500 registros de una.
- Rutas que verifican autenticación (¿hay sesión?) pero no autorización (¿esta sesión puede hacer esto?) — el error clásico de mezclar "logueado" con "autorizado".
- Un recurso con varios identificadores (id numérico interno + slug público, por ejemplo) donde el chequeo de permiso se hizo contra uno y el acceso real ocurre por el otro.

Pregunta guía: para esta acción puntual, ¿qué principal específico debería poder hacerla, y el código verifica exactamente eso o algo más amplio "que en la práctica suele coincidir"?

## Lógica de negocio

Los escáneres automáticos no encuentran esta clase — hace falta leer el flujo completo y pensar como quien se beneficiaría de romperlo.

- **Máquinas de estado**: ¿se puede saltar un paso, repetir una transición ya hecha, o volver a un estado anterior llamando a un endpoint fuera de orden? ¿Qué pasa si una operación de varios pasos falla a la mitad — queda a medio hacer de forma explotable?
- **Carreras con impacto real**: dos requests concurrentes a una operación de "verificar y luego actuar" (descontar stock, aprobar un pago, marcar un cupo como tomado) — ¿hay una transacción o un lock, o gana el que llegue último?
- **Números en los bordes**: cantidades negativas, cero, el valor exacto en el límite de una validación, overflow de un contador, redondeo que beneficia sistemáticamente a un lado.
- **Confianza heredada sin revalidar**: un dato que se validó al entrar al sistema, y que un módulo distinto vuelve a leer más tarde asumiendo que sigue siendo válido — sin considerar que otra ruta pudo haberlo escrito directamente.
- **Comportamiento por defecto**: ¿qué hace el sistema cuando falta una configuración, un feature flag está apagado, o una dependencia externa no responde? El camino "por si acaso" suele ser el menos revisado.

Pregunta guía: si dos usuarios (o el mismo usuario dos veces) hacen esto exactamente al mismo tiempo, o si alguien llama a los pasos en un orden que la interfaz nunca permitiría pero la API sí, ¿el resultado sigue siendo válido?

## Abuso de funcionalidad legítima

Una funcionalidad que hace exactamente lo que dice, usada para un fin distinto al que se pensó.

- Un export, backup, o reporte que un usuario de bajo privilegio puede disparar, y que trae más datos de los que ese usuario podría ver uno por uno en la interfaz normal.
- Un buscador o filtro que responde distinto (existe / no existe, error distinto, tiempo de respuesta distinto) según si el recurso existe pero no es accesible, versus si directamente no existe — eso es un oráculo de enumeración.
- Un campo de "URL de notificación" o "webhook de callback" que el propio servidor va a visitar — ¿se valida que no apunte a una IP interna, a metadata del proveedor de nube, o a un puerto que no debería ser alcanzable desde afuera?
- Contenido en borrador, preview, o con un token de acceso temporal que termina siendo indexado, cacheado, o accesible por una ruta secundaria que nadie pensó en proteger igual que la principal.
- Cualquier acción que un usuario válido puede repetir sin límite y que consume un recurso compartido, un cupo, o dinero de la organización.

Pregunta guía: si un usuario legítimo (no un atacante externo) usa esta funcionalidad de la forma menos esperada pero técnicamente permitida, ¿a quién perjudica?

## Cadenas y límites de confianza compuestos

Un componente aislado puede estar bien, y aun así la combinación con otro componente rompe una garantía que ninguno de los dos rompía por separado.

- Componente A valida y sanitiza una entrada; componente B la recibe y asume una garantía más fuerte de la que A realmente ofrece (tamaño, encoding, ausencia de cierto carácter).
- Un dato guardado como texto plano en un contexto se reinterpreta como ruta de archivo, expresión regular, o consulta en otro contexto más adelante.
- Un token, credencial delegada, o permiso que se vuelve más amplio de lo esperado después de un refresh, una composición de scopes, o un cambio de rol — ¿alguien verificó que la unión de permisos siga siendo la intención original?
- Restauración desde backup, deshacer un borrado, o revertir una migración: ¿esas operaciones vuelven a aplicar las reglas de autorización y validación actuales, o resucitan el estado (y los permisos) de cuando se guardaron?

Pregunta guía: enumere, para el activo en juego, exactamente qué puede leer/escribir/invocar cada componente por separado — después busque dónde el componente siguiente asume algo más de lo que el anterior realmente garantiza.

## Manejo de archivos y recursos

- Rutas de archivo construidas con un nombre o identificador que viene del usuario, sin normalizar — ¿se puede escapar del directorio esperado con `../`, una codificación alternativa, o un enlace simbólico?
- El servidor obtiene contenido de una URL que el usuario controla (una imagen de perfil por URL, una vista previa de un link) — ¿puede esa URL apuntar a un recurso interno de la red del propio servidor?
- Deserialización de un formato complejo (archivos comprimidos, documentos de office, formatos con esquemas propios) sin límites de tamaño, de profundidad, o de expansión — la puerta de entrada clásica a agotamiento de recursos y, en algunos formatos, a ejecución.
- El tipo de un archivo subido se determina por lo que el cliente declaró (nombre, extensión, `Content-Type`), no por los bytes reales — ¿algo en el sistema confía en esa etiqueta más de lo que debería?
- Dos operaciones sobre el mismo archivo separadas en el tiempo (se verifica algo, después se usa) donde el archivo pudo cambiar entre medio.

Pregunta guía: para cada dato que termina siendo una ruta, una URL, o el contenido de un archivo, ¿de dónde vino y qué lo normalizó antes de usarse?

## Criptografía y secretos

- Generación de valores que deberían ser impredecibles (tokens de sesión, de reseteo de contraseña, IDs de recursos sensibles) usando una fuente de aleatoriedad no criptográfica.
- Secretos, claves, o credenciales que aparecen en logs, mensajes de error, respuestas de API, o el propio historial de control de versiones.
- Comparación de secretos (contraseñas ya hasheadas correctamente, tokens, firmas) con un operador de igualdad normal en vez de uno de tiempo constante, cuando el valor comparado nunca debería filtrar información por temporización.
- Qué pasa exactamente cuando una operación criptográfica falla — ¿el código cae a un modo sin cifrar, sin verificar, o sin autenticar "por las dudas", en vez de directamente fallar la operación completa?

Pregunta guía: si este valor secreto se filtrara hoy, ¿cuánto de la seguridad del sistema depende únicamente de que siga siendo secreto, versus de un control adicional que seguiría funcionando igual?

## Lo obvio (revisar siempre, sin excusa)

Esta categoría no requiere creatividad — requiere ser prolijo y no asumir que "seguro alguien ya lo revisó":

- Credenciales, tokens, o claves de API hardcodeadas en el código fuente o en archivos de configuración commiteados.
- Comentarios `TODO`/`FIXME`/`HACK` que mencionan seguridad, auth, o validación pendiente.
- Un modo debug o de desarrollo que se puede activar en producción vía variable de entorno, parámetro de URL, o header.
- Endpoints de diagnóstico, salud, métricas, o administración sin protección — buscarlos también por los nombres que no aparecen en la navegación normal de la app.
- Dependencias sin versión fijada, o con vulnerabilidades conocidas ya publicadas para la versión exacta que usa el proyecto.
- Cookies de sesión sin los atributos que corresponden a su sensibilidad (las de scope HTTP-only, las que solo deberían viajar por HTTPS, las que no deberían enviarse en navegación cross-site).
- Redirecciones que aceptan un destino controlado por el usuario sin lista de permitidos.

Para cada ítem de esta lista: encontrar la señal es el primer paso, no el hallazgo. Verifique el camino completo — una cookie sin cierto atributo solo importa si de hecho contiene algo sensible o si JavaScript necesita leerla por diseño.

## Wildcard

No tiene una categoría asignada. Busque fuera de lo que las clases de arriba ya cubren.

- El código que se ve raro, incompleto, o "temporal" suele tener la revisión más floja — es donde más vale la pena mirar dos veces.
- Use la API directamente, de formas que la interfaz normal nunca generaría — ¿qué permite el backend que el frontend simplemente nunca pide?
- Revise el historial de control de versiones en busca de chequeos de seguridad comentados, o secretos que se borraron pero siguen en un commit anterior.
- Combine dos funcionalidades que nunca se probaron juntas a propósito — cada una por separado puede estar bien.
- Una función con un comentario que explica por qué algo "es seguro así" merece que se verifique esa explicación, no que se le crea.

Persiga la anomalía dentro del alcance de su amenaza asignada hasta poder decir, con evidencia, si es segura o no — no la deje sin resolver solo porque no encaja en una categoría con nombre.
