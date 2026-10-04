# Administración del almacenamiento

Abre **Almacenamiento** en la barra lateral. Máster y administrativos pueden ver el disco, consumo, cupos, respaldos, archivos grandes y el historial de cambios. Docentes consultan su consumo y el de sus cursos; estudiantes consultan solo su cupo personal.

## Cómo se suman los archivos

- Cada curso o grupo tiene un **responsable de almacenamiento**. Sus materiales, actividades, entregas e historial cuentan en el cupo del grupo y en el total de esa persona, junto con sus otros cursos y su biblioteca personal.
- Las entregas también cuentan en el cupo del estudiante que las subió, incluso si es docente en otros cursos. No se suman dos veces en el total físico de la plataforma.
- Una cuenta con varios roles tiene un único cupo personal. Si tiene función docente, hereda el predeterminado docente.
- Los borradores, intentos anteriores, archivos de versiones previas y cursos archivados siguen ocupando espacio. Un archivo compartido por varias versiones cuenta una sola vez por cuenta, grupo y plataforma.
- Los enlaces externos no ocupan cupo de archivos. Las fotos de perfil sí se contabilizan. La base de datos, sus registros de texto y los respaldos aparecen como consumo del servidor.

## Ajustar cupos

En **Usuarios**, busca a la persona y pulsa **Ajustar cupo**. En **Cursos y grupos**, pulsa **Gestionar** para cambiar el responsable y el máximo del grupo. En **Resumen → Configurar**, cambia los valores predeterminados y los máximos globales.

Los valores iniciales son 500 MB por docente, 100 MB por estudiante y 250 MB por curso/grupo. El máximo global de entregas conserva `SUBMISSIONS_MAX_BYTES` si estaba definido; en otro caso parte de 500 MB. Se reservan 50 MB para el funcionamiento del aula. Son MiB (1024 × 1024 bytes), presentados como MB en la interfaz.

Un cupo personalizado prevalece sobre el predeterminado; **Usar predeterminado** restaura la herencia. **Sin tope adicional** elimina ese límite particular, pero los demás límites y la capacidad física siguen vigentes. Un límite de cero bloquea nuevos archivos. Reducir un cupo por debajo del consumo no borra contenido; permite seguir editando texto, usando enlaces y retirando archivos.

Los límites se verifican al guardar, también al copiar cursos y usar la biblioteca. Reemplazar un borrador descuenta el archivo retirado si no lo utiliza otro registro. Las versiones históricas conservadas siguen contando. Dos administradores no pueden sobrescribir accidentalmente la misma configuración: el panel pide actualizar cuando la versión cambió.

Los límites por archivo y entrega se mantienen: estudiantes hasta 5 archivos, 10 MB cada uno y 20 MB en conjunto; adjuntos de actividad hasta 20 MB en conjunto. Un cupo mayor no modifica esas restricciones.

## Espacio físico y respaldos

**Aumentar un cupo no compra capacidad en Render.** El panel distingue espacio contratado, espacio libre, reserva, archivos del aula y respaldos. Si el servidor tiene poco espacio, revisa **Respaldos → Optimizar respaldos** antes de considerar una ampliación del disco.

La optimización verifica SHA-256 y tamaño y sustituye las copias idénticas de respaldos por enlaces físicos dentro del directorio de respaldos. Todas las rutas, manifiestos y contenidos se conservan; nunca se enlazan archivos activos del aula. Los respaldos son inmutables: se restauran mediante `server/backup.mjs restore` a un directorio independiente, que crea copias normales. La creación de nuevos respaldos también optimiza las copias acumuladas.

El tamaño lógico es la suma del contenido de todas las copias. El tamaño físico cuenta una sola vez los archivos compartidos. Los archivos sin referencia se muestran para revisión, sin borrado automático. La plataforma no elimina entregas ni respaldos para liberar espacio de forma silenciosa.

El panel permite exportar los cupos y consumos a CSV. El historial registra quién cambió cada cupo o responsable y cuándo realizó una optimización.
