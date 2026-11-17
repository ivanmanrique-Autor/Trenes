# R4 directo: Cerdanyola del Vallès ↔ Barcelona-Sants

Web móvil para consultar en una sola pantalla los trenes R4 de la próxima hora, los horarios del día descargados de la fuente oficial y las actualizaciones en tiempo real publicadas por Renfe. La pantalla muestra hasta cinco trenes, hora de salida, llegada estimada a la estación de destino, cuenta atrás y, al desplegar cada tren, su posición conocida y las paradas hasta la estación de consulta.

## Desplegar en GitHub y Vercel

1. Sube todos los archivos de esta carpeta a la raíz de un repositorio GitHub.
2. En Vercel, importa ese repositorio y pulsa **Deploy**. No hace falta configurar un comando de build.
3. En el proyecto de Vercel, abre **Storage → Create Database → Blob** y crea un Blob Store. Vercel añade `BLOB_READ_WRITE_TOKEN` al proyecto.
4. Si la variable no aparece en **Settings → Environment Variables**, añade `BLOB_READ_WRITE_TOKEN` desde el Blob Store o copia el token de lectura/escritura. Actívala para Production y vuelve a desplegar.

La primera consulta de cada fecha de servicio descarga el horario GTFS de Renfe, conserva el horario R4 válido para ese día en Blob y reutiliza esa copia durante el día. Las consultas de trenes también consultan los feeds en directo de Renfe. La aplicación no presenta horarios de ayer como si fueran actuales: si Renfe no permite descargar el horario del día, muestra un error.

## Desarrollo local

Requiere Node.js instalado y Vercel CLI. En la carpeta del proyecto:

```sh
npm install
npx vercel dev
```

Para probar el almacenamiento Blob localmente, enlaza el proyecto Vercel (`npx vercel link`) y descarga las variables (`npx vercel env pull .env.local`). No subas `.env.local` ni tokens al repositorio.

## Archivos

- `index.html`: interfaz adaptable a móvil y escritorio; preferencias locales de estación, refresco automático cada 30 segundos y selección de estación inicial por geolocalización cuando está disponible.
- `api/departures.js`: consulta de trenes y feeds en tiempo real.
- `api/stations.js`: lista de estaciones R4 para los ajustes.
- `api/_shared.js`: descarga y filtrado diario del GTFS, cálculo de servicio y caché privada en Vercel Blob.
- `vercel.json`: límites de ejecución de las funciones.

Los ajustes de la estación de casa y trabajo se guardan en el navegador. Las notificaciones push no están incluidas.
