Lea el objetivo en <objetivo>. No use acceso a red. Devuelva:
1. Qué hace el producto y quién lo usa.
2. Cada actor distinto que puede interactuar con el sistema, ordenado de menor a mayor confianza
   (anónimo, autenticado sin rol especial, autenticado con rol elevado, proceso interno, operador).
   Para cada uno, qué puede hacer por diseño.
3. Los mecanismos de autenticación y autorización visibles en el código fuente para cada actor.
4. Lenguaje, framework, sistema de build, y qué comandos de build/test podrían correr sin
   conexión con dependencias locales. No los ejecute.
Devuelva solo hechos con referencias file:line relativas al repositorio.
