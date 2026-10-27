# Díl 01 – Skelet projektu: Vite, TypeScript a three.js

> **Soubory:** `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.ts`, `src/assets.ts`,
> `src/asset-model-catalog.d.ts`
> **Commity:** `ac8cc93` (Fáze 0: skelet projektu), `1c96d6e` (stránky pro modely), `229e337` (base pro nasazení)

## O čem je tento díl

Postavíme prázdný projekt, do kterého v dalších dílech přibude celá hra. Na konci dílu bude
v prohlížeči modré nebe, zelená plocha a na ní lokomotiva z Kenney Train Kitu, viděná
izometrickou kamerou. Vypadá to jako málo, ale už tady se rozhodne o několika věcech, které hru
provázejí do konce:

- Vite servíruje modely **přímo ze složky `assets/`**, bez kopírování,
- three.js scéna má od začátku stejná světla, jaká má hotová hra,
- renderovací smyčka je `renderer.setAnimationLoop`, ne vlastní `requestAnimationFrame`,
- kamera je **ortografická**, ne perspektivní (podrobně v [dílu 02](02-izometricka-kamera.md)).

## Teorie: z čeho se skládá three.js aplikace

Každá three.js aplikace, i ta nejmenší, má tři povinné objekty:

```
   Scene ─────────── strom objektů: meshe, světla, skupiny
     │
     │   renderer.render(scene, camera)
     ▼
   Camera ────────── odkud a jak se díváme (projekce)
     │
     ▼
   WebGLRenderer ─── <canvas>, WebGL kontext, převod scény na draw cally
```

**Scene** je strom (`Object3D` → děti → děti). Každý uzel má polohu, natočení a měřítko, ze
kterých si three.js spočte **lokální matici** a vynásobením s maticí rodiče **světovou matici**
(`matrixWorld`). To je důležité: když posunete skupinu, posunou se všechny její děti.

**Mesh** je list stromu, který se opravdu kreslí. Skládá se ze dvou věcí:

```
Mesh = BufferGeometry  +  Material
       (tvar: vrcholy,     (vzhled: barva, textura,
        normály, UV)        jak reaguje na světlo)
```

Geometrie říká GPU, **kde** jsou trojúhelníky, materiál říká, **jakou barvu** má každý pixel.
three.js z materiálu sestaví shader (program pro GPU) – v [dílu 12](12-shadery-voda.md) se
naučíme do těchto shaderů zasahovat.

**Světla** jsou taky uzly scény. Hra od prvního commitu používá dvojici:

- `HemisphereLight(nebe, zem, intenzita)` – „světlo z oblohy“. Plochy otočené nahoru dostanou
  barvu nebe, plochy otočené dolů barvu země, mezi tím se interpoluje podle normály. Je to levná
  náhrada odraženého okolního světla (ambient), díky které nejsou stíněné strany budov černé.
- `DirectionalLight(barva, intenzita)` – „slunce“. Paprsky jsou rovnoběžné, záleží jen na směru
  (z pozice světla do počátku). Plocha natočená ke slunci je světlejší, plocha od slunce tmavší.

```
          slunce (10, 20, 5)
              \
               \  rovnoběžné paprsky
                \
   ┌──────┐      \       světlejší: normála míří ke slunci
   │ dům  │ ◄─── stěna od slunce dostane jen světlo z hemisféry
   └──────┘
 ─────────────── země (normála nahoru → plná barva nebe z hemisféry + slunce)
```

Podrobně se k osvětlení vrátíme v [dílu 16](16-osvetleni-den-noc.md), kde obě světla
plynule přebarvíme na noc.

**Materiál `MeshLambertMaterial`** počítá osvětlení Lambertovým modelem: jas plochy je úměrný
`max(0, N · L)`, tedy kosinu úhlu mezi normálou `N` a směrem ke světlu `L`. Nemá odlesky ani
drsnost (na rozdíl od `MeshStandardMaterial`), je tedy levný a k low-poly stylu Kenney modelů
se hodí. Hra ho používá skoro všude.

## Implementace

### 1. Vite + TypeScript

Projekt je obyčejná Vite šablona `vanilla-ts`. `index.html` má jen kontejner a vstupní modul:

```html
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

`tsconfig.json` je přísný (`strict`, `noUnusedLocals`, `noUnusedParameters`) a díky
`"moduleResolution": "bundler"` jde importovat i doplňky three.js z `three/examples/jsm/…`.

Jediná runtime závislost v `package.json` je `three`, typy dodává `@types/three`.

### 2. Assety přímo ze složky `assets/`

Kenney kity jsou ve složce `assets/` po kitech: `assets/train kit/train-locomotive-a.glb`,
`assets/train kit/Textures/colormap.png` atd. GLB soubor se na texturu odkazuje **relativní
cestou**. Kdybychom modely importovali přes bundler, cesty k texturám by se rozbily. Proto
první commit nastavil složku `assets` jako `publicDir`:

```ts
export default defineConfig({
  // GLB modely a textury se servírují přímo ze složky assets
  publicDir: 'assets',
});
```

Soubor `assets/train kit/train-locomotive-a.glb` je pak dostupný na URL
`/train%20kit/train-locomotive-a.glb` a textura vedle něj na relativní cestě, kterou GLTFLoader
dopočítá sám.

### 3. Načítání modelů s cache

`src/assets.ts` v prvním commitu:

```ts
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

// Načte GLB z kitu (s cache) a vrátí nezávislý klon
export async function loadModel(kit: Kit, name: string): Promise<THREE.Group> {
  const url = `/${encodeURIComponent(kit)}/${encodeURIComponent(name)}.glb`;
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(url, pending);
  }
  return (await pending).clone(true);
}
```

Dva detaily, které stojí za vysvětlení ve videu:

- **V cache je `Promise`, ne hotový model.** Když 50 budov požádá o stejný model najednou,
  všechny dostanou stejný rozběhnutý požadavek a soubor se stáhne jednou.
- **`clone(true)`** vytvoří nový strom uzlů, ale geometrie a materiály zůstanou **sdílené**.
  Klon je levný a změna polohy klonu neovlivní originál. Změna materiálu by ale ovlivnila všechny.

Dnešní verze má dvě funkce: `loadScene()` vrací sdílenou scénu, která se nesmí měnit (budovy
z ní jen čtou geometrie, viz [díl 05](05-modely-glb.md)), a `loadModel()` vrací klon.
A URL začíná `import.meta.env.BASE_URL`, protože hra na serveru neběží v kořeni domény:

```ts
// Načte GLB z kitu (s cache), vrácená scéna je sdílená a nesmí se měnit
export function loadScene(kit: Kit, name: string): Promise<THREE.Group> {
  // BASE_URL - na serveru /ttd/ (hra neběží v rootu domény), lokálně /
  const url = `${import.meta.env.BASE_URL}${encodeURIComponent(kit)}/${encodeURIComponent(name)}.glb`;
  // …
}

// Načte GLB z kitu a vrátí nezávislý klon
export async function loadModel(kit: Kit, name: string): Promise<THREE.Group> {
  return (await loadScene(kit, name)).clone(true);
}
```

### 4. První scéna

Celý `src/main.ts` z commitu `ac8cc93` (49 řádků) je dobrý materiál na první video, protože
obsahuje všechny základní stavební kameny:

```ts
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d8);

// Izometrická ortografická kamera
const viewSize = 10;
const camera = new THREE.OrthographicCamera();
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);
```

- `antialias: true` zapne vyhlazování hran (MSAA) – u ostrých hran low-poly budov je rozdíl
  vidět hodně.
- `setPixelRatio(devicePixelRatio)` – na retina displeji je canvas ve fyzických pixelech dvakrát
  větší než v CSS pixelech. Bez toho by byl obraz rozmazaný. (Cena: čtyřnásobek pixelů pro
  fragment shader. K tomu se vrátíme v [dílu 17](17-optimalizace-a-lod.md).)
- Kamera stojí v bodě `(20, 20, 20)` a dívá se do počátku: to je klasická „izometrie“ s elevací
  asi 35°. V dílu 02 ji nahradíme přesnou dimetrií 2:1 jako v OpenTTD.

Ortografická kamera nemá zorný úhel, ale **obdélník**, který vidí. Ten se musí přepočítat při
změně velikosti okna:

```ts
function resize(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -viewSize * aspect;
  camera.right = viewSize * aspect;
  camera.top = viewSize;
  camera.bottom = -viewSize;
  camera.near = -1000;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
```

`viewSize = 10` znamená „na výšku obrazovky je vidět 20 jednotek světa“. Šířka se dopočítá
z poměru stran, aby čtverec zůstal čtvercem. **Po každé změně parametrů kamery je nutné zavolat
`updateProjectionMatrix()`**, jinak se změna neprojeví – častá chyba začátečníků.

Světla, zem a testovací model:

```ts
scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(10, 20, 5);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x5f9e3c }),
);
scene.add(ground);

// Ověření načítání assetů
loadModel('train kit', 'train-locomotive-a').then((model) => scene.add(model));

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

Všimněte si:

- `PlaneGeometry` leží v rovině XY (stojí jako zeď). `rotateX(-Math.PI / 2)` ji položí na zem
  do roviny XZ. Rotace **geometrie** (ne meshe) přepíše přímo souřadnice vrcholů – mesh pak
  nemá žádnou rotaci a jeho matice je jednotková.
- Barva země `0x5f9e3c` a barvy světel (`0xffffff`/`0x556644`, intenzity 1,2 a 1,5, slunce
  v `(10, 20, 5)`) přežily do hotové hry beze změny. Najdete je v `GameView` i v renderu ikon
  (`src/render/icons.ts`), aby ikony nástrojů měly stejné světlo jako hra.
- Země `0x556644` u hemisféry je tmavě zelená: spodní strany objektů dostanou nádech „odraženého“
  světla od trávy.

### 5. Renderovací smyčka

```ts
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

`setAnimationLoop` je tenký obal nad `requestAnimationFrame`. Callback dostane časovou značku
`now` v milisekundách; v hotové hře z ní počítáme `dt` mezi snímky (viz [díl 00](00-uvod.md)).
Výhody oproti ručnímu `requestAnimationFrame`:

- funguje i ve WebXR (tam rAF prohlížeče neplatí),
- smyčku jde zastavit `setAnimationLoop(null)`,
- prohlížeč ji automaticky pozastaví ve skrytém tabu.

Poslední bod má důsledek pro herní logiku: po návratu do tabu může přijít `dt` v řádu sekund.
Hodiny ho proto ořezávají (`MAX_FRAME_MS = 250` v `src/game/clock.ts`, viz
[díl 09](09-cas-ekonomika-ukladani.md)).

### 6. Routing bez knihovny

Hotový `src/main.ts` je rozcestník. Podle cesty v URL spustí jednu ze „screens“:

```ts
const container = document.getElementById('app')!;
// cesta bez base (/ttd/all-models -> /all-models)
const route = location.pathname.slice(import.meta.env.BASE_URL.length - 1).replace(/\/$/, '');
if (route === '/all-models') {
  runAllModels(container);
} else if (route === '/game-assets') {
  runGameAssets(container);
} else {
  const intent = takeLaunchIntent();
  // ?seed=... v URL spustí rovnou novou hru (zkratka pro ladění)
  const urlSeed = new URLSearchParams(location.search).get('seed');

  if (intent) runGame(container, intent);
  else if (urlSeed) runGame(container, { mode: 'new', options: { seedText: urlSeed, ...DEFAULT_OPTIONS } });
  else runTitle(container);
}
```

- `/all-models` – galerie všech modelů ze všech kitů s miniaturami (užitečné při výběru modelů),
- `/game-assets` – jen modely, které hra opravdu používá,
- `?seed=…` – zkratka pro vývoj: přeskočí úvodní obrazovku a hned vygeneruje svět.

### 7. Virtuální modul: seznam modelů z disku

Galerie modelů potřebuje vědět, jaké GLB soubory ve složce `assets/` jsou. Prohlížeč složku
vylistovat neumí, ale Vite (běžící v Node.js) ano. Řešením je **virtuální modul**: import, za
kterým není soubor, ale kód vygenerovaný pluginem (`vite.config.ts`):

```ts
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
```

Postup Vite pluginu ve třech hácích:

1. `resolveId` – když někdo importuje `virtual:asset-model-catalog`, plugin řekne „to je moje“
   a vrátí id s prefixem `\0` (konvence Rollupu: takové id ostatní pluginy nezpracovávají).
2. `load` – vrátí zdrojový kód modulu jako řetězec: `export const assetModels = [...]`.
3. `configureServer` – v dev serveru sleduje složku a při přidání/smazání GLB pošle prohlížeči
   `full-reload`, aby se seznam načetl znovu.

TypeScript o virtuálním modulu nic neví, proto je vedle deklarace v `src/asset-model-catalog.d.ts`:

```ts
declare module 'virtual:asset-model-catalog' {
  export interface AssetModelEntry {
    kit: string;
    name: string;
  }

  export const assetModels: AssetModelEntry[];
}
```

Použití je pak obyčejný import: `import { assetModels } from 'virtual:asset-model-catalog';`
v `src/screens/allModels.ts`.

### 8. Base URL pro nasazení

Poslední úprava konfigurace přišla s nasazením na server (`229e337`):

```ts
export default defineConfig(({ mode }) => ({
  // build (a vite preview) pro https://app.makuderovi.cz/ttd/ (npm run upload), dev server zůstává na http://localhost:5173/
  base: mode === 'production' ? '/ttd/' : '/',
  // GLB modely a textury se servírují přímo ze složky assets
  publicDir: 'assets',
  plugins: [assetModelCatalog()],
}));
```

Proto všude v kódu, kde se skládá URL nebo čte cesta, je `import.meta.env.BASE_URL`. Víc
v [dílu 18](18-testy-build-nasazeni.md).

## Úskalí

- **Rozbité textury při importu GLB přes bundler.** Řešení `publicDir: 'assets'` bylo
  rozhodnutím hned prvního commitu: „Složka assets slouží jako publicDir, aby GLB modely
  z Kenney kitů šly načíst včetně relativních cest k texturám bez kopírování.“
- **Mezery v názvech složek.** Kity se jmenují `city kit commercial`, `train kit`… Bez
  `encodeURIComponent` se URL rozbije. Je to vidět už v prvním `loadModel`.
- **Sdílené materiály po `clone()`.** Kdo by přebarvil materiál klonu, přebarví všechny instance.
  Hra to později řeší vlastními kopiemi materiálů (stromy, okna – [díl 13](13-shadery-okna-a-vitr.md))
  nebo posunem UV do palety ([díl 05](05-modely-glb.md)).
- **Absolutní cesty na serveru.** Dokud hra běžela v kořeni domény, fungovalo `/${kit}/…`. Na
  `https://…/ttd/` přestalo; řešením je `BASE_URL` v `loadScene` i v routingu.

## Scénář videa

1. **Cíl:** ukázat finální obrázek dílu (nebe, tráva, lokomotiva) a říct, že za 49 řádků.
2. `npm create vite@latest` (vanilla-ts), `npm i three`, `npm i -D @types/three`.
3. Struktura `assets/` – otevřít kit, ukázat GLB + `Textures/colormap.png`. Vysvětlit, proč
   `publicDir`.
4. Nákres Scene / Camera / Renderer, pak napsat renderer a scénu.
5. Ortografická kamera a `resize()`. Ukázat, co se stane bez `updateProjectionMatrix()`.
6. Světla: nejdřív bez světel (Lambert je černý), pak jen hemisféra, pak slunce. Krátce vysvětlit
   `N · L`.
7. Zem z `PlaneGeometry` – ukázat ji bez `rotateX` (stojí jako zeď) a s ním.
8. `loadModel` s cache Promise – lokomotiva se objeví.
9. Bonus: virtuální modul a stránka `/all-models`.
10. Upoutávka: „kamera z (20, 20, 20) není dimetrie z OpenTTD – příště to spočítáme přesně.“

## Cvičení

- Nahraďte `MeshLambertMaterial` u země za `MeshBasicMaterial`. Proč najednou nezáleží na
  světlech?
- Změňte pozici slunce na `(-10, 20, -5)` a sledujte, které strany lokomotivy ztmavnou.
- Načtěte stejný model dvakrát přes `loadModel`, jednomu klonu změňte `material.color`.
  Co se stane s druhým a proč?
- Rozšiřte virtuální modul tak, aby vracel i velikost každého GLB souboru (`statSync`)
  a zobrazte ji v galerii.
