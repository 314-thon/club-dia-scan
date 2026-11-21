# Club Dia Scan — PWA

Prototipo funcional de aplicación móvil progresiva (PWA) para asistir la compra presencial en sucursales de **Supermercados Dia**, pensada para consultar precios y descuentos en góndola incluso sin señal celular.

**Demo online:** https://club-dia-scan.vercel.app/

## Qué hace

- **Escaneo en góndola:** lee códigos de barras (EAN-13, EAN-8, UPC, Code 128) y QR con la cámara trasera (con linterna y carga manual de EAN como alternativa).
- **Precios y descuentos por sucursal:** muestra precio final, precio de lista, porcentaje de descuento y ahorro por unidad, con selector de sucursal y detección de locales cercanos por GPS.
- **Lista de la visita:** registra los productos escaneados en el recorrido y calcula el total y el ahorro estimado.
- **Ofertas e inicio:** buscador sobre el catálogo de Dia, ofertas filtrables por categoría y acceso a la tarjeta Club Dia.
- **Historial y preferencias:** seguimiento del gasto y ahorro mensual por tickets, desglose por categoría y productos habituales.

## Cómo funciona la PWA

- **Instalable y con Service Worker (`public/manifest.webmanifest` y `public/sw.js`):** se instala en pantalla de inicio en modo `standalone`. El Service Worker precarga el shell de la app y combina *Network-First* para navegaciones y API (con fallback a caché si no hay red), *Cache-First* para miniaturas de productos y *Stale-While-Revalidate* para assets estáticos.
- **Catálogo diario offline en IndexedDB (`src/storage/catalogDb.ts`):** al abrir la app sincroniza automáticamente una vez por día el catálogo (~5.000 productos) desde `/api/catalog` (con fallback al snapshot estático `/catalog.json`). Si hay señal, el escáner consulta el EAN en vivo con timeout corto; si se corta o tarda, resuelve al instante contra IndexedDB por clave EAN.
- **Caché incremental de imágenes (`src/storage/imageCacheSync.ts`):** descarga en segundo plano miniaturas `160×160` en la Cache API, salteando las que ya están cacheadas y purgando las que dejaron de existir en el catálogo.
- **Proxy y catálogo serverless en Vercel (`api/dia.ts`, `api/catalog.ts`):** proxea de forma acotada los endpoints públicos VTEX de Dia Online (búsqueda de productos, consulta por EAN y sucursales cercanas vía `pickup-points`) y consolida el catálogo diario con caché de 24 h en el edge.
- **Integración con el dispositivo:** cámara trasera y decodificación de códigos con `html5-qrcode`, control de flash/linterna vía MediaTrack capabilities y geolocalización vía Geolocation API.

## Stack

- React 19 + TypeScript + Vite
- `html5-qrcode` y `lucide-react`
- IndexedDB, Cache API y Service Worker nativos
- Vercel Serverless Functions

## Uso local

```bash
npm install
npm run dev
```

Otros comandos útiles:

- `npm run build`: compila la versión de producción en `dist/`.
- `npm run sync-catalog`: actualiza el snapshot local `public/catalog.json` desde Dia Online.
- `npm run build:standalone`: genera un único archivo HTML autocontenido con el catálogo embebido para abrir sin servidor.
