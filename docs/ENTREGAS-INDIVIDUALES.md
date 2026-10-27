# Plazos individuales de entrega

El docente con permiso para calificar puede habilitar la entrega de una actividad a un estudiante con matrícula vigente. La ventana se abre desde la actividad o el libro de calificaciones, incluidos estudiantes que todavía no tienen un envío. Permite fijar una fecha y hora de Colombia o autorizar sin fecha límite. Elegir un alumno o buscarlo no guarda cambios; guardar y retirar la autorización son acciones directas y reversibles.

Los plazos se guardan en `activity_deadline_extensions`, separados de la configuración general, los envíos y las calificaciones. La fecha individual no modifica el plazo del grupo ni autoriza a sus compañeros. El registro mantiene su versión al revocarse, de modo que un formulario antiguo no pueda sobrescribir una autorización posterior. La auditoría identifica actividad, estudiante, plazo, versión y posible reinicio del temporizador.

## Disponibilidad y prioridad

`academics.studentDeadline()` resuelve el plazo para los distintos consumidores. Los DTO del estudiante conservan las fechas generales y añaden `deadline`, `extension`, `effectiveDueAt` y `effectiveClosesAt`. Un `null` individual significa que no hay límite; nunca debe sustituirse por la fecha global mediante `||` o `??`.

Una corrección y una extensión individual son autorizaciones distintas. Se aplica la más reciente según `returned_at` y `extension.updatedAt`; un empate favorece la extensión. Al retirar la extensión vuelve a aplicarse la corrección vigente o el plazo general. Una autorización nueva puede ampliar una corrección que ya había vencido sin crear otro intento.

La excepción sustituye entrega y cierre, pero conserva la apertura, la publicación de la actividad y su capítulo, el acceso al grupo y la matrícula. La API vuelve a comprobar identidad, permisos y plazo al recibir el envío, incluso después de validar los archivos. El vencimiento se aplica en el instante exacto del límite usando el reloj del servidor.

No se añaden intentos. En cuestionarios se conserva la duración configurada. Si el temporizador individual ya terminó y la respuesta no tiene un envío final vigente, conceder la autorización retira ese inicio vencido: al abrir, comienza de nuevo el tiempo configurado sobre el mismo borrador e intento. Un temporizador todavía vigente se conserva.

## Estado académico

La autorización no completa la actividad ni modifica una nota manual, incluida una nota de cero. Cuando la política existente muestra cero por ausencia de entrega después del cierre, una autorización vigente devuelve la celda del alumno al estado pendiente. Su acumulada sigue calculándose sobre el 100 %; ese porcentaje aporta cero provisional mientras no esté calificado. Una entrega recibida queda enviada o pendiente de revisión, y su calificación sustituye el estado de ausencia según el flujo normal de devolución de notas.

Conceder o retirar un plazo conserva la publicación global de notas finales. La preparación y la disponibilidad de la final se calculan por alumno; los compañeros conservan su situación. El envío y la calificación posteriores siguen la política habitual de la plataforma. Las exenciones permanecen intactas.

Esta función no implementa un proceso nuevo de cierre automático ni asignación de ceros. Utiliza los estados y la política de faltantes existentes.

## Vistas, avisos y conservación

Actividad, agenda, panel del curso y seguimiento utilizan el plazo efectivo del alumno. Una autorización sin límite mantiene el trabajo como pendiente, sin clasificarlo como vencido por la fecha anterior. Conceder el permiso nunca aumenta el avance; enviar sí utiliza el cálculo integral existente.

Los avisos de habilitación, cambio y retirada se dirigen únicamente al estudiante afectado. Las versiones anteriores y sus reintentos pendientes se cancelan. La campana identifica el plazo en hora de Colombia; el push conserva el texto genérico de privacidad. Los avisos de nota final se comprueban por destinatario para no anunciar una final que temporalmente no está disponible.

El respaldo SQLite conserva los plazos individuales. Las copias de contenido crean nuevas actividades y no trasladan autorizaciones, matrículas ni envíos personales. La eliminación de la actividad elimina sus autorizaciones por clave foránea.
