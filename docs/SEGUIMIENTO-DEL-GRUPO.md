# Seguimiento del grupo

Panorama, Seguimiento y el libro de calificaciones utilizan el mismo informe autorizado del grupo. Panorama permite localizar un grupo; Seguimiento compara estudiantes y abre el detalle individual; el libro presenta primero ese resumen y permite desplegar las calificaciones por actividad. El registro de auditoría de Panorama sigue disponible por separado.

Los filtros de grupo, estudiante y fechas se conservan en los enlaces entre estas vistas. Las fechas corresponden a días de Colombia, en `America/Bogota`. Si no se elige un intervalo, se muestran los últimos 30 días. El promedio del grupo conserva toda su matrícula como referencia cuando se consulta a un solo estudiante. En el panorama de varios grupos, un estudiante puede tener más de una matrícula; se informa también el número de personas distintas.

## Estado actual y actividad del periodo

Las entregas, pendientes, vencidas, materiales completados, avance y notas describen el estado actual. No se reconstruye una nota ni un avance histórico al cambiar las fechas. El periodo filtra ingresos, sesiones, tiempo activo y acciones registradas. Los informes lo indican para evitar comparar medidas de alcance distinto.

Cada actividad visible se cuenta una vez según su última respuesta vigente. Enviada o calificada cuenta como entregada; un borrador o una devolución sigue pendiente. Las actividades pendientes y las vencidas sin entrega forman categorías separadas. Una corrección usa su nuevo plazo y, si no tiene otro plazo, no recupera el vencimiento anterior. Las exenciones no se cuentan como incumplimiento. Estos informes no asignan notas de cero ni cambian plazos o estados de entrega.

El avance usa el mismo cálculo integral que la vista del estudiante: materiales completados, tareas entregadas y cuestionarios enviados del contenido publicado visible. Las notas usan la acumulada sobre el 100 % del semestre del libro docente, incluida su política de exenciones. Una actividad publicada conserva su efecto en el esquema de notas aunque su capítulo se oculte; el seguimiento del contenido visible se identifica por separado. Las notas privadas se muestran únicamente a quienes tienen permiso para calificar.

## Medición de ingresos y tiempo

La medición nueva se guarda en tablas independientes de la presencia en línea y de las sesiones de autenticación. Su fecha inicial queda registrada de forma persistente. No se atribuyen ingresos ni tiempo activo al periodo anterior a esa fecha. Las antiguas consultas del curso, registradas como `group.enter`, permanecen como evidencia de apertura de la API y no se convierten en ingresos medidos.

Un ingreso inicia una sesión de trabajo del estudiante en el grupo. La sesión se reanuda mientras no transcurran 30 minutos sin actividad; después empieza otra. Recargar, cambiar de capítulo o abrir otra pestaña del mismo grupo no añade otro ingreso dentro de esa sesión. Se cuenta un ingreso por sesión iniciada en el intervalo seleccionado.

El tiempo activo requiere el aula visible, en primer plano y una interacción reciente en su interfaz. El cliente solo considera eventos de interacción confiables del navegador. Envía señales cada 15 segundos y deja de considerarlas activas tras 60 segundos sin interacción. El servidor utiliza su propio reloj; no acepta una duración declarada por el cliente. Una primera señal no acredita tiempo anterior y un hueco de conexión superior a 30 segundos no se rellena. Las secuencias repetidas se descartan y los intervalos solapados de varias pestañas se cuentan una vez.

El promedio por sesión divide el tiempo activo medido en el periodo entre las sesiones con inicio o actividad en ese periodo. Por eso una sesión iniciada el día anterior puede aportar tiempo sin sumar un nuevo ingreso al día siguiente. Su duración entre inicio y última señal se puede consultar como dato distinto del tiempo activo. Las series diarias usan los intervalos realmente medidos y los días de Colombia; no representan una acumulada histórica de notas.

La medición es conservadora. La lectura sin interacción, la reproducción de un video y las acciones dentro de contenido externo o marcos incrustados no siempre pueden confirmarse y no se estiman. Tampoco demuestra atención ni aprendizaje. Una pestaña abierta sin interacción no suma tiempo activo.

Solo el estudiante con contraseña, matrícula vigente y grupo disponible puede enviar señales. La vista docente y las vistas previas no generan participación académica. El servidor vuelve a comprobar la identidad y la matrícula después de leer cada señal. Cerrar sesión no elimina el histórico del seguimiento.

## Lectura de los indicadores

Las barras comparan tiempo activo por estudiante con el promedio del grupo. La serie temporal muestra fechas y valores registrados. Las proporciones de entrega separan entregadas, pendientes y vencidas sin entrega; no suman dos veces una actividad vencida. La distribución de notas utiliza la acumulada actual, cuyo valor cero puede ser provisional mientras existan porcentajes pendientes de evaluación.

Los indicadores enlazan con sus estudiantes, sesiones, contenidos o entregas. El detalle y las tablas accesibles sustentan los gráficos. Las alertas de acumulada por debajo del umbral no son un dictamen de reprobación anticipado. Las tablas extensas de eventos, intervalos y sesiones tienen límites visibles; el detalle indica cuando se ha recortado la lista, mientras los totales se calculan sobre todos los registros del periodo.
