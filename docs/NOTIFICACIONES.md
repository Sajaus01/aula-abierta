# Novedades de los cursos

La campana de la barra superior muestra los avisos sin leer. **Notificaciones** reúne el historial; cada curso tiene un perfil con su nombre, imagen, grupo y publicaciones. Desde el curso, **Novedades del curso** abre ese perfil. Se puede marcar un aviso o todo el curso como leído y cargar avisos anteriores.

Los estudiantes con matrícula vigente reciben avisos al publicarse materiales o actividades, al publicarse una calificación y cuando se devuelve una entrega para corregir. Guardar una nota privada no la notifica al estudiante. Los avisos personales se muestran únicamente a su destinatario. El acceso se vuelve a comprobar cuando se consulta el historial o se abre el enlace.

Los docentes con permiso para editar el grupo pueden abrir su perfil y usar **Publicar aviso para el grupo**. El mensaje aparece con la identidad del curso. Un reintento del mismo envío conserva el aviso original y no lo duplica.

## Avisos del navegador y sonidos

En la campana o en **Notificaciones**, pulsa **Activar avisos del navegador**. La solicitud de permiso aparece solo después de pulsar ese botón. Si el navegador bloquea el permiso, la bandeja del aula sigue disponible. La opción **Desactivar en este dispositivo** cancela la suscripción de ese navegador; cerrar sesión también la desvincula.

Cuando la conexión de segundo plano está activa, Web Push permite recibir avisos con la página cerrada, según el soporte y la configuración del navegador y del sistema operativo. El aula muestra si esa conexión se completó. Si no se pudo conectar, los avisos se actualizan mientras la página permanece abierta. En iPhone o iPad, el navegador puede requerir instalar la aplicación en la pantalla de inicio antes de habilitar los avisos.

Los avisos del sistema usan texto general: no incluyen notas, respuestas ni comentarios privados. Al pulsarlos se abre la sección correspondiente, con las comprobaciones de sesión y matrícula habituales. No se envían notificaciones antiguas al conectar un dispositivo. Si el aula está visible y enfocada, el aviso del sistema permanece en silencio y se utiliza el tono breve de la página.

**Sonidos de mensajes y avisos** controla el tono breve dentro del aula y solicita silenciar los avisos del sistema cuando se desactiva. El navegador necesita una interacción inicial para reproducir audio. No se reproduce el historial al ingresar; los mensajes silenciados tampoco suenan. Se limita el tono a uno por ráfaga y se coordina entre pestañas. Durante una grabación de voz se suspende el tono de esa pestaña. El volumen final de los avisos externos depende del navegador y del sistema operativo.

## Operación

El servidor conserva el registro de avisos, destinatarios, lecturas y suscripciones en SQLite. Los eventos se registran junto al cambio académico, se comprueba su visibilidad actual antes de entregarlos y los reintentos de Web Push se guardan en la base. Las claves de aplicación se generan y conservan en el directorio de datos; las suscripciones se almacenan cifradas. El disco persistente y sus respaldos deben incluir esa información. El servicio existente necesita salida HTTPS hacia los proveedores de notificaciones de los navegadores; no se necesita contratar un proveedor de correo.
