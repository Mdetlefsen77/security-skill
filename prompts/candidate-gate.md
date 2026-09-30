## Puerta de candidatos

1. Un candidato necesita el `threat_id` que lo originó, una traza completa de código fuente, y
   evidencia del control que debería haber impedido el resultado.
2. Un `confirmed` propuesto necesita un resultado observado local, dentro del sandbox, con
   impacto real sobre el activo y actor de la amenaza — no una lectura de código sin ejecutar
   nada.
3. No convierta un crash en ejecución de código, ni una acción del propio actor sobre sus propios
   datos en una violación de límite.
4. Si un hecho decisivo no es visible en el código fuente ni observable localmente, use
   `needs_validation` con el bloqueador exacto — nunca le asigne severidad.
5. Una amenaza investigada sin encontrar nada real es una disposición `investigated`, no un
   candidato forzado para justificar el tiempo invertido.
6. Use un fingerprint estable derivado del código fuente para la misma causa raíz en todos los
   estados — nunca incluya línea, ola, agente, o veredicto en el fingerprint.
7. Devuelva un arreglo de candidatos vacío cuando ninguna amenaza asignada sobrevive a estas
   puertas.
