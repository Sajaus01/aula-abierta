# Correcciones de la auditoría del 25 de septiembre de 2026

1. Vista de estudiante de actividades guardadas, incluidas las que están en borrador o tienen fechas futuras. Es un modo docente de solo lectura, autorizado por curso y actividad; no crea intentos, entregas ni avances.
2. Biblioteca reutilizable accesible también desde la lista de actividades, además del capítulo.
3. Vista previa recursiva de capítulos, materiales, laboratorios, preguntas y adjuntos de actividades. Los archivos de la biblioteca conservan sus permisos.
4. Archivos por pregunta: imágenes, PDF y documentos. Hasta cinco por pregunta, cincuenta adjuntos docentes y veinte MB en total por actividad. Las entregas de estudiantes mantienen su límite anterior. Las imágenes permiten una descripción alternativa.
5. Paleta principal/acento/fondo/texto, tipografía y tamaño aplicados a curso, actividades, notas y vista previa. Se validan contrastes de la paleta. Las copias conservan una apariencia independiente.
6. Cada plantilla muestra enlaces a sus grupos.
7. Los porcentajes de actividades se muestran por corte; se distingue el peso del corte en la nota final. Los códigos de cortes se conservan al reordenar y no se permite eliminar uno con actividades asignadas.
8. Se solicita confirmación del impacto aun si la actividad editada carece de respuestas propias. La simulación conserva la escala histórica de las respuestas y contempla la exigencia de repetir.
9. Actividades iniciadas: apertura del formulario disponible o existencia de borrador/entrega, contadas una vez por estudiante y actividad en el intervalo. Abrir no demuestra resolución.
10. Gráficas de cambios de puntos por estudiante/actividad, comparación de promedio y progreso entre grupos, y descarga del informe completo en JSON, además del CSV resumido. Las comparaciones indican la escala y usan el estado completo actual de los grupos.
11. El filtro de actividad no altera el promedio general. Las actividades exentas quedan fuera de alertas de pendientes y vencidas.
12. Registro de resultados de laboratorio deshabilitado, opcional o requerido para marcarlo completado. Los resultados aparecen con nombre y fecha en estadísticas, visor y reporte.
13. El panorama del máster muestra responsable y objeto identificable de cada evento; se conservan los identificadores para objetos históricos que ya no existen.
14. La migración reconoce y reutiliza un grupo 2026-1 existente sin crear otro grupo. Conserva respuestas y avances, y deja historial al conciliar matrículas duplicadas. Si ambos destinos tienen esquemas de calificación incompatibles, revierte la transacción y pide resolver el conflicto: nunca elige silenciosamente una escala que cambie notas. Una migración ya completada sigue sin repetirse.
15. Revisión de interfaz con datos sintéticos: anchos 320, 390, 768 y 1280; corrección de desbordamientos; subida desde editor, vista previa y navegación; nombres de imágenes/marcos, foco visible, cierre de diálogo con Escape y enlace para saltar al contenido. Esta revisión no constituye una certificación WCAG de todos los contenidos que los docentes suban.

## Verificación

La suite HTTP cubre acceso real y denegaciones, borradores, protección de vistas previas, notas generales filtradas, exenciones, registro obligatorio de laboratorio, paletas inválidas, adjuntos de preguntas, vista de biblioteca con archivos privados y copias entre grupos. Las pruebas de migración verifican reutilización de grupos, conciliación de matrícula, conservación de respuestas y reversión ante esquemas incompatibles.

Los datos de prueba y capturas locales no se publican en este repositorio. Antes de desplegar se conserva un respaldo privado de la base de datos y sus archivos en Render. No se cambia el plan contratado.
