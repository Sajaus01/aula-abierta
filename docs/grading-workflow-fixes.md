# Devolución masiva y cambios de escala

La devolución desde el listado de una actividad y desde el libro del grupo usa el bloqueo de doble clic del manejador global. La acción académica no vuelve a cancelar la operación por encontrar ese mismo botón bloqueado. Un fallo al recargar después de devolver informa que la devolución quedó guardada; un rechazo del servidor permite reintentar. Las entregas que no se modificaron conservan su estado, sin atribuirles una causa de omisión que el servidor no haya informado.

Los puntos máximos del cuestionario se pueden ajustar desde el editor. El total redistribuye proporcionalmente los puntos de las preguntas, cuya suma sigue siendo el máximo canónico. El editor muestra los valores resultantes y valida los límites de cada pregunta.

Por decisión del usuario, al modificar el máximo de una actividad las notas vigentes se convierten proporcionalmente: 80/100 pasa a 4/5. La conversión conserva el porcentaje y mantiene precisión interna; el redondeo de presentación no sustituye el valor de cálculo. Los ceros siguen siendo ceros y una nota vacía no se convierte en cero.

Con la política de conservar entregas, un cambio exclusivo de escala sin impacto en las acumuladas se aplica al pulsar Guardar, sin una segunda confirmación. Los cambios de contenido, ponderación, corte o política de repetición mantienen la revisión de impacto. Guardar una actividad que ya tenía un máximo nuevo también normaliza entregas vigentes que aún conservaran otra escala.

La escala efectiva de la entrega se guarda separada del enunciado histórico. Los intentos invalidados y las versiones anteriores permanecen en el historial. Las tablas, la revisión, el resultado del estudiante y los promedios consultan la escala efectiva. La revisión admite valores fraccionarios convertidos al guardar comentarios.

Un cambio exclusivo de escala no elimina borradores ni correcciones con la política de conservar entregas. Los cambios de contenido y las decisiones explícitas de repetir mantienen su tratamiento de versiones.

Las comprobaciones funcionales se realizan con datos ficticios en un servidor local. No se utilizan notas de producción para reproducir errores.
