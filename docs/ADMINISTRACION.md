# Administrar cursos y estudiantes

## Preparar un curso

Crea el curso desde el panel de administración. Usa un nombre descriptivo, agrega su descripción y elige libre, cédula, o cédula y contraseña. Mantén el curso en borrador mientras organizas sus módulos y materiales; publícalo cuando quieras habilitarlo para estudiantes.

La modalidad se decide por curso. Puedes tener cursos libres y privados al mismo tiempo. Un estudiante puede tener matrícula en varios cursos. La matrícula y la cuenta son cosas distintas: crear la cuenta de un estudiante no lo matricula automáticamente en todos los cursos.

## Agregar estudiantes

Registra la cédula como texto compuesto por dígitos, sin puntos, guiones ni espacios. Conserva los ceros iniciales si los hay. Usa el nombre que quieras mostrar en el aula y, opcionalmente, su correo de contacto.

Para un grupo, usa la importación CSV. La [plantilla](plantilla-estudiantes.csv) contiene solamente los encabezados:

```csv
cedula,nombre,correo
```

Guarda el archivo en UTF-8 y separado por comas. Si lo preparas en Excel, configura primero la columna de cédula como texto para evitar notación científica, pérdida de dígitos o eliminación de ceros. Un valor que incluya comas debe ir entre comillas dobles según el formato CSV. No incluyas contraseñas en la hoja.

Importa hasta 500 estudiantes por lote. La importación registra las filas válidas e informa cuáles fallaron; una cédula ya existente no se sobrescribe. Revisa el resultado y corrige únicamente las filas pendientes antes de volver a importarlas. Los códigos de activación se muestran al crear las cuentas o al emitir un código nuevo; entrega cada código individualmente por un canal privado.

Después del registro, asigna la matrícula del estudiante en el curso correspondiente. Configura su vigencia cuando quieras que el acceso termine en una fecha determinada. Revisa la modalidad del curso antes de comunicar cómo ingresar.

## Contraseñas

Para cursos con contraseña, el administrador entrega al estudiante un código de activación de un solo uso. El estudiante entra en la opción de activar/configurar su contraseña, indica cédula y código, y elige su propia contraseña. El código caduca a los siete días.

Si un estudiante olvida su contraseña o el código caduca, verifica su identidad por tu canal habitual y genera un nuevo código desde administración. Entrega cada código solo a su titular. Emitir un código nuevo invalida el anterior y las sesiones existentes de esa cuenta.

En cursos de cédula, ingresar por cédula no debe confundirse con comprobar identidad: esa modalidad es apropiada únicamente cuando aceptas que alguien que conozca una cédula matriculada pueda consultar el material. El acceso por contraseña exige que la sesión haya sido creada usando contraseña.

El ingreso solo con cédula se habilita cuando el estudiante tiene una matrícula vigente en al menos un curso publicado con esa modalidad. Una cuenta matriculada únicamente en cursos con contraseña debe ingresar con contraseña.

Si olvidas la contraseña del administrador, la persona que administra el servidor puede restablecerla mediante el procedimiento de [recuperación del administrador](PUBLICACION.md#recuperar-el-acceso-del-administrador). No hay un restablecimiento público de esa cuenta.

## Materiales y publicación

Agrupa los recursos en módulos. Un material puede ser un archivo, un enlace de video, un enlace externo o contenido de texto según el tipo elegido en el formulario. Los ejercicios en esta versión se publican como instrucciones o archivos; no hay un sistema de exámenes con corrección automática.

Antes de publicar, prueba el recorrido como estudiante en una sesión separada del navegador. El administrador puede revisar borradores, por lo que su vista por sí sola no demuestra qué ve un estudiante.

## Datos y mantenimiento

Desactiva una cuenta o revoca su matrícula cuando corresponda. Conserva únicamente los datos necesarios y controla quién tiene acceso al servidor y a sus respaldos. Para trasladar la instalación debes conservar tanto la base de datos como los archivos; consulta [Publicación](PUBLICACION.md).

