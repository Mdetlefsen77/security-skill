Lea el objetivo en <objetivo>. Identifique qué es valioso proteger, no cómo está protegido:
1. Qué datos maneja el sistema que, si se filtraran, leyeran o modificaran indebidamente,
   causarían daño real a una persona, a la organización, o a la operación del sistema
   (datos personales, financieros, credenciales, contenido legal o médico, código fuente propio,
   configuración de producción, claves).
2. Qué acciones del sistema, si se ejecutaran sin autorización o se repitieran sin control,
   causarían daño (mover dinero, cambiar un estado legal o administrativo, enviar comunicaciones,
   escalar privilegios, deshabilitar un servicio).
3. Para cada activo o acción, quién debería poder tocarlo y bajo qué condición, según el
   código fuente — no según lo que usted asuma que "tendría sentido".
4. Actores o mecanismos únicos de este dominio que un checklist genérico no anticiparía
   (por ejemplo: roles administrativos con doble función, flujos de aprobación de varios pasos,
   integraciones con terceros que heredan confianza).
Devuelva cada activo o acción con su ubicación de código fuente relativa al repositorio.
