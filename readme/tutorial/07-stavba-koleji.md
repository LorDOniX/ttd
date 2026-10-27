# Díl 07 – Stavba kolejí a silnic: kusy, atlas, picking a A*

> **Soubory:** `src/world/rail.ts` (`PIECES`, `canPlace`), `src/world/railPath.ts`, `src/world/roadPath.ts`,
> `src/world/heap.ts`, `src/render/rail.ts`, `src/render/roads.ts`, `src/render/preview.ts`,
> `src/render/cursor.ts`, `src/ui/buildTools.ts`, `src/game/construction.ts`, `src/screens/game.ts` (`tileAt`)
> **Commity:** `5d8dbee` (Fáze 4: stavba železnice), `65777fe` (demolice, silnice, přejezdy),
> `4c977cb` (mosty), `37e2e18` (zábradlí), `67dc992` (jeden dílek kliknutím),
> `4a0562b` (silnice jako koleje), `217abac` (velká nástupiště tažením)

## O čem je tento díl

Hráč táhne myší po mapě a za kurzorem se objevuje zelený náhled trati, která se sama vyhýbá
budovám, napojuje se na existující koleje a přes řeku staví most. V tomhle dílu:

- navrhneme **datový model kolejí** převzatý z OpenTTD (6 kusů na dlaždici),
- poskládáme z kvádrů **geometrii kusů** – štěrk, pražce, kolejnice, mostovky s pilíři,
- nakreslíme **silnice texturovým atlasem**, který si vyrobíme sami v `<canvas>`,
- převedeme polohu myši na dlaždici a **část dlaždice** (picking),
- ukážeme **poloprůhledný náhled** stavby,
- napíšeme **A\*** nad stavy (dlaždice, vstupní hrana, směr) s cenou, která dělá „rozumné“ trasy.

## Teorie

### Kusy koleje místo dlaždic koleje

Nejjednodušší model („na dlaždici je/není kolej“) neumí zatáčky ani diagonály. OpenTTD to řeší
tak, že kolej na dlaždici je **množina kusů** a každý kus spojuje středy dvou hran:

```
     N                     rovné:  N–S  (0)   W–E  (1)
  ┌──●──┐                  rohové: N–E  (2)   E–S  (3)   S–W  (4)   W–N  (5)
  │     │
W ●     ● E               ┌──●──┐   ┌──●──┐   ┌─────┐
  │     │                 │  │  │   │   ╲ │   │     │
  └──●──┘                 │  │  │   │    ╲●   ●──── ●
     S                    └──●──┘   └─────┘   └─────┘
                           N–S        N–E       W–E
```

V kódu je to šest dvojic hran a na dlaždici bitová maska (`Uint8Array pieces`):

```ts
// Kus koleje spojuje středy dvou hran dlaždice; rohové kusy tvoří zatáčky i diagonály
export const PIECES: readonly [Edge, Edge][] = [
  [Edge.N, Edge.S],
  [Edge.W, Edge.E],
  [Edge.N, Edge.E],
  [Edge.E, Edge.S],
  [Edge.S, Edge.W],
  [Edge.W, Edge.N],
];

export function pieceLength(piece: number): number {
  return isCorner(piece) ? Math.SQRT1_2 : 1;
}
```

Rohový kus vede od středu jedné hrany ke středu sousední, tedy po přeponě trojúhelníku s odvěsnami
0,5 → délka √(0,5² + 0,5²) = √½ ≈ 0,707. **Diagonální trať** je schod z rohových kusů, který se
střídá mezi dvěma dlaždicemi – na pohled vypadá jako rovná šikmá čára:

```
   ┌───────┬───────┬───────┐
   │       │       │ ╱     │   dlaždice (2,0): kus W–N v levém horním rohu
   │       │     ╱ │       │   dlaždice (1,0): kus E–S v pravém dolním rohu
   ├───────┼───────┼───────┤
   │       │ ╱     │       │   dlaždice (1,1): kus W–N
   │     ╱ │       │       │   dlaždice (0,1): kus E–S
   └───────┴───────┴───────┘
   rohové kusy se střídají a navazují přes středy hran → přímka pod 45°
```

Velká výhoda: vlak mezi dvěma kusy **nikdy nezatočí o víc než 45°**. Směr jízdy má 8 hodnot
(po 45°) a funkce `turnAllowed` povolí změnu nejvýš o jeden krok. Tentýž model pak použijeme pro
pohyb vlaků v [dílu 08](08-vlaky.md).

### Texturový atlas

Silnice má na dlaždici 16 možných tvarů podle toho, na které ze čtyř stran navazuje (2⁴ = 16).
Místo 16 textur (16 materiálů, 16 draw callů) uděláme **jednu** texturu, kde jsou všechny varianty
vedle sebe, a každá dlaždice si UV souřadnicemi „vystřihne“ tu svou:

```
 maska:   0     1     2     3     4    …    15
        ┌─────┬─────┬─────┬─────┬─────┬───┬─────┐
řádek 0 │  ▪  │  ┃  │  ━  │  ┗  │  ┃  │ … │  ╋  │   obyčejné silnice
        ├─────┼─────┼─────┼─────┼─────┼───┼─────┤
řádek 1 │     │     │     │     │     │ … │ ╋▤▤ │   kopie, křižovatky se zebrami
        └─────┴─────┴─────┴─────┴─────┴───┴─────┘
         u = maska / 16 … (maska + 1) / 16
```

Bity masky: N = 1, E = 2, S = 4, W = 8. Rovná silnice sever–jih je 1 | 4 = 5, křižovatka 15.

### Problém prosakování na hranách

Když GPU čte texturu s lineárním filtrováním přesně na hraně políčka, průměruje sousední texely –
tedy i texely **vedlejší varianty**. Na okraji dlaždice pak prosvítá cizí silnice. Řešení: UV se
posunou o půl texelu dovnitř políčka (inset). A mipmapy, které by při oddálení průměrovaly celé
bloky přes hranice políček, se vypnou.

### A* stručně

A* hledá nejlevnější cestu v grafu. Udržuje prioritní frontu stavů seřazenou podle
`f = g + h`, kde `g` je skutečná cena od startu a `h` odhad do cíle. Pokud odhad nikdy
nepřecení skutečnost (je *přípustný*), je nalezená cesta optimální. Kouzlo je ve dvou volbách:

- **Co je stav.** U kolejí nestačí dlaždice – záleží, odkud vlak přijel a kterým směrem jede
  (aby nezatočil o víc než 45°).
- **Co je cena.** Cena nemusí být délka. Levné existující koleje, dražší mosty a penalizace
  zatáček udělají z „nejkratší“ cesty „nejrozumnější“.

## Implementace

### 1. Geometrie kusu koleje

Kus koleje délky `length` podél osy X, slepený z kvádrů s barvami ve vrcholech
([díl 06](06-instancing-a-draw-cally.md)):

```ts
// Kus koleje délky `length` podél osy X se středem v počátku
function pieceGeometry(length: number): THREE.BufferGeometry {
  const parts = [box(length, 0.03, 0.44, BALLAST, 0, 0, 0)];
  const sleepers = Math.max(2, Math.round(length / 0.125));
  for (let i = 0; i < sleepers; i++) {
    const x = -length / 2 + (i + 0.5) * (length / sleepers);
    parts.push(box(0.06, 0.025, 0.36, SLEEPER, x, 0.03, 0));
  }
  for (const z of [-0.1, 0.1]) parts.push(box(length, 0.03, 0.025, RAIL, 0, 0.055, z));
  return mergeGeometries(parts)!;
}

const STRAIGHT = pieceGeometry(1);
const CORNER = pieceGeometry(Math.SQRT1_2);
```

Rohový kus je **stejná geometrie, jen kratší** (√½). Na místo ho dostane matice, která ho otočí
podle spojnice středů hran a posune do jejího středu:

```ts
function pieceMatrix(x: number, y: number, piece: number, lift: number, target: THREE.Matrix4): THREE.Matrix4 {
  const [a, b] = PIECES[piece];
  const [ax, az] = EDGE_MID[a];
  const [bx, bz] = EDGE_MID[b];
  const angle = Math.atan2(-(bz - az), bx - ax);
  return target.makeRotationY(angle).setPosition(x + (ax + bx) / 2, 0.002 + lift, y + (az + bz) / 2);
}
```

Proč `-(bz - az)`? Rotace kolem Y v three.js je pravotočivá při pohledu shora **proti** ose Y,
takže kladný úhel točí od +X k −Z. Naše „y dlaždice“ roste po +Z, proto znaménko.
Zdvih `0.002` drží kolej nad terénem, aby se s ním „nepraly“ pixely (z-fighting).

Zatáčka tedy není oblouk, ale jeden kratší rovný kus pod 45°. Na styku s rovným kusem vzniká
drobná mezera a překryv štěrku – při izometrickém pohledu to ale skoro není vidět a geometrie
zůstane triviální (a stejná pro zatáčky i diagonály).

### 2. Mosty s pilíři k hladině

Dílek nad vodou je most: mostovka ve výšce `BRIDGE_DECK`, cihlově červené zábradlí
(od commitu `37e2e18`, původní šedé splývalo s kolejí) a pilíře, které sahají až pod úroveň
terénu k hladině:

```ts
export const BRIDGE_DECK = 0.08;
function bridgeGeometry(): THREE.BufferGeometry {
  const parts = [box(1, 0.05, 0.62, BRIDGE, 0, BRIDGE_DECK - 0.05, 0)];
  for (const z of [-0.29, 0.29]) {
    // Ocelové zábradlí: sloupky, madlo a středová tyč
    for (let i = 0; i < 5; i++) parts.push(box(0.03, 0.17, 0.03, BRIDGE_RAIL, -0.4 + i * 0.2, BRIDGE_DECK, z));
    parts.push(box(1, 0.03, 0.035, BRIDGE_RAIL, 0, BRIDGE_DECK + 0.16, z));
    parts.push(box(1, 0.02, 0.025, BRIDGE_RAIL, 0, BRIDGE_DECK + 0.08, z));
  }
  // Pilíře sahají až k hladině pod úrovní terénu
  const pier = BRIDGE_DECK - 0.05 + WATER_DEPTH;
  for (const z of [-0.22, 0.22]) parts.push(box(0.12, pier, 0.12, BRIDGE, 0, -WATER_DEPTH, z));
  return mergeGeometries(parts)!;
}
```

`WATER_DEPTH` je z `terrain.ts` (voda leží 0,06 pod terénem, [díl 03](03-teren.md)). Kolej na
mostě je zvednutá o `BRIDGE_DECK` – viz `lift` v `TrackView.replace`. Totéž musí udělat vlaky
(díl 08) a auta na silničním mostě.

### 3. Atlas silnic z canvasu

Textury silnic se nekreslí v grafickém editoru, ale kódem při startu hry (`createRoadAtlas`
v `src/render/roads.ts`). Každá varianta je obdélník chodníku a menší obdélník asfaltu, s rameny
do stran podle masky:

```ts
// Atlas 16 variant silnice podle propojení se sousedy, kreslený do canvasu
function createRoadAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * VARIANTS;
  canvas.height = CELL * ROWS;
  const ctx = canvas.getContext('2d')!;
  const c = CELL / 2;

  const arms = (mask: number, half: number, ox: number): void => {
    ctx.fillRect(ox + c - half, c - half, half * 2, half * 2);
    if (mask & N) ctx.fillRect(ox + c - half, 0, half * 2, c);
    if (mask & S) ctx.fillRect(ox + c - half, c, half * 2, c);
    if (mask & W) ctx.fillRect(ox, c - half, c, half * 2);
    if (mask & E) ctx.fillRect(ox + c, c - half, c, half * 2);
  };

  for (let mask = 0; mask < VARIANTS; mask++) {
    const ox = mask * CELL;
    ctx.fillStyle = '#b9b8b0';
    arms(mask, CELL * 0.32, ox);
    ctx.fillStyle = '#4d4e54';
    arms(mask, CELL * 0.25, ox);
    // … přerušovaná středová čára jen na rovných úsecích a zatáčkách
  }

  // Druhý řádek je kopie prvního, křižovatky v něm mají zebry
  ctx.setLineDash([]);
  ctx.drawImage(canvas, 0, 0, CELL * VARIANTS, CELL, 0, CELL * CROSSWALK_ROW, CELL * VARIANTS, CELL);
  // … drawCrosswalks pro masky se 3 a více rameny

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}
```

Klíčová nastavení textury:

- `colorSpace = SRGBColorSpace` – barvy z canvasu jsou v sRGB; bez toho by three.js bral hex
  `#4d4e54` jako lineární hodnotu a asfalt by vyšel světlejší.
- `generateMipmaps = false` + `minFilter = LinearFilter` – mipmapy by při oddálení míchaly
  sousední varianty v atlasu (viz prosakování).
- `anisotropy = 4` – izometrická kamera se na zem dívá šikmo; anizotropní filtrování drží
  texturu ostrou i ve směru, kde se „zkracuje“, a částečně nahradí chybějící mipmapy.
- Plocha mimo ramena zůstane v canvasu **průhledná**. Materiál silnice má `alphaTest: 0.5`,
  takže fragmenty s nízkou alfou se zahodí (`discard`) a pod silnicí je vidět tráva terénu.
  Silnice tedy nemusí mít tvar – je to čtverec přes celou dlaždici.

### 4. Geometrie silnic a UV do atlasu

Všechny silnice mapy jsou jedna geometrie: čtverec na každou dlaždici s UV podle masky:

```ts
for (const { x, y } of tiles) {
  const mask =
    (connects(x, y, Edge.N) ? N : 0) |
    (connects(x, y, Edge.E) ? E : 0) |
    (connects(x, y, Edge.S) ? S : 0) |
    (connects(x, y, Edge.W) ? W : 0);
  const u0 = mask / VARIANTS + inset;
  const u1 = (mask + 1) / VARIANTS - inset;
  // Řádek 0 je v canvasu nahoře, tedy u v = 1
  const row = crosswalks(x, y) ? CROSSWALK_ROW : 0;
  const v0 = 1 - (row + 1) / ROWS + insetV;
  const v1 = 1 - row / ROWS - insetV;
  const v = positions.length / 3;
  positions.push(x, lift, y, x + 1, lift, y, x + 1, lift, y + 1, x, lift, y + 1);
  uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
  indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
}
```

kde `inset = 0.5 / (CELL * VARIANTS)` je **půl texelu** v jednotkách UV. Pořadí indexů
`v, v+2, v+1` volí směr hodinových ručiček tak, aby normála mířila nahoru (+Y) a trojúhelník
nebyl odvrácený od kamery ([díl 03](03-teren.md) o winding order).

Funkce `connects` (`roadConnects`) je čistá logika: silnice navazuje na silnici, na vjezd garáže
otočený k ní a na most jen v jeho ose. Stejnou funkcí se kreslí náhled i ikona nástroje
([díl 10](10-ui-nad-3d.md)).

Městské silnice mají navíc **chodníky** – kvádry výšky `SIDEWALK_HEIGHT = 0.02` v rozích
dlaždice a podél hran, kde silnice nepokračuje (`sidewalkGeometry`), a pouliční lampy po
čtyřech dlaždicích jako InstancedMesh.

### 5. Picking: z myši na dlaždici a její část

Kamera z [dílu 02](02-izometricka-kamera.md) umí vrhnout paprsek z kurzoru a protnout ho se zemí.
Z bodu na zemi pak stačí oddělit celou a desetinnou část (`src/screens/game.ts`):

```ts
function tileAt(clientX: number, clientY: number): PointerTile | null {
  const p = isoCamera.groundPoint(clientX, clientY);
  if (!p) return null;
  const x = Math.floor(p.x);
  const y = Math.floor(p.z);
  return map.inBounds(x, y) ? { x, y, fx: p.x - x, fy: p.z - y } : null;
}
```

`fx, fy ∈ ⟨0, 1)` říkají, **kde v dlaždici** kurzor je. Podle toho kliknutí položí rovný kus,
nebo zatáčku (commit `67dc992` – předtím kliknutí bez tažení nepostavilo nic):

```ts
// Hranice od středu dlaždice, za kterou kurzor v rohu vybere zatáčku
const CORNER_ZONE = 0.25;

// Kus koleje podle polohy kurzoru v dlaždici (fx, fy v 0..1): v rohu zatáčka k bližším hranám,
// jinak rovný kus ve směru, kterým je kurzor od středu dál
export function pieceAtCursor(fx: number, fy: number): number {
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  if (Math.abs(dx) > CORNER_ZONE && Math.abs(dy) > CORNER_ZONE) return cornerPiece(fx, fy);
  return Math.abs(dx) >= Math.abs(dy) ? axisPiece('x') : axisPiece('y');
}
```

```
  ┌───┬───────┬───┐
  │ ╱ │   │   │ ╲ │   rohy: zatáčka k bližším hranám
  ├───┤   │   ├───┤
  │ ──────┼────── │   jinak rovný kus ve směru, kde je kurzor dál od středu
  ├───┤   │   ├───┤
  │ ╲ │   │   │ ╱ │
  └───┴───────┴───┘
```

Tažení začaté v rohu staví **diagonálu** (`diagonalPath`): z rohu se určí jedna ze dvou
rovnoběžných přímek přes dlaždici, kurzor se promítne na směr tažení a po přímce se položí
`count` rohových kusů. Ostatní tažení hledá trasu A*.

### 6. Náhled stavby

`BuildPreview` (`src/render/preview.ts`) používá **stejné** třídy jako skutečná scéna (`TrackView`,
`createStationObject`, `roadGeometry`), jen s jiným materiálem:

```ts
// Poloprůhledný náhled stavby pod kurzorem
export class BuildPreview {
  readonly object = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  // …
  showTrack(items: TrackItem[], valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.track.update(items);
  }
```

- `color` materiálu se **násobí** barvami vrcholů – štěrk a pražce zůstanou rozeznatelné,
  jen zezelenají (`0x9fff9f`) nebo zčervenají (`0xff7070`).
- `transparent` + `opacity 0.6` + `depthWrite: false`: náhled je průsvitný a nezapisuje do
  hloubkového bufferu, takže nezakryje sám sebe ani objekty, které se kreslí po něm.
  `renderOrder = 5` zajistí, že se kreslí až po neprůhledné scéně.
- Plochy (demolice, dosah nástupiště) jsou InstancedMesh plochých kvádrů s kapacitou
  `MAX_AREA = 4096`.

Volitelný obrys dlaždice pod kurzorem (`TileCursor`) je `LineLoop` se `depthTest: false`
a `renderOrder = 10` – kreslí se vždy navrch, i přes budovy.

### 7. A* pro koleje

`findTrackPath` v `src/world/railPath.ts`. Stav je trojice (dlaždice, hrana, kterou se vjelo,
směr jízdy 0..7), zakódovaná do jednoho čísla, aby šla použít jako klíč `Map` a do haldy:

```ts
const key = (x: number, y: number, entry: Edge, h: number): number => ((y * width + x) * 4 + entry) * 8 + h;
```

Heuristika je *octile distance* – délka cesty, když se smí jet rovně i diagonálně:

```ts
const estimate = (x: number, y: number): number => {
  const dx = Math.abs(x - to.x);
  const dy = Math.abs(y - to.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
};
```

A cena kroku nese všechny „preference“:

```ts
const TURN_PENALTY = 0.15;
// Existující koleje jsou levné, aby se nová trasa napojovala na stávající
const REUSE_FACTOR = 0.1;
// Rohový kus je kratší, bez penalizace by jimi začínala i rovná trasa
const END_CORNER_PENALTY = 0.5;
// Most je dražší, trasa vede přes vodu jen když se objíždění nevyplatí
const BRIDGE_FACTOR = BRIDGE_PIECE_COST / TRACK_PIECE_COST;

const stepCost = (x: number, y: number, piece: number): number =>
  pieceLength(piece) * (rail.has(x, y, piece) ? REUSE_FACTOR : map.get(x, y) === TileType.Water ? BRIDGE_FACTOR : 1);
```

Rozbalení stavu zkouší všechny kusy, které začínají na vstupní hraně, smí se položit a nezatočí
o víc než 45°:

```ts
for (let piece = 0; piece < PIECES.length; piece++) {
  const [a, b] = PIECES[piece];
  if (a !== entry && b !== entry) continue;
  const exit = a === entry ? b : a;
  const h2 = heading(entry, exit);
  if (!turnAllowed(h, h2) || !rail.canPlace(x, y, piece)) continue;
  const cost = base + stepCost(x, y, piece) + (h2 !== h ? TURN_PENALTY : 0);
  relax(x, y, piece, exit, h2, cost, current);
}
```

`rail.canPlace` je pravidlo stavby: na trávu, les a kolej ano, na silnici jen kolmo (vznikne
přejezd), na vodu jen rovně (most), na nástupiště, depo a most jen po už existujícím kusu.

Několik poznámek k vysvětlení ve videu:

- **Proč je most dražší i v hledání:** cena mostu je 20 000 Kč vs. 5 000 Kč za kolej
  (`4c977cb`), stejný poměr v A* znamená, že trasa malé jezero objede a přes řeku se přemostí.
- **Proč `REUSE_FACTOR`:** bez něj by se dvě souběžné trasy nikdy nespojily a vznikaly by
  zbytečné paralelní koleje.
- **Proč `END_CORNER_PENALTY`:** rohový kus je kratší (0,707) – trasa by ráda začínala
  a končila zatáčkou, protože je „levnější“.
- **Limit `MAX_EXPANSIONS = 200_000`:** pojistka, aby nedosažitelný cíl nezamrazil hru.
  Commit Fáze 4 uvádí, že trasa přes celou mapu 256×256 trvá desítky ms.

Prioritní fronta je vlastní binární halda `MinHeap` (`src/world/heap.ts`) se dvěma paralelními
poli `keys` a `scores` – čísla místo objektů znamenají méně práce pro garbage collector:

```ts
push(key: number, score: number): void {
  let i = this.keys.length;
  this.keys.push(key);
  this.scores.push(score);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (this.scores[p] <= score) break;
    this.keys[i] = this.keys[p];
    this.scores[i] = this.scores[p];
    i = p;
  }
  this.keys[i] = key;
  this.scores[i] = score;
}
```

Halda nemá operaci „sniž prioritu“. Když se najde levnější cesta do stavu, prostě se vloží znovu
a stará položka se později přeskočí (`cost >= g.get(nk)` v `relax`). To je běžná a jednodušší
varianta A* („lazy deletion“).

### 8. A* pro silnice

`findRoadPath` v `roadPath.ts` je stejný princip v jednodušší podobě: pohyb jen ve 4 směrech,
`TURN_PENALTY = 0.2`, existující silnice za `REUSE_COST = 0.1`, most dražší podle poměru cen.
Navíc pravidlo, že přes kolej, zastávku a vodu se smí jen rovně (`straightOnly`) a kolej se
kříží jen kolmo na jedinou rovnou kolej (`passable`) – vznikne přejezd jako v OpenTTD.

### 9. Postupná výstavba

Nalezená trasa se nepostaví naráz. `Construction` ji zařadí do fronty a staví
`PIECES_PER_SECOND = 25` dílků za sekundu, při pauze stojí a při nedostatku peněz se zastaví.
Pro grafiku to znamená, že se mapa mění **25× za sekundu** – a právě to v [dílu 17](17-optimalizace-a-lod.md)
odhalí, že přestavovat po každé změně celý terén je příliš drahé.

## Úskalí

- **Prosakování atlasu** se projeví jako tenké světlé čáry na okrajích silnic, hlavně při
  oddálení. Inset půl texelu + vypnuté mipmapy.
- **Kliknutí nepostavilo nic** (`67dc992`): hledání trasy potřebovalo dvě různé dlaždice. Řešení
  bylo `pieceAtCursor` a `singlePieceStep` (když vybraný kus nejde položit, zkusí rovný kus –
  třeba přes silnici jako přejezd).
- **Silnice se stavěly naslepo** (`4a0562b`): náhled byl šedý čtverec. Teď náhled kreslí
  skutečnou geometrii silnice napojenou na stávající síť, protože sdílí `roadGeometry` a atlas.
- **Most nebyl poznat od koleje** (`37e2e18`): šedé zábradlí splývalo, pomohla barva.
- **Z-fighting.** Kolej (`+0.002`), silnice (`0.005`), náhled silnice (`0.012`), obrys dlaždice
  (`0.02`) – každá vrstva má malý zdvih nad terénem, jinak by se pixely ploch ve stejné výšce
  náhodně prolínaly.

## Scénář videa

1. **Hook:** táhnout dlouhou trať přes řeku a les, náhled se mění pod kurzorem.
2. **Model kusů:** nákres 6 kusů, diagonála jako schod, proč max. 45°.
3. **Geometrie:** `pieceGeometry` – štěrk, pražce, kolejnice; `pieceMatrix` a znaménko úhlu.
4. **Mosty:** pilíře k hladině, zdvih koleje.
5. **Atlas:** otevřít v DevTools canvas atlasu (`roadAtlas().image`) – ukázat 16 variant a zebry.
6. **UV a prosakování:** dočasně nastavit `inset = 0` a zapnout mipmapy, ukázat artefakty.
7. **alphaTest:** vypnout ho a ukázat černé/bílé čtverce kolem silnic.
8. **Picking:** `tileAt`, nákres zón `pieceAtCursor`, kliknout do rohu vs. kraje dlaždice.
9. **Náhled:** zelená/červená, `depthWrite: false`, `renderOrder`.
10. **A\*:** nakreslit stav (dlaždice, hrana, směr), heuristika, vliv vah – živě změnit
    `REUSE_FACTOR` na 1 a ukázat paralelní koleje, `BRIDGE_FACTOR` na 1 a ukázat mosty všude.
11. **Outro:** máme koleje, příště vlaky.

## Cvičení

- Změňte `TURN_PENALTY` na 0 a na 2. Jak se změní tvar tras?
- Přidejte do atlasu třetí řádek – silnice s cyklopruhem – a použijte ho pro silnice ve vesnicích.
- Zkuste heuristiku `estimate` vynásobit dvěma. Hledání se zrychlí, ale trasy přestanou být
  optimální – proč? (Heuristika přestane být přípustná.)
- Napište test pro `pieceAtCursor`: střed hrany → rovný kus, roh → zatáčka.
- Zatáčka je dnes rovný kus pod 45°. Zkuste vygenerovat geometrii oblouku (čtvrtkruh s poloměrem
  0,5 kolem rohu dlaždice) a porovnejte vzhled.
