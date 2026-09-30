# Chat de los grupos

## Activar y controlar

Entra al grupo y pulsa **Activar chat**, junto a la comunidad en línea. El chat empieza desactivado en cada grupo nuevo. En **Configurar chat** decide si los estudiantes pueden escribir a docentes y/o a sus compañeros. Los docentes asignados al grupo pueden supervisar y moderar sus conversaciones; el máster y administrativos tienen alcance global. Cuando se desactiva el grupo, desaparecen sus botones de mensajes y de escribir a personas. El docente conserva los controles de configuración.

En **Mensajes → Mis permisos**, cada docente puede impedir que estudiantes le escriban. En **Control general**, administración puede desactivar toda la mensajería. Desactivar un chat conserva su historial y bloquea nuevos envíos; las restricciones se comprueban en el servidor incluso para ventanas ya abiertas. El chat requiere contraseña personal: una sesión de solo cédula o una vista previa no puede usarlo.

## Conversar

Usa **Mensajes del grupo**, el icono de la barra superior, la sección **Mensajes** o **Comunidad → Escribir**. El panel lateral muestra directamente las personas del grupo, con su foto, nombre y presencia. Pulsa una persona para abrir o iniciar su conversación. La pestaña **Conversaciones** permite retomar el historial; los filtros avanzados quedan en **Organizar conversaciones** en la página completa. Hasta tres conversaciones pueden estar abiertas; en pantallas pequeñas se presenta una a la vez. Volver a abrir una conversación desde la bandeja la trae al frente. Un docente puede escribir a un estudiante recién matriculado: este podrá leer y responder después de crear su contraseña personal en el primer ingreso.

Puedes enviar texto de hasta 5.000 caracteres, enlaces y emojis, citar respuestas, editar mensajes propios y eliminarlos. Enter envía; Shift + Enter añade una línea. Los mensajes sin leer, las confirmaciones de lectura y el indicador de escritura se actualizan mientras el aula está abierta. Se reutilizan las fotos y la presencia de Comunidad, respetando el estado oculto del personal docente.

El historial se almacena en SQLite en el disco persistente del servidor, no en GitHub. Los borradores sin enviar se conservan en la sesión de ese navegador y no son mensajes entregados. La mensajería usa actualizaciones periódicas: aproximadamente cada 6 segundos con chats abiertos y 20 segundos para la bandeja. No hay notificaciones por correo ni push cuando el usuario cierra el aula. Esta versión envía texto y enlaces; no adjunta archivos ni realiza llamadas.

## Supervisión y eliminación

Las conversaciones **son visibles para los docentes del grupo**. En **Mensajes → Supervisión**, filtra por grupo, persona o estado. Las conversaciones ajenas se abren en modo de lectura y no cambian las confirmaciones de lectura de sus participantes.

Los participantes pueden reportar un mensaje. El docente puede filtrar **Con reportes pendientes**, revisar el motivo, resolverlo, retirar mensajes y suspender los envíos de un estudiante desde la lista de contactos del grupo. Los cambios de configuración, mensajes enviados y acciones de moderación se registran en Panorama con su grupo; el texto de las conversaciones no se copia a Panorama.

**Eliminar para mí** oculta la conversación, sin borrar el historial de la otra persona ni de supervisión. Se puede recuperar desde **Archivadas / eliminadas para mí**; un mensaje nuevo vuelve a mostrarla. **Archivar** organiza la bandeja; **silenciar** excluye sus mensajes del contador general de avisos.

**Retirar para todos** requiere marcar una confirmación y escribir RETIRAR. Oculta la conversación a estudiantes y bloquea nuevos mensajes. Los docentes conservan acceso desde **Retiradas por docente** y pueden restaurarla. Los originales de mensajes eliminados y las versiones anteriores de mensajes editados se conservan para supervisión; se muestran hasta las últimas 20 revisiones en la ventana. Este control no representa un borrado definitivo de datos personales.

Una matrícula vencida o revocada, una cuenta suspendida o un grupo que deja de estar activo/publicado impiden el acceso del estudiante. Eliminar definitivamente un grupo también elimina sus conversaciones y mensajes mediante relaciones de base de datos. Las copias de seguridad verificadas incluyen todas las tablas de chat y deben administrarse conforme a la política de conservación de datos de la institución.

## Operación

No requiere un proveedor adicional ni cambiar el plan actual de Render. Consume el almacenamiento persistente y capacidad del servicio existente. Antes de ampliar el número de usuarios simultáneos, observa el uso real del disco, memoria y CPU. El sistema limita ráfagas a 40 mensajes por usuario por minuto y evita duplicar un mismo envío reintentado. Las fotos se conservan en el sistema de perfiles existente.
