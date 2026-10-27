# Cierre automático de actividades sin entrega

Al terminar el plazo efectivo de una actividad publicada, Aula Abierta registra un cero automático para cada estudiante con matrícula vigente que no tenga una respuesta enviada ni una exención. Un proceso del servidor comprueba los vencimientos cada 15 segundos; las lecturas del curso, la actividad y las notas también actualizan el estado. Si el servidor estuvo detenido, procesa los vencimientos al arrancar.

El plazo efectivo respeta la configuración de la actividad, las autorizaciones individuales y las correcciones. Si se permiten entregas tardías, la fecha de entrega señala retraso, pero el cierre automático espera la fecha de cierre. Si no hay fecha de cierre y se permiten tardías, la entrega sigue habilitada. Una ampliación vigente sin límite impide el cierre.

El registro se guarda separado de las entregas, con su revisión, plazo, cero y transiciones de cierre o reapertura. No crea respuestas, intentos ni archivos ficticios. Un borrador nunca enviado puede quedar cerrado, pero conserva su contenido y sus adjuntos. Si el plazo vence mientras el estudiante escribe, se permite guardar ese borrador para que pueda salir sin perder sus cambios; esto mantiene el cero y no autoriza el envío. Una respuesta que sí se envió, incluso si está pendiente de calificación, tiene una nota privada o fue devuelta para corregir, no recibe un cero por falta de entrega.

El cero automático participa en la nota acumulada sobre el 100 % y conserva el estado «Vencida sin entrega». Este estado se distingue de una nota ordinaria publicada. El docente lo encuentra en el libro de notas y en una lista separada dentro de la actividad; desde allí puede habilitar una entrega individual.

La actividad cerrada queda finalizada para continuidad: sale de las próximas entregas y deja de ser la acción recomendada. No equivale a una entrega ni a una aprobación. El porcentaje de avance conserva las acciones realmente realizadas y los capítulos mantienen su alerta roja. Las estadísticas separan entregas, vencimientos y pendientes que todavía pueden atenderse; los eventos del sistema no se contabilizan como participación del estudiante.

Cuando el docente amplía el plazo, se retira el cero activo y queda conservado su historial. El estudiante puede continuar el mismo borrador o crear su primera entrega. Enviarla no inventa un intento adicional. La nueva entrega pasa a pendiente de calificación y la nota que publique el docente sustituye el cero en la acumulada. Si vence de nuevo una autorización sin que exista entrega, se registra un nuevo cierre en el historial.

Cada cierre genera un aviso personal del curso. Releer las páginas o reiniciar el servidor no repite el aviso ni el registro. Al reabrir la actividad, el aviso de cierre anterior deja de mostrarse como vigente. Las preferencias existentes del navegador y del sonido siguen aplicándose.

Los cierres requieren una actividad publicada y, si pertenece a un capítulo, que este sea visible; también requieren un curso publicado y activo y una matrícula vigente. No se crean nuevos cierres para cuentas suspendidas o matrículas revocadas. El historial personal no aparece en el catálogo ni en la vista previa docente. Los datos de seguimiento y las listas de cierres requieren permiso para calificar.

El cierre explícito funciona independientemente de la antigua opción de cálculo `missingAsZero`. Esa opción se conserva en los datos por compatibilidad; la interfaz explica el cierre automático sin presentar un interruptor que contradiga la política. Se conserva la publicación global de las notas finales: la disponibilidad de la nota de cada estudiante depende de sus propios estados y ponderaciones.
