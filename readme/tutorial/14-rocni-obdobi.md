# Díl 14 – Roční období a sníh

> **Soubory:** `src/game/seasons.ts`, `src/render/gameView.ts`, `src/render/terrain.ts`, `src/render/trees.ts`,
> `src/render/buildings.ts`, `src/render/industries.ts`, `src/render/water.ts`
> **Commity:** `cc36b46` (střídání ročního období), `c79dc61` (sníh na budovách), `6d1b1fe` (padající listí),
> `0f7eed1` (plynulé střídání období a dne a noci), `0d79d89` (led na vodě), `0e9fec8` (oprava zasněžených střech)

## O čem je tento díl

Rok ve hře trvá 15 minut, takže hráč za hodinu uvidí čtyři zimy. Svět, který vypadá pořád stejně,
je promarněná příležitost. V tomhle dílu necháme krajinu stárnout s kalendářem:

- jarní svěží zeleň, letní sytá, podzimní okrová a hnědá, zimní sníh,
- stromy přebarvené podle období (podzimní koruny, zasněžené v zimě),
- sníh na střechách budov a továren, generovaný z geometrie modelů,
- zamrzlá voda (navazuje na [díl 12](12-shadery-voda.md)) a padající listí ([díl 15](15-casticove-efekty.md)).

A hlavně: přechod mezi obdobími je **plynulý**, ne skokový, a přitom levný.

Divák si odnese:

- jak modelovat plynulý přechod mezi stavy (`SeasonBlend`) a oddělit ho od vykreslování,
- jak levně přebarvit celou mapu přes barvy vrcholů a proč to dělat po krocích,
- jak přebarvit tisíce instancí stromů změnou jediného sdíleného materiálu,
- jak z modelu vybrat „střechy“ podle normál a postavit z nich vrstvu sněhu,
- co je hloubkový buffer, z-fighting a jak ho řeší `polygonOffset`.

## Teorie

### Stav × přechod

Nejjednodušší řešení je funkce „datum → období“ a při změně období všechno přebarvit. Přesně tak
vypadala první verze (`cc36b46`):

```ts
private applySeason(): void {
  const season = seasonForDate(this.game.clock.date, this.seasonMode);
  if (this.currentSeason === season) return;
  this.currentSeason = season;
  this.terrain.setSeason(season);
  this.trees.setSeason(season);
}
```

Fungovalo to, ale 1. března se celá krajina v jednom snímku přepnula ze sněhu do jara. Commit
`0f7eed1` zavedl **prolnutí dvou období**:

```ts
// Vzhled mezi dvěma obdobími: t = 0 je celé from, t = 1 celé to
export interface SeasonBlend {
  from: Season;
  to: Season;
  t: number;
}
```

Každá vrstva scény pak dostane trojici `(from, to, t)` a sama si rozhodne, co s ní: barvy se dají
plynule prolnout (`lerp`), ale sníh na střeše buď je, nebo není. Pro takové věci existuje
„převažující období“ a pro led „podíl zimy“:

```
 listopad        prosinec (přechod autumn → winter)              leden
 ─────────┬──────────────────────────────────────────────────┬──────────
  autumn  │ t: 0 ──────────────── 0.5 ──────────────────── 1 │  winter
          │ barvy terénu a stromů se plynule prolínají        │
          │ dominantSeason = autumn  │ dominantSeason = winter│
          │ (listí padá)             │ (sníh na střechách)    │
          │ seasonWeight(winter) = t → led roste s t          │
```

### Barvy vrcholů jako „paleta“

Terén je jedna geometrie s barvou v každém vrcholu ([díl 03](03-teren.md)). Přebarvit krajinu
znamená přepsat pole barev a poslat ho na GPU. Na mapě 256×256 je to 65 536 dlaždic po čtyřech
vrcholech, tedy 786 432 čísel (`Float32Array`, přes 3 MB). Jednou za čas je to v pohodě, ale
každý snímek by to byla zbytečná zátěž: CPU projde smyčku přes celou mapu a GPU dostane celý buffer.

Prolnutí proto běží **po krocích**: přechod má deset stupňů a přebarvuje se jen při změně stupně.
Měsíc přechodu trvá při normální rychlosti zhruba 75 sekund reálného času, takže krok přijde asi
každých 7,5 sekundy. Oko při tak pomalé změně schod nepozná.

### Barvy se míchají v lineárním prostoru

`THREE.Color.lerp` míchá složky, které three.js drží v **lineárním** prostoru (hex barvy převádí
z sRGB). To je správně: prolnutí v lineárním prostoru odpovídá fyzikálnímu míchání světla
a prostředek mezi zelenou a bílou nevychází zašedlý.

### Hloubkový buffer a z-fighting

GPU si u každého pixelu pamatuje nejen barvu, ale i **hloubku** (vzdálenost od kamery). Když kreslí
nový trojúhelník, porovná jeho hloubku s uloženou a pixel přepíše, jen když je nový bližší. Díky
tomu nezáleží na pořadí kreslení neprůhledných objektů.

Hloubka má ale omezenou přesnost (typicky 24 bitů). Když dvě plochy leží skoro ve stejném místě,
zaokrouhlení rozhodne náhodně, která je „blíž“, a to pro každý pixel jinak:

```
 střecha a sníh ve stejné rovině:     sníh posunutý o kousek nad střechu:
 ▓░▓▓░░▓░▓▓▓░░▓░▓  ← z-fighting        ░░░░░░░░░░░░░░░░  ← čistý sníh
 ░▓░░▓▓░▓░░░▓▓░▓░    (při pohybu        ░░░░░░░░░░░░░░░░
 ▓░▓░░▓▓░▓▓░░▓░▓▓     kamery bliká)     ░░░░░░░░░░░░░░░░
```

Řešení jsou dvě a hra používá obě:

1. **Fyzický posun**: vrcholy sněhu leží 0,002 nad střechou, posunuté ve směru normály.
2. **`polygonOffset`**: GPU při testu hloubky přičte k hloubce sněhu malou korekci. Vzorec je
   `offset = factor · DZ + r · units`, kde `DZ` je sklon plochy v hloubce (jak rychle se hloubka mění
   mezi pixely) a `r` nejmenší rozlišitelný krok hloubky. Záporný `factor` přitáhne plochu ke kameře.
   Na šikmých střechách, kde je `DZ` velké, je posun větší, a právě tam z-fighting hrozí nejvíc.

## Implementace

### 1. Kalendář → přechod

`src/game/seasons.ts` je čistá logika bez three.js, testovaná ve Vitestu:

```ts
export function seasonForDate(date: Pick<GameDate, 'month'>, mode: SeasonMode): Season {
  if (mode !== 'auto') return mode;
  if (date.month === 11 || date.month < 2) return 'winter';
  if (date.month < 5) return 'spring';
  if (date.month < 8) return 'summer';
  return 'autumn';
}

const SEASON_ORDER: readonly Season[] = ['winter', 'spring', 'summer', 'autumn'];
const FIRST_MONTH: Record<Season, number> = { spring: 2, summer: 5, autumn: 8, winter: 11 };

// V automatickém režimu se během prvního měsíce období vzhled plynule mění z předchozího období
export function seasonBlendForDate(date: Pick<GameDate, 'month' | 'day'>, mode: SeasonMode): SeasonBlend {
  const to = seasonForDate(date, mode);
  if (mode !== 'auto' || date.month !== FIRST_MONTH[to]) return { from: to, to, t: 1 };
  const from = SEASON_ORDER[(SEASON_ORDER.indexOf(to) + SEASON_ORDER.length - 1) % SEASON_ORDER.length];
  return { from, to, t: Math.min(1, (date.day - 1) / 30) };
}

// Období, které v přechodu převažuje (sníh na střechách, padající listí)
export function dominantSeason(blend: SeasonBlend): Season {
  return blend.t < 0.5 ? blend.from : blend.to;
}

// Podíl daného období ve vzhledu 0 až 1
export function seasonWeight({ from, to, t }: SeasonBlend, season: Season): number {
  return (from === season ? 1 - t : 0) + (to === season ? t : 0);
}
```

Režim `SeasonMode` je `'auto'` nebo ručně vybrané období. Volba je v okně Nastavení a je to hlavně
ladicí nástroj: při natáčení se hodí přepnout rovnou na zimu.

Testy (`src/game/seasons.test.ts`) hlídají hrany, na kterých se nejsnáz chybuje, třeba že přechod do
zimy začíná v prosinci a jarní tání v březnu:

```ts
expect(seasonBlendForDate({ month: 11, day: 10 }, 'auto').from).toBe('autumn');
expect(seasonBlendForDate({ month: 2, day: 10 }, 'auto').from).toBe('winter');
```

### 2. Rozdělení práce v GameView

`GameView.applySeason()` se volá každý snímek, ale většinou hned skončí (`src/render/gameView.ts`):

```ts
// Přechod ročního období po krocích: každý krok přebarví celý terén, proto ne každý herní den
const SEASON_STEPS = 10;

private applySeason(): void {
  const blend = seasonBlendForDate(this.game.clock.date, this.seasonMode);
  const stepped = { ...blend, t: Math.round(blend.t * SEASON_STEPS) / SEASON_STEPS };
  const key = `${stepped.from}>${stepped.to}:${stepped.t}`;
  if (this.seasonKey === key) return;
  this.seasonKey = key;
  this.terrain.setSeason(stepped);
  this.trees.setSeason(stepped);
  this.forestMist.setSeason(dominantSeason(stepped));
  const season = dominantSeason(stepped);
  if (this.currentSeason === season) return;
  this.currentSeason = season;
  this.fallingLeaves.setSeason(season);
  this.animals.setSeason(season);
  this.buildings.setSeason(season);
  this.industries.setSeason(season);
}
```

Dvě úrovně:

- **Plynulé vrstvy** (terén, stromy, led) dostanou zaokrouhlený `stepped` blend při každé změně
  kroku. Klíč `"autumn>winter:0.3"` brání zbytečné práci.
- **Skokové vrstvy** (sníh, listí, zvířata, mlha) reagují jen na změnu převažujícího období.

### 3. Terén: palety po obdobích

Každé období má vlastní barvy trávy, zahrad a lesní půdy a nastavení detailní textury stébel
(`src/render/terrain.ts`):

```ts
const TERRAIN_PALETTES: Record<Season, TerrainPalette> = {
  spring: {
    grass: new THREE.Color(0x75b84b),
    garden: new THREE.Color(0x8cbe62),
    forest: new THREE.Color(0x568e3b),
    detailTint: [0.95, 1, 0.84],
    detailAlpha: 1,
  },
  // … summer, autumn
  winter: {
    grass: new THREE.Color(0xe8ece5),
    garden: new THREE.Color(0xf0f1ed),
    forest: new THREE.Color(0xd5ddd5),
    detailTint: [1, 1, 1],
    detailAlpha: 0.06,
  },
};
```

Zimní „tráva“ je prostě skoro bílá. Sníh na zemi tedy není žádný efekt, jen jiná barva vrcholů.
Barvy, které se s obdobím nemění (voda, chodníky, povrch průmyslových areálů), leží mimo paletu jako
konstanty.

`setSeason` paletu prolne a přepíše barvy celé mapy:

```ts
setSeason(blend: SeasonBlend): void {
  const { from, to, t } = blend;
  const key = `${from}>${to}:${t}`;
  if (this.seasonKey === key) return;
  this.seasonKey = key;
  setWaterIce(seasonWeight(blend, 'winter'));
  const a = TERRAIN_PALETTES[from];
  const b = TERRAIN_PALETTES[to];
  const tint = (k: number): number => a.detailTint[k] + (b.detailTint[k] - a.detailTint[k]) * t;
  this.palette = {
    grass: a.grass.clone().lerp(b.grass, t),
    garden: a.garden.clone().lerp(b.garden, t),
    forest: a.forest.clone().lerp(b.forest, t),
    detailTint: [tint(0), tint(1), tint(2)],
    detailAlpha: a.detailAlpha + (b.detailAlpha - a.detailAlpha) * t,
  };
  const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
  const detailColors = this.greenDetails.getAttribute('color') as THREE.BufferAttribute;
  for (let y = 0; y < this.map.height; y++) {
    for (let x = 0; x < this.map.width; x++) {
      this.writeTileColor(colors.array as Float32Array, x, y);
      this.writeGreenDetailAlpha(x, y);
    }
  }
  colors.clearUpdateRanges();
  colors.needsUpdate = true;
  detailColors.clearUpdateRanges();
  detailColors.needsUpdate = true;
}
```

Všimněte si `clearUpdateRanges()`. Při běžné stavbě terén posílá na GPU jen rozsahy změněných
dlaždic (`addUpdateRange`, [díl 17](17-optimalizace-a-lod.md)). Tady se mění všechno, takže se
rozsahy smažou a `needsUpdate` nahraje celý buffer.

`writeTileColor` vezme barvu podle typu dlaždice z aktuální palety a vynásobí ji jemným šumem
dlaždice, aby plocha nebyla jednolitá:

```ts
private writeTileColor(colors: Float32Array, x: number, y: number): void {
  const base = this.tileColor(x, y);
  const shade = 0.94 + tileNoise(x, y) * 0.08;
  // … 4 vrcholy dlaždice
}
```

### 4. Stébla trávy pod sněhem

Přes zelené dlaždice leží druhá vrstva: čtverce s procedurální texturou stébel (díl 03). Kreslí se
neosvětleným `MeshBasicMaterial` s průhledností a barvou vrcholů se **čtyřmi** složkami (RGBA).
Alfa ve vrcholech určuje, jak moc jsou stébla vidět:

```ts
private writeGreenDetailAlpha(x: number, y: number): void {
  const offset = (y * this.map.width + x) * 16;
  const { detailTint, detailAlpha } = this.palette;
  const alpha = this.isGreenTile(x, y) ? detailAlpha : 0;
  for (let k = 0; k < 4; k++) {
    const vertex = offset + k * 4;
    this.greenDetailColors[vertex] = detailTint[0];
    this.greenDetailColors[vertex + 1] = detailTint[1];
    this.greenDetailColors[vertex + 2] = detailTint[2];
    this.greenDetailColors[vertex + 3] = alpha;
  }
}
```

Když má atribut `color` čtyři složky, three.js zapne v shaderu `USE_COLOR_ALPHA` a barva vrcholu
násobí i průhlednost. V zimě klesne alfa na 0,06, takže ze sněhu tu a tam vykoukne stéblo.
Na podzim se stébla tónují do oranžova (`detailTint: [1, 0.88, 0.62]`).

### 5. Stromy: jeden materiál pro tisíce instancí

Les má desítky tisíc stromů, ale všechny instance jednoho dílu sdílejí jeden materiál a materiály
jsou v cache podle jména z kitu (`leafsGreen`, `leafsDark`, `woodBark`…). Přebarvit všechny stromy
na mapě tedy znamená změnit barvu několika materiálů (`src/render/trees.ts`):

```ts
const SEASON_TREE_COLORS: Record<Season, Record<string, number>> = {
  spring: { ...TREE_COLORS, leafsGreen: 0x67ad50, leafsDark: 0x438744 },
  summer: TREE_COLORS,
  autumn: { ...TREE_COLORS, leafsGreen: 0xc18737, leafsDark: 0x985a2d },
  winter: { ...TREE_COLORS, leafsGreen: 0xe5ece5, leafsDark: 0xcbd6ce },
};

// Barva materiálu v aktuálním přechodu období; undefined pro materiály, které se nepřebarvují
function seasonColor(name: string, target: THREE.Color): THREE.Color | undefined {
  const from = SEASON_TREE_COLORS[activeBlend.from][name];
  const to = SEASON_TREE_COLORS[activeBlend.to][name];
  if (from === undefined || to === undefined) return undefined;
  return target.setHex(to).lerp(blendFrom.setHex(from), 1 - activeBlend.t);
}

function applyTreeSeason(blend: SeasonBlend): void {
  activeBlend = blend;
  for (const [name, material] of treeMaterials) seasonColor(name, (material as THREE.MeshLambertMaterial).color);
}
```

Změna `material.color` nestojí skoro nic: barva je uniforma, three.js ji pošle při dalším vykreslení.
Žádná geometrie se nemění a shader se nepřekládá. Kmeny (`woodBark`) mají ve všech obdobích stejnou
barvu, mění se jen listí. Zimní „listí“ je bílé, takže jehličnany i listnáče vypadají zasněžené.

`activeBlend` je proměnná modulu a čte ji i `treeMaterial()` při vytvoření nového materiálu. Strom
načtený uprostřed zimy (třeba v nově postaveném průmyslovém areálu) tak hned dostane zimní barvu.

### 6. Sníh na střechách: geometrie z normál

Sníh na budovách nejde udělat přebarvením: střecha z palety je červená nebo šedá a její materiál
sdílí i stěny. Místo toho z modelu vyrobíme **novou geometrii jen ze střech** a v zimě ji zobrazíme
přes budovu (`src/render/buildings.ts`):

```ts
// Nejnižší střecha se sněhem; nižší jsou jen chodníky a podesty modelů na zemi (do ~0,05), přízemní
// přístavky a verandy domků mají střechy už od ~0,17
const SNOW_MIN_HEIGHT = 0.06;

export function createSnowRoofGeometry(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry | null {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute('position');
  // …
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i).applyMatrix4(matrix);
    b.fromBufferAttribute(position, i + 1).applyMatrix4(matrix);
    c.fromBufferAttribute(position, i + 2).applyMatrix4(matrix);
    normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (normal.y < 0.3 || (a.y + b.y + c.y) / 3 < SNOW_MIN_HEIGHT) continue;

    for (const point of [a, b, c]) {
      const snowPoint = point.clone().addScaledVector(normal, 0.002);
      snowPositions.push(snowPoint.x, snowPoint.y, snowPoint.z);
      snowNormals.push(normal.x, normal.y, normal.z);
      snowUvs.push(snowPoint.x * 4, snowPoint.z * 4);
    }
  }
  // …
}
```

Algoritmus pro každý trojúhelník:

1. **Převod do budovy.** `matrix` je normalizace dílu (střed dlaždice, šířka 0,86, dno v `y = 0`,
   [díl 05](05-modely-glb.md)). Výšky jsou tak ve všech modelech ve stejných jednotkách.
2. **Normála** z vektorového součinu hran.
3. **Sklon.** `normal.y` je kosinus úhlu mezi normálou a svislicí. `normal.y ≥ 0.3` znamená sklon
   do zhruba 72°: rovné střechy i strmé sedlové střechy, ale ne stěny.

   ```
     normal.y = 1      normal.y ≈ 0.7     normal.y ≈ 0.3     normal.y = 0
        ▲                  ↗                  →↗                 →
     ───────            ╱                   │╱                  │
     rovná střecha     45° střecha         ~72°               stěna
     sníh ✓             sníh ✓              sníh ✓ (hranice)   sníh ✗
   ```

4. **Výška.** Plochy, jejichž střed je níž než 0,06, jsou chodníky a podesty modelu na zemi. Na ty
   sníh nepatří, zem je zasněžená už barvou terénu.
5. **Posun po normále** o 0,002, aby sníh ležel nad střechou (viz z-fighting).
6. **UV z vodorovných souřadnic** `x * 4, z * 4` v normalizované budově. Sněhová textura se tak
   opakuje čtyřikrát na dlaždici bez ohledu na to, jak má model UV, a na šikmé střeše se natáhne
   jen nepatrně. (Projekci shora se říká planární mapování.)

Výsledek je ploché pole trojúhelníků, kopie střech. Pro každý díl se spočte jen jednou
(cache `WeakMap` podle dílu `snowRoofs`), ne pro každou budovu ve městě.

### 7. Sněhová textura a materiál

Textura je 64×64 pixelů šumu z lineárního kongruenčního generátoru, odstíny 228–255 s nádechem
do modra:

```ts
function createSnowTexture(): THREE.DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 0x5f3759df;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const shade = 228 + (seed % 28);
    pixels.set([shade - 2, shade, Math.min(255, shade + 3), 255], i * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // … filtry a mipmapy
  return texture;
}

export const SNOW_MATERIAL = new THREE.MeshLambertMaterial({
  map: createSnowTexture(),
  color: 0xffffff,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
```

- `RepeatWrapping` – UV větší než 1 texturu opakují (UV jdou až do 4 na dlaždici).
- `colorSpace = SRGBColorSpace` – bajty textury jsou sRGB, three.js je při čtení převede do lineárního
  prostoru. Bez toho by sníh vyšel příliš světlý a „vypálený“.
- Mipmapy – při oddálení se šum zprůměruje do hladké bílé místo zrnění.
- `MeshLambertMaterial` – sníh je osvětlený, v noci ztmavne spolu se střechou.
- `polygonOffset` se záporným faktorem – pojistka proti z-fightingu na šikmých plochách.

### 8. Sníh v dávkách budov

Budovy se kreslí v `BatchedMesh` ([díl 06](06-instancing-a-draw-cally.md)). Sníh všech budov ve
městech je jedna další dávka s `SNOW_MATERIAL`, tedy jeden draw call navíc:

```ts
const snow = snowRoofOf(part);
for (const placement of matrices) {
  bucket.items.push({ geometry: part.geometry, matrix: placement.clone().multiply(part.matrix) });
  if (snow) snowItems.push({ geometry: snow, matrix: placement });
}
```

Sníh má jako matici jen `placement` (poloha a natočení budovy na mapě), protože normalizace dílu
`part.matrix` je už zapečená do jeho vrcholů.

Přepnutí zimy je pouhé `visible`:

```ts
setWinter(winter: boolean): void {
  this.winter = winter;
  if (this.snow) this.snow.mesh.visible = winter;
}
```

Zjednodušené budovy pro oddálený pohled ([díl 17](17-optimalizace-a-lod.md)) mají vlastní sadu dávek
a sníh se jim spočte stejnou funkcí z jejich zjednodušené geometrie. Ploché vršky sloupců výškové
mapy mají normálu přímo nahoru, takže sníh dostanou automaticky.

### 9. Sníh na továrnách

Průmyslové areály nejsou v dávkách, jsou to obyčejné skupiny objektů. Funkce `kenney()`, která načte
model z City Kitu, rovnou ke každému dílu přidá sněhový mesh (`src/render/industries.ts`):

```ts
model.traverse((part) => {
  if (!(part instanceof THREE.Mesh)) return;
  const geometry = createSnowRoofGeometry(part.geometry, part.matrixWorld);
  if (!geometry) return;
  const snow = new THREE.Mesh(geometry, SNOW_MATERIAL);
  snow.userData.snowRoof = true;
  snow.visible = activeSeason === 'winter';
  snowMeshes.push(snow);
});
```

Značka `userData.snowRoof` slouží dvakrát: při změně období se podle ní sníh najde
(`area.traverse(...)`) a při zániku závodu se podle ní uvolní geometrie (`disposeSnow`), protože
na rozdíl od sdílených geometrií modelů patří sněhová geometrie jen tomuto areálu.

### 10. Led a listí

- **Led** – terén v `setSeason` volá `setWaterIce(seasonWeight(blend, 'winter'))`. Během prosince
  podíl zimy roste po desetinách od 0 do 1 a shader vody podle něj zamrzá po ostrůvcích od břehů
  ([díl 12](12-shadery-voda.md)). V březnu stejnou cestou taje.
- **Padající listí a mlha** – zapínají se, když převažuje podzim ([díl 15](15-casticove-efekty.md)).
- **Zvířata** – včely v zimě nelétají (`animals.setSeason`).

## Úskalí

- **Skokový přechod.** První verze (`cc36b46`) přepínala období naráz. Plynulý přechod přišel
  v `0f7eed1` spolu s plynulým soumrakem. Oba používají stejný vzor: cílový stav a hodnota 0..1,
  která se k němu blíží.
- **Přebarvení každý den.** Prolnutí po dnech by znamenalo 30 přebarvení celé mapy za měsíc. Při
  rychlosti ×8, kterou hra chvíli měla (přidaná v `0d79d89`, odebraná v `43f3f7a`), by to bylo
  několik přebarvení za sekundu. `SEASON_STEPS = 10` drží počet
  na deseti za přechod bez ohledu na rychlost hry.
- **Sníh jen na vysokých střechách.** První verze (`c79dc61`) brala jen plochy výš než 0,25.
  Přízemní přístavky a verandy domků ze suburban kitu mají střechy od zhruba 0,17, takže v zimě
  zůstávaly bez sněhu, zatímco hlavní střecha byla bílá. Oprava v `0e9fec8` snížila práh na
  `SNOW_MIN_HEIGHT = 0.06`, těsně nad chodníky a podesty modelů. Přidal se k tomu test, který
  hlídá obě hranice:

  ```ts
  it('pokryje i nízké střechy přízemních přístavků, ale ne plochy na zemi', () => {
    // …
    const snow = createSnowRoofGeometry(geometry, new THREE.Matrix4());
    expect(snow?.getAttribute('position').count).toBe(3);
    expect(snow?.getAttribute('position').getY(0)).toBeCloseTo(0.182);
  });
  ```

  Test staví dva vodorovné trojúhelníky, střechu ve výšce 0,18 a podestu ve výšce 0,02, a čeká
  sníh jen na střeše, posunutý o 0,002 nahoru. Za zmínku stojí, že výpočet geometrie sněhu je čistá funkce bez GPU, takže jde testovat ve Vitestu.
- **Z-fighting.** Samotný posun o 0,002 na šikmých střechách při oddálení nestačil, proto
  i `polygonOffset`.
- **Nové objekty uprostřed zimy.** Strom nebo továrna vytvořená v zimě musí zimní vzhled dostat
  hned, ne až při další změně období. Proto `activeBlend` v `trees.ts` a `activeSeason`
  v `industries.ts`.

## Scénář videa

1. **Hook:** timelapse celého roku při rychlosti ×4, kamera nad městem u jezera.
2. **Stav × přechod:** nákres časové osy prosince s `t`, `dominantSeason` a `seasonWeight`. Ukázat
   testy v `seasons.test.ts`.
3. **Terén:** palety, `lerp`, přepis barev. Spočítat nahlas, kolik dat se přebarvuje, a vysvětlit
   `SEASON_STEPS`.
4. **Stébla:** přepnout na zimu, přiblížit a ukázat ojedinělá stébla ve sněhu (alfa 0,06).
5. **Stromy:** změna barvy materiálu = změna všech stromů naráz. Živě v konzoli změnit barvu
   jednoho materiálu.
6. **Sníh na střechách:** nákres sklonu a `normal.y`, pak algoritmus `createSnowRoofGeometry`.
   Ladicí trik: dočasně dát sněhu červenou barvu, aby bylo vidět, které plochy dostal.
7. **Z-fighting:** dočasně nastavit posun 0 a `polygonOffset: false`, oddálit a ukázat blikání
   na šikmých střechách. Nákres hloubkového bufferu.
8. **Oprava verand:** before/after commit `0e9fec8` na domku z suburban kitu.
9. **Led a listí:** krátce, s odkazem na díly 12 a 15.
10. **Outro:** příště částice: kouř, padající listí, mlha a včely.

## Cvičení

- Přidejte páté „období“ `'mud'` (blátivé předjaří) mezi zimu a jaro: hnědá tráva, šedivé stromy.
  Co všechno je potřeba upravit (`SEASON_ORDER`, `FIRST_MONTH`, palety, testy)?
- Udělejte sníh na střechách plynulý: místo `visible` měňte průhlednost sněhu podle
  `seasonWeight(blend, 'winter')`. Proč to není tak jednoduché? (Nápověda: průhledné objekty a řazení,
  díl 15; alternativa je zmenšovat sníh „odtáváním“ podle šumu v shaderu, jako led na vodě.)
- Upravte práh `normal.y ≥ 0.3` na 0,7. Které střechy přijdou o sníh?
- Zkuste UV sněhu brát ze světových souřadnic místo souřadnic budovy. Co se změní na sousedních
  budovách stejného typu?
