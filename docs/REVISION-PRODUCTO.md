# Revisión de interfaz y recorridos · 25 de septiembre de 2026

La revisión corrige accesos ambiguos y acciones dispersas después de la incorporación de grupos, biblioteca, evaluación y permisos.

## Estudiantes

- Cada tarjeta mantiene **Abrir curso**, con **Continuar** como acción independiente cuando ya existe avance.
- Los cursos ocupan el lugar principal del inicio. Las próximas entregas y materiales recientes aparecen debajo; los pendientes se actualizan al volver después de entregar.
- El curso muestra actividades pendientes en su lateral y conserva actividades/notas a la derecha del resumen de avance.
- Después de entregar se muestra una confirmación persistente. Si quedan intentos, la siguiente entrega se abre de manera explícita.
- Se conserva el visor de materiales a pantalla completa y el regreso al curso.

## Docentes y administración

- Navegación única con iconos, sección activa y título de página coherentes; separación entre plantillas, grupos, evaluación y usuarios.
- Resumen con grupos, matrículas y entregas por revisar, en lugar de instrucciones de primera configuración.
- Menús de opciones en capítulos y materiales; creación y reutilización agrupadas al pie de cada capítulo.
- Biblioteca con nombres de tipos en español, título sugerido al guardar y destino del capítulo conservado al reutilizar. Tras insertar, se abre el curso de destino.
- Cortes editables mediante nombres y porcentajes, total visible y conservación de los identificadores existentes.
- Estado de curso/cuenta y permisos docentes cargados con sus valores reales.
- Matrículas con búsqueda, grupos identificados por semestre/código y destinos limitados por permisos. El traslado excluye el grupo de origen.
- Controles de edición/calificación/gestión acordes con el permiso. Los recursos rápidos de lectura siguen disponibles.
- Primer acceso docente indica los 12 caracteres que exige el servidor; estudiantes mantienen el mínimo de 4.

## Interacción y presentación

- Espaciado, tarjetas, acciones, formularios y tablas con estilos compartidos; botones con texto e icono.
- Envíos protegidos contra doble clic, errores de formulario con foco y navegación sin redibujados duplicados.
- Aviso dentro del formulario antes de descartar cambios; opciones para continuar o descartar.
- Menú móvil con cierre visible, fondo pulsable, foco acotado y cierre con Escape.
- Navegación conservada cuando una página no puede cargarse.

## Comprobación

- Pruebas automáticas de permisos, matrículas, biblioteca, evaluación, publicación y seguridad, más regresiones de apertura de curso, navegación, destinos y cortes.
- Recorridos con datos sintéticos: alumno abre un curso/material, registra avance, guarda borrador y entrega; docente con solo calificación revisa y guarda una nota; administración crea actividad y copia un material al capítulo elegido.
- Inspección visual en escritorio y pantallas de 390 y 320 píxeles, incluida ausencia de desbordamiento horizontal en inicio/curso del estudiante.
- La revisión no modifica el esquema de datos ni los registros académicos de producción.
