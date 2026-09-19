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

Importa hasta 500 estudiantes por lote. La importación registra las filas válidas e informa cuáles fallaron; una cédula ya existente no se sobrescribe. Revisa el resultado y corrige únicamente las filas pendientes antes de volver a importarlas. Cada estudiante nuevo recibe automáticamente su cédula como usuario y contraseña inicial, tanto en el registro individual como en CSV. No debes entregar códigos ni contraseñas distintas a cada persona.

Después del registro, asigna la matrícula del estudiante en el curso correspondiente. Configura su vigencia cuando quieras que el acceso termine en una fecha determinada. Revisa la modalidad del curso antes de comunicar cómo ingresar.

## Contraseñas

El estudiante elige **Con contraseña** e ingresa su cédula en ambos campos. El aula le muestra **Crea tu contraseña personal**. Debe escribir la nueva contraseña dos veces; se aceptan de 4 a 256 caracteres (incluidos cuatro dígitos), siempre que sea diferente de su cédula. Hasta guardarla no puede entrar al aula ni usar el ingreso solo con cédula. Cerrar o recargar la página no elimina este requisito.

En **Estudiantes** puedes ver **Primer ingreso pendiente** o **Contraseña personal**. Si alguien olvida su contraseña, verifica su identidad y usa **Restablecer**. Al confirmar, su contraseña vuelve a ser la cédula, se cierran sus sesiones y deberá crear una nueva al ingresar. Esto conserva matrículas y avances. No se envían correos automáticos.

Las cuentas existentes con contraseña personal conservan su acceso. Las cuentas antiguas que nunca configuraron contraseña reciben el flujo inicial con cédula. Actualizar la plataforma o reimportar estudiantes no restablece contraseñas personales. La contraseña del administrador mantiene un mínimo de 12 caracteres.

La contraseña inicial es conocida por quien tenga la cédula y no comprueba quién está configurando la cuenta. Esta facilidad de acceso implica que otra persona podría activar una cuenta primero. Las contraseñas cortas también son más fáciles de adivinar. La aplicación limita los intentos y guarda hashes, pero esos controles no convierten la cédula en un secreto.

En cursos de cédula, ingresar por cédula no debe confundirse con comprobar identidad: esa modalidad es apropiada únicamente cuando aceptas que alguien que conozca una cédula matriculada pueda consultar el material. El acceso por contraseña exige que la sesión haya sido creada usando contraseña.

El ingreso solo con cédula se habilita cuando el estudiante tiene una matrícula vigente en al menos un curso publicado con esa modalidad. Una cuenta matriculada únicamente en cursos con contraseña debe ingresar con contraseña.

Si olvidas la contraseña del administrador, la persona que administra el servidor puede restablecerla mediante el procedimiento de [recuperación del administrador](PUBLICACION.md#recuperar-el-acceso-del-administrador). No hay un restablecimiento público de esa cuenta.

## Materiales y publicación

Agrupa los recursos en módulos. Un material puede ser un archivo, un enlace de video, un enlace externo o contenido de texto según el tipo elegido en el formulario. Los ejercicios en esta versión se publican como instrucciones o archivos; no hay un sistema de exámenes con corrección automática.

Antes de publicar, prueba el recorrido como estudiante en una sesión separada del navegador. El administrador puede revisar borradores, por lo que su vista por sí sola no demuestra qué ve un estudiante.

## Datos y mantenimiento

Desactiva una cuenta o revoca su matrícula cuando corresponda. Conserva únicamente los datos necesarios y controla quién tiene acceso al servidor y a sus respaldos. Para trasladar la instalación debes conservar tanto la base de datos como los archivos; consulta [Publicación](PUBLICACION.md).

