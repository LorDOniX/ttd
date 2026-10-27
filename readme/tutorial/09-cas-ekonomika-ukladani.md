# Díl 09 – Herní čas, ekonomika a ukládání

> **Soubory:** `src/game/clock.ts`, `src/game/emitter.ts`, `src/game/game.ts`, `src/game/balance.ts`,
> `src/game/passengers.ts`, `src/game/rating.ts`, `src/game/cargo.ts`, `src/game/freight.ts`,
> `src/game/industryLife.ts`, `src/world/town.ts`, `src/game/save.ts`, `src/game/launch.ts`
> **Commity:** `498e706` (Fáze 3: herní čas, HUD, růst měst), `750df19` (vyvážení ekonomiky),
> `ec03176` (Fáze 6: cestující a ekonomika), `5fb8a43` (Fáze 7: uložení a načtení), `f87f726`
> (hodnocení nástupišť), `0eae4a5` (obecný systém nákladů), `824d860` (vyvážení nákladu),
> `c61cf43` (živý průmysl), `cf3253a` (uložení pohledu kamery), `cd47d57` (uložení rozpracované výstavby)

## O čem je tento díl

Tenhle díl je nejméně „grafický“ z celé série, ale bez něj by hra byla jen hezká krajina. Na konci
divák bude vědět:

- jak převést reálný čas snímků na herní kalendář (1 rok = 15 minut) a proč je ten převod
  oddělený od vykreslování,
- jak se herní logika domlouvá s 3D scénou přes typované události, aniž by o sobě věděly,
- jak funguje ekonomika: odkud se berou cestující, kolik se platí za přepravu, co je hodnocení
  stanice,
- jak města rostou a průmysl žije,
- jak uložit celou hru do JSON a za půl roku ji načíst v novější verzi hry.

## Teorie

### Snímky nejsou herní čas

Prohlížeč volá naši smyčku `setAnimationLoop` zhruba 60× za sekundu, ale nic negarantuje: na
monitoru 144 Hz to bude 144×, na přetíženém notebooku 25× a ve skrytém tabu skoro vůbec. Kdyby se
vlak posunul o pevný kus „za snímek“, jezdil by na rychlém monitoru dvakrát rychleji.

Proto každý snímek dostane **dt** – kolik milisekund uplynulo od minulého snímku – a herní logika
posouvá svět o čas, ne o snímky:

```
reálný čas   |--16ms--|--16ms--|----------40ms----------|--16ms--|
herní dny     +0,0062  +0,0062   +0,0156                  +0,0062
```

S tím souvisí dvě pravidla, která se v kódu objevují znovu a znovu:

1. **Strop na dt.** Když se tab na minutu schová a pak vrátí, přijde jeden snímek s dt = 60 000 ms.
   Kdyby ho logika poctivě odsimulovala, vlaky by „proskočily“ přes stanice a návěstidla. Proto se
   dt ořezává (`MAX_FRAME_MS = 250` v hodinách, `Math.min(dtMs, 100)` u animací).
2. **Logika nesmí záviset na vykreslování.** Vlak se musí pohybovat stejně, ať ho kamera vidí, nebo
   ne, a ať je zapnutá noc, nebo den. Herní stav proto žije v `src/game/` a `src/world/` a o three.js
   nic neví (viz [díl 00](00-uvod.md)).

Odměnou je **testovatelnost a determinismus**: test může zavolat `game.update(200)` dvacet tisíckrát
bez prohlížeče a GPU a porovnat výsledek. Celá náhoda ve hře jde přes seedovaný generátor `Rng`
([díl 04](04-generovani-sveta.md)), takže stejný vstup dá stejný výsledek.

### Události místo volání napříč vrstvami

Když vlak vyloží cestující, hra potřebuje: přičíst peníze, aktualizovat HUD, ukázat nad stanicí
zelenou plovoucí částku a přepsat popisek stanice. Kdyby to `Passengers.exchange()` všechno volalo
přímo, herní logika by musela znát HUD i 3D scénu. Místo toho jen **vyhlásí událost** a kdo chce,
poslouchá:

```
  game/ (logika)                  render/, ui/ (pohled)
  ┌──────────────┐  emit('income', 1200, x, z)  ┌──────────────────────────┐
  │ Passengers   │ ───────────────────────────► │ GameView → FloatingTexts │
  │ exchange()   │  emit('money', 1001200)      │ Hud → částka v liště     │
  └──────────────┘ ───────────────────────────► └──────────────────────────┘
```

## Implementace

### 1. Herní kalendář

`GameClock` drží datum, počet celých dní od začátku hry a rozpracovaný zlomek dne
(`src/game/clock.ts`):

```ts
export const START_YEAR = 1950;
export const END_YEAR = 2050;
const REAL_MS_PER_YEAR = 15 * 60 * 1000;
// Delší výpadek (např. skrytý tab) nesmí přeskočit celé měsíce
const MAX_FRAME_MS = 250;
// …
export const GAME_SPEEDS = [1, 2, 4] as const;
```

Klíčová je metoda `tick()`. Převede milisekundy na zlomek dne podle délky roku (přestupný rok má
366 dní, takže je den o kousek kratší), vynásobí rychlostí hry a celé dny „odtiká“ po jednom:

```ts
// Posune čas o reálných dtMs, vrací počet uplynulých herních dní (necelé číslo)
tick(dtMs: number): number {
  if (this._paused || this.ended) return 0;
  const msPerDay = REAL_MS_PER_YEAR / daysInYear(this.date.year);
  const days = (Math.min(dtMs, MAX_FRAME_MS) * this._speed) / msPerDay;
  this.dayProgress += days;
  while (this.dayProgress >= 1 && !this.ended) {
    this.dayProgress -= 1;
    this.advanceDay();
  }
  return days;
}
```

Vrácené `days` je **necelé číslo** – vlaky a auta s ním počítají plynulý pohyb (rychlost je
v dlaždicích za den). Celé dny naopak spouští události `day`, `month`, `year`:

```ts
private advanceDay(): void {
  this.day++;
  const d = this.date;
  if (d.day < daysInMonth(d.year, d.month)) {
    this.date = { ...d, day: d.day + 1 };
    this.events.emit('day', this.date);
    return;
  }
  const newYear = d.month === 11;
  this.date = newYear
    ? { year: d.year + 1, month: 0, day: 1 }
    : { year: d.year, month: d.month + 1, day: 1 };
  this.events.emit('day', this.date);
  this.events.emit('month', this.date);
  if (newYear) this.events.emit('year', d.year);
  if (this.ended) this.events.emit('end');
}
```

Délku měsíce bere z vestavěného `Date`: `new Date(Date.UTC(year, month + 1, 0))` je nultý den
dalšího měsíce, tedy poslední den tohoto.

Herní čas pro výpočty („kdy cestující nastoupil“) je `clock.now = day + dayProgress` – spojité
číslo dní, které se dá odečítat.

### 2. Typovaný Emitter

Celý event systém je dvacet řádků (`src/game/emitter.ts`):

```ts
type Handler<Args extends unknown[]> = (...args: Args) => void;

// Jednoduchý typovaný event emitter
export class Emitter<Events extends { [K in keyof Events]: unknown[] }> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    // …
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) (handler as Handler<Events[K]>)(...args);
  }
}
```

Trik je v generickém parametru: mapa „název události → n-tice argumentů“. TypeScript pak hlídá,
že `emit('income', 1200, x, z)` má správné argumenty a že posluchač dostane správné typy. Seznam
událostí hry je v `src/game/game.ts`:

```ts
type GameEvents = {
  money: [number];
  news: [string];
  company: [string];
  townsChanged: [];
  railChanged: [];
  roadsChanged: [];
  // …
  stationsChanged: [];
  // Závod vznikl nebo zanikl
  industriesChanged: [];
  // Výdělek za přepravu a místo, kde vznikl
  income: [number, number, number];
  // Výsledek demolice a její střed: kladná částka se vrátila, záporná se zaplatila
  demolished: [number, number, number];
  outOfMoney: [];
};
```

Na druhé straně `GameView` jen poslouchá (`src/render/gameView.ts`):

```ts
game.events.on('townsChanged', () => {
  void this.buildings.rebuild(towns);
  towns.forEach((town) => this.labels.update(town));
  // …
  this.nightLights.invalidate();
});
game.events.on('railChanged', () => (this.railDirty = true));
game.events.on('stationsChanged', rebuildStationLabels);
game.events.on('industriesChanged', () => void this.industries.sync(world.industries));
game.events.on('income', (amount, x, z) =>
  this.floatingTexts.show(`+${formatMoney(amount)}`, x, z, 'income-label'),
);
```

Všimněte si `railChanged`: koleje se nepřestaví hned, jen se nastaví příznak `railDirty`. Když hráč
táhne dlouhou trať, přijde událostí desítky za snímek, ale přestavba proběhne nejvýš jednou
v `syncMap()`. Tohle je obecný vzor: **událost označí, snímek dorovná** (víc v
[dílu 17](17-optimalizace-a-lod.md)).

### 3. Herní smyčka logiky

`Game` je kořen herního stavu a jeho `update()` je to, co volá `GameView.frame()`:

```ts
update(dtMs: number): number {
  const days = this.clock.tick(dtMs);
  this.fleet.update(days);
  this.roadFleet.update(days);
  this.construction.update(dtMs);
  return days;
}
```

Vlaky a auta se posouvají spojitě o `days`, kdežto ekonomika se počítá po dnech a měsících přes
události hodin. V konstruktoru `Game` je vidět, kdo na co poslouchá:

```ts
constructor(readonly world: World) {
  // Vlastní proud náhody pro průběh hry, oddělený od generování mapy
  this.rng = new Rng(world.seed ^ 0x5bd1e995);
  this.fleet = new Fleet(this);
  this.roadFleet = new RoadFleet(this);
  this.passengers = new Passengers(this);
  this.freight = new Freight(this);
  // Až po Freight, aby měsíční změny viděly uzavřený odvoz
  this.industryLife = new IndustryLife(this);
  this.clock.events.on('month', () => this.payMonthly());
  this.events.on('railChanged', () => (this.infrastructure = null));
  this.clock.events.on('year', (year) => this.onYearEnd(year));
  // …
}
```

Pořadí vytvoření je důležité: posluchači se volají v pořadí registrace, takže průmysl vidí
měsíční odvoz až po jeho uzavření. Takové závislosti stojí za komentář – přesně jako tady.

### 4. Vyvážení na jednom místě

Všechny konstanty ekonomiky jsou v `src/game/balance.ts`. Proč? Commit `750df19` to vysvětluje
naprosto konkrétně: hodnoty ze zadání (`ttd.md`) k sobě nesedí. Podle původní tabulky by jedna
jízda vydělala 1,2 mil. Kč, víc než stála celá trať, a růst měst o 5 % ročně by je za sto let
zvětšil 130×. Vyvažování je iterativní a je pohodlné mít všechny páky v jednom souboru.

Sazba za přepravu se řídí dobou cesty – čím déle cestující jede, tím méně zaplatí:

```ts
// Sazba za cestujícího a ujetou dlaždici podle doby přepravy
export const FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 30, rate: 10 },
  { maxDays: 60, rate: 5 },
  { maxDays: Infinity, rate: 2 },
];
```

```ts
export function fare(amount: number, tiles: number, days: number, tiers = FARE_TIERS): number {
  const tier = tiers.find((t) => days <= t.maxDays)!;
  return Math.round(amount * tiles * tier.rate);
}
```

Poměr pásem 5000 : 2500 : 1000 ze zadání zůstal zachovaný (10 : 5 : 2), jen absolutní hodnoty jsou
o řády menší. Každý druh nákladu má vlastní tabulku pásem v `CARGOS` (`src/game/cargo.ts`), suroviny
ztrácejí cenu pomaleji než cestující.

### 5. Cestující a dosah stanice

Cestující nevznikají „ve městě“, ale v té **části města, kterou stanice pokrývá**. Dosah je obdélník
kolem nástupiště rozšířený o `STATION_CATCHMENT_RADIUS = 4` dlaždice. Každá budova v dosahu přispívá
podílem své kapacity na kapacitě města a budova v dosahu dvou stanic se mezi ně dělí:

```
 . . . . . . . . . . .     B = budova města
 . ┌─────────────┐ . .     ┌─┐ = dosah nástupiště (±4 dlaždice)
 . │ B B   B     │ B .     Podíl stanice = Σ kapacita budov v dosahu / kapacita města
 . │   ═══       │ . .
 . │ B     B   B │ B .
 . └─────────────┘ . .
```

Měsíční příliv z jednoho města (`src/game/passengers.ts`):

```ts
// Měsíční příliv cestujících na nástupiště z části města v dosahu
monthlyPassengers(station: Station): number {
  let sum = 0;
  for (const [town, share] of this.townShares(station)) {
    const travelling = town.population + Math.min(town.population, PASSENGERS_BOOSTED_RESIDENTS);
    sum += travelling * PASSENGERS_MONTHLY_SHARE * share;
  }
  return sum;
}
```

Za `Math.min(town.population, PASSENGERS_BOOSTED_RESIDENTS)` je zajímavý příběh (commit `0659ca2`):
na začátku hry jsou města malá a osobní doprava vydělávala mnohem méně než uhlí. Prvních 3 000
obyvatel proto cestuje dvakrát častěji – malé město pošle dvojnásobek, velké město bonus skoro
nepozná.

Výpočet podílů je drahý (všechny budovy × všechna nástupiště), a tak se cachuje podle kurzoru logu
změn mapy – přepočítá se jen tehdy, když se na mapě něco změnilo:

```ts
private refreshReach(): void {
  const { map } = this.game.world;
  if (this.reachVersion === map.changeCursor) return;
  this.computeReach();
  this.reachVersion = map.changeCursor;
}
```

Commit `c5729ee` uvádí, že tímhle trikem kleslo denní generování cestujících (18 nástupišť) z 0,70 ms
na 0,04 ms.

Při výměně ve stanici se počítá i s cestujícími, kteří nevystoupili: jejich ujetá vzdálenost
a čas nástupu se zprůměrují s nově nastoupivšími do jedné „společné jízdenky“:

```ts
// Kdo nevystoupil, jede dál; jeho cesta se započte poměrně do společné jízdenky
const total = staying + boarding;
train.boardedAt = total > 0 ? (staying * train.boardedAt + boarding * game.clock.now) / total : game.clock.now;
train.tiles = total > 0 ? Math.round((staying * train.tiles) / total) : 0;
```

### 6. Hodnocení stanice

Hodnocení 0–1 (jako v OpenTTD) určuje, kolik cestujících na stanici přijde a kolik jich odejde.
Cílová hodnota se skládá ze tří částí (`src/game/rating.ts`):

| Část | Body | Konstanta |
| --- | --- | --- |
| doba od posledního vlaku | 0,4 / 0,3 / 0,2 / 0,1 do 10/20/30/45 dnů | `RATING_VISIT_TIERS` |
| rychlost posledního vlaku | až 0,3 (plné body od 10 dlaždic/den) | `RATING_SPEED_POINTS` |
| počet čekajících | 0,3 / 0,2 / 0,1 do 50/150/300 | `RATING_WAITING_TIERS` |

Skutečné hodnocení se k cíli posouvá jen pomalu, nejvýš o 1 % denně, takže jeden zpožděný vlak
stanici nezničí:

```ts
// Denní posun hodnocení k cíli, nejvýš o RATING_DAILY_CHANGE
export function updateRating(station: Station, cargo: Cargo, now: number): void {
  const entry = station.ratings[cargo];
  const delta = targetRating(station, cargo, now) - entry.rating;
  entry.rating += Math.max(-RATING_DAILY_CHANGE, Math.min(RATING_DAILY_CHANGE, delta));
}

// Násobek přílivu cestujících: při 50 % beze změny, při 100 % o polovinu víc
export function inflowFactor(rating: number): number {
  return 0.5 + rating;
}
```

Hodnocení je zvlášť pro každý druh nákladu (commit `6d43c80`) – stanice může mít výborné hodnocení
pro cestující a mizerné pro uhlí.

### 7. Náklad jako data

Commit `0eae4a5` přepsal uhlí (první prototyp) na obecný systém: druh nákladu je položka v tabulce,
ne kód. Komentář v `src/game/cargo.ts` to říká přímo:

```ts
// Druhy nákladu: přidání dalšího je položka v FREIGHT_TYPES, CARGOS a v INDUSTRY_TYPES (kdo ho vyrábí a přijímá)
export type FreightType = 'mail' | 'coal' | 'wood' | 'oil' | 'iron-ore' | 'steel' | 'goods' | 'grain' | 'food';
export type Cargo = 'passengers' | FreightType;
```

Každý `CargoSpec` nese jméno, jednotku, tvary pro české věty („ruda 12 t“, „výkup rudy“), tabulku
sazeb, modely vagonů a barvu do grafů. Řetězce (důl → elektrárna, les → pila → továrna → zboží
do města) pak vzniknou jen tím, že `INDUSTRY_TYPES` řekne, kdo co vyrábí a kdo co přijímá.

### 8. Růst měst a živý průmysl

Na konci roku (`Game.onYearEnd`) se uzavře statistika, spočte hodnocení společnosti a každé město
povyroste:

```ts
export function growTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  redevelopCentre(town, year, rng);
  const rate = town.served ? TOWN_GROWTH_SERVED : TOWN_GROWTH_BASE;
  town.population = Math.round(town.population * (1 + rate));
  expandTown(map, town, year, rng);
}
```

Obsluhované město (`served` nastaví každá výměna cestujících ve stanici v dosahu) roste o 5 % ročně,
neobsluhované jen o 0,5 %. Populace je navíc shora omezená kapacitou budov, takže město musí
nejdřív postavit domy (a od roku 2010 přestavovat centrum na mrakodrapy). Po růstu přijde
`townsChanged` a `GameView` přestaví budovy (viz [díl 06](06-instancing-a-draw-cally.md)).

Průmysl se mění měsíčně (`src/game/industryLife.ts`): se 4% pravděpodobností těžba stoupne nebo
klesne o faktor 1,5 – dobře obsluhovaný závod (odvoz ≥ 60 %) roste s pravděpodobností 2/3, ostatní
1/3. Vytěžený důl se zavře, zpracovatel bez dodávek po pěti letech také, a občas vznikne nový závod:

```ts
// Těžba občas stoupne nebo klesne; z vytěženého závodu se stane zase louka
private changeProduction(industry: Industry): void {
  const { game } = this;
  const range = INDUSTRY_TYPES[industry.kind].production;
  if (!range || !game.rng.chance(INDUSTRY_CHANGE_CHANCE)) return;
  const share = industry.production > 0 ? industry.lastTransported / industry.production : 0;
  const growth = share >= INDUSTRY_WELL_SERVED ? INDUSTRY_GROWTH_CHANCE.served : INDUSTRY_GROWTH_CHANCE.unserved;
  // …
}
```

Všechna náhoda jde přes `game.rng`, tedy vlastní proud odvozený ze seedu. Proto je uložená a znovu
načtená hra deterministická (viz test níže).

### 9. Ukládání do JSON

Uložení je obyčejný JSON, který si hráč stáhne jako soubor, nebo ho hra uloží do `localStorage`
jako autosave. Struktura `SaveData` (`src/game/save.ts`) obsahuje mapu, města, průmysl, koleje,
vlaky, auta, finance, stav hodin, stav generátoru náhody a pohled kamery.

**Velká binární pole jako Base64.** Mapa 512×512 má 262 144 dlaždic. Jako JSON pole čísel by to bylo
přes megabajt; jako Base64 z `Uint8Array` je to třetina:

```ts
function encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
```

Po kouscích (`0x8000`) proto, že `String.fromCharCode(...pole)` s 262 tisíci argumenty by přetekl
zásobník. `owner` je `Int16Array`, takže se kóduje přes jeho `buffer` jako bajty.

**Verze a migrace.** Hra se vyvíjela rychleji než formát uložení, takže každé rozšíření zvedlo
verzi. Historie je přímo v komentáři:

```ts
// 2: úvěr, historie let a rozpad výdajů; 3: hodnocení nástupišť; 4: stáří vlaků; 5: návěstidla; 6: průmysl;
// 7: nákladní doprava uhlí; 8: čekání na plné naložení; 9: náklad podle druhů (dřív jen uhlí); 10: dodávky závodům;
// 11: den poslední dodávky; 12: hodnocení podle nákladu; 13: silniční doprava; 14: zemědělský řetězec
const SAVE_VERSION = 14;
```

Nová pole jsou v `SaveData` volitelná (`view?`, `roadFleet?`, `industries?`) a `restoreGame()` je
při chybějící hodnotě doplní výchozí. Verze 1 se liší strukturou, takže má vlastní migraci
`migrateV1()`.

**Data od uživatele se nevěří.** Soubor může být poškozený nebo podvržený, proto `parseSave()`
ověří strukturu dřív, než cokoli použije:

```ts
// Kontrola struktury souboru; data pochází od uživatele, proto se neověřené nepoužijí
export function parseSave(text: string): SaveData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platný JSON.');
  }
  // …
  const size = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_MAP_SIZE;
  if (!size(map.width) || !size(map.height)) throw new Error('Neplatná velikost mapy.');
  // …
}
```

A `decode()` zkontroluje, že Base64 má přesně tolik bajtů, kolik má mapa dlaždic. Bez toho by
`map.tiles.set()` buď spadl, nebo tiše načetl půl mapy. Podobně `validView()` zahodí nesmyslný pohled
kamery a zbytek hry se načte.

**Pohled kamery** (commit `cf3253a`) je `ViewState { x, z, zoom, rotation }`. `IsoCamera` ho
vystavuje přes getter `view` a `GameView.frame()` ho každý snímek kopíruje do `game.view`, takže je
při ukládání vždy aktuální. Po načtení se obnoví přes `camera.restore()` (viz
[díl 02](02-izometricka-kamera.md)).

### 10. Spuštění hry přes reload

Přechod z úvodní obrazovky do hry, načtení souboru i návrat do menu se dělají **reloadem stránky**.
Volba se předá přes `sessionStorage` (`src/game/launch.ts`):

```ts
// Předání volby z úvodní obrazovky do hry přes reload stránky
const LAUNCH_KEY = 'ttd-launch';
// …
export function launch(intent: LaunchIntent): void {
  sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(intent));
  location.assign(location.pathname);
}
```

Proč tak „primitivně“? WebGL kontext, tisíce geometrií, textury, posluchači událostí – uklidit
po jedné hře všechno ručně (`dispose()` všude) je pracné a chybové. Reload uvolní všechno najednou
a nová hra začne z čistého stavu. `main.ts` si záměr vyzvedne přes `takeLaunchIntent()` (a hned ho
smaže, aby F5 nespustilo hru znovu).

Autosave do `localStorage` je obalený `try/catch`, protože velká mapa může překročit kvótu úložiště:

```ts
export function writeAutosave(game: Game, seedText: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeGame(game, seedText)));
  } catch {
    // Plné úložiště (velká mapa) nesmí shodit hru; pokračování pak jen nebude k dispozici
  }
}
```

## Úskalí

- **Tabulka ze zadání nesedí.** Viz commit `750df19`: jedna jízda by vydělala víc než celá trať.
  Ponaučení: čísla ze zadání ber jako poměry, absolutní hodnoty si změř simulací.
- **Náklad se nevyplácel.** Commit `824d860` naměřil, že uhelný vlak vydělá jen ~40 % osobního
  (náklad jede jen jedním směrem). Sazby se přepočítaly v poměru základních cen OpenTTD a test hlídá,
  aby uhlí zůstalo v rozmezí 70–130 % cestujících.
- **Rychlost ×8 zmizela.** Commit `0d79d89` přidal rychlost ×8, `43f3f7a` („úpravy pro zasekávání,
  pryč ×8“) ji zase odebral ve stejném commitu, který řešil zasekávání městských aut. Velký krok
  času za snímek je obecně zkouška, jestli simulace nepočítá s „malým dt“ – auto se za jeden snímek
  posune dál a snáz „přeskočí“ místo, kde mělo zastavit.
- **Pořadí posluchačů.** `IndustryLife` se musí vytvořit až po `Freight`, jinak měsíční změna těžby
  vidí odvoz z minulého měsíce.
- **Rozpracovaná stavba.** Koleje se staví postupně (`PIECES_PER_SECOND = 25` v `construction.ts`),
  takže uložení uprostřed stavby by ji ztratilo. Commit `cd47d57` přidal frontu staveb do uložení.

## Scénář videa

1. **Problém dt:** ukázat, co by se stalo s pohybem „o kus za snímek“ na 60 a 144 Hz (dvě čáry
   na tabuli).
2. **GameClock:** projít `tick()` a `advanceDay()`, zdůraznit strop `MAX_FRAME_MS` a demonstrovat ho
   schováním tabu.
3. **Emitter:** napsat ho naživo (20 řádků), ukázat, jak TypeScript odhalí špatný argument.
4. **Propojení:** `GameEvents` vedle posluchačů v `GameView` – logika neví o 3D scéně.
5. **Ekonomika:** postavit trať mezi dvěma městy, ukázat zprávu o výdělku a vysvětlit vzorec
   `počet × dlaždice × sazba`.
6. **Dosah a hodnocení:** náhled dosahu nástupiště při stavbě, okno stanice s hodnocením.
7. **Vyvážení:** citovat commit `750df19` – proč čísla ze zadání nefungovala.
8. **Ukládání:** uložit, otevřít JSON v editoru (Base64 mapa, verze), načíst. Pak ručně rozbít
   soubor a ukázat chybovou hlášku.
9. **Determinismus:** ukázat test „obnovená hra pokračuje stejně jako originál“.

## Cvičení

- Napište test, který ověří, že při rychlosti ×2 trvá rok 7,5 minuty (inspirace v
  `src/game/clock.test.ts`).
- Přidejte do `FARE_TIERS` čtvrté pásmo (např. do 15 dnů sazba 12) a sledujte, jak se změní
  výdělek rychlých vlaků.
- Přidejte do `GameEvents` událost `trainArrived` a zobrazte ji v HUD. Kde ji vyhlásit, aby logika
  pořád nevěděla o UI?
- Projděte `src/game/save.test.ts` – test „obnovená hra pokračuje stejně jako originál“ simuluje dvě
  hry vedle sebe. Co by se stalo, kdyby se do uložení zapomněl `rngState`?
