# Aula Abierta: cursos plantilla y grupos

## Uso

- **Cursos plantilla**: prepara contenidos y evaluaciones. Usa «Crear grupo / duplicar» para generar una copia independiente por semestre y código. Las matrículas corresponden a grupos.
- **Grupos**: administra la clase actual, sus docentes, matrículas, materiales y notas. Archivar conserva el historial y retira el acceso estudiantil.
- **Usuarios y roles**: disponible para máster y administrativos. Los docentes administran únicamente los grupos asignados, según permisos de edición, calificación y gestión. Solo un máster concede o retira ese rol; la última cuenta máster activa está protegida.
- **Biblioteca**: guarda capítulos, materiales, laboratorios y actividades desde un curso; permite copias privadas o compartidas. «Usar uno existente» crea otra copia, en borrador, con archivos propios.
- **Evaluación**: configura cortes que sumen 100 %, asigna actividades a cada corte y completa sus ponderaciones. Las notas pendientes no equivalen a cero. Las exenciones redistribuyen ponderaciones; las correcciones llevan motivo y autor.
- **Cuestionarios**: preguntas de selección única, múltiple y abiertas; imágenes HTTPS, retroalimentación, puntos, intentos, fechas y límite de tiempo. La plantilla XLSX se descarga desde el editor. La importación permite mapear columnas y validar cada fila antes de incorporarla.
- **Versiones**: una corrección editorial conserva las entregas. Para cambios evaluables, elige conservar notas, permitir nuevos intentos o exigir repetir. Las versiones, respuestas y enunciados anteriores se conservan en el historial. Un cambio evaluable archiva los borradores anteriores para que no se envíen contra preguntas distintas.
- **Vista estudiante**: previsualiza un grupo sin generar avances ni entregas. Los borradores permanecen ocultos como en el acceso real.
- **Seguimiento**: filtros y exportación por grupo, estudiante y actividad. Distingue acceso a la plataforma, ingreso al grupo, apertura y finalización declarada de materiales. Las aperturas no demuestran aprendizaje.
- **Laboratorios**: HTML/CSS/JavaScript autocontenido, aislado con CSP y sandbox. Se pueden importar, abrir a pantalla completa, compartir y copiar. Los resultados se registran como texto y observaciones; no se ejecuta código Java en el servidor ni se aceptan mensajes automáticos del iframe como calificaciones.

## Activación y migración

Configura `AULA_MODEL_V2=1`. En el primer arranque se crea un respaldo consistente de SQLite y sus archivos en `DATA_DIR/backups`, con manifiesto SHA-256. Luego se realiza una transacción idempotente:

1. Identifica al único administrador actual como máster, sin crear otra cuenta ni cambiar credenciales.
2. Conserva los cursos originales como plantillas y crea un grupo `2026-1` por curso.
3. Reasigna los identificadores originales de contenidos, actividades y matrículas al grupo. Así se conservan respuestas, notas y avances sin duplicarlos. La plantilla recibe copias independientes de contenidos y archivos.
4. Compara inventarios por curso y verifica claves foráneas. Conserva el informe en el respaldo y en `schema_migrations`.

Una migración completada no se repite. Si aparece un grupo 2026-1 sin registro de migración, lo reconoce y concilia sus matrículas conservando historial. Un conflicto entre esquemas de notas distintos revierte la operación para permitir una decisión explícita. Los estudiantes acceden únicamente a grupos activos con matrícula vigente, incluso si el antiguo modo del curso era libre.

## Recuperación

No reviertas solamente el código después de migrar los datos. Detén el servicio, conserva una copia del estado actual y restaura el respaldo verificado en **otro directorio vacío**:

```sh
node server/backup.mjs restore /ruta/al/respaldo /ruta/vacia
```

Arranca la versión anterior apuntando `DATA_DIR` al directorio restaurado, sin `AULA_MODEL_V2`. No sobrescribas la base activa. El respaldo contiene datos privados: no lo publiques en GitHub.

## Alcance de las mediciones y límites

Los registros de ingreso al grupo y auditorías detalladas de calificación empiezan con esta versión; no se inventan datos históricos. Los filtros de materiales usan sus últimas fechas guardadas; notas y ponderaciones muestran el estado actual. Las correcciones se muestran cronológicamente y en gráficas por estudiante y actividad, pero no se reconstruye una nota final histórica completa. La comparación de grupos presenta promedio, escala, progreso y volúmenes, y advierte que contenidos y estudiantes pueden ser diferentes.

La importación de cuestionarios acepta XLSX de hasta 2 MB, 50 preguntas y cuatro opciones por fila; el editor permite hasta diez opciones. Rechaza fórmulas y limita la expansión ZIP a 20 MB. El laboratorio debe ser autocontenido: no accede a las credenciales, almacenamiento del campus ni conexiones de red mediante JavaScript.

Los límites actuales de archivos y el almacenamiento contratado en Render se conservan. No se contrató un servidor o plan adicional.

## Verificación

`npm ci --omit=optional --ignore-scripts` y `node --test --test-concurrency=1 tests/*.test.mjs`.

Las pruebas cubren migración repetida y restauración, copias independientes de archivos, permisos y último máster, matrícula por lotes, publicación, versiones, conservación de escalas, exenciones, cortes, registro de laboratorio, estadísticas, importación XLSX y recuperación de acceso. Las pruebas de navegador usan exclusivamente datos sintéticos locales.

Consulta [las correcciones de la auditoría](docs/CORRECCIONES-AUDITORIA.md) para los quince ajustes y su verificación.
