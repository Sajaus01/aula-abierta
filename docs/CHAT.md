# Mensajes entre personas

## Activar y controlar

Entra al grupo y pulsa **Activar chat**, junto a la comunidad en línea. La mensajería empieza desactivada en cada grupo nuevo. En **Configurar chat** decide si los estudiantes pueden escribir a docentes y/o a sus compañeros. El grupo determina qué personas pueden encontrarse y qué envíos están permitidos. La identidad de la conversación corresponde a sus dos participantes.

Dos personas tienen una sola conversación, aunque compartan varios grupos. Abrir a la misma persona desde otro grupo recupera el mismo historial. El directorio muestra únicamente personas con acceso activo a un grupo compartido y no expone cédulas, correos ni sesiones. Si dejan de compartir un grupo, se comprueba si conservan otro vínculo vigente antes de permitir el acceso o nuevos envíos.

En **Mensajes → Mis permisos**, cada docente puede impedir que estudiantes le escriban. En **Control general**, administración puede desactivar toda la mensajería. Desactivar el chat de un grupo conserva su historial y bloquea los envíos que dependan de ese grupo; otros grupos compartidos mantienen sus propias reglas. Las restricciones se comprueban en el servidor incluso para ventanas ya abiertas. El chat requiere contraseña personal: una sesión de solo cédula o una vista previa no puede usarlo.

## Conversar

Usa el acceso de mensajes del grupo, el icono de la barra superior, la sección **Mensajes** o **Comunidad → Escribir**. El panel muestra personas con foto, nombre y presencia; pulsa una para conversar. La pestaña **Conversaciones** permite retomar el historial; los filtros avanzados quedan en **Organizar conversaciones** en la página completa. El filtro por grupo organiza los contactos y el contexto autorizado, sin crear otra conversación entre las mismas personas. Hasta tres conversaciones pueden estar abiertas; en pantallas pequeñas se presenta una a la vez. Volver a abrir a la misma persona trae su ventana al frente. Un docente puede escribir a un estudiante recién matriculado: este podrá leer y responder después de crear su contraseña personal en el primer ingreso.

Puedes enviar texto de hasta 5.000 caracteres, enlaces y emojis, citar respuestas, editar mensajes propios y eliminarlos. Enter envía; Shift + Enter añade una línea. Las acciones secundarias están en el menú del mensaje. Un tick indica que el servidor recibió el envío; dos ticks azules indican lectura por la otra persona. Abrir una pestaña en segundo plano, minimizar un chat o consultar su historial desde supervisión no confirma lectura. La confirmación requiere que el mensaje final esté visible en la conversación personal enfocada. Leer mensajes anteriores tampoco confirma mensajes nuevos que estén fuera de la vista.

«En línea» corresponde a la otra persona, no a quien mira la conversación. Se envían señales desde una pestaña visible y enfocada cada 15 segundos. Perder el foco, ocultar o cerrar la pestaña y perder conexión solicita retirar su señal. Si esa solicitud no llega, caduca a los 45 segundos. Cada pestaña y sesión tiene su propia señal; cerrar una no desconecta las demás. Conservar una sesión iniciada no basta para aparecer en línea. Se respeta el estado oculto del personal docente. Estos indicadores describen actividad del navegador, no atención ni asistencia.

El historial se almacena en SQLite en el disco persistente del servidor, no en GitHub. Los borradores sin enviar se conservan en la sesión de ese navegador y no son mensajes entregados. Si existían textos distintos en conversaciones antiguas de la misma pareja, se conservan como borradores recuperados para elegir cuál continuar. Enviar uno no descarta los otros. La mensajería usa actualizaciones periódicas: aproximadamente cada 6 segundos con chats abiertos y 20 segundos para la bandeja.

Puedes adjuntar imágenes, grabar una nota de voz o enviar archivos. El micrófono se solicita al pulsar el botón de grabación; antes de enviar puedes revisar o descartar la grabación. Los archivos se guardan de forma privada y se vuelven a comprobar los permisos al descargarlos. Se permiten hasta cinco adjuntos por mensaje, de hasta 10 MB cada uno y 20 MB en conjunto, sujetos al cupo de almacenamiento. Los archivos ejecutables o el contenido HTML se descargan como archivos, sin ejecutarse dentro del chat.

Las burbujas del borde derecho permiten mantener varias conversaciones y cambiar entre personas. En pantallas pequeñas se muestra una ventana a la vez. Los mensajes nuevos pueden producir un tono breve después de la primera interacción con el aula. Se puede apagar en **Notificaciones → Sonidos de mensajes y avisos**; las conversaciones silenciadas no lo reproducen.

## Preguntar desde un material o una actividad

En la vista del estudiante aparece **Preguntar al docente** mientras consulta un curso, material o actividad. El panel muestra los docentes asignados y el contexto que se adjuntará. Elegir una persona abre su conversación personal con una referencia al curso, capítulo y material o actividad; el estudiante escribe la pregunta y la envía desde allí. Ese contexto no crea otro chat, aunque las mismas personas compartan varios grupos.

La referencia se resuelve y valida en el servidor. El docente recibe el nombre original del contenido y un enlace para abrirlo; los cambios posteriores de título no alteran la referencia guardada en el mensaje. Las preferencias personales del docente, la configuración del grupo y la vigencia de la matrícula siguen aplicándose.

Los avisos académicos y las notificaciones del navegador se describen en [Novedades de los cursos](NOTIFICACIONES.md). Las conversaciones no realizan llamadas de voz ni videollamadas.

## Supervisión y eliminación

Los docentes asignados pueden revisar el contenido originado en sus grupos. En **Mensajes → Supervisión**, filtra por grupo, persona o estado. Compartir participantes con otro grupo no concede acceso al contenido de ese otro grupo: el servidor limita mensajes, citas, reportes y versiones a los orígenes autorizados. Máster y administración conservan su alcance global. Las conversaciones ajenas se abren en modo de lectura y no cambian las confirmaciones de lectura de sus participantes.

Los participantes pueden reportar un mensaje. El docente puede filtrar **Con reportes pendientes**, revisar el motivo, resolverlo, retirar mensajes y suspender los envíos de un estudiante desde **Configurar chat → Gestionar participantes**. Los cambios de configuración, mensajes enviados y acciones de moderación se registran en Panorama con su grupo; el texto de las conversaciones no se copia a Panorama.

**Eliminar para mí** oculta la conversación, sin borrar el historial de la otra persona ni de supervisión. Se puede recuperar desde **Archivadas / eliminadas para mí**; un mensaje nuevo vuelve a mostrarla. **Archivar** y **silenciar** se aplican a la conversación personal completa, independientemente del grupo desde el que se abrió.

La retirada docente se limita al grupo seleccionado. Impide continuar por ese grupo; no retira los permisos que procedan de otro grupo compartido. Los docentes conservan acceso desde **Retiradas por docente** y pueden restaurar el vínculo de su grupo. Los originales de mensajes eliminados y las versiones anteriores de mensajes editados se conservan para la supervisión autorizada; se muestran hasta las últimas 20 revisiones en la ventana. Este control no representa un borrado definitivo de datos personales.

Una matrícula vencida o revocada, una cuenta suspendida o un grupo que deja de estar activo/publicado retiran el acceso que dependía de ese vínculo. Eliminar definitivamente un grupo elimina sus mensajes de origen. Si la misma conversación conserva otros grupos vinculados, se preserva el historial de esos otros grupos; una conversación que dependía únicamente del grupo eliminado desaparece con él. Las copias de seguridad verificadas incluyen todas las tablas de chat y deben administrarse conforme a la política de conservación de datos de la institución.

Antes de actualizar una instalación con chats anteriores, el servidor crea una copia verificada con la etiqueta `before-chat-person-v2`. Si no puede completarla, no inicia la migración. Las conversaciones repetidas de cada pareja se unen en una transacción. Se conservan los identificadores de mensajes, las citas, las ediciones, los reportes y las lecturas individuales. Las direcciones de las conversaciones antiguas resuelven a la conversación única. Repetir el inicio del servidor no vuelve a duplicar ni fusionar los datos ni generar otra copia por esta actualización.

## Operación

No requiere un proveedor adicional ni cambiar el plan actual de Render. Consume el almacenamiento persistente y capacidad del servicio existente. Antes de ampliar el número de usuarios simultáneos, observa el uso real del disco, memoria y CPU. El sistema limita ráfagas a 40 mensajes por usuario por minuto y evita duplicar un mismo envío reintentado. Las fotos se conservan en el sistema de perfiles existente.

Para volver al modelo anterior de conversaciones por grupo hace falta restaurar la copia previa, además del código correspondiente: la base migrada tiene una restricción de identidad global y lecturas individuales que el código antiguo no administra. Detén el servicio, restaura el respaldo en un directorio vacío y verifica su integridad antes de cambiar `DATA_DIR`. La restauración descarta los cambios posteriores a la copia; consérvalos antes si hubo actividad después de la actualización. No sobrescribas una base activa.
