# Díl 08 – Vlaky na kolejích: trasa, souprava, brzdění a rezervace

> **Soubory:** `src/world/route.ts`, `src/game/trains.ts` (`Fleet`), `src/game/reservations.ts`,
> `src/render/trains.ts`, `src/render/signals.ts`, `src/render/crossings.ts`, `src/game/balance.ts`
> **Commity:** `a92a4e6` (Fáze 5: vlaky), `784ac20` (Fáze 16a: rezervace kolejí),
> `7fb842e` (Fáze 16b: návěstidla), `b248696` (volná kolej a vzájemné zablokování),
> `cde0d03` (počet vagonů podle nástupiště), `94bc5f4` (úpravy vláčku – lokomotiva vždy v čele), `779608f` (přejezdy se závorami)

## O čem je tento díl

Máme koleje z [dílu 07](07-stavba-koleji.md). Teď po nich pošleme vlaky:

- zvolíme reprezentaci, ve které je **poloha vlaku jedno číslo**, a z něj spočítáme bod ve 3D,
- vykreslíme soupravu z modelů train kitu tak, aby **vagony v zatáčkách sledovaly kolej**,
- naučíme vlak plynule **rozjet a zabrzdit** přesně na konci nástupiště,
- zabráníme vlakům projíždět skrz sebe **rezervacemi kolejí** a rozdělíme trať **návěstidly**,
- poznáme **vzájemné zablokování** a ukážeme, jak vizuální prvky (světla návěstidel, závory)
  čtou stav simulace.

Tenhle díl je dobrou ukázkou rozdělení `game/` a `render/` z [dílu 00](00-uvod.md): celá jízda je
čistá logika nad čísly, renderer jen převádí čísla na polohy a natočení modelů.

## Teorie

### Trasa jako křivka parametrizovaná délkou

Trasa vlaku je posloupnost **průjezdů kusy koleje** – každý průjezd ví, kterou hranou se do
dlaždice vjelo a kterou vyjelo:

```ts
// Průjezd jedním kusem koleje od vstupní k výstupní hraně
export interface Segment {
  x: number;
  y: number;
  piece: number;
  entry: Edge;
  exit: Edge;
}
```

Každý segment je úsečka mezi středy dvou hran (délka 1 nebo √½). Celá trasa je tedy lomená
čára a polohu na ní popíše jediné číslo – **vzdálenost od začátku** `d`:

```
 začátek                                                    konec
   ●──────1──────●──────1──────●─0,71─●─0,71─●──────1──────●
   d=0           1             2      2,71   3,41          4,41
                                  ▲
                         train.pos = 2,3  →  bod na 3. segmentu, t = 0,3 / 0,71
```

Vlak si pamatuje `path` a `pos` (vzdálenost **hlavy** od začátku trasy). Pohyb je pak triviální:
`pos += rychlost × čas`. Kde je který vagon, se spočítá odečtením délky vozů.

Této technice se v grafice říká *parametrizace délkou oblouku* a používá se všude, kde něco jede
po křivce (kamera po kolejnici, auta po silnici, částice po spline).

### Natočení vozu ze dvou podvozků

Kdyby se vůz natočil podle směru segmentu pod svým středem, v zatáčce by se otočil skokem o 45°.
Skutečný vagon má dva podvozky a karoserie leží na spojnici mezi nimi:

```
                    zadní podvozek          přední podvozek
   kolej  ─────────────●─────────────────────────●───────╲
                       b = pos − 0,18            f = pos + 0,18  ╲
                       └──────── karoserie ──────┘
          střed vozu = (f + b) / 2      natočení = atan2(f.x − b.x, f.z − b.z)
```

Oba podvozky jsou na trase (`pointAt`), takže sledují kolej i v zatáčce, a karoserie se mezi nimi
natáčí plynule. Střed vozu přitom leží trochu „uvnitř“ oblouku – přesně jako u skutečného vlaku.

### Rozjezd a brzdná dráha

Konstantní zpomalení `a` a rychlost `v` dávají brzdnou dráhu (z rovnic rovnoměrně zrychleného
pohybu):

```
  s = v² / (2a)        a naopak       v_max = √(2 · a · s)
```

Druhý vzorec je klíčový: když vlak ví, že mu zbývá `s` dlaždic do konce rezervované koleje
(nebo do konce nástupiště), nesmí jet rychleji než `√(2as)`. Pak ho stačí každý snímek omezit
na minimum ze tří hodnot – „zrychluji“, „maximální rychlost lokomotivy“, „ještě stihnu
zabrzdit“ – a zastaví přesně v cíli bez jakéhokoli plánování brzdění.

```
 rychlost
    │    ┌──────────────────────┐ v_max lokomotivy
    │   ╱                        ╲
    │  ╱ a·t                      ╲  √(2a·zbývá)
    │ ╱                            ╲
    └──────────────────────────────●── dráha
                                  cíl
```

### Rezervace bloků

Na skutečné železnici smí do úseku (bloku) vjet jen jeden vlak. Hra to dělá tak, že vlak si
**rezervuje dlaždice** před sebou. Bez návěstidel celou trasu až do cíle, s návěstidly jen úsek
k nejbližšímu návěstidlu. Za koncem soupravy dlaždice uvolňuje. Na cizí rezervaci nevjede.

## Implementace

### 1. Bod na trase

`src/world/route.ts` – bod na segmentu je lineární interpolace mezi středy hran, bod na trase se
najde odečítáním délek:

```ts
export function segmentPoint(s: Segment, t: number): [number, number] {
  const [ax, ay] = EDGE_MID[s.entry];
  const [bx, by] = EDGE_MID[s.exit];
  return [s.x + ax + (bx - ax) * t, s.y + ay + (by - ay) * t];
}

// Bod ve vzdálenosti d od začátku trasy (ořezaný na rozsah trasy)
export function pointAt(path: readonly Segment[], d: number): [number, number] {
  let rest = Math.max(0, d);
  for (const s of path) {
    const len = segmentLength(s);
    if (rest <= len) return segmentPoint(s, rest / len);
    rest -= len;
  }
  const last = path[path.length - 1];
  return segmentPoint(last, 1);
}
```

`pointAt` je O(n) v délce trasy. Pro trasy o stovkách kusů a desítky vlaků to stačí; kdyby ne,
předpočítaly by se kumulativní délky a hledalo by se půlením intervalu.

Trasa k cíli se hledá A* **jen po existujících kolejích** (`findRoute`) se stejným stavem
(dlaždice, vstupní hrana, směr) jako při stavbě v dílu 07 a pak se prodlouží přes celé nástupiště
(`extendThroughStation`), aby souprava zastavila čelem na jeho konci.

### 2. Souprava ve 3D

Modely z train kitu jsou dlouhé asi 2,6 jednotky podél +Z, ve hře má vůz délku
`VEHICLE_LENGTH = 0.5` dlaždice:

```ts
// Modely z train kitu jsou dlouhé ~2,6 jednotky podél +Z
const SCALE = VEHICLE_LENGTH / 2.75;
const RAIL_TOP = 0.06;
// Vzdálenost podvozků od středu vozu
const BOGIE = 0.18;
```

(Dělí se 2,75, tedy o kus víc než délkou modelu – vůz je tak o něco kratší než `VEHICLE_LENGTH`
a mezi vozy zůstane malá mezera.)

Každý vlak je `THREE.Group` s klony modelů (`loadModel` z [dílu 05](05-modely-glb.md)) –
lokomotiva, vagony a k nim „světla“ pro noc. Umístění každý snímek (`TrainsView.place`):

```ts
for (let i = 0; i < count; i++) {
  // Lokomotiva jede vždy v čele, i po otočení ve stanici
  const vehicle = view.vehicles[i];
  const center = train.pos - (i + 0.5) * VEHICLE_LENGTH;
  const [fx, fz] = pointAt(train.path, center + BOGIE);
  const [bx, bz] = pointAt(train.path, center - BOGIE);
  const x = (fx + bx) / 2;
  const z = (fz + bz) / 2;
  const y = RAIL_TOP + (this.map.isType(Math.floor(x), Math.floor(z), TileType.Bridge) ? BRIDGE_DECK : 0);
  vehicle.position.set(x, y, z);
  vehicle.rotation.y = Math.atan2(fx - bx, fz - bz);
  // Vozy ještě (nebo už) v depu nejsou vidět
  vehicle.visible =
    center > 0 &&
    this.map.get(Math.floor(x), Math.floor(z)) !== TileType.Depot &&
    inView(frustum, x, y, z, VEHICLE_LENGTH);
}
```

- **`atan2(dx, dz)` a ne `atan2(dz, dx)`** – model míří po +Z a `rotation.y = 0` znamená „dopředu
  je +Z“. Úhel měřený od osy Z je `atan2(x, z)`.
- **Výška na mostě** – stejný `BRIDGE_DECK` jako u geometrie mostu.
- **Viditelnost** – vůz, který ještě nevyjel z depa (`center > 0`, nebo stojí na dlaždici depa),
  se schová. Vůz mimo záběr kamery taky (`inView` z `camera.ts` testuje kouli proti frustu,
  [díl 17](17-optimalizace-a-lod.md)) – skrytý objekt three.js vůbec neprochází.

Když se změní model lokomotivy, počet vagonů nebo druh nákladu (`trainKey`), souprava se postaví
znovu. Náklad je vidět jen u naložených vagonů – model vagonu má díl pojmenovaný `cargo`
a ten se zapíná podle obsazenosti; ocelářské plošiny dostanou plechy z kvádrů (`addSteelLoad`).

Kliknutí na vlak řeší `TrainsView.pick`: raycast do skupiny všech vlaků a dohledání, do které
soupravy zasažený mesh patří (procházením `parent`).

### 3. Pohyb: zrychlení, brzdná křivka, rezervace

Rychlosti jsou v **dlaždicích za herní den** (parní lokomotiva `speed: 3.0`), zrychlení
i zpomalení v dlaždicích za den za den. `Fleet.update(days)` dostane, kolik herních dní uplynulo
za snímek ([díl 09](09-cas-ekonomika-ukladani.md)), a pro jedoucí vlaky volá `move`:

```ts
// Zrychlení a brzdění v dlaždicích za den za den
const ACCELERATION = 2;
const DECELERATION = 2;

private move(train: Train, days: number): void {
  const model = trainModel(train);
  const { reservations } = this;
  const pathEnd = pathLength(train.path);
  // Rezervace musí sahat aspoň na brzdnou dráhu a krok tohoto snímku před hlavu
  const needed = train.pos + (model.speed * model.speed) / (2 * DECELERATION) + model.speed * days + 1;
  while (!reservations.fullyReserved(train) && reservations.limit(train) < needed && reservations.extend(train));
  const limit = Math.min(pathEnd, reservations.limit(train));
  const remaining = Math.max(0, limit - train.pos);
  const brakeLimit = Math.sqrt(2 * DECELERATION * remaining);
  train.speed = Math.min(train.speed + ACCELERATION * days, model.speed, brakeLimit);
  // Minimální rychlost, aby brzdění vlak nezastavilo těsně před cílem
  train.speed = Math.max(train.speed, 0.15);
  const step = train.speed * days;
  // …
  if (step < remaining) {
    train.pos += step;
    // … započítat ujeté dlaždice, uvolnit koleje za vlakem
    reservations.sync(train, this.tail(train));
    return;
  }
  train.pos += remaining;
  train.speed = 0;
  if (limit < pathEnd - 1e-6) {
    // dojel na konec rezervace, ne na konec trasy → čeká
    reservations.sync(train, this.tail(train));
    this.wait(train, days);
    return;
  }
  this.arrive(train);
}
```

Projděme řádky s fyzikou:

1. `needed` = kde je hlava + brzdná dráha při plné rychlosti (`v²/2a`) + krok tohoto snímku
   + rezerva 1 dlaždice. Vlak si rezervuje úseky, dokud nemá rezervováno aspoň sem. Rychlá
   lokomotiva (5,2 dlaždice/den → brzdná dráha 6,76 dlaždice) si proto bere víc úseků dopředu
   než parní (3,0 → 2,25 dlaždice).
2. `limit` = kam smí hlava dojet: konec trasy, nebo konec rezervace, co je blíž.
3. `brakeLimit = √(2a · zbývá)` – vzorec z teorie.
4. `min(zrychlení, max. rychlost, brzdná křivka)` – celé „řízení“ vlaku je jeden řádek.
5. Minimální rychlost 0,15 – bez ní by se vlak k cíli asymptoticky blížil, protože √ u nuly
   klesá k nule a poslední milimetry by trvaly věčnost.

Rychlost je přitom **herní**, ne snímková: při zrychlení hry na ×4 je `days` za snímek čtyřikrát
větší, vlak jede čtyřikrát rychleji a vzorce fungují beze změny. Jediná past: velký krok `days`
by mohl „přeskočit“ cíl – proto se krok porovnává s `remaining` a dojede se přesně na limit.

### 4. Rezervace a návěstidla

`src/game/reservations.ts` drží mapu `dlaždice → id vlaku`. Rezervace dalšího úseku:

```ts
// Zkusí zarezervovat další úsek; vrací false, když je obsazený nebo už není kam
extend(train: Train): boolean {
  const { path } = train;
  const start = this.reach.get(train.id) ?? 0;
  if (start >= path.length) return false;
  let end = start;
  while (end < path.length - 1 && !this.isWaitPoint(path[end].x, path[end].y)) end++;
  for (let i = start; i <= end; i++) {
    if (this.blocks(train, path[i].x, path[i].y)) return false;
  }
  // … zapsat vlastníka všech dlaždic start..end
  this.reach.set(train.id, end + 1);
  return true;
}
```

Úsek končí na nejbližším **místě, kde se dá čekat** (`isWaitPoint`), což je dlaždice
s návěstidlem – `Fleet` vytváří rezervace jako `new Reservations(width, (x, y) => rail.hasSignal(x, y))`.
Úsek se rezervuje **celý, nebo vůbec** – kdyby vlak zabral půlku úseku a zastavil uprostřed
výhybky, zablokoval by i křížící trasy. Ze stejného důvodu jde návěstidlo postavit jen na
samostatnou rovnou kolej bez výhybky (`canPlaceSignal`).

`sync` po každém pohybu přepočítá, co vlak drží: od konce soupravy po konec rezervace. Dlaždice
za koncem vlaku se uvolní a může na ně vjet další vlak.

```
  bez návěstidel:   [■■■■■■■■■■■■■■■■■■■■■■■■■■■■] celá trasa → za vlakem nikdo nejede
  s návěstidly:     [■■■■■■■]|  volno  |  volno  |   → za vlakem může jet další
                         ▲ návěstidlo
```

Rezervace se neukládají do uložené hry – po načtení si je vlaky vezmou znovu
(`if (!this.reservations.has(train)) this.reservations.reset(…)` v `Fleet.update`).

### 5. Čekání, jiná kolej a vzájemné zablokování

Vlak stojící před obsazenou tratí každé 3 dny (`BLOCKED_REPLAN_DAYS`) zkusí najít jinou cestu.
Hledání trasy dostane funkci `avoid`, která zakáže cizí rezervace – vlak tak na vícekolejném
nástupišti najde volnou kolej. Commit `b248696` opravil jemnou chybu: kolej nástupiště, na které
jiný vlak stál jen v zadní části, se brala jako volná – jenže trasa končí až na konci nástupiště,
takže vlak čekal za stojícím vlakem. Teď se kolej s jakýmkoli cizím vlakem bere jako obsazená celá
(`avoidFor`).

Dva vlaky proti sobě na jednokolejce se nemají kde minout. Hra to pozná hledáním **cyklu
v grafu „kdo na koho čeká“**:

```ts
// Vlaky, které na sebe čekají v kruhu (A čeká na B, B na A…); bez pomoci hráče se nepohnou
private deadlockCycle(train: Train): Train[] | null {
  const cycle: Train[] = [train];
  let current = train;
  for (let i = 0; i < this.trains.length; i++) {
    const id = this.reservations.blockerOf(current);
    const next = this.trains.find((t) => t.id === id);
    if (!next || !this.blocked.has(next.id)) return null;
    if (next === train) return cycle;
    if (cycle.includes(next)) return null;
    cycle.push(next);
    current = next;
  }
  return null;
}
```

Každý čekající vlak má nejvýš jednoho „blokujícího“ (`blockerOf` – vlastník první obsazené
dlaždice dalšího úseku), takže graf je funkcionální a cyklus se najde prostým sledováním
ukazatelů. Hráč pak dostane zprávu, které vlaky se blokují a co postavit (výhybnu nebo
dvoukolejné nástupiště).

### 6. Otočení ve stanici

Vlak v koncové stanici musí jet zpátky. `replan` zkusí dvě trasy – vpřed z konce soupravy
a vzad z jejího začátku – a vybere kratší:

```ts
const body = this.body(train);
const offset = train.pos - trainLength(train) - this.bodyStart(train);
const forward = this.routeTo(segmentStart(body[body.length - 1]), goal, train);
const reversed = body.map(reverseSegment).reverse();
// Ve stanici nebo bez cesty vpřed se vlak může otočit
const canReverse = train.state !== 'running' || !forward;
const backward = canReverse ? this.routeTo(segmentStart(reversed[reversed.length - 1]), goal, train) : null;

const useBackward = backward && (!forward || pathLength(backward) < pathLength(forward));
if (useBackward) {
  train.path = [...reversed, ...backward];
  // Lokomotiva přejede na druhý konec soupravy a vlak vyjede jí napřed
  train.pos = pathLength(body) - Math.max(0, offset);
  train.speed = 0;
}
```

Otočení je čistě datová operace: kusy pod vlakem se obrátí (prohodí `entry`/`exit`
a pořadí) a `pos` se přepočítá tak, aby hlava byla na druhém konci soupravy. Renderer nic
speciálního nedělá – lokomotiva je vždy vůz č. 0 na pozici `pos`, takže se „přesune“ na druhý
konec. Ve Fázi 5 se vlak otáčel jako souprava s řídicím vozem (lokomotiva zůstala vzadu a tlačila,
příznak `flipped`); commit `94bc5f4` (úpravy vláčku) příznak odstranil a zavedl dnešní chování.

### 7. Vizuální zpětná vazba: návěstidla a přejezdy

Renderer stav rezervací jen čte. Návěstidla jsou dva InstancedMeshe (sloupky a světla) a barva
světla se nastavuje přes `instanceColor` každý snímek:

```ts
// Barvy podle toho, zda dlaždici návěstidla drží nějaký vlak
update(isReserved: (x: number, y: number) => boolean): void {
  if (!this.lamps.instanceColor) return;
  this.tiles.forEach(({ x, y }, i) => this.lamps.setColorAt(i, isReserved(x, y) ? RED : SIGNAL_GREEN));
  this.lamps.instanceColor.needsUpdate = true;
}
```

Světlo má `MeshBasicMaterial` – neosvětlený materiál, takže svítí stejně ve dne i v noci.
Sloupek stojí kolmo vedle středu kusu koleje na straně blíž ke středu dlaždice (`place`:
normála ke směru kusu × `SIDE_OFFSET`).

Přejezdy (`CrossingsView`) používají stejný dotaz. Rezervace přejezdové dlaždice vlakem =
závory dolů a střídavé blikání:

```ts
const blink = Math.floor(now / BLINK_MS) % 2;
for (const [i, view] of this.views) {
  const closed = isClosed(i % this.map.width, Math.floor(i / this.map.width));
  const target = closed ? 0 : Math.PI / 2;
  const step = ARM_SPEED * dt;
  view.angle += Math.max(-step, Math.min(step, target - view.angle));
  for (const arm of view.arms) arm.rotation.z = view.angle;
  view.lamps[0].color.set(closed && blink === 0 ? LAMP_ON : LAMP_OFF);
  view.lamps[1].color.set(closed && blink === 1 ? LAMP_ON : LAMP_OFF);
}
```

Závora se nepřepne skokem, ale otáčí se konstantní úhlovou rychlostí k cíli (`clamp(target −
angle, −step, step)`) – nejjednodušší plynulá animace bez easingu. A protože se rezervace dělá
na brzdnou dráhu dopředu, závory se zavřou s předstihem, než vlak dorazí. Auta před zavřeným
přejezdem stojí ([díl 11](11-zivot-ve-meste.md)).

V `GameView.frame()` se to propojí dvěma řádky:

```ts
const { reservations } = this.game.fleet;
this.signals.update((x, y) => reservations.ownerAt(x, y) !== undefined);
this.crossings.update(seconds * 1000, (x, y) => reservations.ownerAt(x, y) !== undefined);
```

## Úskalí

- **Vlaky jezdily skrz sebe** (do `784ac20`): bez rezervací šlo na jednu trať pustit libovolně
  vlaků. Rezervace celé trasy to vyřešila, ale zároveň omezila trať na jeden vlak – proto hned
  následovala návěstidla (`7fb842e`).
- **Rezervace kratší než brzdná dráha** by znamenala, že vlak uvidí obsazený úsek pozdě
  a „zabrzdí“ skokem. Proto `needed` počítá s `v²/2a`.
- **Asymptotické dojíždění** bez minimální rychlosti.
- **Vlak delší než nástupiště** (`cde0d03`): souprava zastaví čelem na konci nástupiště
  a nakládají jen vagony, které na něm stojí (`wagonsAtStation` – zase přes `pointAt`).
- **Natočení podle segmentu místo podvozků** – skoky o 45° v zatáčkách. Podvozky jsou levné
  řešení, které vypadá věrohodně.
- **Uložená hra a rezervace**: ukládat je by znamenalo verzovat další strukturu. Jednodušší je
  je po načtení obnovit z poloh vlaků.

## Scénář videa

1. **Hook:** dva vlaky za sebou na trati s návěstidly, červená/zelená světla, závory na přejezdu.
2. **Trasa jako čísla:** nákres lomené čáry s `d`, kód `pointAt`.
3. **Souprava:** nejdřív natočení podle segmentu (skoky), pak dva podvozky – nákres a kód `place`.
4. **Fyzika:** odvodit `v = √(2as)` na tabuli, graf rychlosti, řádek `Math.min(…)`.
   Ukázat vlak zastavující přesně na konci nástupiště.
5. **Rezervace:** zapnout okno „?“ nad kolejí (ukazuje vlak, který dlaždici rezervuje),
   nákres úseků s návěstidly.
6. **Deadlock:** postavit jednokolejku se dvěma vlaky proti sobě, ukázat zprávu, vysvětlit cyklus.
7. **Otočení ve stanici:** obrácení segmentů a přepočet `pos`.
8. **Zpětná vazba ve scéně:** `instanceColor` u návěstidel, závory s konstantní úhlovou rychlostí.
9. **Outro:** vlaky jezdí, ale zatím zadarmo – příště čas a peníze.

## Cvičení

- Změňte `BOGIE` na 0 a pozorujte vozy v zatáčce. Pak na 0,24 – co se stane s mezerami mezi vozy?
- Přidejte do vlaku „setrvačnost“ při rozjezdu: zrychlení klesající s rychlostí
  (`ACCELERATION * (1 - speed / model.speed)`). Jak se změní jízdní doby?
- Upravte `SignalsView`, aby návěstidlo svítilo žlutě, když je obsazený až **následující** úsek
  (předvěst).
- Přepište `pointAt` na verzi s předpočítanými kumulativními délkami a binárním hledáním
  a změřte rozdíl na trase o 1 000 kusech.
- Zkuste do `deadlockCycle` přidat vlak, který neblokuje nikoho – proč algoritmus skončí
  nejpozději po `trains.length` krocích?
