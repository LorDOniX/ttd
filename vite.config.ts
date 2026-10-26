import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const ASSET_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), 'assets');
const ASSET_CATALOG_ID = 'virtual:asset-model-catalog';
const RESOLVED_ASSET_CATALOG_ID = `\0${ASSET_CATALOG_ID}`;

function collectAssetModels(): { kit: string; name: string }[] {
  return readdirSync(ASSET_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(resolve(ASSET_ROOT, entry.name), { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith('.glb'))
        .map((file) => ({ kit: entry.name, name: file.name.slice(0, -4) })),
    )
    .sort((a, b) => a.kit.localeCompare(b.kit) || a.name.localeCompare(b.name));
}

function assetModelCatalog(): Plugin {
  return {
    name: 'asset-model-catalog',
    configureServer(server) {
      server.watcher.add(ASSET_ROOT);
      server.watcher.on('all', (event, file) => {
        if ((event === 'add' || event === 'unlink') && file.startsWith(ASSET_ROOT) && file.endsWith('.glb')) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    resolveId(id) {
      return id === ASSET_CATALOG_ID ? RESOLVED_ASSET_CATALOG_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ASSET_CATALOG_ID) return null;
      return `export const assetModels = ${JSON.stringify(collectAssetModels())};`;
    },
  };
}

export default defineConfig(({ mode }) => ({
  // build (a vite preview) pro https://app.makuderovi.cz/ttd/ (npm run upload), dev server zůstává na http://localhost:5173/
  base: mode === 'production' ? '/ttd/' : '/',
  // GLB modely a textury se servírují přímo ze složky assets
  publicDir: 'assets',
  plugins: [assetModelCatalog()],
}));
