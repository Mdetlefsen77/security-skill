# Cómo contribuir

Gracias por querer mejorar `risk-led-security-audit`. Esta skill le dice a un agente de código cómo auditar software ajeno, ejecutar código potencialmente hostil y decidir qué se publica como hallazgo. Un cambio chico en un prompt puede hacer que un agente ejecute algo fuera del sandbox, filtre datos de un cliente o publique un falso positivo con severidad alta. Por eso las contribuciones son bienvenidas, pero pasan por las normas de este documento.

Si algo de acá no cubre su caso, abra un issue antes de escribir código.

## Antes de empezar

- **Cambios grandes, primero un issue.** Una fase nueva, un cambio de schema, un cambio en la tabla de riesgo, un rol de agente nuevo o una modificación de los principios fundamentales se discuten en un issue antes del PR. Los PR grandes sin discusión previa se cierran con un pedido de abrir el issue.
- **Correcciones chicas, directo al PR.** Erratas, links rotos, aclaraciones de redacción y pruebas nuevas para comportamiento existente no necesitan issue.
- **Vulnerabilidades en la skill, nunca en un issue público.** Si encuentra una forma de que el procedimiento de promoción acepte un archivo que debería rechazar, de que un validador apruebe un artefacto inválido, o de que un prompt induzca al agente a salir del sandbox, repórtela con [GitHub Private Vulnerability Reporting](https://github.com/Mdetlefsen77/security-skill/security/advisories/new). No abra un issue ni un PR que la describa hasta que haya una corrección publicada.

## Guardrails: lo que ningún PR puede hacer

Un PR que haga cualquiera de estas cosas se rechaza, sin importar cuán útil sea el resto del cambio.

### Seguridad de ejecución

1. **Debilitar los controles del sandbox** de la sección "Seguridad de ejecución universal" de [SKILL.md](SKILL.md#seguridad-de-ejecución-universal): sin red externa, entorno vacío con lista de permitidos, objetivo de solo lectura, secretos enmascarados y límites de recursos. Si un control no se puede aplicar en una plataforma, la respuesta correcta sigue siendo `needs_validation`, no ejecutar igual.
2. **Agregar pasos que toquen sistemas reales**: sondear endpoints desplegados, usar identidades o datos de producción, consumir cuota paga de terceros o llamar a servicios externos durante una auditoría.
3. **Relajar el procedimiento de promoción** de [prompts/promotion-procedure.md](prompts/promotion-procedure.md) o de `scripts/promote.cjs`: aceptar symlinks, hardlinks, archivos especiales, subdirectorios, nombres fuera de la lista declarada o límites de tamaño más altos por defecto. Endurecerlo sí se acepta, con pruebas.
4. **Dar al agente o al sandbox acceso de escritura** a `artifacts/`, al árbol del objetivo, a `/tmp`, al directorio personal o al directorio de otro agente.

### Integridad de los hallazgos

5. **Romper los principios fundamentales** de [SKILL.md](SKILL.md#principios-fundamentales). En particular:
   - permitir `confirmed` sin reproducción local dentro del sandbox;
   - asignar severidad a un registro `needs_validation`;
   - dejar que la severidad supere el impacto demostrado;
   - dejar que un mismo agente cace y verifique el mismo candidato, incluso "solo cuando falta presupuesto".
6. **Bajar la rigurosidad para ahorrar presupuesto.** Se puede investigar menos amenazas, nunca investigarlas peor.
7. **Permitir que la auditoría se declare completa** cuando en realidad se alcanzó el piso de riesgo o se agotó el presupuesto.

### Confidencialidad

8. **Mezclar scopes en el store cross-repo**, o permitir que nombres de repos, clientes, organizaciones, rutas o fragmentos de código real lleguen a los campos genéricos de un patrón. `validators/validate-cross-repo.cjs` lo verifica, y un PR no puede desactivar ese chequeo.
9. **Incluir datos de auditorías reales**: hallazgos, `threat-register.json`, `findings.json`, `REPORT.md`, nombres de repos auditados, rutas internas, credenciales o capturas. Todo ejemplo, fixture y prueba usa principales, repos y secretos ficticios.
10. **Incluir exploits funcionales contra software de terceros identificable.** Los ejemplos de técnicas de [reference/attack-classes.md](reference/attack-classes.md) describen la clase de ataque y cómo reconocerla en el código, no un payload listo para usar contra un producto concreto.

### Proyecto

11. **Agregar dependencias.** La skill no tiene dependencias en tiempo de ejecución ni de desarrollo, y se corre con Node ≥ 18 y la librería estándar. Un PR que agregue un `node_modules` se rechaza; si cree que una dependencia es imprescindible, abra un issue.
12. **Desactivar, saltear o debilitar pruebas** para que un cambio pase.

## Normas de diseño

Además de los guardrails, estas normas mantienen la skill coherente. Un PR que no las cumpla recibe pedido de cambios, no un rechazo.

### Una sola copia normativa

Cada texto normativo vive en un solo lugar y el resto lo referencia:

- los textos que van textuales a un agente delegado viven solo en `prompts/`;
- el procedimiento de promoción vive solo en [prompts/promotion-procedure.md](prompts/promotion-procedure.md);
- los contratos de los artefactos viven solo en `schemas/`;
- la tabla de probabilidad × daño vive solo en [phases/1-threat-model.md](phases/1-threat-model.md).

Si su cambio necesita repetir una regla en otro archivo, enlácela en lugar de copiarla.

### Cambios de contrato

Un cambio en un schema de `schemas/` va en el mismo PR que:

1. el validador correspondiente en `validators/`;
2. las pruebas que cubren el caso nuevo y el caso inválido;
3. los prompts y las fases que producen o consumen ese campo;
4. una nota en la descripción del PR que diga si los artefactos existentes siguen validando o no.

### Tabla de riesgo y priorización

La tabla de probabilidad × daño no está calibrada todavía (ver "Pendiente" en el [README](README.md#pendiente)). Los cambios son bienvenidos, pero deben traer evidencia: qué auditorías se observaron (anonimizadas), qué priorizaba mal la tabla actual y cómo cambia el orden con la propuesta. "Me parece más razonable" no alcanza.

### Redacción

- Español, en el mismo registro que el resto de la documentación: trato de usted, sin regionalismos marcados.
- Terminología neutral de plataforma: **padre**, **cazador**, **verificador** y **crítico de riesgo**. No nombre un producto de agente concreto en el procedimiento; eso va, si hace falta, en `reference/`.
- Los estados de un registro se escriben siempre igual: `confirmed`, `needs_validation`, `rejected`.
- Sea preciso antes que exhaustivo. Una instrucción ambigua en un prompt se convierte en comportamiento ambiguo del agente.

### Archivos y links

- Los links relativos, sus anchors y las rutas de la skill citadas entre backticks se verifican en `tests/docs.test.cjs`. Si renombra o mueve un archivo, actualice todas las referencias y agregue el nombre anterior a `OLD_NAMES` en esa prueba.
- Si agrega, quita o renombra un archivo, actualice la tabla de archivos del [README](README.md) y el "Mapa de archivos" de [SKILL.md](SKILL.md#mapa-de-archivos).

## Pruebas

```bash
npm test
```

Todas las pruebas deben pasar antes de pedir revisión. Además:

- todo cambio de comportamiento en `validators/` o `scripts/` trae pruebas nuevas, incluido al menos un caso que el código debe rechazar;
- los fixtures de las pruebas son ficticios y chicos;
- las pruebas no usan red, no invocan un `claude -p` real y no escriben fuera de un directorio temporal propio.

Si el cambio afecta el comportamiento de un agente (un prompt o una fase), las pruebas automáticas no alcanzan. Describa en el PR cómo lo probó: contra qué repo de ejemplo o fixture (nunca uno de un cliente), qué resultado obtuvo antes y después, y qué registros cambiaron.

## Zonas sensibles

Los PR que tocan estos archivos reciben una revisión más estricta y pueden tardar más:

| Archivo | Por qué |
|---|---|
| `SKILL.md` (secciones "Seguridad de ejecución universal" y "Principios fundamentales") | Definen qué puede ejecutar el agente y qué cuenta como hallazgo |
| `prompts/promotion-procedure.md`, `scripts/promote.cjs`, [reference/write-isolation.md](reference/write-isolation.md) | Único punto donde algo cruza del lado del objetivo al lado del padre |
| `prompts/verifier-phase3.md`, `prompts/verifier-phase5.md` | Deciden qué se publica |
| `validators/` y `schemas/` | Última barrera antes del informe |
| [reference/cross-repo.md](reference/cross-repo.md), `validators/validate-cross-repo.cjs` | Confidencialidad entre repos y clientes |
| `scripts/audit-diff.cjs` | Corre en CI con permisos y decide si un pipeline falla |

## Proceso del PR

1. Haga un fork y trabaje en una rama con un nombre descriptivo (`fix/promote-hardlink`, `docs/diff-mode-ci`).
2. Un PR, un cambio. No mezcle una corrección con una refactorización o con un cambio de redacción no relacionado.
3. Mensajes de commit en imperativo y en español, con una primera línea de hasta 72 caracteres (`Rechazar hardlinks en promote.cjs`).
4. Complete la descripción del PR con:
   - **Qué cambia y por qué**, con link al issue si lo hay;
   - **Guardrails**: confirmación de que el cambio no toca ninguno, o explicación de por qué uno no aplica;
   - **Pruebas**: salida de `npm test` y, si toca prompts o fases, cómo lo probó con un agente;
   - **Compatibilidad**: si los artefactos generados con la versión anterior siguen validando.
5. Mantenga la rama al día con `main`. Los PR se integran con squash.
6. El mantenedor puede pedir cambios, dividir el PR o cerrarlo si contradice la dirección de la skill. Un PR cerrado no es un juicio sobre usted: la discusión puede seguir en el issue.

### Contribuciones generadas con IA

Se aceptan PR escritos con ayuda de agentes de IA, con estas condiciones:

- quien abre el PR es responsable del contenido, lo leyó completo y puede explicar cada cambio;
- lo declara en la descripción del PR;
- las pruebas se corrieron de verdad, y la salida pegada es la real;
- el agente no inventó referencias, anchors, rutas ni resultados de auditorías.

## Licencia

Al enviar un PR, acepta que su contribución se publique bajo la licencia MIT del proyecto (ver [LICENSE.txt](LICENSE.txt)).
