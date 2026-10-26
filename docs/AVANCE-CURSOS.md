# Vista del curso y avance

El encabezado del estudiante reúne la portada, los accesos a notas, actividades y novedades, y el avance total. El siguiente paso prioriza una corrección solicitada, entregas próximas y borradores antes de continuar con materiales nuevos. Los capítulos se pueden desplegar, buscar y filtrar sin cambiar el porcentaje global. Los recursos rápidos quedan agrupados como recursos de apoyo.

Cada material completado, tarea entregada y cuestionario enviado aporta un elemento al avance. Una entrega puede contar aunque su nota todavía no esté publicada: el avance representa trabajo realizado, no una calificación. Los borradores, las devoluciones para corregir y las entregas invalidadas siguen pendientes. Una corrección usa su nuevo plazo; si no tiene plazo, no recupera la fecha original de entrega.

Se cuentan los contenidos publicados que el estudiante puede ver. Las actividades programadas ya visibles se incluyen como pendientes. Los borradores del docente y el contenido de capítulos ocultos quedan fuera del cálculo. El porcentaje solo llega a 100 cuando todos los elementos contados están completos; un curso sin contenido muestra 0. Las barras de los capítulos y las tarjetas de Mi aprendizaje utilizan el mismo criterio. Los recursos de apoyo no tienen un registro de finalización y no forman parte de ese porcentaje.

En la vista docente, el selector **Orden de capítulos** permite elegir ascendente o descendente y guarda la elección para ese curso o grupo, sin un diálogo adicional. El orden se basa en la posición de los capítulos. Cambiarlo invierte la lista y conserva su numeración de referencia. Solo una persona con permiso de edición puede modificarlo; las copias y los respaldos conservan la configuración.

Para compatibilidad, `/api/learning` mantiene los campos anteriores de materiales (`total`, `completed`, `opened`) y añade `overall` con el resumen integral. La elección de orden se conserva en `courses.chapter_order`, con `asc` como valor inicial para los cursos existentes.
