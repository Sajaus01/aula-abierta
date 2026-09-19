# Aula Abierta

Plataforma de cursos en español para administrar estudiantes, matrículas y materiales desde el navegador. Empieza sin cursos ni estudiantes: tú creas la estructura y subes después tus diapositivas, libros, videos y ejercicios.

La interfaz usa HTML, CSS y JavaScript. El servidor usa Node.js y SQLite, sin dependencias de terceros de npm. No necesitas programar para agregar cursos o materiales desde el panel.

## GitHub y publicación

El repositorio de GitHub guarda el código y ejecuta las verificaciones automáticas. La plataforma completa necesita además un servidor que ejecute Node.js y conserve su volumen de datos. GitHub Pages aloja archivos estáticos; por sí solo no ejecuta este servidor ni puede proteger materiales mediante las matrículas de esta aplicación. [Documentación oficial de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Para dar acceso a estudiantes por internet sin administrar un servidor, sigue [Publicar en Render](docs/RENDER.md): incluye los pasos, las variables y el costo de referencia. Si ya tienes un servidor, puedes usar [Docker y HTTPS](docs/PUBLICACION.md). El código incluye la configuración de despliegue; tener estos archivos en GitHub no significa que el servicio ya esté publicado.

## Empezar en tu computador

1. Instala Node.js 22.16 o una versión más reciente de la rama 22.
2. Descarga el repositorio y abre una terminal en esta carpeta.
3. Copia `docs/local.env.example` como `.env.local` en la raíz.
4. Completa `ADMIN_DOCUMENT` con tu cédula, `ADMIN_NAME` con tu nombre y `ADMIN_PASSWORD` con una contraseña de al menos 12 caracteres. No compartas ni subas este archivo a GitHub.
5. Ejecuta:

```sh
node --env-file=.env.local server/index.mjs
```

Abre [http://localhost:3000](http://localhost:3000) e ingresa con las credenciales que definiste. El administrador inicial se crea solamente si todavía no existe uno; cambiar después esas variables no reemplaza una contraseña existente. Los datos quedan en `data/`, fuera de los archivos públicos y excluidos de Git.

No es necesario ejecutar `npm install`. `node:sqlite` viene integrado; Node.js 22 puede mostrar un aviso sobre el estado experimental de esta API. [Referencia de Node.js](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html).

## Tres formas de acceso por curso

| Modalidad | Quién puede ver los materiales | Uso habitual |
| --- | --- | --- |
| Libre | Cualquier visitante | Recursos abiertos y cursos públicos |
| Cédula | Estudiante activo con matrícula vigente e ingreso por cédula | Contenido de acceso sencillo |
| Cédula y contraseña | Estudiante activo con matrícula vigente y sesión autenticada con contraseña | Cursos que necesitan verificar identidad |

La cédula identifica a una persona, pero no es un secreto. En un curso con acceso por cédula, cualquiera que conozca una cédula matriculada podría entrar con ella. El administrador siempre debe usar contraseña. Los borradores sirven para preparar cursos antes de publicarlos.

## Flujo de trabajo

1. Crea el curso y elige su modalidad de acceso.
2. Organiza módulos y agrega materiales desde el panel.
3. Dentro del curso, pulsa **Matricular estudiantes → Subir lista y matricular** y carga un CSV con `cedula,nombre,correo`. Creará las cuentas que falten y las matriculará en ese curso en un solo paso.
4. Revisa la vista previa, define vigencia si corresponde y consulta el resultado por registro. También puedes registrar estudiantes por separado y usar la matrícula individual.
5. Indica a los estudiantes nuevos que ingresen en **Con contraseña**, usando su cédula como usuario y contraseña inicial. El aula les exigirá crear una contraseña personal antes de acceder a los cursos. No necesitas repartir códigos.
6. Publica el curso y comparte la dirección de tu plataforma.

Consulta [la guía de administración](docs/ADMINISTRACION.md) y [las recomendaciones para preparar contenido](docs/CONTENIDOS.md). También puedes agregar capítulos HTML con CSS y JavaScript incluidos en el mismo documento; se muestran en un visor aislado con control de matrícula. Hay una [plantilla CSV vacía](docs/plantilla-estudiantes.csv), sin datos de personas ni cursos de ejemplo.

Las contraseñas personales de estudiantes admiten de 4 a 256 caracteres, incluidos cuatro dígitos, y deben ser diferentes de su cédula. El administrador conserva el mínimo de 12 caracteres. La cédula inicial es predecible: quien la conozca podría completar el primer ingreso antes que su titular. Si ocurre, verifica la identidad del estudiante y restablece su acceso desde **Estudiantes**. Las contraseñas personales ya elegidas se conservan al actualizar o reimportar una lista.

## Desarrollo y comprobaciones

```sh
node --test tests/*.test.mjs
```

GitHub Actions ejecuta las pruebas y construye la imagen Docker en cada cambio. El flujo de CI no publica el sitio y no necesita las contraseñas de tu plataforma.

```text
public/                    Interfaz HTML, CSS y JavaScript
server/                    API, sesiones, autorización y persistencia
tests/                     Pruebas automatizadas
docs/                      Guías y plantilla de importación
docs/deploy/               Docker Compose y proxy HTTPS
data/                      Base de datos y materiales; solo en el servidor
```

## Alcance

Esta base permite gestionar un aula y distribuir materiales. No incluye cobros, videoconferencia propia, envío de correos de recuperación, calificación automática de ejercicios, SCORM ni certificados académicos. Los videos externos conservan las reglas de acceso del proveedor donde están alojados. Se puede ampliar el código cuando esas funciones hagan falta.

La configuración usa una única instancia de la aplicación y almacenamiento persistente local. Antes de operar con estudiantes reales, configura HTTPS, copias de seguridad y una política de tratamiento de los datos que recopilarás.
