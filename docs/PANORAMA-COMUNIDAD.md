# Panorama, perfiles y presencia

## Uso

- **Panorama**: filtrar por grupo, curso plantilla, persona, tipo de evento, fechas de Colombia y texto. Cada página contiene hasta 50 registros y se puede exportar a CSV. Los registros tienen detalles, grupo, capítulo, actividad, estudiante, intento y contexto de calificación cuando corresponde. Los docentes ven únicamente su alcance; las entregas y notas requieren permiso de calificación. Máster y administración tienen vista global.
- **Comunidad**: buscar personas por grupo, rol y estado. En el encabezado del grupo aparece un acceso con los avatares activos. Los estudiantes ven únicamente compañeros y personal del grupo autorizado, sin cédulas, correos ni identificadores de sesión.
- **Mi perfil**: foto y presentación breve. Se conserva el nombre institucional. Para editar se necesita una sesión con contraseña. Docentes, administrativos y máster pueden ocultar su indicador; se oculta ante todos, incluido el máster. Ocultar presencia no desactiva los registros de auditoría.

## Significado de los indicadores

La aplicación informa presencia desde las pestañas activas cada 30 segundos; una señal caduca a los 90 segundos. Cerrar sesión, suspender la cuenta, revocar la sesión o salir de la pestaña elimina su señal. Varias pestañas se contabilizan como una persona. No se registra cada señal en la auditoría. «En este grupo» indica una pestaña activa en el grupo; «En línea» puede corresponder a otro espacio del aula. No mide atención, asistencia ni aprendizaje demostrado.

Un inicio de sesión pertenece a la plataforma. Se muestran los grupos vinculados al momento del registro, sin atribuir el ingreso a un grupo específico. La apertura de un grupo es un evento independiente. Los registros antiguos se enriquecen con la información disponible y se identifican como reconstruidos; no se inventan nombres de objetos ya eliminados ni vínculos históricos que no se guardaron.

## Datos, migración y reversión

La primera ejecución guarda automáticamente un respaldo `before-community-panorama-v1` con `server/backup.mjs`. Se añaden las tablas `profiles` y `presence`, y campos de contexto en `audit` y `learning_events`. La operación es repetible. No se modifican cuentas, contraseñas, cursos, matrículas, materiales ni evaluaciones existentes. El contexto de auditoría contiene metadatos de la acción, nunca contraseñas, documentos de identidad, contenido de respuestas o señales periódicas de presencia.

Las fotos son imágenes raster de hasta 256 KB y 2048 píxeles por lado. El navegador recorta y recodifica a JPG de 384 × 384; se guarda en SQLite y se sirve mediante una ruta autorizada. No se publica en GitHub. Los respaldos SQLite incluyen los perfiles. La presencia es efímera y depende de sesiones vigentes.

Para revertir código, la versión anterior puede ignorar las tablas y columnas adicionales. Si se requiere revertir también los datos, detener el servicio y restaurar el respaldo en un directorio vacío con `node server/backup.mjs restore BACKUP DESTINO`; verificar la integridad antes de cambiar `DATA_DIR`. No sobrescribir una base activa. Una restauración descarta cambios posteriores al respaldo: preservarlos antes si hubo actividad durante el despliegue.

## Verificación

`npm test` incluye permisos entre grupos, estado oculto frente a máster y estudiantes, sesiones revocadas o vencidas, varias pestañas, perfiles e imágenes privadas, acceso con solo cédula, caducidad de matrículas, contexto de entregas y eliminación, filtros y paginación de Panorama, migración repetible y una cohorte de 500 estudiantes. La interfaz se comprueba también en navegador y a 320/390 píxeles.
