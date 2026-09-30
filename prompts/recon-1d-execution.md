Lea pruebas, definiciones de build, manifiestos y overlays de entorno mantenidos. Devuelva:
1. Fixtures o pruebas existentes que puedan validar un límite de confianza con datos ficticios
   dentro de un sandbox forzado por el sistema operativo.
2. Si la plataforma local puede forzar un entorno vacío con lista de permitidos, sin red externa,
   montajes de solo lectura, escrituras exclusivas en scratch, y límites de recursos explícitos.
   Los controles faltantes bloquean la ejecución controlada por el objetivo (ver `needs_validation`
   en `SKILL.md`).
3. Comandos que obtendrían dependencias, publicarían artefactos, o afectarían estado compartido;
   márquelos prohibidos para esta ejecución.
