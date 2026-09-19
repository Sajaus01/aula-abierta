# Preparar materiales

La plataforma separa el contenido académico del código de la aplicación. Agrega cursos, módulos y recursos desde el panel de administración: quedan guardados en la base de datos y en el directorio privado del servidor. No es necesario editar un archivo JavaScript para cada capítulo.

## Publicar el curso por partes

Los capítulos y materiales nuevos se guardan como **Borrador** por defecto. Puedes marcar **Publicar capítulo** o **Publicar material** al crearlos o editarlos. Desde el listado del curso también tienes **Publicar** y **Ocultar** en cada fila, junto al estado actual.

Para que un material sea visible deben estar publicados el curso, su capítulo y el propio material. Publicar un capítulo no publica automáticamente sus borradores. Ocultar un capítulo oculta sus materiales y actividades, incluso desde enlaces directos del aula y desde la lista de actividades. Al publicarlo de nuevo, cada elemento conserva su estado anterior. Las actividades conservan además sus propios estados y fechas de apertura y entrega.

Los borradores se pueden abrir y revisar desde la cuenta de administrador. Ocultarlos conserva archivos, entregas, calificaciones y avances. El progreso estudiantil cuenta solo los materiales disponibles en ese momento y puede cambiar al publicar u ocultar contenidos. Los porcentajes de evaluación y las notas no se recalculan por ocultar un capítulo.

Los contenidos creados antes de esta función conservan su visibilidad. Los recursos rápidos de la barra lateral ya disponen de **Mostrar a los estudiantes**, en su formulario de edición.

Ocultar un enlace en el aula no cambia los permisos del sitio externo ni retira archivos que alguien ya haya descargado.

## Formatos

| Material | Formato recomendado | Consideración |
| --- | --- | --- |
| Diapositivas | PDF | Exporta desde PowerPoint, Canva o tu editor; ofrece una presentación consistente |
| Presentación editable | PPTX | Se distribuye como archivo; su visualización depende del programa del estudiante |
| Libros y guías | PDF | Comprueba que tengas permiso para distribuirlos |
| Video | Enlace HTTPS | Usa el proveedor de tu preferencia; las reglas de privacidad dependen también de él |
| Imágenes | PNG, JPG o WebP | Añade una descripción útil junto al recurso |
| Ejercicios | Texto, PDF o DOCX | Puedes incluir instrucciones y archivos descargables |
| Capítulo web | Enlace a una página HTTPS | La página enlazada aplica sus propias reglas de acceso |
| Capítulo interactivo autocontenido | HTML o HTM, o código HTML pegado | Vista previa aislada con HTML, CSS y JavaScript incluidos; también se puede descargar el archivo |

El servidor admite PDF, PPTX, DOCX, JPG/JPEG, PNG, GIF, WebP, TXT, HTML y HTM, con un límite de 20 MiB por archivo. No admite scripts JavaScript sueltos, ejecutables ni SVG. Los documentos de Office se descargan; no dependen de un visor público que pueda revelar los materiales privados.

Los recursos de tipo HTML ofrecen una vista previa aislada: puedes escribir HTML, CSS dentro de `<style>` y JavaScript dentro de `<script>` en el mismo documento. El visor permite esos scripts internos, pero no comparte el origen de la plataforma, sus cookies ni su almacenamiento. El servidor verifica la matrícula antes de entregar la vista previa; al descargar el archivo, se entrega como adjunto.

Usa capítulos autocontenidos. El visor bloquea bibliotecas JavaScript externas, paquetes cargados desde CDN, `fetch`/XHR, formularios y acceso a la aplicación. Las imágenes pueden estar incluidas como `data:` o usar direcciones HTTPS externas; las fuentes deben incluirse como `data:`. Una imagen HTTPS sí genera una solicitud al sitio que la aloja. Para conservar el material completo y evitar depender de otros sitios, incorpora sus imágenes y estilos en el propio HTML. Un conjunto de archivos con rutas relativas, un archivo JavaScript suelto o un ZIP no es un capítulo autocontenido.

## Estructura sugerida

Un curso contiene módulos; cada módulo reúne sus recursos en el orden que decidas. Puedes separar una unidad en una presentación, un video, una lectura y una práctica. Esta estructura es una recomendación: la instalación se entrega vacía y no crea unidades ni clases de ejemplo.

Usa títulos que permitan reconocer el recurso sin abrirlo y nombres de archivo breves. En imágenes, describe la información relevante en el texto del material; en videos, utiliza subtítulos cuando estén disponibles. Para libros largos, agrega la referencia de los capítulos o páginas que se deben leer.

## Recursos rápidos en la barra lateral

Dentro de un curso, busca **Recursos rápidos → Añadir recurso** en la barra lateral derecha. Escribe el título o rótulo y una descripción; selecciona **Video**, **Descarga** o **Enlace**. Puedes pegar una dirección de YouTube, Drive, un sitio de aplicaciones o un libro; o elegir **Subir archivo** para PDF, documentos, hojas de cálculo e imágenes de hasta 20 MB. Los videos y las aplicaciones se enlazan, no se suben al disco del aula.

Los videos de YouTube muestran una miniatura automática. También puedes indicar una URL de imagen de portada. Los videos compatibles se abren en el visor grande, con un botón para volver al curso y un enlace al original. Algunos proveedores o autores pueden restringir la reproducción integrada; en ese caso utiliza el enlace original.

Puedes editar, ordenar con las flechas, ocultar mediante **Mostrar a los estudiantes** o eliminar cada recurso. El máximo es de 30 por curso. Si la sección está vacía, no aparece al estudiante. Los enlaces externos mantienen los permisos de su servicio de origen; por ejemplo, debes permitir el acceso al archivo de Drive. Los PDF subidos se descargan con los mismos permisos que el curso. Los recursos rápidos no alteran el progreso ni las calificaciones.

Los archivos subidos ocupan el disco persistente actual y se incluyen en el respaldo de la base de datos completa y `uploads/`. El traslado JSON inicial no incluye esta sección. Eliminar un recurso con archivo también elimina ese archivo; ocultarlo lo conserva.

## Acceso a los materiales

Sube los archivos de cursos restringidos mediante el panel. Así, el servidor comprueba el acceso antes de entregarlos. Los archivos que coloques directamente en `public/`, en GitHub Pages o en otro enlace público no obtienen protección de matrícula por estar enlazados desde un curso privado.

No guardes bases de datos, listas de estudiantes ni materiales privados en el repositorio. GitHub versiona el código del sitio; el volumen de datos del servidor guarda lo que subes desde el panel.
