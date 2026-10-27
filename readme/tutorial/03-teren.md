# Díl 03 – Terén z jediné geometrie

> **Soubory:** `src/render/terrain.ts`, `src/world/map.ts`
> **Commity:** `7e98305` (Fáze 1: terén s barvami ve vrcholech), `c5729ee` (Fáze 9: přebarvení
> jen změněných dlaždic), `73762c8` (voda pod úrovní terénu, břehy, mělčiny), `3eba113`
> (procedurální textura trávy)

## O čem je tento díl

Mapa 256×256 má 65 536 dlaždic, mapa 512×512 přes čtvrt milionu. Kdybychom každou dlaždici
kreslili jako samostatný `Mesh`, hra by se zastavila na počtu draw callů (o nich podrobně
v [dílu 06](06-instancing-a-draw-cally.md)). Místo toho postavíme **celý terén jako jednu
geometrii**, kterou GPU vykreslí jedním voláním. Naučíme se při tom, jak `BufferGeometry`
vypadá uvnitř:

- pole poloh, barev a indexů a jak spolu souvisí,
- pořadí vrcholů v trojúhelníku (winding) a proč na něm záleží,
- barvy ve vrcholech místo textur,
- procedurální textura trávy vygenerovaná v kódu,
- jak na GPU poslat jen změněný kousek bufferu,
- jak z dlaždic vody udělat břeh se svislou stěnou, písčitým lemem a mělčinou.

## Teorie

### Co je BufferGeometry

GPU nezná objekty, jen dlouhá pole čísel. `BufferGeometry` je přesně to: sada **atributů**
(`Float32Array` + informace, kolik čísel patří k jednomu vrcholu) a volitelně **index**.

```
  position  (itemSize 3):  x0 y0 z0 | x1 y1 z1 | x2 y2 z2 | x3 y3 z3 | …
  color     (itemSize 3):  r0 g0 b0 | r1 g1 b1 | r2 g2 b2 | r3 g3 b3 | …
  normal    (itemSize 3):  …
  index:                   0 2 1 | 0 3 2 | …      ← trojice indexů = trojúhelníky
```

Vrchol číslo `i` je „řez“ přes všechny atributy na pozici `i`. Index říká, které tři vrcholy
tvoří trojúhelník, takže jeden vrchol může patřit víc trojúhelníkům bez kopírování dat.

Vertex shader dostane pro každý vrchol jeho atributy, fragment shader pro každý pixel
**interpolované** hodnoty z vrcholů trojúhelníku (barycentrická interpolace). Když mají
všechny tři vrcholy stejnou barvu, je trojúhelník jednobarevný. Když se liší, vznikne přechod.

### Sdílet vrcholy, nebo ne?

Mřížka `w × h` dlaždic má `(w+1)(h+1)` průsečíků. Mohli bychom mít jeden vrchol na průsečík
a sdílet ho mezi čtyřmi dlaždicemi. Jenže:

```
   sdílené vrcholy                      vlastní vrcholy každé dlaždice

   ●─────●─────●                        ●───● ●───●
   │tráva│voda │   barva vrcholu        │ T │ │ V │   každá dlaždice
   ●─────●─────●   na hraně je jedna,   ●───● ●───●   má 4 vlastní vrcholy,
                   přechod se rozmaže                 hrana je ostrá
```

- Vrchol má **jednu** barvu. Na hranici trávy a vody by vznikl rozmazaný přechod přes celou
  dlaždici.
- Vrchol má **jednu** výšku. Voda leží níž než tráva, sdílené vrcholy by z hrany udělaly šikmý
  svah.

Proto má každá dlaždice **4 vlastní vrcholy** a 2 trojúhelníky (6 indexů). Paměť navíc je
zanedbatelná a výměnou můžeme každou dlaždici obarvit a posunout nezávisle.

Mapa 512×512 má `512 · 512 · 4 = 1 048 576` vrcholů. Index typu `Uint16Array` umí adresovat jen
65 536 vrcholů, proto je index `Uint32Array`.

### Winding: z které strany je trojúhelník vidět

Trojúhelník má přední a zadní stranu. three.js ve výchozím stavu kreslí jen přední
(`side: FrontSide`) a za přední považuje tu, ze které vidíme vrcholy **proti směru hodinových
ručiček** (CCW). Stejné pořadí určuje směr spočtené normály: `n = (b − a) × (c − a)`.

```
   pohled shora (osa Y míří k nám), x doprava, z dolů

     v (x, y) ●───────● v+1 (x+1, y)
              │ ╲     │
              │   ╲   │      trojúhelníky: (v, v+2, v+1) a (v, v+3, v+2)
              │     ╲ │
   v+3 (x,y+1)●───────● v+2 (x+1, y+1)
```

Ověření pro první trojúhelník: `b − a = (1, 0, 1)`, `c − a = (1, 0, 0)`, jejich vektorový součin
je `(0, 1, 0)` – normála míří nahoru, ke kameře. Kdybychom indexy prohodili (`v, v+1, v+2`),
normála by mířila dolů a terén by z kamery nebyl vidět vůbec (back-face culling). To je
nejčastější důvod „proč se mi nic nevykreslilo“.

### Barvy ve vrcholech místo textur

Terén nemá texturu s trávou a vodou. Barva je **atribut vrcholu** a materiál ji použije, když
má `vertexColors: true`:

```ts
readonly groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
```

Výhody: žádná textura, žádné UV, změna typu dlaždice je přepsání 12 čísel. A protože je to
jeden materiál a jedna geometrie, je to **jeden draw call** pro celou mapu.

## Implementace

### Stavba geometrie

```ts
private buildGeometry(): THREE.BufferGeometry {
  const { width, height } = this.map;
  const count = width * height;
  const positions = new Float32Array(count * 4 * 3);
  const colors = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      this.water[i] = this.isWater(x, y) ? 1 : 0;
      this.writeTileHeight(positions, x, y);
      const v = i * 4;
      indices.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
      this.writeTileColor(colors, x, y);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return withLampLightUv(geometry);
}
```

Dlaždice `i = y · width + x` má vrcholy `4i … 4i+3`, takže v poli poloh začíná na `12i`
a v poli indexů na `6i`. Tahle pravidelnost je klíčová: z čísla dlaždice okamžitě víme, kde
jsou její data, a můžeme je přepsat bez hledání.

`computeVertexNormals()` spočte normály z trojúhelníků (pro rovný terén všechny `(0, 1, 0)`).
`withLampLightUv` přidá druhou sadu UV pro noční osvětlení – k té se dostaneme
v [dílu 16](16-osvetleni-den-noc.md).

Výška a barva dlaždice jsou samostatné funkce, aby šly přepsat jednotlivě:

```ts
private writeTileHeight(positions: Float32Array, x: number, y: number): void {
  const h = this.isWater(x, y) ? -WATER_DEPTH : 0;
  positions.set([x, h, y, x + 1, h, y, x + 1, h, y + 1, x, h, y + 1], (y * this.map.width + x) * 12);
}

private writeTileColor(colors: Float32Array, x: number, y: number): void {
  const base = this.tileColor(x, y);
  const shade = 0.94 + tileNoise(x, y) * 0.08;
  const offset = (y * this.map.width + x) * 12;
  for (let k = 0; k < 4; k++) {
    colors[offset + k * 3] = base.r * shade;
    colors[offset + k * 3 + 1] = base.g * shade;
    colors[offset + k * 3 + 2] = base.b * shade;
  }
}
```

### Odstíny dlaždic: deterministický šum

Jednobarevná zelená plocha vypadá jako plastová podložka. Každá dlaždice proto dostane jas
v rozmezí 0,94–1,02 podle hashe svých souřadnic:

```ts
// Deterministický šum 0..1 pro jemné odstíny dlaždic
function tileNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
```

Není to `Math.random()`, protože odstín musí být **stejný** při každém přebarvení (jinak by
dlaždice při každé změně mapy problikly). Princip hashů jako náhody bez stavu probereme v
[dílu 04](04-generovani-sveta.md).

Barva podle typu dlaždice:

```ts
private tileColor(x: number, y: number): THREE.Color {
  const palette = this.palette;
  switch (this.map.get(x, y)) {
    case TileType.Water:
    case TileType.Bridge:
    case TileType.RoadBridgeX:
    case TileType.RoadBridgeY:
      return WATER;
    case TileType.Trees:
      return palette.forest;
    case TileType.Building:
      return this.towns[this.map.getOwner(x, y)]?.kind === 'city' ? PAVEMENT : palette.garden;
    case TileType.Industry:
      return INDUSTRY_GROUND;
    default:
      return palette.grass;
  }
}
```

Dlaždice pod budovou je ve městě dlažba, ve vesnici zahrada. Tráva, zahrady a les mají barvu
z **palety ročního období** – v zimě je tráva bílá, na podzim okrová ([díl 14](14-rocni-obdobi.md)).

### Procedurální textura trávy

Barvy ve vrcholech dají každé dlaždici jednu barvu. Při přiblížení je ale tráva plochá. Druhá
vrstva přidává **stébla** z textury, která není obrázek na disku, ale je vygenerovaná v kódu:

```ts
function createGreenTexture(): THREE.DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 173;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const drawBlade = (startX: number, startY: number, length: number, color: readonly number[]): void => {
    let x = startX;
    for (let dy = 0; dy < length; dy++) {
      x += Math.floor(random() * 3) - 1;
      const y = (startY + dy) % size;
      for (let dx = 0; dx < (random() > 0.72 ? 2 : 1); dx++) {
        const offset = (y * size + ((x + dx + size) % size)) * 4;
        pixels.set(color, offset);
      }
    }
  };
  // …
  for (let i = 0; i < 500; i++) {
    // … náhodná poloha, délka 3–9 px a jedna z pěti barev
    drawBlade(x, y, length, color);
  }

  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
```

Co tu stojí za vysvětlení:

- **`DataTexture`** je textura z pole bajtů RGBA. Pixel `(x, y)` je na indexu `(y · size + x) · 4`.
- **Stéblo** je náhodná procházka: každý řádek dolů se posune o −1, 0 nebo +1 pixel. Výsledek
  vypadá jako zahnutá stébla, ne jako šum.
- **Alfa** pixelů stébel je 70–125 z 255 (barvy jako `[39, 79, 29, 125]`), zbytek textury je
  průhledný. Stébla tedy jen ztmavují nebo tónují barvu dlaždice pod sebou.
- **`% size` na obou osách** zajistí, že stéblo přetékající přes okraj pokračuje na druhé straně.
  Textura je **dlaždicovatelná** a díky `RepeatWrapping` se může opakovat bez viditelného švu.
- **`SRGBColorSpace`**: barvy jsme vybírali „očima“, tedy v sRGB. three.js je před výpočtem
  osvětlení převede do lineárního prostoru. Bez toho by tráva byla vybledlá.
- **Mipmapy a `LinearMipmapLinearFilter`**: při oddálení připadne na jeden pixel obrazovky
  mnoho texelů. Bez mipmap by se textura „třpytila“ (aliasing). Mipmapy jsou předpočítané
  zmenšeniny (64², 32², …), GPU vybere dvě nejbližší a smíchá je (trilineární filtrování).

```
  128×128  →  64×64  →  32×32  →  …  →  1×1      mipmapy (generateMipmaps)
   blízko                 daleko
```

### Vrstva detailů s alfou ve vrcholech

Stébla nepatří na vodu ani na dlažbu, takže potřebujeme textuře říct, kde se má ukázat. Druhá
geometrie má stejné dlaždice o milimetr výš (`y = 0.001`), UV a barvu **se čtyřmi složkami**
(RGBA):

```ts
private buildGreenDetails(): THREE.BufferGeometry {
  // …
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 12;
      positions.set([x, 0.001, y, x + 1, 0.001, y, x + 1, 0.001, y + 1, x, 0.001, y + 1], p);
      uvs.set(
        [x * 0.5, y * 0.5, (x + 1) * 0.5, y * 0.5, (x + 1) * 0.5, (y + 1) * 0.5, x * 0.5, (y + 1) * 0.5],
        i * 8,
      );
      for (let k = 0; k < 4; k++) {
        const c = i * 16 + k * 4;
        colors[c] = 1;
        colors[c + 1] = 1;
        colors[c + 2] = 1;
        colors[c + 3] = this.isGreenTile(x, y) ? 1 : 0;
      }
      // …
    }
  }
  // …
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
}
```

- **UV `x · 0.5`** znamená, že textura pokryje 2×2 dlaždice a pak se opakuje. UV mimo 0..1 jsou
  v pořádku právě díky `RepeatWrapping`.
- **Alfa ve vrcholech** je 1 na trávě a v lese, 0 jinde. Výsledná průhlednost pixelu = alfa
  textury × alfa vrcholu. Na vodě je vrstva neviditelná.
- **RGB ve vrcholech** je tónování stébel. Na podzim jsou stébla do oranžova
  (`detailTint: [1, 0.88, 0.62]`), v zimě skoro zmizí (`detailAlpha: 0.06`).

Materiál je neosvětlený a průhledný:

```ts
const details = new THREE.Mesh(
  this.greenDetails,
  new THREE.MeshBasicMaterial({
    map: GREEN_TEXTURE,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  }),
);
```

`depthWrite: false` – vrstva se nezapisuje do hloubkového bufferu. Je to tenký „nátěr“ těsně nad
terénem a nemá zakrývat nic, co se kreslí po ní (silnice, koleje). O průhlednosti a pořadí
kreslení víc v [dílu 15](15-casticove-efekty.md).

### Mřížka

Mřížka (zapíná se v nastavení) je `LineSegments`: každé dva body tvoří samostatnou úsečku.

```ts
private buildGrid(): THREE.LineSegments {
  const { width, height } = this.map;
  const points: number[] = [];
  const lift = 0.01;
  for (let x = 0; x <= width; x++) points.push(x, lift, 0, x, lift, height);
  for (let y = 0; y <= height; y++) points.push(0, lift, y, width, lift, y);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }),
  );
}
```

Jen `2 · (w + 1)` dlouhých úseček místo čtverečku na dlaždici. `lift = 0.01` zvedne čáry nad
terén, aby s ním „nebojovaly“ v hloubkovém bufferu. Pozor: WebGL kreslí čáry vždy 1 pixel
široké, `linewidth` se ignoruje.

### Přebarvení jen změněných dlaždic

Hráč staví koleje, město roste, stromy se kácí. Každá změna dlaždice musí změnit barvu
v geometrii. Naivně: přepsat celé pole a nastavit `needsUpdate = true`. Pak ale three.js pošle
na GPU celý buffer (12 floatů × 262 144 dlaždic u mapy 512×512 = 12 MB) a projde celou mapu.

Mapa si proto vede **log změněných dlaždic** a každá vrstva si z něj čte, co se změnilo od
posledního snímku (třída `MapChanges`, podrobně v [dílu 17](17-optimalizace-a-lod.md)). Terén
pak přepíše jen ty dlaždice a GPU řekne, které kousky bufferu poslat:

```ts
// Přebarví jen dlaždice změněné od posledního volání; změna vody přestaví i břehy a mělčiny
sync(): void {
  const changes = this.changes.take();
  if (changes === null) {
    this.refresh();
    return;
  }
  if (changes.length === 0) return;
  const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
  const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
  // …
  let shoreChanged = false;
  for (const i of new Set(changes)) {
    const x = i % width;
    const y = Math.floor(i / width);
    // … detaily trávy
    const water = this.isWater(x, y) ? 1 : 0;
    if (water === this.water[i]) {
      this.writeTileColor(colors.array as Float32Array, x, y);
      colors.addUpdateRange(i * 12, 12);
      continue;
    }
    this.water[i] = water;
    shoreChanged = true;
    this.writeTileHeight(positions.array as Float32Array, x, y);
    positions.addUpdateRange(i * 12, 12);
    positions.needsUpdate = true;
    this.writeTileColor(colors.array as Float32Array, x, y);
    colors.addUpdateRange(i * 12, 12);
  }
  // …
  colors.needsUpdate = true;
  if (shoreChanged) this.rebuildShore();
}
```

- `addUpdateRange(start, count)` je v **prvcích pole** (floatech), ne ve vrcholech. Dlaždice
  `i` má 12 floatů od `12i`.
- Při dalším vykreslení three.js zavolá pro každý rozsah `gl.bufferSubData` místo nahrání
  celého bufferu, a rozsahy pak vymaže.
- Pole `water` si pamatuje, jestli dlaždice byla vodou při posledním kreslení. Jen změna
  voda ↔ pevnina (třeba stavba mostu, viz `isWater`) mění výšku a vyžaduje přestavbu břehů.

Výsledek z commitu `c5729ee` na mapě 512×512: obsluha jednoho položeného dílku koleje klesla
z 15,6 ms na 2,0 ms, z toho přebarvení celého terénu samo stálo 9,3 ms.

### Voda pod úrovní terénu a břehy

Voda leží o `WATER_DEPTH = 0.06` níž než pevnina. Mezi nimi je schod a ten je potřeba něčím
vyplnit. Na to má terén třetí mesh, **břeh**, se třemi prvky:

```
     pevnina           lem (SAND)
   ───────────────┬────────┐  y = 0 (+ BEACH_LIFT)
                  │        │
                  │ stěna  │  svislá stěna (BANK), normála ven k vodě
                  │        │
                  └────────┴──────────────  y = -WATER_DEPTH
                            hladina + mělčina (SHALLOW → WATER)
```

Pomocná funkce skládá obdélníky ze čtyř rohů, každý se svou normálou a barvou:

```ts
const quad = (corners: number[], normal: number[], color: THREE.Color): void => {
  const v = positions.length / 3;
  positions.push(...corners);
  for (let k = 0; k < 4; k++) {
    normals.push(...normal);
    colors.push(color.r, color.g, color.b);
  }
  indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
};
```

**Svislá stěna.** Pro každou dlaždici pevniny a každou ze čtyř stran, za kterou je voda,
vznikne stěna na hraně dlaždice. Normálu nezadáváme výpočtem, ale přímo: je to směr k vodě
`(dx, 0, dy)`. Pořadí rohů je zvolené tak, aby stěna byla přední stranou k vodě:

```ts
SIDES.forEach(([dx, dy], side) => {
  if (!wet[side]) return;
  // Stěna na hraně dlaždice čelem k vodě; vodorovná osa stěny vede tak, aby normála mířila ven
  const cx = x + 0.5 + dx * 0.5;
  const cz = y + 0.5 + dy * 0.5;
  const [tx, tz] = [dy * 0.5, -dx * 0.5];
  quad(
    [cx - tx, -WATER_DEPTH, cz - tz, cx + tx, -WATER_DEPTH, cz + tz, cx + tx, 0, cz + tz, cx - tx, 0, cz - tz],
    [dx, 0, dy],
    BANK,
  );
  if (dy === -1) beach(x, y, x + 1, y + w);
  // … ostatní tři strany
});
```

`(tx, tz) = (dy, −dx) / 2` je vektor podél hrany – kolmice k normále `(dx, dy)` otočená o 90°.
Jedna formule tak pokryje všechny čtyři směry bez `switch`.

**Písčitý lem** je pruh široký `BEACH_WIDTH = 0.12` podél hrany, o 2 mm nad terénem
(`BEACH_LIFT`). Na rozích, kde voda sousedí jen úhlopříčně, doplní lem malý čtvereček, aby
v lemu nebyla díra.

**Mělčina** je světlejší modrá u břehu, která do hloubky přechází v tmavou. Na dlaždici vody se
pro každý ze čtyř rohů zjistí, jestli se dotýká pevniny (některá ze čtyř dlaždic kolem rohu je
pevnina). Pak se nakreslí **vějíř ze středu**:

```ts
// Mělčina přes dlaždici vody: vějíř ze středu, aby přechod do hloubky neměl šikmé pruhy
const shallows = (x: number, y: number): void => {
  // … shallow[k] = dotýká se roh k pevniny?
  if (!shallow.some(Boolean)) return;
  // …
  vertex(x + 0.5, y + 0.5, 1 - shallow.filter(Boolean).length / 4);
  corners.forEach(([cx, cy], k) => vertex(cx, cy, shallow[k] ? 0 : 1));
  // Rohy 1..4 jsou SZ, SV, JV, JZ; trojúhelníky proti směru hodin při pohledu shora
  indices.push(v, v + 1, v + 4, v, v + 4, v + 3, v, v + 3, v + 2, v, v + 2, v + 1);
};
```

Proč ne dva trojúhelníky jako u terénu? Představte si dlaždici, které se pevniny dotýká jen
jeden roh:

```
   dva trojúhelníky                       vějíř ze středu (4 trojúhelníky)

   S ●───────● H         S = mělčina       S ●───────● H
     │ ╲     │           H = hloubka         │ ╲   ╱ │
     │   ╲   │                               │   ●   │  střed: 3/4 hloubky
     │     ╲ │                               │ ╱   ╲ │
   H ●───────● H                           H ●───────● H

   přechod se táhne podél úhlopříčky,      přechod je soustředný kolem rohu
   podle toho, kterou úhlopříčku zvolíme,  a nezáleží na orientaci
   vzniká šikmý pruh
```

U dvou trojúhelníků se barva interpoluje jen uvnitř každého z nich. Úhlopříčka, která dlaždici
dělí, se tak stane viditelnou hranou přechodu a celá voda by byla pokrytá šikmými pruhy ve
stejném směru. Pátý vrchol uprostřed s průměrnou hloubkou (`1 − počet mělkých rohů / 4`)
rozbije tuto asymetrii.

Barva vrcholu mělčiny je `SHALLOW.lerp(WATER, depth)` krát odstín dlaždice. Mělčina leží
o milimetr nad hladinou (`SHALLOWS_LIFT = 0.001`), aby ji překryla.

Břeh se při změně vody přestaví celý (počet obdélníků se mění, nejde přepsat na místě):

```ts
private rebuildShore(): void {
  this.shore.geometry.dispose();
  this.shore.geometry = this.buildShore();
}
```

`dispose()` uvolní buffery na GPU. three.js je samo neuvolní, protože neví, jestli geometrii
ještě někde nepoužíváte – bez `dispose()` by každá přestavba nechala v paměti GPU starou kopii.

Hladina (dlaždice vody v terénu i mělčina) má navíc animované vlnky a v zimě led. Ty dodá shader
přes `withWater(material, surface)` – to je téma [dílu 12](12-shadery-voda.md).

## Úskalí

- **Voda byla původně na úrovni terénu.** Do commitu `73762c8` byla voda jen modře obarvená
  dlaždice ve výšce 0. S mosty a pilíři „k hladině“ to přestalo stačit: voda se snížila o 0,06,
  přibyla funkce `writeTileHeight`, břehy, lem a mělčina. Pilíře mostů v `rail.ts` teď sahají
  `BRIDGE_DECK - 0.05 + WATER_DEPTH` dolů.
- **Přebarvení celé mapy při každé změně.** Ve Fázi 1 měl terén `updateTile()`, ale vrstvy se
  časem začaly přestavovat celé. Fáze 9 to změřila (9,3 ms jen za terén) a zavedla log změn
  a `addUpdateRange`.
- **Šikmé pruhy v mělčině.** Gradient přes dva trojúhelníky ukázal úhlopříčky – řešením je vějíř
  s pátým vrcholem (komentář přímo v kódu).
- **Index `Uint16Array` nestačí.** Od 128×128 dlaždic (65 536 vrcholů) je nutný `Uint32Array`.

## Scénář videa

1. Problém: 65 536 dlaždic × Mesh = tisíce draw callů. Ukázat (třeba jen pro 64×64), jak FPS
   padá.
2. Nákres atributů a indexu. Postavit geometrii pro jednu dlaždici ručně v konzoli.
3. Winding: prohodit dva indexy a ukázat, že dlaždice zmizí. Vysvětlit vektorový součin.
4. Proč nesdílet vrcholy – ukázat rozmazaný přechod tráva/voda na sdílené mřížce.
5. Celá mapa jednou geometrií, `vertexColors`, `tileNoise` – před a po.
6. Procedurální textura: vykreslit `DataTexture` samotnou na plochu, pak opakování 2×2.
7. Mipmapy: oddálit s vypnutými mipmapami (třpyt) a se zapnutými.
8. Vrstva detailů s alfou ve vrcholech – zapnout/vypnout, přepnout na zimu.
9. `addUpdateRange` – stavět koleje s otevřeným profilerem, srovnat s celým nahráním.
10. Břehy: stěna, lem, mělčina. Ukázat drátový model (`wireframe: true`) vějíře.

## Cvičení

- Zapněte `wireframe: true` na materiálu terénu a břehu a najděte vějíře mělčin.
- Změňte `writeTileHeight`, aby měla tráva výšku podle `tileNoise` (±0,02). Co se stane
  s hranami dlaždic a proč by teď sdílené vrcholy dávaly smysl?
- Upravte texturu trávy: přidejte drobné kvítky (pár žlutých a bílých pixelů s vyšší alfou).
- Zkuste UV detailů `x · 0.25` (textura přes 4×4 dlaždice) a `x · 1`. Kdy je vidět opakování?
- Spočítejte, kolik bajtů posílá na GPU přebarvení jedné dlaždice s `addUpdateRange` a bez něj
  na mapě 256×256.
