# Navegación contextual

Los enlaces principales de regreso utilizan `data-nav-back`. Si existe un origen conocido en esta pestaña y en el mismo ámbito de sesión, el botón vuelve a esa entrada real del historial. Omite los cambios de pestaña o filtros de la misma vista al buscar el origen. Un enlace directo conserva su destino de respaldo del mismo curso, sin enviar al usuario a una página externa mediante `history.back()`.

El controlador de `public/navigation.js` atiende enlaces internos, `hashchange` y `popstate`. Conserva la ruta completa, los filtros permitidos, las búsquedas locales, los capítulos y detalles abiertos, el desplazamiento de la página y las tablas y el foco de los controles de navegación. La posición se restaura después de terminar el renderizado asíncrono. Las respuestas tardías se descartan si cambió la ruta, el usuario o el ámbito.

Las instantáneas se guardan en `sessionStorage`, con un máximo de 80 entradas, para recuperar el contexto después de recargar. El ámbito distingue cuenta, funciones, espacio Docencia/Aprendizaje, nivel de autenticación y vista previa. Cambiar de ámbito impide restaurar una instantánea anterior. La API conserva sus comprobaciones de acceso: una ruta o una instantánea nunca concede permisos.

Solo se capturan controles explícitos de búsqueda y filtrado. No se guardan respuestas, notas, comentarios, contraseñas, archivos ni HTML en el historial de navegación. Las claves de consulta admitidas corresponden a filtros y enlaces profundos de la aplicación. Si el navegador no permite guardar la sesión, los recorridos de la pestaña continúan funcionando en memoria.

## Materiales y revisión

Abrir un visor o una ventana de revisión crea una entrada de diálogo. Atrás cierra esa ventana antes de salir de la página; el botón de cierre retira esa misma entrada. Adelante puede reabrirla mientras su acción siga disponible en la pestaña. Si se recarga, se vuelve a la página y no se reconstruye una ventana con datos privados guardados en el navegador.

Un material abierto desde Mi aprendizaje o una notificación vuelve directamente a ese origen. Cuando se abre un enlace directo sin origen conocido, el respaldo es su curso. Los enlaces profundos de materiales conservan los metadatos del historial al consumir sus parámetros.

Antes de cambiar de vista, refrescar la pantalla dentro de la aplicación o cambiar de cuenta o espacio, se esperan las escrituras pendientes de borradores y notas. Los archivos seleccionados se guardan como parte del borrador, sin enviar la entrega. La cola reconoce los archivos confirmados para no subirlos de nuevo si otra condición cancela la navegación. Un error de guardado conserva el formulario y muestra el error.

Las notas se guardan de forma privada; navegar no equivale a devolverlas. Un texto de solicitud de corrección o un editor con cambios sin guardar conserva la protección de descarte existente y requiere una decisión dentro de la ventana. No se envía una corrección automáticamente al regresar.

Las anclas de accesibilidad y las secciones internas de revisión, los enlaces externos, las descargas y los clics para abrir otra pestaña mantienen su comportamiento normal.
