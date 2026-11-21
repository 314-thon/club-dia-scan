import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TMP_OUT = resolve(ROOT, '.standalone-tmp');
const OUTPUT_HTML = resolve(ROOT, '../entregables/prototipo-club-dia.html');

const LOCAL_IMAGES = [
  'aceite.jpg',
  'gondola.jpg',
  'higienol.jpg',
  'leche.jpg',
  'matarazzo.jpg',
  'playadito.jpg',
  'yogur.jpg',
];

function escapeScriptInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

async function main() {
  await rm(TMP_OUT, { recursive: true, force: true });

  await viteBuild({
    root: ROOT,
    configFile: false,
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir: TMP_OUT,
      emptyOutDir: true,
      target: 'es2020',
      cssCodeSplit: false,
      assetsInlineLimit: 10000000,
      rollupOptions: {
        input: resolve(ROOT, 'src/main.tsx'),
        output: {
          format: 'iife',
          name: 'ClubDiaPrototype',
          inlineDynamicImports: true,
          entryFileNames: 'bundle.js',
          assetFileNames: 'bundle.[ext]',
        },
      },
    },
    logLevel: 'warn',
  });

  const jsCode = await readFile(resolve(TMP_OUT, 'bundle.js'), 'utf8');
  let cssCode = '';
  try {
    cssCode = await readFile(resolve(TMP_OUT, 'bundle.css'), 'utf8');
  } catch {
    cssCode = '';
  }

  const assetsMap = {};
  for (const filename of LOCAL_IMAGES) {
    const buf = await readFile(resolve(ROOT, 'public/assets', filename));
    assetsMap[`/assets/${filename}`] = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }

  const iconSvg = await readFile(resolve(ROOT, 'public/icon.svg'), 'utf8');
  const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg, 'utf8').toString('base64')}`;

  const catalogRaw = await readFile(resolve(ROOT, 'public/catalog.json'), 'utf8');
  // Validate JSON before embedding
  const catalogParsed = JSON.parse(catalogRaw);

  const html = `<!doctype html>
<html lang="es-AR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#F7F6F3" />
    <title>Club Dia — Prototipo Funcional</title>
    <link rel="icon" type="image/svg+xml" href="${iconDataUri}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Outfit:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>${cssCode}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__CLUB_DIA_STANDALONE__ = true;
      window.__CLUB_DIA_ASSETS__ = ${escapeScriptInline(JSON.stringify(assetsMap))};
      window.__CLUB_DIA_CATALOG__ = ${escapeScriptInline(JSON.stringify(catalogParsed))};
    </script>
    <script>${escapeScriptInline(jsCode)}</script>
  </body>
</html>
`;

  await mkdir(dirname(OUTPUT_HTML), { recursive: true });
  await writeFile(OUTPUT_HTML, html, 'utf8');
  await rm(TMP_OUT, { recursive: true, force: true });

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  console.log(
    `OK: prototipo autocontenido generado en ${OUTPUT_HTML} (${kb} KB, ${catalogParsed.count} productos embebidos).`
  );
}

main().catch((err) => {
  console.error('Error generando prototipo standalone:', err);
  process.exit(1);
});
