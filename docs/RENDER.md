# Publicar en Render sin administrar un servidor

Guía preparada el **18 de septiembre de 2026**. Render ejecutaría la plataforma, proporcionaría HTTPS y guardaría tus datos en un disco persistente. El código seguiría en [Sajaus01/aula-abierta](https://github.com/Sajaus01/aula-abierta). No necesitas comprar un dominio para comenzar.

Esta guía describe la configuración de publicación. Comprueba en tu panel de Render el estado del servicio y su facturación.

## Costo de referencia

El servicio con **0,5 CPU y 512 MB cuesta USD 7 al mes**, y el disco persistente cuesta **USD 0,25 por GB al mes**. Con un disco de 1 GB, la base sería **USD 7,25 al mes**, usando el espacio de trabajo Hobby sin cuota mensual; no incluye impuestos, consumos adicionales ni un dominio propio. Revisa el total vigente antes de contratar. [Precios oficiales de Render](https://render.com/pricing).

El servicio gratuito no sirve para conservar los datos de esta aplicación: sus archivos y bases SQLite se pierden al reiniciar o volver a desplegar y no admite disco persistente. [Limitaciones del servicio gratuito](https://render.com/docs/free).

## 1. Configurar el servicio

Entra en [Render](https://dashboard.render.com), selecciona **New → Web Service** y usa **Public Git Repository** con `https://github.com/Sajaus01/aula-abierta`, rama **`main`**. Esta opción permite publicar el repositorio público sin conceder acceso adicional a tu cuenta de GitHub. Configura:

| Campo | Valor |
| --- | --- |
| Name | `aula-abierta` o un nombre disponible |
| Language / Runtime | **Node** |
| Root Directory | Dejar vacío: usar la raíz del repositorio |
| Build Command | `node --check server/index.mjs` |
| Start Command | `node server/index.mjs` |
| Compute / Instance Type | **0,5 CPU / 512 MB**, de pago |
| Health Check Path | `/api/status` |

Elige Node expresamente aunque el repositorio también incluya un Dockerfile. Esta aplicación no necesita instalar paquetes para ejecutarse. Render admite comandos propios de construcción e inicio y entrega una dirección `onrender.com` con HTTPS. [Crear un servicio web](https://render.com/docs/web-services).

## 2. Agregar variables y disco antes de crear

En **Environment Variables**, agrega estas variables. Introduce tu contraseña únicamente en el panel de Render; no la escribas en GitHub ni en archivos públicos. [Variables y secretos de Render](https://render.com/docs/configure-environment-variables).

| Variable | Valor |
| --- | --- |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DATA_DIR` | `/var/data/aula` |
| `ADMIN_DOCUMENT` | Tu cédula, entre 4 y 20 dígitos, sin puntos |
| `ADMIN_NAME` | Tu nombre |
| `ADMIN_PASSWORD` | Una contraseña propia de 12 a 256 caracteres |
| `SKIP_INSTALL_DEPS` | `true` |

`NODE_VERSION=22` mantiene el servicio en la rama 22; la aplicación requiere como mínimo 22.16. Render permite definir la versión mediante esa variable. [Versión de Node.js](https://render.com/docs/node-version).

No necesitas configurar `PORT`: la aplicación utiliza el puerto que Render le asigna. Tampoco necesitas `APP_URL` para la dirección inicial: usa automáticamente `RENDER_EXTERNAL_URL`, que Render proporciona. `SKIP_INSTALL_DEPS` evita una instalación innecesaria de paquetes. [Variables predeterminadas de Render](https://render.com/docs/environment-variables).

En **Advanced → Add Disk**, configura:

| Campo | Valor |
| --- | --- |
| Mount Path | `/var/data` |
| Size | `1 GB` |

`DATA_DIR` queda dentro del disco y guarda tanto la base de datos como los materiales. Solo los archivos bajo la ruta montada sobreviven a reinicios y despliegues. Mantén una sola instancia; puedes ampliar el disco según tu contenido. [Discos persistentes de Render](https://render.com/docs/disks).

## 3. Publicar y entrar

Comprueba el servicio de pago, el disco y el costo que muestra Render. **Create Web Service** inicia la contratación y el despliegue. Esa acción queda a tu cargo; preparar estos archivos no la ejecuta.

Cuando Render indique que está **Live**, abre la URL HTTPS que te asigne e ingresa con tu cédula y contraseña de administrador. La plataforma comienza vacía; puedes crear contenido desde el panel o trasladar una instalación existente antes de agregar cursos y estudiantes.

Después de comprobar el acceso, elimina `ADMIN_PASSWORD` de las variables de Render y elige **Save and deploy**. La cuenta ya queda guardada en la base de datos. Cambiar esa variable por sí solo no reemplaza una contraseña existente.

## Trasladar el contenido local

Con la sesión de administrador abierta, ve a **Configuración → Importar traslado** y selecciona la copia de migración preparada para tu instalación. Se conservan los cursos, capítulos, recursos, archivos, estudiantes, matrículas y avances incluidos en la copia. La cuenta de administrador y la configuración del destino se mantienen.

La importación inicial solo admite un destino sin cursos ni estudiantes y se ejecuta una vez. El límite del archivo es 64 MB. La herramienta valida el paquete antes de guardarlo y rechaza una importación que sobrescribiría datos. No es una herramienta de sincronización ni reemplaza un sistema de respaldos.

Las contraseñas de estudiantes que ya estaban configuradas conservan su hash; las sesiones y los códigos de activación del origen no se trasladan. Si un estudiante necesita activar su cuenta, genera un código nuevo desde **Estudiantes**. La cuenta de prueba de administrador local no se copia.

**La copia de migración contiene datos privados.** Consérvala fuera del repositorio, de las carpetas públicas y de las páginas del curso. Súbela únicamente mediante el importador administrativo de tu propia plataforma usando HTTPS.

## Después de publicar

- Haz una prueba con un curso y estudiante propios; comprueba que los materiales privados no se abran al cerrar sesión y que los datos sobrevivan a un nuevo despliegue.
- Conserva respaldos coherentes de la base SQLite y de los materiales fuera del servicio. No confundas la copia del código en GitHub con una copia de tus datos académicos. La guía de [operación y respaldos](PUBLICACION.md#persistencia-y-copias) explica qué debes conservar; sus comandos Docker corresponden únicamente a instalaciones Docker.
- Al usar la URL de un repositorio público sin conectar GitHub, publica los cambios desde **Manual Deploy → Deploy latest commit** en Render. No presupongas despliegues automáticos. Con disco persistente hay una breve interrupción durante ese cambio. [Consideraciones de discos](https://render.com/docs/disks#disk-limitations-and-considerations).
- Si más adelante agregas un dominio propio, configura `APP_URL` con su dirección HTTPS exacta y úsala para entrar. La URL inicial de Render es suficiente para empezar.

