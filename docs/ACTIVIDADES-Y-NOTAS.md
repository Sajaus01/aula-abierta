# Actividades, entregas y calificaciones

## Crear actividades

Abre un curso y pulsa **Gestionar actividades → Crear actividad**. También puedes entrar por **Actividades y notas** en el menú. Los materiales se siguen cargando desde los capítulos, con **Material**.

Puedes crear una **tarea** con respuesta escrita, enlace o archivo; o un **cuestionario interactivo**. Completa el título, instrucciones y criterios de evaluación. Al relacionarla con un capítulo, sus materiales quedan accesibles desde la actividad.

- **Estado:** borrador para preparar, publicada para mostrar al grupo o archivada para retirarla conservando el historial. Archivar retira su porcentaje del cálculo.
- **Porcentaje:** aporte a la nota final. Usa 0 % para práctica. Las actividades publicadas no pueden superar 100 % y deben sumar 100 % para cerrar la evaluación.
- **Puntos máximos:** por ejemplo 100. En cuestionarios se suman los puntos de las preguntas.
- **Apertura:** impide borradores y envíos antes de ese momento; las preguntas tampoco se muestran antes de la apertura.
- **Fecha de entrega:** límite ordinario. Puedes permitir tardías, que quedarán identificadas.
- **Cierre definitivo:** impide cualquier nuevo envío. Si aceptas tardías sin cierre, la actividad seguirá abierta.
- **Intentos:** entre 1 y 20 envíos por estudiante. Cuenta la última entrega enviada, no la mejor; las anteriores se conservan.

Las fechas se introducen y muestran en la zona horaria del navegador, indicada en pantalla. El servidor guarda instantes UTC y comprueba los plazos.

## Cuestionarios

Selecciona **Cuestionario interactivo → Añadir pregunta**. Admite hasta 50 preguntas, de estos tipos:

1. **Una respuesta correcta:** entre 2 y 10 opciones, una por línea. Indica el número correcto empezando por 1.
2. **Varias respuestas correctas:** números separados por comas, por ejemplo `1,3`. Se asignan puntos solo si se elige exactamente el conjunto correcto; no hay puntos parciales ni penalizaciones negativas.
3. **Respuesta abierta:** revisión manual del docente.

Los cuestionarios que solo contienen selección se califican automáticamente al enviarlos. Si incluyen alguna respuesta abierta, el docente asigna la puntuación total. En ambos casos, las notas se ocultan hasta su publicación y las claves correctas no se envían al estudiante.

Con borradores o entregas existentes, quedan protegidos el tipo, las preguntas y los puntos máximos. Para modificarlos, crea otra actividad. Sí puedes ajustar instrucciones, fechas, intentos y porcentajes.

## Entregar trabajos

El estudiante necesita contraseña personal y matrícula vigente, incluso si el curso permite consultar materiales solo con cédula o es libre. **Mis actividades** muestra pendientes y fechas de sus cursos. Puede guardar un borrador y enviarlo al terminar. Un borrador no cuenta como entrega ni aparece en la bandeja de corrección.

Las tareas admiten texto, enlace y un archivo opcional de hasta **10 MB**: PDF, PNG, JPG, WebP, XLSX, CSV, DOCX, PPTX o TXT. El archivo se descarga; la plataforma no ejecuta macros ni calcula hojas de Excel. El estudiante debe dar al docente acceso a los enlaces externos.

Cada envío queda cerrado. Si hay más intentos, puede enviar otro que sustituye al anterior para el cálculo de su nota. El historial y los comentarios publicados siguen disponibles. Cada estudiante accede únicamente a sus propias entregas.

## Revisar y publicar

Dentro de la actividad, pulsa **Revisar**. Abre el archivo o enlace, consulta las respuestas, asigna puntos de cero al máximo y escribe comentarios. Puedes guardar sin publicar o marcar **Publicar esta nota y los comentarios**.

En **Libro de notas** ves la matriz del curso. **Publicar notas disponibles** muestra todas las notas guardadas o calculadas de actividades publicadas, incluidos los cuestionarios automáticos. Los envíos aún sin nota siguen pendientes. **Descargar libro CSV** incluye las notas guardadas, aunque todavía no estén publicadas; un campo vacío no representa cero.

En **Configurar evaluación** defines la escala, inicialmente 0–5, y el umbral aprobatorio, inicialmente 3. El promedio provisional usa solo los porcentajes ya evaluados; para estudiantes, solo notas publicadas.

La nota final se calcula con:

`suma((puntos obtenidos / puntos máximos) × porcentaje / 100) × nota máxima del curso`

Ejemplo: tarea de 60 % con 80/100 y cuestionario de 40 % con 1/1 producen **4,4 sobre 5**.

Publicar la nota final requiere porcentajes que sumen 100 % y notas publicadas de las entregas de estudiantes con matrícula activa. La opción **Contar como cero las actividades sin entrega cuando termine su plazo** solo afecta a faltantes con plazo ya cerrado. Una entrega enviada pero aún sin calificar nunca se convierte automáticamente en cero. Sin cierre efectivo, no hay faltante definitivo.

Editar una actividad, recibir un nuevo envío, cambiar una nota o volver a publicar notas disponibles retira la publicación final; debes revisarla y confirmarla otra vez. Las notas individuales ya publicadas siguen visibles salvo que las retires o una entrega posterior las sustituya para el cálculo.

## Almacenamiento y respaldo

Los adjuntos se guardan en el **disco persistente actual de Render**. Esta versión no contrata servicios ni conecta Cloudflare R2. El cupo global inicial es **500 MiB** de adjuntos de estudiantes y se muestra a administración en **Actividades y notas**. Al agotarlo se rechazan archivos nuevos, pero se permiten texto y enlaces. Es un límite de la aplicación, no una ampliación del disco contratado.

La variable opcional `SUBMISSIONS_MAX_BYTES` ajusta el cupo en bytes. Antes de aumentarlo, comprueba el espacio real y reserva espacio para tus materiales y base de datos. También se conservan al menos 50 MiB libres al cargar un archivo. Para cientos de estudiantes con entregas frecuentes, conecta almacenamiento externo antes de acumular archivos; mientras tanto puedes recibir enlaces.

Respalda una copia coherente de **la base de datos completa y `uploads/`**, según [Publicación](PUBLICACION.md#persistencia-y-copias). El traslado JSON heredado del aula inicial no incluye actividades, entregas ni calificaciones y no sirve para respaldar esta función.

Esta versión no incluye vigilancia de exámenes, temporizador individual, banco aleatorio, detección de plagio, corrección por IA, entregas grupales ni integración con R2. Los criterios de rúbrica se escriben en las instrucciones; se registra una puntuación total y comentarios.
