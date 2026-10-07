# Portal de seguimiento · Mejora NPS WLAN

Portal web de Sipnology para dar seguimiento a las iniciativas de mejora NPS de la red WLAN de BBVA.

- **Inicio de sesión** con usuario y contraseña propios del portal.
- **Tablero ejecutivo**: las 6 iniciativas con métrica inicial, actual y objetivo, estado y tendencia. Incluye modo presentación (pantalla completa, sin controles de edición).
- **Detalle por iniciativa**: gráfica semanal contra el objetivo, valor al negocio, impacto esperado, hitos, bitácora de avances y metodología.
- **Captura semanal**: cada ingeniero registra las métricas de la semana con su detalle, sede y enlace de evidencia. Un registro por iniciativa por semana.
- **Usuarios y roles**: administrador, ingeniero (captura) y solo consulta.
- **Exportación** de todos los avances a CSV.

## Recorridos proactivos (captura diaria)

La iniciativa "Recorridos proactivos" se captura por día en la sección **Recorridos**:

- Cada recorrido lleva fecha, hora (automática y editable), sede, piso, área, SSID y ejecutor (el usuario que inició sesión).
- 20 pruebas por recorrido, cada una con evidencia obligatoria. Con **Carga rápida** se suben varias fotos a la vez: el portal las lee con OCR, identifica la prueba y carga los resultados. Lo que no pueda leer se captura a mano y la evidencia queda guardada.
- Las lecturas dudosas del OCR quedan marcadas como "Revisar lectura" y no dejan completar el recorrido hasta que el ingeniero las confirme o corrija.
- Los resultados se colorean con los umbrales (bueno, regular, alarmante) definidos en `public/js/pruebas.js`.
- Solo el ejecutor o un administrador puede modificar un recorrido. El administrador puede capturar a nombre de otro ingeniero y reasignar el recorrido; todo queda en la trazabilidad.
- Sedes, pisos y áreas se pueden agregar a mano; el portal avisa si ya existe uno igual o parecido.
- El tablero muestra el avance diario, los valores mínimo, promedio y máximo por indicador, y la matriz de recorridos. Se exporta a **PDF** (botón "Exportar a PDF", que usa la impresión del navegador en horizontal) y a **CSV** para Excel.
- El indicador "Recorridos por semana" se calcula con los recorridos completos de cada semana.

**OCR.** Usa Tesseract instalado en el servidor (la imagen de Docker ya lo incluye en español e inglés). Si no está instalado, el portal funciona igual con captura manual. Las evidencias se guardan en `data/evidencias/`: unos 3 MB por recorrido completo. Vigila el espacio del disco y amplíalo cuando haga falta.

**Actualizar desde la versión anterior.** Sube todos los archivos al mismo repositorio; al arrancar se crean las tablas nuevas y el catálogo de sedes y pisos sin tocar usuarios, avances ni hitos existentes.

## Rediseño WLAN (seguimiento diario)

Dentro de la iniciativa "Rediseño WLAN sedes centrales y divisionales" hay un tablero diario de usuarios y utilización de canal por AP:

- **Carga de Excel:** el ingeniero sube el "Reporte de canal de utilización" (.xlsx, una hoja por sede). El portal extrae las lecturas, las valida y muestra un resumen antes de guardar. Se puede subir el archivo completo cada día: solo se agregan las lecturas nuevas y se avisa de las que cambiarían de valor.
- **Captura manual:** sede, fecha, hora y los valores de cada AP. Los valores muy por encima de lo habitual piden confirmación.
- **Validación:** usuarios no numéricos o negativos, utilización fuera de 0 a 100%, porcentajes sin formato, fechas futuras o repetidas, bloques sin fecha, AP repetidos o con nombre parecido a uno existente, sedes nuevas.
- **Métrica y colores:** usuarios por AP: bueno menos de 30, regular de 30 a 37, alarmante más de 37 (constante `UMBRALES` en `rediseno.js`). La utilización de canal se muestra pero no forma parte de la métrica.
- **Tablero:** periodo editable (dos semanas por defecto), hallazgos automáticos, estadística general y por sede, tendencias y matriz de pico diario por AP.
- **Exportación:** PDF (impresión del navegador) e imagen PNG por sede.
- **Trazabilidad:** cada carga queda con el ingeniero, la fecha y la hora; un administrador puede deshacerla.
- El indicador semanal de la iniciativa es el promedio de usuarios por AP de todas las lecturas de la semana.

El histórico inicial (`seed-rediseno.json`) se carga solo cuando el portal no tiene lecturas.

**Respaldo.** En Usuarios, el administrador puede descargar la base de datos completa.



- Node.js **22.13 o superior**. No requiere `npm install`: no tiene dependencias externas.
- Los datos se guardan en un archivo SQLite dentro de `data/`.

## Arranque

```bash
cp .env.example .env      # opcional: ajusta puerto y contraseña inicial
npm start
```

Abre `http://localhost:3000`. La primera vez se crea el usuario `admin`; su contraseña temporal aparece **una sola vez en la consola** (o es la que definas en `ADMIN_PASSWORD`). El portal obliga a cambiarla en el primer acceso.

Después, entra a **Usuarios** y da de alta a cada ingeniero con una contraseña temporal; cada quien define la suya al entrar.

### Alta masiva de usuarios

Con un CSV de columnas `usuario,nombre,rol,contrasena_temporal` (roles: `admin`, `ingeniero`, `consulta`):

```bash
npm run usuarios -- usuarios.csv
```

Los usuarios que ya existen se omiten y cada persona debe cambiar su contraseña temporal al entrar. Si lo ejecutas antes del primer arranque, el portal ya no crea el usuario `admin` genérico. Con Docker: `docker cp usuarios.csv portal-nps:/tmp/` y `docker exec portal-nps node --disable-warning=ExperimentalWarning crear-usuarios.js /tmp/usuarios.csv`. Elimina el CSV al terminar.

### Con Docker

```bash
docker build -t portal-nps .
docker run -d --name portal-nps --restart unless-stopped -p 3000:3000 \
  -v portal-nps-data:/app/data -e ADMIN_PASSWORD='cambia-esta-clave' portal-nps
```

### En Render (sin servidor propio)

El archivo `render.yaml` describe el servicio: contenedor Docker, disco persistente de 1 GB en `/app/data` y HTTPS incluido. Sube esta carpeta a un repositorio privado de GitHub (sin `usuarios.csv`), y en Render elige **New > Blueprint**, selecciona el repositorio y define `ADMIN_PASSWORD`. Después entra como `admin` y usa **Usuarios > Alta masiva** para pegar la lista de cuentas.

## Puesta en producción

1. **Usa HTTPS.** Publica el portal detrás de un proxy inverso (Nginx, Caddy o el balanceador de la nube) con certificado, y define `COOKIE_SECURE=1` y `TRUST_PROXY=1`.
2. **Respalda `data/portal.db`** (junto con `portal.db-wal` si existe). Es toda la información del portal.
3. Mantén el servicio activo con systemd, PM2 o Docker.

Ejemplo mínimo para Nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Variables de entorno

| Variable | Valor por defecto | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `DATA_DIR` | `./data` | Carpeta de la base de datos |
| `ADMIN_USER` | `admin` | Usuario administrador inicial (solo primer arranque) |
| `ADMIN_PASSWORD` | aleatoria | Contraseña temporal del administrador inicial |
| `COOKIE_SECURE` | `0` | `1` para enviar la cookie de sesión solo por HTTPS |
| `TRUST_PROXY` | `0` | `1` si hay un proxy inverso delante |
| `SESSION_HOURS` | `12` | Duración de la sesión |

## Seguridad incluida

- Contraseñas con hash scrypt y sal por usuario; mínimo 10 caracteres.
- Sesión en cookie `HttpOnly` + `SameSite=Strict`; los tokens se guardan con hash.
- Bloqueo de 15 minutos tras 5 intentos fallidos de acceso.
- Permisos validados en el servidor en cada operación.
- Bitácora de auditoría (tabla `audit`): accesos, capturas, ediciones, cambios de metas y de usuarios, con el valor anterior.
- Cabeceras CSP, `X-Frame-Options` y `nosniff`. Sin recursos de terceros: funciona en redes sin salida a internet.

Antes de exponerlo a internet conviene una revisión de seguridad propia, como con cualquier aplicación nueva.

## Cómo se calculan los estados

| Estado | Regla |
|---|---|
| Objetivo cumplido | El valor actual cumple la métrica objetivo |
| En progreso | Hay objetivo, aún no se cumple y el valor mejora respecto al inicial |
| Requiere atención | Hay objetivo y el valor no mejora respecto al inicial |
| Dentro de criterio / Evaluar rediseño | Indicadores con umbral en lugar de objetivo (usuarios por AP: 37) |
| Mejora vs. inicial | Indicadores sin objetivo numérico que mejoran respecto al inicial |

## Datos iniciales

`seed.js` contiene las 6 iniciativas tal como aparecen en la presentación "Actividades Mejora WLAN - NPS" (octubre 2026): métricas inicial y objetivo, textos, hitos y un primer registro con la "métrica actual" del documento, asignado a la semana del 28 de septiembre de 2026. Solo se carga cuando la base está vacía. Las métricas inicial y objetivo se editan después desde el portal (administrador, en el detalle de cada iniciativa).

Para agregar una iniciativa nueva, añade su definición en `seed.js` antes del primer arranque, o inserta la fila en la tabla `initiatives`.

## Estructura

```
server.js        servidor, API y base de datos
recorridos.js    recorridos diarios, evidencias y OCR
rediseno.js      rediseño WLAN: lecturas diarias, carga de Excel y validación
rediseno-formato.js / xlsx-lite.js   lectura del reporte de Excel
seed.js          definición inicial de iniciativas
public/          login, aplicación, estilos, gráficas y logo
data/            base de datos (se crea al arrancar)
```
