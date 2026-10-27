# Díl 04 – Generování světa ze seedu

> **Soubory:** `src/world/rng.ts`, `src/world/noise.ts`, `src/world/generator.ts`,
> `src/world/town.ts`, `src/world/industry.ts`, `src/world/generator.test.ts`
> **Commity:** `0c3ee3f` (Fáze 2: generování světa ze seedu), `5ecde19` (mrakodrapy až od 2010),
> `750df19` (vyvážení růstu měst), `db8ceee` (stromy), `568e47d` (průmysl s vlastním proudem náhody)

## O čem je tento díl

Napíšeme generátor, který z textu (třeba `brno` nebo `test`) vyrobí vždy **stejný** svět: vodu,
lesy, města s ulicemi a budovami, průmyslové závody. Naučíme se:

- převést text na číslo (hash FNV-1a),
- deterministický generátor náhody, jehož stav jde uložit (mulberry32),
- value noise a fraktální šum (fBm) pro přírodně vypadající tvary,
- **bezstavovou náhodu** – hash souřadnic dlaždice, který render používá všude,
- proč mít několik oddělených proudů náhody,
- jak „pěstovat“ město: tvar, silniční mřížka, budovy natočené k ulici, výběr modelů podle roku.

Celá vrstva `world/` je čistý TypeScript bez three.js. Výstup je `World` – mapa dlaždic, seznam
měst, kolejová síť a závody – a vykreslení je až věcí ostatních dílů.

## Teorie

### Proč deterministicky

Zadání chce mapu podle seedu a v commitu Fáze 2 stojí: „Svět je deterministický podle seedu
(?seed= v URL), aby šlo stejnou mapu reprodukovat a později uložit jen seed a změny.“ Prakticky:

- chybu nahlášenou na seedu `abc` si vývojář zopakuje na svém stroji,
- testy můžou ověřovat konkrétní mapy (`generateWorld(42, 128, 1950)` dá vždy totéž),
- úvodní obrazovka ukazuje „svět v roce 2025“, který vznikne vždy stejně.

`Math.random()` tohle nesplní – nejde nastavit jeho seed.

### Hash textu: FNV-1a

Seed je text, generátor potřebuje 32bitové číslo. FNV-1a je jednoduchý hash: pro každý znak
`h = (h XOR znak) · prvočíslo`:

```ts
// Převod textového seedu na číslo (FNV-1a)
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
```

`Math.imul` je 32bitové celočíselné násobení. Obyčejné `*` by pracovalo v `double`, přesáhlo by
53 bitů přesnosti a výsledek by se lišil od „opravdového“ 32bitového hashe. `>>> 0` převede
výsledek na číslo bez znaménka.

### Generátor náhody: mulberry32

```ts
// Deterministický generátor (mulberry32), stav jde uložit a obnovit
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // … int(min, max), chance(p), pick(items), shuffle(items)
}
```

Celý stav generátoru je **jedno 32bitové číslo**. Každé `next()` k němu přičte konstantu
a výsledek „zamíchá“ posuny a násobeními. Výhoda pro hru: stav se dá uložit do JSON a po
načtení obnovit. Hra to dělá – `Game` má vlastní `rng` pro náhodné události (růst měst,
průmysl) a `save.ts` ukládá `rngState: game.rng.state`. Po načtení se hra vyvíjí stejně, jako
by se nikdy neukládala.

### Value noise

Náhodné číslo pro každou dlaždici zvlášť dá „šum televize“ – voda by byla roztroušená po
jednotlivých dlaždicích. Přírodní tvary (jezera, lesy) potřebují **spojitý** šum: blízké body
mají podobné hodnoty.

Value noise to dělá takhle:

1. V celočíselných bodech mřížky (`lattice`) vezmi náhodné číslo 0..1 (hash souřadnic).
2. Mezi nimi **interpoluj**.

```
  hodnoty v mřížce:      0.2 ─────────── 0.9
                          │               │
                          │   (x, y)      │      bilineární interpolace
                          │      •        │      s vyhlazeným t
                          │               │
                         0.6 ─────────── 0.1
```

Lineární interpolace by nechala na čarách mřížky viditelné „zlomy“ (derivace skáče). Proto se
parametr `t` nejdřív vyhladí křivkou **smoothstep** `3t² − 2t³`, která má v 0 a 1 nulovou
derivaci:

```
  lineární t             smoothstep(t) = t·t·(3 − 2t)

  1 ┤      ╱             1 ┤       ___
    │    ╱                 │     ╱
    │  ╱                   │   ╱
  0 ┼╱                     0 ┼__╱
    0      1                 0      1
```

```ts
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
```

Poslední řádek je rozepsaná bilineární interpolace
`mix(mix(a, b, tx), mix(c, d, tx), ty)` – po roznásobení vyjde přesně tenhle výraz.

### Fraktální šum (fBm)

Jedna vrstva value noise vypadá jako „bubliny“ stejné velikosti. Krajina má detaily na všech
měřítkách: velké jezero má zálivy a ty mají menší zálivy. **fBm** (fractional Brownian motion)
sečte několik vrstev (**oktáv**) šumu: každá další má dvojnásobnou frekvenci a poloviční
amplitudu.

```
  oktáva 0:  frekvence 1, amplituda 1     ~~~~~~~~      velké tvary
  oktáva 1:  frekvence 2, amplituda 1/2   ∿∿∿∿∿∿∿∿      zálivy
  oktáva 2:  frekvence 4, amplituda 1/4   ≈≈≈≈≈≈≈≈      zubaté pobřeží
  oktáva 3:  frekvence 8, amplituda 1/8   ⋯⋯⋯⋯⋯⋯⋯⋯      drobnosti
  ─────────────────────────────────────
  součet / (1 + 1/2 + 1/4 + 1/8)        → 0..1
```

```ts
// Fraktální šum v rozsahu 0..1
export function fbm(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(seed + o * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
```

Každá oktáva má jiný seed (`seed + o * 1013`), jinak by se vrstvy vzájemně kopírovaly. Dělení
`norm` vrátí výsledek do rozsahu 0..1. Průměr součtu vrstev se blíží 0,5 a extrémy jsou vzácné
– to se hodí pro prahování.

### Bezstavová náhoda: hash dlaždice

Funkce `lattice` výše je zvláštní druh náhody: **čistá funkce souřadnic**. Pro `(seed, x, y)`
vrátí vždy stejné číslo a nepotřebuje žádný stav. Hra má stejný princip v několika variantách,
nejčastěji jako `tileHash`:

```ts
function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
```

Velká lichá čísla souřadnice „rozprostřou“, posuny a XOR (`h ^ (h >>> 13)`) zamíchají bity tak,
že sousední dlaždice dostanou nesouvisející hodnoty. Parametr `salt` dává z jedné dlaždice
libovolný počet nezávislých čísel: salt 1 = počet stromů, 10 + k = model k-tého stromu,
20 + k = jeho velikost…

Proč je to pro render tak důležité:

- **Žádná data navíc.** Kde stojí stromy v lese a jak jsou otočené, se nikam neukládá. Při každé
  přestavbě vrstvy se spočítá znovu – a vyjde stejně (`src/render/trees.ts`).
- **Stabilita.** Když hráč vykácí jednu dlaždici lesa, ostatní stromy se nepřeskupí. S jedním
  sdíleným `Rng` by se posunula celá posloupnost a les by se při každé změně „přemíchal“.
- **Částice jen v záběru.** Padající listí a mlha nemají žádné pole částic. Pro každou viditelnou
  dlaždici se parametry k-tého listu spočtou z hashe (`fallingLeaf(x, y, k)`) a mimo obrazovku
  neexistují ([díl 15](15-casticove-efekty.md)).
- **Barva fasády** budovy je hash polohy (`facadeAt`), takže dům po přestavbě scény barvu nezmění
  ([díl 05](05-modely-glb.md)).

`tileHash` je zkopírovaný v `trees.ts`, `fallingLeaves.ts`, `forestMist.ts`, `animals.ts`,
`town.ts` a `game/trafficLights.ts`. Duplicita je vědomá – jsou to čtyři řádky a každý modul
zůstává nezávislý.

## Implementace

### Postup generátoru

`generateWorld()` (`src/world/generator.ts`) jde v pevném pořadí:

```ts
export function generateWorld(
  seed: number,
  size: number,
  year: number,
  options: GenerateOptions = DEFAULT_OPTIONS,
): World {
  const rng = new Rng(seed);
  const map = new GameMap(size, size);
  generateWater(map, seed, options.waterLevel);

  const towns: Town[] = [];
  // Města a městečka berou jména ze společného seznamu, aby se neopakovala
  const townNames = rng.shuffle(CITY_NAMES.filter((name) => name !== 'Brno'));
  placeTowns(map, rng, 'city', townNames, towns, year, options.townDensity, 'Brno');
  placeTowns(map, rng, 'town', townNames, towns, year, options.townDensity);
  placeTowns(map, rng, 'village', rng.shuffle([...VILLAGE_NAMES]), towns, year, options.townDensity);
  generateTrees(map, seed);
  // Vlastní proud náhody, aby přidání průmyslu nezměnilo města na existujících seedech
  const industryDensity = options.industryDensity ?? 1;
  const industries = placeIndustries(map, towns, new Rng(seed ^ 0x1d872b41), industryDensity);

  return { seed, map, towns, rail: new RailNetwork(map), industries, industryDensity };
}
```

Pořadí má důvod: voda → města (potřebují vědět, kde je voda) → stromy (jen na zbylé trávě) →
průmysl (mimo města). Každá mapa má právě jedno **Brno** – je to první velké město a jeho jméno
se nevybírá ze seznamu (a hlídá to test).

### Voda a lesy prahem šumu

```ts
const WATER_SCALE = 1 / 28;

function generateWater(map: GameMap, seed: number, level: number): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (fbm(seed, x * WATER_SCALE, y * WATER_SCALE) < level) map.set(x, y, TileType.Water);
    }
  }
}
```

- `WATER_SCALE = 1/28` – jedna buňka šumu na 28 dlaždic. Menší měřítko by dalo menší jezírka.
- `level` je práh: všechno pod ním je voda. Volby nové hry „málo / normálně / hodně vody“ jsou
  jen prahy `0.28 / 0.34 / 0.42` (`WATER_LEVELS` v `src/screens/game.ts`). Protože fBm má
  hodnoty nahuštěné kolem 0,5, malá změna prahu udělá velký rozdíl v ploše.

Lesy fungují stejně, jen s jiným seedem a s druhým hodem kostkou:

```ts
const FOREST_SCALE = 1 / 22;
const FOREST_LEVEL = 0.58;
const FOREST_DENSITY = 0.85;
const LONE_TREE_CHANCE = 0.03;

// Lesy podle šumu a občasné solitéry na volné trávě
function generateTrees(map: GameMap, seed: number): void {
  const forestSeed = seed ^ 0x9e3779b9;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.isType(x, y, TileType.Grass)) continue;
      const forest = fbm(forestSeed, x * FOREST_SCALE, y * FOREST_SCALE) > FOREST_LEVEL;
      const roll = tileRandom(forestSeed, x, y);
      if (roll < (forest ? FOREST_DENSITY : LONE_TREE_CHANCE)) map.set(x, y, TileType.Trees);
    }
  }
}
```

Šum určí, **kde** je les (nad prahem 0,58). Uvnitř lesa má dlaždice 85% šanci na stromy
(les má mýtinky), mimo les 3 % (osamělé stromy v polích). `seed ^ 0x9e3779b9` dá lesům jiný
šum než vodě – jinak by se lesy kopírovaly podle jezer.

### Oddělené proudy náhody

Všimněte si, kolik různých „seedů“ se z jednoho seedu odvozuje:

| Proud | Odvození | K čemu |
| --- | --- | --- |
| `new Rng(seed)` | seed | rozmístění a jména měst |
| `fbm(seed, …)` | seed | voda |
| `seed ^ 0x9e3779b9` | XOR konstantou | lesy |
| `new Rng(seed ^ 0x1d872b41)` | XOR konstantou | průmysl |
| `new Rng(world.seed ^ 0x5bd1e995)` | XOR konstantou | náhoda během hry (`Game.rng`) |

Proč ne jeden `Rng` pro všechno? Commit `568e47d` (průmysl) to vysvětluje: „Používá vlastní
proud náhody, takže rozmístění měst na stávajících seedech zůstává stejné.“ Kdyby průmysl
bral čísla ze stejného generátoru jako města a byl umístěný dřív, všechna města by se posunula.
A kdyby byl umístěný později, ale někdo by později přidal další druh závodu, posunuly by se
ostatní závody. Oddělené proudy znamenají, že **přidání nové funkce nezmění staré mapy** –
hráč může dál hrát na svém oblíbeném seedu. Na stejný princip dbá test:

```ts
it('výchozí parametry zachovávají dosavadní mapy', () => {
  const implicit = generateWorld(7, 128, 1950);
  const explicit = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1 });
  expect(implicit.map.tiles).toEqual(explicit.map.tiles);
});
```

### Rozmístění měst

`placeTowns` zkouší náhodná místa (až `600 · density` pokusů) a místo přijme, jen když:

- je volné a v okruhu 6 dlaždic je aspoň 75 % volné pevniny (`landRatio`),
- je daleko od ostatních sídel – 40 dlaždic mezi dvěma velkými městy, jinak 26 (`minDistance`).

Počet sídel se odvozuje od plochy: jedno město na 11 000 dlaždic, městečko na 8 000, vesnice
na 5 500 (`TILES_PER_TOWN`), krát hustota z voleb nové hry. Města tak zůstanou „oddělenými
celky“, jak chce zadání, a na větší mapě jich je úměrně víc.

### Tvar města ze sektorů

Kruhová města by vypadala uměle. Město proto dostane **12 sektorů** a v každém náhodný násobek
poloměru 0,7–1,3:

```ts
const SHAPE_SECTORS = 12;

export function createTownShape(rng: Rng): number[] {
  return Array.from({ length: SHAPE_SECTORS }, () => 0.7 + rng.next() * 0.6);
}

function insideShape(town: Town, x: number, y: number, radius: number): boolean {
  const dx = x - town.x;
  const dy = y - town.y;
  const angle = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
  const f = angle * SHAPE_SECTORS;
  const i = Math.floor(f);
  const t = f - i;
  const scale = town.shape[i % SHAPE_SECTORS] * (1 - t) + town.shape[(i + 1) % SHAPE_SECTORS] * t;
  return Math.hypot(dx, dy) <= radius * scale;
}
```

```
             1.2
        0.8 ╱‾‾‾╲ 1.1          úhel bodu → sektor i a podíl t v něm,
       ╱             ╲         poloměr se mezi sousedními sektory
  0.9 │       •       │ 1.3    lineárně interpoluje → hladký,
       ╲             ╱         ale nepravidelný obrys
        0.7 ╲___╱ 1.0
             0.8
```

Je to vlastně 1D value noise po obvodu kruhu. `(… + 1) % 1` převede úhel z `atan2`
(−π..π) na 0..1 a `% SHAPE_SECTORS` zajistí, že poslední sektor plynule navazuje na první.

### Silniční mřížka a budovy

Město roste od středu. Silnice smějí ležet jen na **čarách mřížky** – každá `roadSpacing`-tá
řada a sloupec (3 u velkých měst, 4 u městeček a vesnic):

```ts
// Čáry silniční sítě jsou vyhrazené pro silnice, aby je budovy nezablokovaly
function onRoadGrid(town: Town, x: number, y: number): boolean {
  const spacing = KIND_RULES[town.kind].roadSpacing;
  return (x - town.x) % spacing === 0 || (y - town.y) % spacing === 0;
}
```

`growRoads` pak prohledá do šířky (flood fill) od středu všechny dlaždice, které jsou uvnitř
tvaru, na mřížce a volné. Silnice tak vždy tvoří **jednu souvislou síť** napojenou na střed –
žádné osamělé kousky. Mezi čarami mřížky zbydou bloky 2×2 (u velkých měst) nebo 3×3 dlaždic
pro budovy:

```
   R R R R R R R      R = silnice na mřížce (spacing 3)
   R . . R . . R      . = místo pro budovu, natočenou k nejbližší silnici
   R . . R . . R
   R R R R R R R
```

Pro budovu se hledají volné dlaždice mimo mřížku, které sousedí se silnicí téhož města.
`roadFacing` vrátí natočení čelem k té silnici:

```ts
// Sousedé v pořadí S, V, J, Z a natočení budovy čelem k nim
const NEIGHBOURS = [
  { dx: 0, dy: 1, rotation: 0 },
  { dx: 1, dy: 0, rotation: Math.PI / 2 },
  { dx: 0, dy: -1, rotation: Math.PI },
  { dx: -1, dy: 0, rotation: -Math.PI / 2 },
];
```

Hlavní smyčka `expandTown` přidává silnice a budovy, dokud **kapacita budov** nestačí na
populaci města, a když místo dojde, zvětší poloměr:

```ts
// Doplní silnice a budovy, dokud kapacita budov nestačí na populaci; populaci pak omezí kapacitou
export function expandTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  const rules = KIND_RULES[town.kind];
  let capacity = townCapacity(town);

  while (capacity < town.population && town.radius <= rules.maxRadius) {
    growRoads(map, town, town.radius);

    const slots: { x: number; y: number; rotation: number; distance: number }[] = [];
    // … volné dlaždice u silnice uvnitř tvaru
    for (/* … */) {
        if (tileHash(x, y, town.id) < rules.gardenRatio) continue;
        const rotation = roadFacing(map, town, x, y);
        if (rotation === null) continue;
        const distance = Math.hypot(x - town.x, y - town.y);
        slots.push({ x, y, rotation, distance: distance + rng.next() * 1.5 });
    }
    slots.sort((a, b) => a.distance - b.distance);

    for (const slot of slots) {
      if (capacity >= town.population) break;
      map.set(slot.x, slot.y, TileType.Building);
      map.setOwner(slot.x, slot.y, town.id);
      const model = pickModel(town, slot.distance, year, rng);
      town.buildings.push({ x: slot.x, y: slot.y, rotation: slot.rotation, model });
      capacity += buildingCapacity(model);
    }

    if (capacity < town.population) town.radius++;
  }

  town.population = Math.min(town.population, capacity);
}
```

Detaily, které dělají města „živější“:

- **Zahrady**: `tileHash(x, y, town.id) < gardenRatio` vynechá 15 % míst u městeček a 30 %
  u vesnic. Je to hash, ne `rng`, takže stejné místo zůstane zahradou i při ročním růstu.
- **Náhodný posun vzdálenosti** `+ rng.next() * 1.5` – budovy se nestaví v dokonalých
  soustředných kruzích, okraj města je roztřepený.
- **Kapacita** podle typu budovy (`BUILDING_CAPACITY` v `balance.ts`): domek 12, nízká kancelář
  25, kancelář 40, mrakodrap 150 obyvatel. Mrakodrap tedy „ušetří“ místo – centrum velkého města
  se nemusí rozlézat.
- `map.setOwner` zapíše vlastníka dlaždice. Podle něj se pozná, ke kterému městu patří
  nástupiště v dosahu, a terén pod budovou velkého města kreslí dlažbu místo zahrady.

### Výběr modelu podle roku

```ts
function pickModel(town: Town, distance: number, year: number, rng: Rng): string {
  if (town.kind === 'village') return rng.pick(HOUSES);
  const ratio = distance / Math.max(town.radius, 4);
  // Městečko: kanceláře převážně v centru, jinak domky
  if (town.kind === 'town') {
    if (ratio >= 0.7 || !rng.chance(0.6)) return rng.pick(HOUSES);
    return rng.chance(0.5) ? rng.pick(LOW_OFFICES) : rng.pick(OFFICES);
  }
  if (year >= SKYSCRAPER_YEAR && ratio < 0.35 && rng.chance(0.6)) return rng.pick(SKYSCRAPERS);
  if (ratio > 0.7 && rng.chance(0.5)) return rng.pick(LOW_OFFICES);
  return rng.pick(OFFICES);
}
```

- Vesnice: jen rodinné domky ze suburban kitu.
- Městečko: v centru (do 70 % poloměru) občas kanceláře, jinak domky.
- Velké město: mrakodrapy v centru (do 35 % poloměru), ale **až od roku 2010**
  (`SKYSCRAPER_YEAR`), na okraji nízké kanceláře.

Rok je parametr generátoru. Nová hra startuje v roce 1950, ale úvodní obrazovka generuje svět
pro rok 2025 – proto má pozadí menu mrakodrapy.

Za zmínku stojí, co patří mezi „mrakodrapy“ (`SKYSCRAPERS` v `town.ts`). Jsou tam i
`low-detail-building-a…m` a `building-m`. Commit `5ecde19` vysvětluje proč: mají úzký půdorys
(0,5), a protože se modely normalizují na šířku dlaždice ([díl 05](05-modely-glb.md)), vyjdou
3–3,9 jednotky vysoké – víc než samotné `building-skyscraper-*`. Rozdělení modelů se dělá
podle výsledné výšky ve hře, ne podle názvu v kitu.

### Roční růst

Na konci každého herního roku `Game` zavolá pro každé město `growTown` se svým `rng`:

```ts
// Roční růst: přestavba centra, přírůstek obyvatel a nové budovy na okraji
export function growTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  redevelopCentre(town, year, rng);
  const rate = town.served ? TOWN_GROWTH_SERVED : TOWN_GROWTH_BASE;
  town.population = Math.round(town.population * (1 + rate));
  expandTown(map, town, year, rng);
}
```

- Obsluhované město (vlakem jezdí cestující) roste o 5 % ročně, neobsluhované jen o 0,5 %.
- Od roku 2010 se budovy v centru s pravděpodobností 12 % ročně přestavují na mrakodrapy
  (`redevelopCentre`).
- Nové budovy přidá stejný `expandTown` jako při generování – kód pro vznik a růst města je
  jeden. To bylo záměrem od Fáze 2: „expandTown() půjde použít i pro roční růst měst ve fázi 3“.

Po růstu `Game` vyšle událost `townsChanged` a render přestaví budovy
([díl 06](06-instancing-a-draw-cally.md)).

### Průmysl

`placeIndustries` pro každý druh závodu spočte cílový počet z plochy mapy
(`tilesPerIndustry`) a zkouší náhodná místa s vlastním `Rng`. Funkce `industrySiteProblem`
vrací **důvod**, proč místo nevyhovuje (okraj mapy, volná zem 3×3, pás volné země kolem, blízko
města nebo jiného závodu), nebo `null`. Stejná funkce slouží i hráči při ruční stavbě závodu,
kde se důvod ukáže v UI. Při založení se okolí areálu vykácí na trávu (kromě lesa, který je
těžbou dřeva).

## Úskalí

- **Hodnoty ze zadání k sobě nesedí.** Zadání chtělo růst měst 5 % ročně. Commit `750df19`
  spočítal, že by to za 100 let zvětšilo města 130×. Řešení: 5 % jen pro obsluhovaná města,
  0,5 % pro ostatní, a všechny konstanty na jednom místě v `src/game/balance.ts`.
- **Mrakodrapy v roce 1950.** První verze stavěla věže hned. `5ecde19` přidal rok jako parametr
  generátoru a zjistil, že většinu „věží“ dělaly úzké low-detail budovy zvětšené normalizací.
- **Budovy blokující růst.** Bez rezervace os mřížky (`onRoadGrid`) by budovy obsadily místa,
  kudy měly vést další ulice, a město by přestalo růst. Fáze 2: „osy silniční sítě jsou
  rezervované, jinak by budovy zablokovaly další růst“.
- **Změna starých map.** Každá nová funkce generátoru riskuje, že rozbije oblíbené seedy. Proto
  oddělené proudy náhody a test „výchozí parametry zachovávají dosavadní mapy“.
- **`*` místo `Math.imul`.** Hashe s obyčejným násobením by dávaly jiné výsledky (ztráta přesnosti
  nad 2⁵³). Všechny hashe v projektu používají `Math.imul`.

## Scénář videa

1. Ukázat dva prohlížeče se stejným `?seed=brno` – stejná mapa. Proč na tom záleží.
2. `Math.random()` nejde seedovat → FNV-1a pro text a mulberry32 pro posloupnost.
3. Šum televize vs. spojitý šum: vykreslit `lattice` a `valueNoise` do canvasu jako stupně šedi.
4. Smoothstep: lineární interpolace se zlomy vs. vyhlazená.
5. fBm: přidávat oktávy jednu po druhé a sledovat, jak vzniká pobřeží.
6. Práh vody: posuvník `level`, mapa se zaplavuje.
7. Lesy: druhý šum + hod kostkou, mýtinky a solitéry.
8. `tileHash` – vykácet dlaždici lesa a ukázat, že ostatní stromy zůstaly. Pak hypoteticky se
   sdíleným `Rng` (stromy se přemíchají).
9. Oddělené proudy: přidat druh průmyslu a ukázat, že města zůstala.
10. Město: tvar ze sektorů (nakreslit obrys), mřížka, flood fill silnic, budovy k ulici.
11. Generovat stejný seed pro rok 1950 a 2025 – mrakodrapy v centru.

## Cvičení

- Vykreslete `fbm` celé mapy do `<canvas>` jako stupně šedi. Jak se změní obraz s 1, 2, 4 a 8
  oktávami?
- Změňte `WATER_SCALE` na `1/10` a `1/60`. Jak se změní charakter vody (jezírka × moře)?
- Přidejte „pobřežní písek“: dlaždice trávy, jejichž `fbm` je těsně nad prahem vody
  (`level … level + 0.02`), označte novým typem.
- Udělejte z `createTownShape` 24 sektorů a rozptyl 0,5–1,5. Vypadají města lépe?
- Napište test, který ověří, že přidání nového proudu `new Rng(seed ^ X)` za průmysl nezmění
  `world.towns`.
