# Díl 05 – Modely z Kenney kitů: glTF, normalizace a paleta barev

> **Soubory:** `src/assets.ts`, `src/render/buildings.ts` (`loadPrototype`, `recolor`, `facadeAt`),
> `src/render/pedestrians.ts` (`litMaterial`), `src/screens/allModels.ts`, `src/screens/gameAssets.ts`,
> `vite.config.ts`, `scripts/zbase/README.md`, `assets/credits.md`
> **Commity:** `c0fc08a` (modely), `ac8cc93` (Fáze 0), `0c3ee3f` (Fáze 2 – první budovy),
> `1e593ca`, `64fe5b1` (barevná města), `faaf9c9` (nature kit), `1c96d6e` (stránky pro modely),
> `c03b945` (textury osob)

## O čem je tento díl

Zatím jsme kreslili jen věci, které jsme si sami poskládali z trojúhelníků (terén v [dílu 03](03-teren.md)).
Města, vlaky, auta a stromy ale potřebují skutečné modely. V tomhle dílu:

- rozebereme formát **glTF / GLB** – co v souboru je a jak to three.js převede na objekty scény,
- ukážeme trik Kenney kitů: **celý model má jeden materiál a barvy bere z malé palety**,
- napíšeme načítání s cache a pochopíme rozdíl mezi sdílenou scénou a klonem,
- **znormalizujeme** model, aby seděl na dlaždici (střed, dno na zemi, velikost),
- přebarvíme fasády budov **bez nové textury**, jen posunem UV souřadnic v paletě,
- zmíníme převod postaviček z neosvětleného materiálu, galerii modelů a převod grafiky ze zbase.

Na konci dílu stojí na mapě barevná města, kde žádné dva sousední domy nevypadají stejně, a přitom
celé město používá jedinou texturu.

## Teorie

### Co je glTF a GLB

glTF („GL Transmission Format“) je formát, který se dá popsat jako „JPEG pro 3D“: je navržený tak,
aby šel co nejrychleji nahrát do GPU. Obsahuje:

```
glTF
├── scenes      seznam scén (většinou jedna)
├── nodes       strom uzlů: každý má translation/rotation/scale a děti
│   └── mesh    odkaz na síť, kterou uzel zobrazuje
├── meshes      sítě; každá má "primitives" = geometrie + materiál
├── accessors   jak číst binární data (typ, počet, offset) – pozice, normály, UV, indexy
├── buffers     surová binární data
├── materials   PBR materiál: baseColor, metallic, roughness, textury
├── textures    odkaz na obrázek + sampler (filtrování, opakování)
└── images      PNG/JPEG (uvnitř souboru, nebo externí URI)
```

**GLB** je binární varianta: JSON popis a binární buffery v jednom souboru. Obrázky můžou být
uvnitř, nebo jako externí soubor. Kenney kity mají texturu externí – v GLB budovy z commercial kitu je:

```json
"images":    [{ "uri": "Textures/colormap.png", "name": "colormap" }],
"materials": [{ "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 }, "metallicFactor": 0.0 },
                "doubleSided": true, "name": "colormap" }]
```

Proto je ve `vite.config.ts` složka `assets` nastavená jako `publicDir`: GLB i jeho relativní cesta
`Textures/colormap.png` se servírují přímo, bez kopírování a přejmenování.

`GLTFLoader` z three.js převede soubor na `THREE.Group`: z každého uzlu udělá `Object3D`, z každé
primitivy `Mesh` s `BufferGeometry` a `MeshStandardMaterial`. Výsledek je obyčejný podstrom scény.

### Paleta místo textur

Kenney modely nemají „malované“ textury. Mají jedinou texturu `colormap.png` (512×512 px), která
je rozdělená na políčka jednolitých barev – u city kitů 4 řádky po 16 políčkách:

```
 u →  0                                              1
v=1 ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐  řádek 0
    ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤  řádek 1 (zelená střecha = sloupec 1)
    ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤  řádek 2 (šedá 1, bílá 7, cihla 11…)
    ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤  řádek 3
v=0 └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
```

Každý vrchol modelu má UV souřadnici, která míří **do středu políčka** požadované barvy. Bílá zeď
má všechny vrcholy s UV v políčku „bílá“, střecha v políčku „zelená“. Důsledky:

1. **Celý model = jeden materiál = jedna textura.** Pro GPU je to ideální: žádné přepínání
   textur mezi díly, všechny budovy jednoho kitu jdou kreslit stejným shaderem (využijeme
   v [dílu 06](06-instancing-a-draw-cally.md)).
2. **Barva je data, ne obrázek.** Chceme jinou barvu zdi? Stačí posunout UV vrcholů do jiného
   políčka. Textura zůstane stejná.
3. **Barvu umíme zpětně přečíst.** Z UV trojúhelníku poznáme, jestli je to bílá zeď, šedé sklo,
   nebo zelená střecha. To využijeme pro okna v [dílu 13](13-shadery-okna-a-vitr.md) i pro LOD
   v [dílu 17](17-optimalizace-a-lod.md).

### Matice a normalizace

Každý uzel v glTF má lokální transformaci a three.js z nich po `updateMatrixWorld()` spočte
`matrixWorld` – matici, která převádí souřadnice vrcholů sítě do souřadnic celého modelu.
Kenney modely mají vlastní měřítko (budova bývá 1–3 jednotky široká, vlak 2,6 dlouhý) a počátek
různě. My potřebujeme:

```
   před                         po normalizaci
                                     ┌──┐
     ┌──┐                            │  │
     │  │       ───────►          ┌──┴──┴──┐   ← největší půdorysný rozměr = 0,86 dlaždice
  ┌──┴──┴──┐                      │   ·    │   ← střed půdorysu v počátku
  │        │                      └────────┘   ← dno na y = 0
  └────────┘ ·(počátek kdekoli)
```

Skládá se to ze dvou matic: nejdřív posunout (střed půdorysu do počátku, dno na nulu), pak zmenšit.
Pozor na pořadí – u matic se čte zprava doleva: `S × T × v` znamená „nejdřív T, pak S“.

## Implementace

### 1. Načítání s cache

`src/assets.ts` je celé krátké, ale obsahuje dvě důležité myšlenky:

```ts
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

// Načte GLB z kitu (s cache), vrácená scéna je sdílená a nesmí se měnit
export function loadScene(kit: Kit, name: string): Promise<THREE.Group> {
  // BASE_URL - na serveru /ttd/ (hra neběží v rootu domény), lokálně /
  const url = `${import.meta.env.BASE_URL}${encodeURIComponent(kit)}/${encodeURIComponent(name)}.glb`;
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(url, pending);
  }
  return pending;
}

// Načte GLB z kitu a vrátí nezávislý klon
export async function loadModel(kit: Kit, name: string): Promise<THREE.Group> {
  return (await loadScene(kit, name)).clone(true);
}
```

- **Cache drží `Promise`, ne výsledek.** Když si 200 budov najednou řekne o stejný model,
  stáhne se jednou – všichni dostanou tentýž rozpracovaný slib. Kdyby se cache plnila až po
  dokončení, odešlo by 200 požadavků.
- **`loadScene` vs. `loadModel`.** Sdílená scéna se smí jen číst (bereme z ní geometrie pro
  instancing). Kdo chce objekt vložit do scény a hýbat s ním (vlak, auto), potřebuje klon.
  `clone(true)` zkopíruje strom uzlů, ale **geometrie a materiály sdílí** – klon je levný a GPU
  data se nenahrávají znovu.

### 2. Rozložení modelu na díly a normalizace

Pro budovy nechceme `Group` se stromem uzlů, ale ploché pole dílů: geometrie, materiál a matice,
která díl umístí do znormalizované budovy. Funkce `loadPrototype` v `src/render/buildings.ts`
vznikla už ve Fázi 2 a od té doby se skoro nezměnila:

```ts
// Největší půdorysný rozměr budovy vůči dlaždici
const FOOTPRINT = 0.86;

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

// Rozloží model na části a normalizuje ho na střed dlaždice se dnem v y = 0
export function loadPrototype(kit: Kit, model: string): Promise<Part[]> {
  // … cache podle `${kit}/${model}`
    pending = loadScene(kit, model).then((scene) => {
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = FOOTPRINT / Math.max(size.x, size.z);
      const normalize = new THREE.Matrix4()
        .makeScale(scale, scale, scale)
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

      const parts: Part[] = [];
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        parts.push({
          geometry: child.geometry,
          material: child.material,
          matrix: normalize.clone().multiply(child.matrixWorld),
        });
      });
      return parts;
    });
  // …
}
```

Projděme to po řádcích:

1. `updateMatrixWorld(true)` – spočte `matrixWorld` všech uzlů. Bez toho by `Box3` počítal
   s jednotkovými maticemi a rozměry by nesouhlasily.
2. `Box3().setFromObject(scene)` – osově zarovnaný kvádr (AABB) přes všechny vrcholy ve
   světových souřadnicích modelu.
3. Měřítko se počítá jen z **půdorysu** (`size.x`, `size.z`). Výška se škáluje stejně, takže
   mrakodrap zůstane vysoký – nedeformujeme proporce.
4. `normalize = S × T`: posun `(-center.x, -box.min.y, -center.z)` dá střed půdorysu do počátku
   a dno na nulu, pak zmenšení.
5. Matice dílu je `normalize × matrixWorld`: vrchol sítě se nejdřív přenese do souřadnic modelu
   (podle stromu uzlů), pak znormalizuje. Pro umístění na mapu se zleva přidá ještě matice
   polohy na dlaždici – vznikne řetěz `placement × normalize × matrixWorld`.

Proč 0,86 a ne 1? Budovy pak mezi sebou mají mezery a chodník kolem silnice zůstane vidět.

Stejný postup s jinými čísly najdete všude, kde se načítá model: stromy se zmenšují podle výšky
(`TREE_HEIGHT` v `trees.ts`), postavy na výšku 0,16 dlaždice (`loadCharacter` v `pedestrians.ts`),
průmyslové budovy na zadaný půdorys (`kenney()` v `industries.ts`).

### 3. Model podle kitu a hash pro barvu

Město z budov jednoho modelu by vypadalo jako ze sádry. Každá budova proto dostane jednu
z deseti barevných variant (`FACADES`). Varianta se nesmí losovat přes `Math.random()` – po
přestavbě scény (město vyroste, načte se hra) by domy změnily barvu. Použije se hash polohy:

```ts
// Fasáda podle polohy, aby budova po přestavbě scény barvu neměnila
function facadeAt(kit: Kit, x: number, y: number): number {
  return (((x * 73_856_093) ^ (y * 19_349_663)) >>> 0) % (FACADES[kit]?.length ?? 1);
}
```

Násobení velkými prvočísly a XOR rozhází sousední souřadnice daleko od sebe, `>>> 0` převede
výsledek na nezáporné 32bitové číslo. Stejný princip „náhoda jako funkce souřadnic“ uvidíme
v [dílu 04](04-generovani-sveta.md) a u částic v [dílu 15](15-casticove-efekty.md).

### 4. Přebarvení fasády posunem UV

Schéma fasády říká, na které políčko palety přesunout bílou zeď, šedé rámy a zelenou střechu:

```ts
// Paleta city kitů (colormap.png) má 4 řádky po 16 políčkách, políčko = řádek * 16 + sloupec;
// řádky 1 a 2 jsou v commercial i suburban kitu stejné
const PALETTE_COLUMNS = 16;
const PALETTE_ROWS = 4;
const cell = (row: number, column: number): number => row * PALETTE_COLUMNS + column;
const GRAY = cell(2, 1);
const WHITE = cell(2, 7);
const GREEN = cell(1, 1);
const BRICK = cell(2, 11);
const DARK = cell(2, 3);

const FACADES: Partial<Record<Kit, readonly (Facade | null)[]>> = {
  'city kit commercial': [
    null,
    { walls: cell(2, 15), trim: BRICK },
    { walls: BRICK, trim: GRAY },
    // …
  ],
  // Domky mají pastelové stěny a různé střechy, podezdívka zůstává šedá
  'city kit suburban': [
    null,
    { walls: cell(2, 15), trim: GRAY, roof: BRICK },
    // …
  ],
};

function paletteCell(u: number, v: number): number {
  return cell(Math.floor(v * PALETTE_ROWS), Math.floor(u * PALETTE_COLUMNS));
}
```

Samotné přebarvení projde vrcholy, zjistí jejich políčko a posune UV o rozdíl sloupců a řádků:

```ts
// Přesune UV bílých, šedých a zelených ploch na barevná políčka palety
function recolor(parts: Part[], scheme: Facade): Part[] {
  const remap = new Map([
    [WHITE, scheme.walls],
    [GRAY, scheme.trim],
  ]);
  if (scheme.roof !== undefined) remap.set(GREEN, scheme.roof);
  return parts.map((part) => {
    const geometry = part.geometry.clone();
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const from = paletteCell(u, v);
      const to = remap.get(from);
      if (to === undefined || to === from) continue;
      const columns = (to % PALETTE_COLUMNS) - (from % PALETTE_COLUMNS);
      const rows = Math.floor(to / PALETTE_COLUMNS) - Math.floor(from / PALETTE_COLUMNS);
      uv.setXY(i, u + columns / PALETTE_COLUMNS, v + rows / PALETTE_ROWS);
    }
    return { ...part, geometry };
  });
}
```

Důležité detaily:

- **Posouvá se o celé políčko** (`columns / 16`), ne na střed cílového políčka. Vrchol tak
  zůstane na stejném místě uvnitř políčka. U palety je to jedno, ale kdyby políčko mělo
  přechod nebo stín, zůstane zachovaný.
- **Geometrie se klonuje.** Sdílená geometrie ze `loadScene` se nesmí měnit – ostatní varianty
  by se přebarvily taky. Klon vznikne jednou pro každou kombinaci model × fasáda (cache
  `facades` podle klíče `${kit}/${model}/${facade}`), ne pro každou budovu.
- Políčka se v kódu adresují čísly `cell(řádek, sloupec)`, ne barvami. Které číslo je „bílá zeď“
  a které „šedý rám“, je potřeba jednou zjistit (např. vypsat `paletteCell` pro UV trojúhelníků
  modelu) a zapsat do konstant.

Celý řetěz načtení budovy tak je: `loadPrototype` (normalizace) → `loadWindowed` (okna pro
budovy bez detailů, [díl 13](13-shadery-okna-a-vitr.md)) → `loadFacade` (přebarvení). Okna se
musí určit **před** přebarvením, protože se poznávají podle původní bílé a šedé barvy.

### 5. Neosvětlené postavičky

Kit „blocky characters“ má materiál s rozšířením `KHR_materials_unlit` – GLTFLoader z něj
udělá `MeshBasicMaterial`, který ignoruje světla. Ve dne to nevadí, ale v noci
([díl 16](16-osvetleni-den-noc.md)) by postavy svítily jako žárovky. Převedou se proto na
Lambertův materiál se stejnou texturou:

```ts
// Postavy mají v GLB neosvětlený materiál (KHR_materials_unlit), v noci by svítily; stínují se jako auta
function litMaterial(material: THREE.Material, cache: Map<THREE.Material, THREE.Material>): THREE.Material {
  if (!(material instanceof THREE.MeshBasicMaterial)) return material;
  let lit = cache.get(material);
  if (!lit) {
    lit = new THREE.MeshLambertMaterial({ map: material.map, color: material.color, side: material.side });
    cache.set(material, lit);
  }
  return lit;
}
```

Podobně stromy z nature kitu dostávají vlastní `MeshLambertMaterial` s barvou podle ročního
období (kit má „tyrkysové listí a kovový materiál“, jak říká komentář v `trees.ts`) – to je
téma [dílu 14](14-rocni-obdobi.md).

### 6. Galerie modelů: `/all-models` a `/game-assets`

Při práci s desítkami kitů je potřeba vidět, co v nich je. Vite plugin ve `vite.config.ts`
vytvoří virtuální modul `virtual:asset-model-catalog` se seznamem všech GLB ve složce `assets`
(a při přidání souboru přenačte stránku):

```ts
load(id) {
  if (id !== RESOLVED_ASSET_CATALOG_ID) return null;
  return `export const assetModels = ${JSON.stringify(collectAssetModels())};`;
},
```

Stránka `/all-models` (`src/screens/allModels.ts`) vykreslí každý model do vlastního náhledu
s `OrbitControls`; model si znormalizuje podobně jako hra (`scale = 1.8 / max(size)`).
Stránka `/game-assets` (`src/screens/gameAssets.ts`) ukáže jen modely, které hra opravdu používá,
roztříděné podle kategorií – seznamy bere přímo z herních konstant (`TRAIN_MODELS`,
`TOWN_BUILDING_MODELS`, `TREE_MODELS`, …), takže nemůže zastarat.

### 7. Vlastní modely: zbase → GLB přes Blender

Kenney kity nemají všechno. Pro grafiku v duchu OpenTTD vznikla v `scripts/zbase/` pipeline, která
převádí projekt [zbase](https://github.com/gravitystorm/zbase) (zdrojové `.blend` scény ke
spritům OpenTTD). Celý postup je v `scripts/zbase/README.md`, pro video jsou zajímavé tři myšlenky:

- **Geometrie ze zdrojových scén, ne z obrázků.** Z PNG spritů 3D model rozumně nevznikne;
  repo ale obsahuje 389 `.blend` souborů, ze kterých se sprity renderovaly.
- **Decimace s rozpočtem podle velikosti dílu.** Trojúhelníky žerou malé, ale přehnaně detailní
  díly (kolo autobusu ~0,08 dlaždice má 1 500 trojúhelníků). Každý díl dostane rozpočet
  `K × (velikost dílu v dlaždicích)²` a zjednoduší se samostatně, hlídaný maximální odchylkou
  povrchu (`--tolerance`). Model nad `--max-triangles` se převede znovu s polovičním `K`.
- **Barvy do palety.** Barvy materiálů se uloží do malé textury-palety přesně jako `colormap.png`
  u Kenney kitů → celý model je jeden materiál a jeden draw call.

Blender se spouští s `--disable-autoexec`, protože `.blend` soubory můžou obsahovat Python skripty.

### 8. Licence

`assets/credits.md` drží přehled: Kenney kity jsou CC0 (uvedení autora není povinné), letadla
z Poly Pizza jsou CC BY 3.0 a autora uvést **musíme**. Grafika ze zbase by byla GPL v2 – při
zveřejnění by bylo nutné přiložit licenci a zdroje. Na tohle je dobré myslet hned od začátku,
ne až před vydáním.

## Úskalí

- **Jedna budova = několik dílů.** Model z kitu nemusí být jedna síť – střecha nebo markýza
  můžou být zvláštní uzly. Proto `scene.traverse` a pole `Part[]` už od Fáze 2: instancovat
  ([díl 06](06-instancing-a-draw-cally.md)) se dá jen síť, ne celý strom uzlů.
- **Barvy commercial vs. suburban.** První přebarvení (`1e593ca`) mělo jedno pole fasád pro
  všechny budovy. V `64fe5b1` se přebarvení rozšířilo na domky
  ze suburban kitu: ty mají navíc zelené střechy a jejich paleta se s commercial kitem shoduje
  jen v řádcích 1 a 2. Proto `FACADES` podle kitu, nepovinná položka `roof` a poznámka
  „řádky 1 a 2 jsou v commercial i suburban kitu stejné“.
- **Každý soubor má vlastní kopii materiálu.** Dvě budovy z commercial kitu sdílí texturu
  na disku, ale GLTFLoader pro každý soubor vytvoří nový `MeshStandardMaterial`. Pro batching
  ([díl 06](06-instancing-a-draw-cally.md)) se proto díly řadí podle názvu materiálu, ne podle
  identity objektu.
- **Měnit sdílenou geometrii je chyba, kterou hned nevidíte.** Přebarvení bez `clone()` by
  obarvilo všechny budovy stejného modelu poslední zvolenou fasádou.

## Scénář videa

1. **Úvod:** šedobílé město z Fáze 2 vedle barevného dnešního – „ty barvy nejsou nová textura“.
2. **glTF:** otevřít GLB v textovém editoru / vypsat JSON hlavičku, ukázat `images` a `materials`.
3. **Paleta:** otevřít `colormap.png`, zvětšit, ukázat políčka. V Blenderu (nebo v galerii)
   ukázat UV mapu modelu – všechny vrcholy v políčkách.
4. **Načítání:** `assets.ts`, vysvětlit cache Promise (nakreslit 200 požadavků vs. 1)
   a `loadScene` vs. `loadModel`.
5. **Normalizace:** nákres před/po, projít `loadPrototype`, zdůraznit pořadí matic.
6. **Přebarvení:** `recolor` – živě změnit jednu položku `FACADES` a ukázat výsledek ve hře.
7. **Hash barvy:** proč ne `Math.random()` – přestavět město a ukázat, že barvy drží.
8. **Galerie:** proklikat `/all-models` a `/game-assets`.
9. **Bonus:** zbase pipeline a licence ve dvou minutách.
10. **Outro:** „máme tisíce budov – jak je nakreslit rychle?“ → díl 06.

## Cvičení

- Přidejte do `FACADES` pro commercial kit vlastní schéma (např. modré stěny `cell(1, 9)`
  s cihlovými rámy) a zkontrolujte ve hře.
- Zkuste v `loadPrototype` změnit `FOOTPRINT` na 1. Co se stane s chodníky a mezerami mezi domy?
- Napište funkci, která pro zadaný model vypíše, kolik trojúhelníků patří do kterého políčka
  palety (využijte `paletteCell`). Které barvy jsou nejčastější?
- V `/all-models` najděte modely, které by se hodily jako další typ budovy, a přidejte je do
  `TOWN_BUILDING_MODELS` v `src/world/town.ts`.
