# Díl 18 – Testy, build a nasazení

> **Soubory:** `package.json`, `vite.config.ts`, `tsconfig.json`, `.oxlintrc.json`, `.prettierrc.json`,
> `src/test/fixtures.ts`, `src/**/*.test.ts`, `src/assets.ts`, `src/main.ts`, `scripts/upload.ts`,
> `.gitignore`, `nth.md`
> **Commity:** `3900774` (Fáze 8: testy a nástroje), `c5729ee` (testy logu změn), `b20c153` (testy LOD),
> `229e337` (FTP upload)

## O čem je tento díl

Poslední díl série: jak si být jistý, že úprava jedné věci nerozbila jinou, jak hru zabalit do
statických souborů a jak ji jedním příkazem dostat na web. Na konci divák ví:

- co všechno se dá testovat **bez prohlížeče a GPU** – včetně 3D geometrie a shaderů,
- jak vypadá kontrola kvality (typecheck, lint, formát, testy),
- co udělá `vite build` a proč hra potřebuje vědět, že neběží v kořeni domény,
- jak napsat inkrementální FTP upload, který nahraje jen změněné soubory a během nahrávání
  nerozbije běžící web,
- co ve hře zbývá a kam by mohla série pokračovat.

## Teorie

### Co jde testovat ve 3D hře

Běžná představa je, že 3D hra se testovat nedá – „musíš se podívat“. Rozdělení kódu z
[dílu 00](00-uvod.md) ale znamená, že většina kódu jsou čisté funkce nad daty:

| Vrstva | Příklad | Testuje se |
| --- | --- | --- |
| `world/` | generátor, hledání tras, chodníkový graf | determinismus, správnost tras |
| `game/` | kalendář, ekonomika, vlaky, auta, uložení | pravidla hry, zpětná kompatibilita |
| `render/` – výpočty | LOD budov a stromů, zapékání světel, listí, kamera | tvar geometrie, počty, stabilita |
| `render/` – pixely | jak scéna vypadá | **netestuje se**, ověřuje se okem |

I v `render/` je hodně kódu, který nepotřebuje WebGL. Three.js je v jádru matematická knihovna:
`BufferGeometry`, `Matrix4`, `Frustum`, `DataTexture` i `Material` fungují v Node.js. GPU je potřeba
až pro `WebGLRenderer.render()`. Test tedy může vytvořit geometrii, nechat ji zjednodušit a ověřit,
že výsledek má správný počet trojúhelníků a normály míří ven – bez jediného pixelu.

Dokonce i úpravy shaderů jdou testovat: `onBeforeCompile` je obyčejná funkce, která dostane
objekt s textem shaderu. Test jí podstrčí falešný shader a zkontroluje, co do textu vložila.

### Statický build a base URL

`vite build` vyrobí složku `dist/` s `index.html`, jedním JS a jedním CSS souborem (s hashem
v názvu) a kopií složky `assets/` s modely. Žádný server-side kód – stačí libovolný webhosting.

Háček: hra neběží na `https://domena/`, ale na `https://domena/ttd/`. Každá absolutní cesta
(`/train kit/train-a.glb`) by pak mířila vedle. Vite to řeší volbou `base` a proměnnou
`import.meta.env.BASE_URL`, kterou při buildu nahradí skutečnou hodnotou.

### Inkrementální upload

Modely mají 34 MB, ale mezi dvěma nasazeními se obvykle změní jen `index-<hash>.js`. Nahrávat
pokaždé všechno je pomalé. Stačí si pamatovat otisk (hash) každého souboru z minulého nahrání
a porovnat:

```
 dist/ (teď)              manifest (minule)          akce
 index-NEW.js   abc1      —                          nahrát
 index-OLD.js   —         index-OLD.js   9f0e        smazat (až nakonec)
 train-a.glb    77aa      train-a.glb    77aa        přeskočit
 index.html     d4d4      index.html     c3c3        nahrát
```

## Implementace

### 1. Skripty v package.json

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "oxlint src",
  "format": "prettier --write",
  "format:check": "prettier --check src",
  "upload": "npm run build && tsx scripts/upload.ts"
}
```

- **`build` začíná `tsc`.** Vite sám typy nekontroluje (TypeScript jen „odstraní“), takže by
  prošel i kód s typovou chybou. `tsc` s `noEmit: true` v `tsconfig.json` nic negeneruje, jen
  zastaví build při chybě.
- **`upload` začíná buildem.** Nedá se omylem nahrát stará verze.

`tsconfig.json` je přísný (`strict`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`). Na projektu, který se za týden mnohokrát přepisoval, je nepoužitá
proměnná často první známka, že refaktoring nedoběhl.

### 2. Lint a formát

Commit `3900774` vysvětluje volbu linteru: typescript-eslint zatím nepodporoval TypeScript 7,
proto Oxlint, a jen s kategorií `correctness`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error"
  },
  "ignorePatterns": ["assets/**", "dist/**"]
}
```

Kategorie `suspicious` hlásila hlavně stylové věci, takže zůstala vypnutá. Prettier (`singleQuote`,
`trailingComma: all`, `printWidth: 120`) se podle commitu nasazoval postupně – soubory se
přeformátují, až když se na ně sáhne (jeden obří „format“ commit by navíc znečistil `git blame`).

### 3. Testy: Vitest

Vitest používá konfiguraci Vite, takže testy rozumí stejným importům jako hra. Testy leží vedle
kódu (`src/game/clock.test.ts` vedle `src/game/clock.ts`), je jich 34 souborů s 209 testy a celá
sada doběhne zhruba za dvě sekundy. Názvy testů jsou česky a čtou se jako specifikace:

```ts
describe('herní kalendář', () => {
  it('rok trvá 15 minut reálného času', () => {
    const clock = new GameClock();
    let years = 0;
    clock.events.on('year', () => years++);
    // Jeden krok navíc kvůli zaokrouhlení součtu zlomků dne
    for (let ms = 0; ms <= 15 * 60 * 1000; ms += 250) clock.tick(250);
    expect(years).toBe(1);
    expect(clock.date).toEqual({ year: 1951, month: 0, day: 1 });
  });
  // …
});
```

Patnáct minut herního roku proběhne v testu za milisekundy – stačí volat `tick()` v cyklu. To je
přímý důsledek toho, že hodiny dostávají `dt` zvenku a nečtou si čas samy
([díl 09](09-cas-ekonomika-ukladani.md)).

#### Sdílené přípravky

Testovat vlak znamená postavit mapu, dvě stanice, trať a depo. Aby to každý test neopakoval,
jsou pomůcky v `src/test/fixtures.ts`:

```ts
export function emptyGame(size = 64, towns: Town[] = []): Game {
  const map = new GameMap(size, size);
  return new Game({ seed: 1, map, towns, rail: new RailNetwork(map), industries: [] });
}
```

Hra se dá vytvořit bez generátoru, bez modelů a bez scény – `Game` dostane jen `World`.

#### Determinismus a zpětná kompatibilita

Nejcennější test celé hry je v `src/game/save.test.ts`. Rozehraje hru, uloží ji, načte kopii
a pak simuluje obě vedle sebe:

```ts
it('obnovená hra pokračuje stejně jako originál', () => {
  const { game, a, b, depot } = buildLine();
  const train = buyTrain(game, depot);
  game.fleet.start(train, [a.id, b.id]);
  game.setCompanyName('ČSD Test');
  runDays(game, 200);

  const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
  expect(copy.companyName).toBe('ČSD Test');
  for (let i = 0; i < 20_000; i++) {
    game.update(200);
    copy.update(200);
  }
  expect(snapshot(copy)).toBe(snapshot(game));
});
```

Kdyby uložení zapomnělo jakoukoli část stavu (stav generátoru náhody, rozjetý vlak, rezervace),
hry se po tisících kroků rozejdou. Další testy v souboru načítají uložení starších verzí („uložení
verze 6 načte vlaky na cestující…“) – každá migrace má svůj test, takže hráčovy staré soubory
nepřestanou fungovat.

Podobně `src/world/generator.test.ts` hlídá, že „stejný seed dá stejný svět“ a že „výchozí parametry
zachovávají dosavadní mapy“ – přidání průmyslu nesmělo změnit města na existujících seedech (proto
má průmysl vlastní proud náhody, viz [díl 04](04-generovani-sveta.md)).

#### Testy 3D geometrie

`src/render/buildingLod.test.ts` ověřuje algoritmus zjednodušení budov z
[dílu 17](17-optimalizace-a-lod.md) na kvádru, u kterého víme, jak má výsledek vypadat:

```ts
it('z kvádru udělá střechu a čtyři stěny ve výšce a barvě modelu', () => {
  const box = new THREE.BoxGeometry(0.8, 1, 0.6).translate(0, 0.5, 0);
  const uv = box.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.3, 0.6);

  const lod = createLodGeometry([{ geometry: box, matrix: new THREE.Matrix4() }])!;

  expect(triangles(lod)).toBe(10);
  lod.computeBoundingBox();
  expect(lod.boundingBox!.min.y).toBeCloseTo(0);
  expect(lod.boundingBox!.max.y).toBeCloseTo(1);
  // …
});
```

Deset trojúhelníků = střecha (2) + čtyři stěny (8); spodek se nekreslí, kamera se dívá shora.
Druhý test kontroluje **orientaci trojúhelníků**: vektorový součin hran musí mířit stejně jako
normála. Chyba v pořadí vrcholů (winding order) je klasická 3D chyba – plocha je vidět zezadu
a zepředu zmizí (back-face culling). Okem se hledá těžko, testem snadno:

```ts
it('plochy míří ven podle normál', () => {
  // …
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    n.fromBufferAttribute(normal, index.getX(i));
    expect(b.sub(a).cross(c.sub(a)).dot(n)).toBeGreaterThan(0);
  }
});
```

#### Test úpravy shaderu

`src/render/nightLights.test.ts` testuje injekci kódu do shaderu z
[dílu 16](16-osvetleni-den-noc.md) bez GPU. Podstrčí falešný shader s jediným `#include`
a ověří, že funkce vložila svůj kód, zachovala předchozí `onBeforeCompile` a prodloužila klíč
programu:

```ts
const material = new THREE.MeshStandardMaterial();
let previousCalls = 0;
material.onBeforeCompile = () => previousCalls++;
material.customProgramCacheKey = () => 'facade-windows';
withLampLight(material);
withLampLight(material);
const shader = {
  uniforms: {},
  vertexShader: 'void main() {\n#include <project_vertex>\n}',
  fragmentShader: 'void main() {\n#include <lights_fragment_maps>\n}',
} as unknown as THREE.WebGLProgramParametersWithUniforms;

material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

expect(previousCalls).toBe(1);
expect(material.customProgramCacheKey()).toBe('facade-windows|lamp-light');
expect(shader.fragmentShader).toContain('irradiance += lampLightIrradiance();');
```

Dvojí volání `withLampLight` testuje, že se kód nevloží dvakrát. Jiný test v témže souboru hlídá
architektonické rozhodnutí: „nepoužívá bodová světla a stejné lampy znovu nepřepéká“ – projde scénu
a spočítá `PointLight`y (musí být nula) a ověří, že `texture.version` se při stejných lampách
nezvýší, tedy že se textura neposílá znovu na GPU.

Testy tak drží i výkon: optimalizace, kterou někdo omylem vrátí, test shodí.

### 4. Build a base URL

`vite.config.ts`:

```ts
export default defineConfig(({ mode }) => ({
  // build (a vite preview) pro https://app.makuderovi.cz/ttd/ (npm run upload), dev server zůstává na http://localhost:5173/
  base: mode === 'production' ? '/ttd/' : '/',
  // GLB modely a textury se servírují přímo ze složky assets
  publicDir: 'assets',
  plugins: [assetModelCatalog()],
}));
```

`publicDir: 'assets'` zkopíruje celou složku s modely do `dist/` beze změny – GLB soubory odkazují
na své textury relativními cestami a ty musí zůstat zachované ([díl 05](05-modely-glb.md)).

Všude, kde hra skládá URL, je `BASE_URL` (`src/assets.ts`):

```ts
// BASE_URL - na serveru /ttd/ (hra neběží v rootu domény), lokálně /
const url = `${import.meta.env.BASE_URL}${encodeURIComponent(kit)}/${encodeURIComponent(name)}.glb`;
```

`encodeURIComponent` je tu kvůli mezerám v názvech složek (`train kit`, `city kit commercial`).

Jednoduchý router v `src/main.ts` musí base z cesty odříznout, jinak by na serveru nikdy nepoznal
stránku galerie modelů:

```ts
// cesta bez base (/ttd/all-models -> /all-models)
const route = location.pathname.slice(import.meta.env.BASE_URL.length - 1).replace(/\/$/, '');
```

Obě změny přišly v commitu `229e337` spolu s uploadem – dokud hra běžela jen lokálně na `/`,
problém neexistoval. Typická past nasazení: lokálně všechno funguje.

### 5. FTP upload

`scripts/upload.ts` se spouští přes `tsx` (TypeScript v Node bez kompilace). Přístupové údaje čte
z `conf/env.json`, který je v `.gitignore` – do repozitáře se nikdy nedostanou:

```
# pristup na FTP (npm run upload)
/conf
```

Stav serveru po posledním nahrání je v `build-data/upload.json` – mapa „cesta → MD5 obsahu“.
Ta v gitu je, takže upload z jiného počítače ví, co už na serveru leží.

Hlavní smyčka nahraje jen soubory, jejichž hash se liší:

```ts
for (const file of [...localFiles].sort()) {
  const hash = getFileHash(path.join(DIST_PATH, file));

  if (prevManifest[file] === hash) {
    skipped++;
    continue;
  }

  const dir = path.posix.join(FTP_PATH, path.posix.dirname(file));

  // ensureDir vytvori slozku a prepne se do ni
  if (dir !== currentDir) {
    await client.ensureDir(dir);
    currentDir = dir;
  }

  console.log(`Upload ${file}`);
  await client.uploadFrom(path.join(DIST_PATH, file), path.posix.basename(file));
  manifest[file] = hash;
  uploaded++;
}
```

Soubory jsou seřazené, takže se nahrávají po složkách a `ensureDir` (pomalé síťové volání) proběhne
jen při změně složky.

Pořadí operací je promyšlené, jak říká komentář:

```ts
/**
 * Nahraje jen soubory, ktere se od posledniho uploadu zmenily, a smaze ze serveru soubory z minuleho uploadu,
 * ktere v buildu uz nejsou (stare js/css s hashem). Mazani az po nahrani novych, aby web behem uploadu fungoval.
 * Manifest se zapise i pri chybe uprostred - obsahuje, co uz na serveru je.
 */
```

1. **Nejdřív nahrát nové soubory.** Nový `index-<hash>.js` vedle starého. Hráč, který má hru
   otevřenou, má načtený starý JS a nic se mu nerozbije.
2. **Pak smazat staré.** Teprve když je nová verze kompletní.
3. **Manifest zapsat vždy**, i po chybě uprostřed – obsahuje přesně to, co na serveru opravdu je,
   a další spuštění naváže.

Hashe v názvech JS/CSS (`index-2VwA9Pb4.js`) generuje Vite a řeší i cache prohlížeče: nový build =
nové jméno = prohlížeč stáhne novou verzi. `index.html` se mění s každým buildem (odkazuje na nové
jméno), takže se nahraje vždy. Přepínač `--full` nahraje všechno znovu, když se manifest a server
rozejdou.

### 6. Celý postup před nasazením

```
npm run typecheck      # typy
npm run lint           # chyby, které typy nechytí
npm test               # 209 testů za ~2 s
npm run upload         # tsc + vite build + upload změněných souborů
```

## Co dál

Seznam rozšíření je v `nth.md`. Hotová část je dlouhá (rezervace kolejí, pošta, silniční doprava,
zemědělský řetězec…), ale tři velké věci zbývají – a každá by vydala na vlastní mini-sérii:

- **Letecká doprava.** Modely letadel už jsou v `assets/airplanes/` (CC BY, autoři v
  `assets/credits.md`, pořadí generací v `airplanes.md`). Chybí návrh letiště a parametry letadel.
  Poznámka v `nth.md` je hezká ukázka práce s cizími modely: délky od 8,6 do 1676 jednotek (nutná
  normalizace, [díl 05](05-modely-glb.md)), jeden model má předek na +X místo +Z, jiný kola pod
  `y = 0`, další 11 tisíc trojúhelníků (kandidát na LOD, [díl 17](17-optimalizace-a-lod.md)).
- **Lodní doprava.** Watercraft kit je připravený; chybí hledání cesty po vodě (A* z
  [dílu 07](07-stavba-koleji.md) nad vodními dlaždicemi) a návrh přístavu.
- **Výška terénu.** Největší zásah: koleje, mosty, stavba i generátor počítají s rovinou. Terén
  by se musel přepsat z plochých čtverců na výškovou mapu se sdílenými vrcholy, koleje na svazích,
  voda by přestala být „o 0,06 níž“. Ve 3D grafice je to vlastně nejpřirozenější rozšíření –
  a proto je dobrým tématem pro další sérii.

## Úskalí

- **Hra na serveru nenačetla modely.** Absolutní cesty bez `BASE_URL` – vyřešené v `229e337`.
- **Linter pro TypeScript 7.** typescript-eslint ho nepodporoval, náhradou je Oxlint.
- **Jednorázové ověřovací skripty mizely.** Commit `3900774` to říká přímo: „Dosud se hra ověřovala
  jednorázovými skripty, které po každé změně zmizely.“ Trvalé testy jsou levnější než opakované
  ruční ověřování.
- **Nebezpečný upload.** Mazat staré soubory dřív než nahrát nové by na pár sekund rozbilo web.

## Scénář videa

1. **Proč testovat 3D hru:** tabulka vrstev, co se testuje a co ne.
2. **Spustit `npm test`:** 209 testů za dvě sekundy, ukázat české názvy jako specifikaci.
3. **Kalendář v testu:** 15 minut za milisekundy.
4. **Determinismus:** test „obnovená hra pokračuje stejně“; pak schválně z uložení vyhodit
   `rngState` a ukázat, jak test spadne.
5. **Geometrie bez GPU:** test LOD – deset trojúhelníků, winding order.
6. **Shader bez GPU:** falešný shader v testu nočních světel.
7. **Build:** `npm run build`, projít `dist/`, ukázat `base` a `BASE_URL`.
8. **Upload:** manifest, pořadí nahrání a mazání, druhé spuštění bez změn („Uploaded 0“).
9. **Závěr série:** `nth.md`, co dál; poděkování, odkazy na Kenney a OpenTTD.

## Cvičení

- Napište test, že `vehiclePoint()` v zatáčce vrací jednotkový směrový vektor a že poloha leží
  v pravém pruhu ([díl 11](11-zivot-ve-meste.md)).
- Napište test pro `createLatheGeometry()` se dvěma kužely nad sebou (smrk) a ověřte, že výsledek
  má méně trojúhelníků než vstup.
- Přidejte do `scripts/upload.ts` přepínač `--dry-run`, který jen vypíše, co by se nahrálo a smazalo.
- Nastavte `base` na `'./'` (relativní cesty) a zjistěte, co přestane fungovat a proč.
- Zkuste nasadit build na GitHub Pages – jaké `base` bude potřeba?
