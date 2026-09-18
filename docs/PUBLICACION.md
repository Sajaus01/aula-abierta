# Publicar Aula Abierta

## Qué se publica y dónde

GitHub conserva el código de la plataforma y su historial. El sitio con usuarios, contraseñas, matrículas y archivos se ejecuta en un servidor Node.js. GitHub Pages es un servicio para sitios estáticos, por lo que no sustituye ese servidor. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Esta guía usa un servidor Linux con Docker Engine y Docker Compose, un dominio y el proxy Caddy. No contrata ningún servicio. Puedes usar un servidor que ya tengas y cuya administración controles.

## Preparación

Necesitas acceso al servidor, Docker con el complemento Compose, espacio para los libros y diapositivas, y un nombre DNS como `aula.tudominio.edu`. Configura los registros DNS para que apunten a la IP del servidor y permite conexiones entrantes a los puertos 80 y 443. Caddy obtiene y renueva certificados para ese dominio cuando la configuración de red lo permite. [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).

En el servidor, clona el repositorio y entra en su carpeta `docs/deploy`. Copia `.env.example` como `.env`, limita sus permisos y edítalo con tu editor:

```sh
cp .env.example .env
chmod 600 .env
```

Completa estas variables:

| Variable | Valor |
| --- | --- |
| `DOMAIN` | Dominio real, sin `https://` ni barra final |
| `ADMIN_DOCUMENT` | Cédula del primer administrador; de 4 a 20 dígitos |
| `ADMIN_NAME` | Nombre del administrador |
| `ADMIN_PASSWORD` | Contraseña propia de al menos 12 caracteres |

En archivos `.env` de Compose, encierra en comillas simples las contraseñas que contienen `$`, `#` o espacios para evitar interpolación. No guardes la contraseña dentro del Dockerfile, del código o de un secreto de GitHub si el flujo no lo necesita. El archivo `.env` está excluido de Git; contiene credenciales en texto legible y debe permanecer bajo control del administrador del servidor. [Formato de variables de Docker Compose](https://docs.docker.com/reference/compose-file/services/#env_file).

## Arranque

Desde `docs/deploy`:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 app web
```

Abre `https://` seguido del dominio configurado. Ingresa con el administrador creado. La aplicación no expone directamente el puerto 3000 en internet; Caddy recibe HTTPS y reenvía las peticiones por la red interna de Docker. [Proxy inverso de Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy).

La sesión usa cookies seguras en producción. `APP_URL` queda configurada como `https://tu-dominio`; debe coincidir con el origen que utilizan los navegadores. Si cambias de dominio, cambia `DOMAIN` y vuelve a ejecutar `docker compose up -d`.

Una vez creado y comprobado el administrador, puedes borrar `ADMIN_PASSWORD` del archivo `.env` y recrear el contenedor con `docker compose up -d`. La cuenta ya existe en la base de datos. Si partes en el futuro de un volumen vacío, tendrás que proporcionar otra vez las variables de creación inicial.

## Persistencia y copias

El volumen Docker `aula-abierta-data` contiene la base de datos y los archivos subidos. Debe persistir al recrear o actualizar el contenedor. No uses almacenamiento efímero para este directorio. Una copia solo del código de GitHub no respalda estudiantes, matrículas ni materiales.

Para una copia coherente y sencilla, detén brevemente la aplicación y copia todo el directorio de datos. Ejecuta desde `docs/deploy` en el servidor Linux:

```sh
snapshot="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$snapshot"
docker compose stop app
docker compose cp app:/app/data/. "$snapshot"
docker compose start app
```

Comprueba que la copia incluye la base de datos y `uploads/`; consérvala cifrada en un destino distinto del servidor y prueba periódicamente su restauración en una instancia aislada. Si falla el comando de copia, vuelve a iniciar la aplicación con `docker compose start app` y resuelve el fallo antes de considerar terminado el respaldo.

Para restaurar, detén la aplicación, conserva aparte el volumen actual y coloca el contenido completo de una copia coherente en un volumen vacío. El usuario `node` de la imagen debe poder escribir en él. Arranca primero una instancia aislada y verifica acceso, matrículas y descargas antes de usar esa copia como producción. No combines bases de datos y archivos de copias de fechas distintas.

No ejecutes `docker compose down -v` sobre la instalación con datos que quieras conservar: `-v` elimina los volúmenes declarados del proyecto.

## Recuperar el acceso del administrador

El restablecimiento del administrador requiere acceso al servidor; no está expuesto en la web. En `docs/deploy/.env`, coloca su cédula existente en `ADMIN_DOCUMENT` y la nueva contraseña en `ADMIN_PASSWORD`. Desde `docs/deploy`, ejecuta:

```sh
docker compose stop app
docker compose run --rm --no-deps app node server/reset-admin.mjs
```

Después de que el comando confirme el restablecimiento, retira `ADMIN_PASSWORD` del archivo `.env` y ejecuta `docker compose up -d app`. La cuenta conserva sus cursos y estudiantes; las sesiones previas de ese administrador se invalidan. Si el comando falla, revisa el mensaje y vuelve a iniciar la aplicación cuando termines de resolverlo.

Para una instalación local, detén el servidor, coloca la nueva contraseña en `.env.local` y ejecuta desde la raíz `node --env-file=.env.local server/reset-admin.mjs`. Retira luego la contraseña del archivo de configuración y arranca de nuevo el servidor. Cambiar solamente las variables y reiniciar no restablece una cuenta existente.

## Actualizar

Primero crea una copia de seguridad. Después actualiza el código en la raíz del repositorio y reconstruye desde `docs/deploy`:

```sh
git pull --ff-only
docker compose build --pull app
docker compose pull web
docker compose up -d
```

El primer comando puede ejecutarse desde `docs/deploy` porque pertenece al mismo repositorio Git. Comprueba la salud con `docker compose ps`, inicia sesión y prueba un archivo matriculado. Para despliegues repetibles puedes fijar las imágenes a versiones o digest previamente comprobados, en lugar de depender de etiquetas móviles.

## Operación

- Usa una única réplica del servidor con este diseño SQLite; no compartas el mismo archivo de base de datos entre múltiples servidores.
- Planifica el espacio del volumen y el tamaño de los respaldos. Los archivos tienen un máximo de 20 MiB cada uno; para videos grandes, utiliza enlaces a un proveedor de video.
- Guarda cédulas, correos, contraseñas, códigos de activación y materiales de cursos privados fuera del repositorio.
- El proxy o el proveedor de video no añade permisos de matrícula a enlaces externos. Si un video debe ser privado, configura también su privacidad en el proveedor.
- El correo de los estudiantes se almacena como dato de contacto. Esta versión no envía correos ni recupera contraseñas por correo; el administrador emite un nuevo código.

## Comprobación antes de compartir el enlace

Verifica con un curso propio que un visitante solo vea contenido libre, que un estudiante acceda únicamente a sus matrículas vigentes, que un archivo privado no se abra al cerrar la sesión y que un curso de contraseña rechace una sesión creada solo con cédula. Comprueba también que los datos sobrevivan a `docker compose restart app`.

