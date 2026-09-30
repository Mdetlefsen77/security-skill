# Salida estructurada e informe

Este archivo reúne las dos fases que escribe el padre: la Fase 4 (`findings.json`) después de la verificación de la Fase 3, y la Fase 6 (informe) después de la verificación final de la Fase 5. Ambas verificaciones están en [3-verification.md](3-verification.md).

### Fase 4: Escribir y validar `findings.json`

Escriba todos los registros decididos de forma independiente en `<directorio-salida>/findings.json`, ordenados por `threat_id` y luego por fingerprint. Lea `schemas/findings.schema.json` inmediatamente antes de escribir — usa `additionalProperties: false`, así que no traslade campos de envoltorio del cazador a un registro final. Cada registro lleva el `threat_id` de la amenaza que lo originó; un registro sin una entrada correspondiente en `threat-register.json` es un error de consolidación, no un caso válido.

Valide `findings.json` contra `schemas/findings.schema.json` con `validate-findings.cjs`, incluido en esta skill — sin dependencias externas, así que corre con cualquier Node.js moderno:

```sh
node <directorio-skill>/validators/validate-findings.cjs <directorio-salida>/findings.json <directorio-salida>/threat-register.json
```

El segundo argumento es opcional pero recomendado: si se lo pasa, el validador también comprueba que cada `threat_id` de `findings.json` exista realmente en `threat-register.json`. Además de la estructura del schema, el script comprueba reglas que un JSON Schema declarativo no puede expresar por sí solo: el orden de la traza (`entrypoint`+ → `propagation`* → `sink`+: varios entrypoints hermanos que comparten la causa raíz, como un POST, un PATCH y un DELETE sin control, van agrupados al principio con al menos un `propagation` donde convergen, y sus sinks agrupados al final), que `overall_severity` nunca supere el impacto demostrado, que ningún fingerprint se repita entre registros, y que los campos marcados `visibleContent` en el schema sean texto legible real y no basura o contenido vacío. Rechaza archivos de más de 5 MiB, más de 1.000 registros de nivel superior, o más de 64 niveles de anidamiento, y limita los errores reportados a 100 mensajes. `validate-findings.test.cjs` corre con `node --test tests/validate-findings.test.cjs` y no requiere ninguna dependencia externa. Corrija cada error estructural antes de avanzar a la Fase 5.

Valide también el registro de amenazas contra `schemas/threat-register.schema.json`:

```sh
node <directorio-skill>/validators/validate-threat-register.cjs <directorio-salida>/threat-register.json <directorio-salida>/findings.json
```

Además de la estructura, comprueba que cada `threat_id` sea el hash de `actor::asset::invariant`, que cada `priority_tier` coincida con la tabla de [phases/1-threat-model.md](1-threat-model.md), que el registro esté ordenado por prioridad, que el estado sea coherente con la evidencia (una amenaza `investigated` tiene rutas, dueño y ola; una `closed_no_finding` no tiene candidatos vinculados) y que cada fingerprint publicado en `findings.json` figure en su amenaza de origen. Al cierre de la ejecución, agregue `--final`: rechaza cualquier amenaza que siga `in_progress`. Las pruebas corren con `node --test tests/validate-threat-register.test.cjs`.

### Fase 6: Informe orientado a riesgo

Solo después de que la Fase 5 termine para cada registro conservado, derive la prosa del informe a partir de los registros finales, el registro de amenazas, y las notas de `hardening`. Un informe de una ejecución incompleta puede reportar los registros ya verificados, pero debe identificar cada amenaza sin resolver como riesgo residual, nunca como un detalle menor al pie.

#### `REPORT.md`

Escriba, en este orden:

1. **Resumen de riesgo**: cuántas amenazas de nivel `critical`/`high` existían en el registro, cuántas se investigaron, y de esas, cuántas se confirmaron. Esto es lo primero que lee alguien que decide si algo se arregla ahora o el próximo sprint — no lo entierre después de la metodología.
2. Alcance de la ejecución: piso de riesgo usado, presupuesto (si se fijó) con agentes gastados versus disponibles, referencia de fuente, y si se usaron registros de ejecuciones anteriores.
3. Tabla de hallazgos confirmados: severidad, `threat_id`, título, actor y activo afectado, resultado observado en una línea.
4. Cada hallazgo confirmado en detalle: ubicación de código fuente, actor de menor confianza, reproducción acotada, condiciones, impacto, y la corrección de código más pequeña.
5. Tabla `NEEDS VALIDATION`: título, `threat_id`, bloqueador exacto, plan de validación local u observado por el propietario. Nunca con severidad.
6. **Riesgo residual**: la lista de amenazas que quedaron `queued` porque su `priority_tier` estaba por debajo del piso configurado, o porque el presupuesto se agotó antes de llegar a ellas — ordenadas de mayor a menor `current_estimate.priority_tier`, cada una con su `why_it_matters`. Esta sección reemplaza a un porcentaje de cobertura: le dice al lector exactamente qué riesgo de negocio queda sin mirar, no cuántas celdas de una matriz quedaron sin marcar.
7. **Patrones cross-repo** (solo si algún registro de esta ejecución tiene `pattern_id`): por cada patrón, su `technique`, cuántas otras ocurrencias tiene y en qué repos del mismo scope, y si algún otro repo comparte `stack_signals` sin tener aún una ocurrencia — como pista de dónde más vale la pena mirar, nunca como afirmación de que la falla existe ahí. Ver [reference/cross-repo.md](../reference/cross-repo.md).
8. Notas de hardening y patrones positivos encontrados.

No describa un registro `rejected` como hallazgo. Menciónelo solo si explica por qué una amenaza que parecía prometedora no llevó a nada.

#### `FINDINGS-DETAIL.md`

Para cada hallazgo confirmado `medium`, `high` o `critical`: la traza y evidencia ordenadas relativas al repositorio, el actor y activo ficticios afectados, la entrada o invocación nativa exacta, el resultado observado y qué invariante prueba, las condiciones necesarias, y la remediación a nivel de código fuente con su caso de regresión.

#### `NEEDS-VALIDATION.md`

Para cada registro sin resolver: la traza de fuente, la evidencia verificada, el bloqueador exacto, la amenaza que lo originó, y cada plan de resolución aplicable. Sin severidad, sin convertirlos en guía de prueba en vivo.

Mantenga el informe proporcional a la evidencia. Una ejecución limpia sobre las amenazas de mayor riesgo puede tener cero registros confirmados — eso es una buena noticia, dígala así, sin inventar hallazgos de severidad baja para llenar una sección.
