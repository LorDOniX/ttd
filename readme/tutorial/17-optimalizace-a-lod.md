# Díl 17 – Optimalizace a úrovně detailu (LOD)

> **Soubory:** `src/world/map.ts` (log změn), `src/render/terrain.ts`, `src/render/trees.ts`,
> `src/render/staticObjects.ts`, `src/render/camera.ts` (`inView`), `src/render/gameView.ts`,
> `src/render/buildingLod.ts`, `src/render/treeLod.ts`, `src/render/buildings.ts`
> **Commity:** `c5729ee` (Fáze 9: překreslování jen změněných dlaždic), `3349613` (FPS v HUD),
> `ce81cba` (optimalizace: BatchedMesh, zmrazení matic, scéna popisků), `cdf0c14`, `95adfb8`
> (noční světla), `b20c153` (LOD budov a stromů)

## O čem je tento díl

Hra na mapě 512×512 má statisíce dlaždic, tisíce budov a stromů, stovky aut a chodců – a má běžet
plynule v prohlížeči. Tenhle díl shrnuje, co všechno pro to bylo potřeba udělat:

- jak výkon **měřit** a jak rozumět rozpočtu snímku,
- jak nepřepočítávat svět, který se nezměnil (**log změn mapy**),
- jak šetřit CPU (matice, alokace, popisky) a GPU (draw cally, culling, drobnosti při oddálení),
- jak automaticky vyrobit **zjednodušené modely** budov a stromů pro pohled z dálky.

Na konci divák uvidí oddálenou mapu velkého světa, kde se při zoomu nenápadně přepíná mezi plnými
a zjednodušenými budovami a stromy, a FPS počítadlo, které se nehne.

## Teorie

### Rozpočet snímku

Při 60 FPS má jeden snímek **16,6 ms**. Do nich se musí vejít:

```
CPU (JavaScript)                         GPU
├─ herní logika (vlaky, auta, města)     ├─ vertex shadery (všechny vrcholy)
├─ synchronizace scény s daty            ├─ rasterizace
├─ animace (zápis matic instancí)        └─ fragment shadery (všechny pixely, × překreslení)
├─ three.js: matice objektů, culling,
│  řazení, příprava draw callů
└─ odeslání dat a příkazů do GPU
```

CPU a GPU běží souběžně, snímek trvá tak dlouho, jak trvá **pomalejší** z nich. Proto je první
otázka vždy: *kdo je úzké hrdlo?*

- Hra se zpomalí, když se zvětší okno nebo přiblíží pixely (víc fragmentů) → **GPU, fragmenty**.
- Zpomalí se s počtem objektů bez ohledu na velikost okna → **CPU nebo draw cally**.
- Zasekne se jednorázově (jeden dlouhý snímek) → typicky **kompilace shaderu** nebo velký upload.

### Čím měřit

- **FPS v HUD.** Commit `3349613` přidal počítadlo zapínané v Nastavení. Počítá snímky za sekundu
  přímo ve smyčce (`hud.countFrame(now)`), takže ukazuje skutečnou plynulost:

  ```ts
  this.fpsFrames++;
  const elapsed = now - this.fpsStart;
  if (elapsed < 1000) return;
  this.fpsEl.textContent = `${Math.round((this.fpsFrames * 1000) / elapsed)} FPS`;
  ```

- **`renderer.info`** v three.js: `info.render.calls` (draw cally za snímek), `info.render.triangles`,
  `info.programs.length` (počet zkompilovaných shaderů). Stačí vypsat do konzole.
- **Záložka Performance** v DevTools: nahrát pár sekund, najít dlouhé snímky a podívat se, které
  funkce v nich trvají nejdéle. Přesně takhle vznikla čísla v commitu `c5729ee` níže.
- **`performance.now()`** kolem podezřelé funkce, když potřebujete číslo pro jeden konkrétní krok.

Pravidlo: **nejdřív měřit, pak optimalizovat**. Většina technik v tomto dílu vznikla jako reakce
na konkrétní naměřený problém.

### Draw cally

Každý `Mesh` ve scéně = aspoň jeden draw call. Draw call sám o sobě GPU nezatěžuje, ale jeho
příprava stojí CPU čas (přepnutí shaderu, nastavení uniformů a bufferů, ověření stavu ve WebGL).
Stovky jsou v pořádku, desítky tisíc ne. Řešení – instancing, batching, slučování – probírá
[díl 06](06-instancing-a-draw-cally.md). Tady na něj jen navážeme.

### Level of detail

Budova vzdálená tak, že zabírá 10×10 pixelů, nepotřebuje 2000 trojúhelníků s okenními rámy –
většina trojúhelníků by byla menší než pixel. Kromě zbytečné práce vertex shaderu to vadí i
rasterizaci: GPU zpracovává pixely po čtvercích 2×2, a trojúhelník menší než pixel plýtvá většinou
výpočtů. **LOD** (level of detail) znamená mít zjednodušenou verzi objektu a přepnout na ni, když
je malý na obrazovce.

V ortografické kameře velikost na obrazovce nezávisí na vzdálenosti, jen na **zoomu**. Přepínání je
proto jednoduché – podle `camera.zoom`, pro všechny objekty najednou.

## Implementace

### 1. Log změn mapy (`c5729ee`)

První skutečný výkonnostní problém se objevil při stavbě kolejí na velké mapě. Z commit message:

> Při stavbě koleje na mapě 512×512 stála obsluha každého položeného dílku přes 15 ms (přebarvení
> celého terénu 9,3 ms, přestavba silnic 4,1 ms, kolejí 2,1 ms, stromy navíc) – dílky přibývají 25×
> za sekundu, takže to zabíralo skoro celý snímek.

Každá vrstva při jakékoli změně mapy přepočítala **všech** 262 144 dlaždic. Řešení: mapa si vede
seznam indexů změněných dlaždic, a každá vrstva si čte jen to, co je nového od jejího posledního
čtení.

```ts
set(x: number, y: number, type: TileType): void {
  const i = y * this.width + x;
  if (this.tiles[i] === type) return;
  this.tiles[i] = type;
  this.record(i);
}

// Pozice konce logu změn; čtenář si ji pamatuje jako kurzor
get changeCursor(): number {
  return this.logStart + this.changeLog.length;
}

// Změněné dlaždice od kurzoru; null = log se mezitím zahodil a je třeba překreslit vše
changesSince(cursor: number): number[] | null {
  if (cursor < this.logStart) return null;
  return this.changeLog.slice(cursor - this.logStart);
}
```

Každá vrstva má vlastního čtenáře s kurzorem:

```ts
// Čte změny mapy od posledního čtení; každá vrstva má vlastního čtenáře
export class MapChanges {
  private cursor: number;
  // …
  take(): number[] | null {
    const changes = this.map.changesSince(this.cursor);
    this.cursor = this.map.changeCursor;
    return changes;
  }
}
```

```
changeLog:  [ 1203, 1204, 5511, 1205, … ]
                         ▲              ▲
             kurzor terénu          kurzor stromů   → každý čte jen svou část
```

Detaily, které stojí za zmínku:

- Zapisují se jen **skutečné** změny (`if (this.tiles[i] === type) return`) – generátor nebo
  růst města, které „nastaví“ stejnou hodnotu, log nezaplní.
- Log nemůže růst donekonečna. Po 65 536 záznamech se zahodí a čtenář, který zaostal, dostane `null`
  = „překresli všechno“. Je to bezpečná a jednoduchá pojistka místo složité správy paměti.
- Vrstvy reagují různě: terén přebarví jen změněné dlaždice; silnice se přestaví, jen když se
  dlaždice stala silnicí nebo jí přestala být; stromy vykácenou dlaždici jen schovají; koleje se
  přestaví nejvýš jednou za snímek (příznak `railDirty`).

Výsledek z commitu: **obsluha dílku 15,6 ms → 2,0 ms**, denní generování cestujících
(18 nástupišť) 0,70 ms → 0,04 ms.

### 2. Do GPU jen to, co se změnilo

Přebarvit pár dlaždic v `Float32Array` je rychlé. Pak se ale buffer musí nahrát do GPU, a bez
nápovědy three.js pošle **celý** atribut – pro terén 512×512 to jsou megabajty. `addUpdateRange`
řekne, které části se změnily (`terrain.ts`):

```ts
for (const i of new Set(changes)) {
  // …
  this.writeTileColor(colors.array as Float32Array, x, y);
  colors.addUpdateRange(i * 12, 12);
}
// …
colors.needsUpdate = true;
```

12 = 4 vrcholy dlaždice × 3 složky barvy. Three.js pak volá `bufferSubData` jen pro tyto rozsahy.
Stejný princip používají instance: skrytí vykáceného stromu nahraje jen jeho jednu matici
(`instanceMatrix.addUpdateRange(index * 16, 16)`), listí jen použitou část bufferu
([díl 15](15-casticove-efekty.md)).

Skrytí stromu je samo o sobě trik – instance se neodebírá (to by znamenalo přeskládat celý buffer),
jen dostane **nulové měřítko**:

```ts
// Vykácený strom: nulové měřítko instanci schová
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
```

Všechny vrcholy takové instance splynou do jednoho bodu a trojúhelníky s nulovou plochou GPU
zahodí ještě před rasterizací.

### 3. Méně draw callů: BatchedMesh (`ce81cba`)

Budovy byly původně `InstancedMesh` pro každou kombinaci modelu, fasády a dílu – každá z nich byl
samostatný draw call, a kombinací při desítkách modelů a deseti fasádách přibývalo s každým novým
typem budovy. Commit `ce81cba` je přesunul do
`BatchedMesh`: jedna dávka na materiál (paletu kitu), všechny různé geometrie v jednom bufferu,
jeden draw call. Podrobně v [dílu 06](06-instancing-a-draw-cally.md). Pro výkon jsou důležité dva
řádky:

```ts
// Neprůhledné budovy řadit netřeba, za snímek se jen vyřadí ty mimo záběr
this.mesh.sortObjects = false;
```

a kapacita s rezervou (`GROWTH = 1.5`), aby se buffery při růstu měst nepřestavovaly často.

### 4. Zmrazené matice (`ce81cba`)

Three.js při každém `render()` projde celý strom scény a každému objektu přepočítá matici z
`position`, `rotation`, `scale` (pokud má `matrixAutoUpdate = true`, což je výchozí). Průmyslový
areál je složený z desítek dílů (trámy, nádrže, hromady, plot) a nic z toho se nehýbe:

```ts
// Zmrazí matice statického podstromu: spočtou se teď jednou a renderer je pak každý snímek nepřepočítává.
// Animované části (userData.updateAnimation) i s potomky zůstávají živé.
export function freezeStatic(object: THREE.Object3D): void {
  if (object.userData.updateAnimation) return;
  object.updateMatrix();
  object.matrixAutoUpdate = false;
  for (const child of object.children) freezeStatic(child);
}
```

Kouř, kola těžních věží a čerpadla mají `updateAnimation` a zůstávají „živé“.

### 5. Oddělená scéna pro popisky (`ce81cba`)

Popisky měst a stanic jsou HTML elementy umístěné `CSS2DRendereru` ([díl 10](10-ui-nad-3d.md)).
`CSS2DRenderer.render(scene, camera)` prochází **celou** předanou scénu a hledá `CSS2DObject`.
Dokud se mu předávala hlavní scéna, procházel každý snímek tisíce meshů, aby našel pár desítek
popisků. Oprava je triviální – popisky mají vlastní scénu:

```ts
// Jen HTML popisky, aby je CSS2DRenderer nehledal mezi tisíci objekty hlavní scény
private readonly labelScene = new THREE.Scene();
// …
this.labelScene.add(this.labels.object, stationLabels.object, this.floatingTexts.object, this.industries.labels);
// …
this.renderer.render(this.scene, this.camera.camera);
this.labels.render(this.labelScene, this.camera.camera);
```

### 6. Ruční frustum culling

Three.js umí automaticky přeskočit objekt mimo záběr (`frustumCulled = true`): otestuje jeho
**obalovou kouli** (bounding sphere) proti šesti rovinám frusta. U `InstancedMesh` je ale koule
spočtená přes **všechny** instance. Pro chodce rozeseté po celé mapě je koule velká jako mapa a
test je k ničemu; a protože se chodci hýbou, musela by se navíc každý snímek přepočítat.

Hra to proto dělá obráceně: frustum spočte jednou za snímek (`camera.frustum()`), automatický
culling instancí vypne (`frustumCulled = false`) a do instancí zapíše **jen objekty v záběru**:

```ts
// Je koule kolem bodu aspoň zčásti v záběru kamery
export function inView(frustum: THREE.Frustum, x: number, y: number, z: number, radius: number): boolean {
  sphere.center.set(x, y, z);
  sphere.radius = radius;
  return frustum.intersectsSphere(sphere);
}
```

V `pedestrians.ts` se instance plní jen pro viditelné chodce a `mesh.count` se nastaví na jejich
počet:

```ts
this.placeBody(p);
const { x, y, z } = this.position;
if (!inView(frustum, x, y + HEIGHT / 2, z, HEIGHT)) continue;
const index = filled[p.variant]++;
```

Auta a vozy vlaků jsou samostatné objekty: auto se mimo záběr schová celé
(`view.group.visible = inView(frustum, x, y, z, 0.3)`), u vlaku každý vůz zvlášť, takže je renderer
vůbec neprochází. Listí a mlha jdou ještě dál: neprocházejí ani dlaždice mimo
obdélník, který kamera vidí ([díl 15](15-casticove-efekty.md)).

Statické instance stromů mají spočtenou obalovou kouli (`computeBoundingSphere()`) a automatický
culling přes celou vrstvu je pro ně levný. Zvířata, která se pohybují, mají `frustumCulled = false`.

### 7. Drobnosti se při oddálení nekreslí

Když je něco menší než pixel, nemá smysl to počítat ani kreslit. Každá vrstva drobností má práh
zoomu:

| Co | Konstanta | Zoom |
| --- | --- | --- |
| padající listí | `LEAF_MIN_ZOOM` | 0,9 |
| světla vozidel | `NIGHT_DETAIL_ZOOM` | 0,7 |
| mlha v lese | `FOREST_MIST_MIN_ZOOM` | 0,65 |
| plné budovy a stromy | `BUILDING_LOD_ZOOM`, `TREE_LOD_ZOOM` | 0,5 |
| zvířata | `ANIMALS_MIN_ZOOM` | 0,45 |

```ts
// Světla vozidel jsou při oddálení menší než pixel, jen by přidávala draw cally
const vehicleLights = this.lightsAmount > 0.5 && this.camera.camera.zoom >= NIGHT_DETAIL_ZOOM;
```

U zvířat se pod prahem nejen skryje vrstva, ale ani se nepočítá pohyb.

### 8. Stropy počtů

Kde počet závisí na tom, kolik toho kamera vidí, je pevný strop: `MAX_VISIBLE_LEAVES = 4000`,
`MAX_FOREST_MIST = 2400` na vrstvu, `MAX_TOWN_GLOWS = 1024`. Strop zaručí, že ani extrémní výřez
(velký monitor, oddálení přesně na hranici prahu) nevyrobí snímek, který by trval desítky ms.

### 9. Žádné alokace ve smyčce

Každé `new THREE.Vector3()` je objekt, který po snímku skončí jako odpad. Při tisících listů
a chodců za snímek to jsou statisíce objektů za sekundu a garbage collector se pak projeví jako
pravidelné zaškobrtnutí. Třídy, které běží každý snímek, si pomocné objekty drží jako pole:

```ts
export class FallingLeavesView {
  // …
  private readonly leaf = {} as FallingLeaf;
  private readonly near = new THREE.Vector3();
  private readonly far = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
```

a funkce dostávají výstupní parametr (`fallingLeaf(x, y, k, out)`). Modulové konstanty jako
`sphere` v `camera.ts` nebo `VIEW_SPHERE` v nočních světlech slouží stejnému účelu.

### 10. Nápověda pro GPU: `DynamicDrawUsage`

Buffery instancí chodců se přepisují každý snímek. Výchozí `StaticDrawUsage` říká ovladači
„nahraju jednou, budu často číst“; `DynamicDrawUsage` „budu často měnit“:

```ts
const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
```

Je to jen nápověda a efekt závisí na ovladači, ale nic nestojí.

### 11. Neaktualizovat, co se nezměnilo

Opakující se vzor celé hry: **porovnej s minulým stavem a když se nic nezměnilo, skonči.**

- Noční světla se přepočítají jen při změně soumraku, lamp nebo pohledu, a při pouhém pohybu kamery
  nejvýš jednou za 80 ms; lampy se přepečou, jen když se změnily jejich polohy
  ([díl 16](16-osvetleni-den-noc.md)).
- Roční období se přebarvuje v 10 krocích (`SEASON_STEPS`), ne každý herní den – každý krok
  přebarví celý terén ([díl 14](14-rocni-obdobi.md)).
- Asynchronní přestavby (budovy, stromy, zvířata) mají čítač `generation`: když mezitím začala
  novější přestavba, výsledek té starší se zahodí, místo aby se nejdřív postavil a pak hned
  přepsal.

### 12. LOD budov (`b20c153`)

Teď to hlavní. Budovy z Kenney commercial kitu mají stovky až tisíce trojúhelníků. Při oddálení na
celé město to dělá statisíce trojúhelníků, z nichž většina je menší než pixel.

#### Přepínání

`BuildingsView` drží dvě kompletní sady dávek – plnou a zjednodušenou – a podle zoomu zobrazí jednu:

```ts
// Při oddálení pod tento zoom se místo modelů kreslí jejich zjednodušené výškové mapy
export const BUILDING_LOD_ZOOM = 0.5;
// …
setZoom(zoom: number): void {
  const simplified = zoom < BUILDING_LOD_ZOOM;
  this.detailed.object.visible = !simplified;
  this.simplified.object.visible = simplified;
}
```

Zjednodušení se počítá **jednou na model a fasádu** a ukládá do `WeakMap` podle pole dílů (díly jsou
v cache načtených modelů, takže se při přestavbě města nepočítají znovu). Modely, které jsou už
jednoduché (méně než `LOD_MIN_TRIANGLES = 600`, typicky low-detail budovy s okny ze shaderu),
zůstávají beze změny:

```ts
const geometry = triangles >= LOD_MIN_TRIANGLES ? createLodGeometry(solid) : null;
lod = geometry ? [{ geometry, material: solid[0].material, matrix: new THREE.Matrix4() }] : parts;
```

#### Algoritmus: výšková mapa z kvádrů

Myšlenka: z izometrického pohledu shora je budova hlavně **půdorys s výškami**. Zjednodušený model
je proto mřížka sloupců (kvádrů), každý s výškou a barvou podle původního modelu.

```
původní model (boční pohled)        výšková mapa 10 buněk
        ┌┐                                 ┌─┐
       ┌┘└┐   anténa, římsy, okna         ┌┘ └┐
       │  │                               │   │
   ┌───┘  └───┐                      ┌────┘   └────┐
   │ ▫ ▫  ▫ ▫ │                      │             │
───┴──────────┴───                ───┴─────────────┴───
```

**Krok 1 – mřížka.** Delší strana půdorysu se rozdělí na `CELLS = 10` buněk, kratší úměrně. Buňka
je při oddálení menší než dva pixely, takže víc rozlišení by nebylo vidět.

**Krok 2 – výška a barva střechy.** Pro každý trojúhelník s normálou nahoru se zjistí, nad kterými
středy buněk leží, a v nich se spočte jeho výška pomocí **barycentrických souřadnic**:

```ts
const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
// … pro každý střed buňky (px, pz) v obdélníku trojúhelníku
const wa = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
const wb = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
const wc = 1 - wa - wb;
if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
const y = wa * a.y + wb * b.y + wc * c.y;
```

Barycentrické souřadnice `(wa, wb, wc)` vyjadřují bod jako vážený průměr vrcholů trojúhelníku:

```
          a
         /\        bod P = wa·a + wb·b + wc·c,   wa + wb + wc = 1
        /  \       P je uvnitř ⇔ všechny váhy ≥ 0
       / P  \      výška v P = wa·a.y + wb·b.y + wc·c.y
      /______\
     c        b
```

Počítá se jen v rovině XZ (2D), výška se pak interpoluje. Buňka si pamatuje **nejvyšší** plochu
nad svým středem – to je střecha, kterou kamera shora uvidí. Barva = UV té plochy.

**Krok 3 – barvy stěn.** Trojúhelníky se strmou normálou (`|normal.y| < STEEP`) jsou stěny.
Každá se přiřadí sloupci kousek **za sebou** (uvnitř budovy) a jednomu ze čtyř směrů (+x, −x, +z,
−z). Ke každému směru se sčítá plocha podle barvy:

```ts
// Stěna patří sloupci kousek za ní, uvnitř budovy
const horizontal = Math.hypot(normal.x, normal.z);
const cx = (a.x + b.x + c.x) / 3 - (normal.x / horizontal) * cellX * 0.5;
// …
const swatch = swatches.get(key);
if (swatch) swatch.area += area;
else swatches.set(key, { u, v, area });
```

Stěna sloupce pak dostane barvu s **největší plochou** v daném směru (hledá se i o dva sloupce
dál – pod přesahem střechy). Tmavá okna a světlé příčky mezi nimi tak zůstanou naznačené jako
pruhy, protože každý sloupec vybírá barvu zvlášť.

**Krok 4 – slévání.** Kdyby každá buňka byla kvádr, měl by model až 100 střech a 400 stěn.
Sousední buňky se stejnou výškou a barvou se proto slijí do obdélníků (hladový algoritmus: rozšiř
doprava, pak dolů, dokud sedí):

```ts
// Střechy: sousední buňky se stejnou výškou a barvou se slijí do obdélníků
let width = 1;
while (fits(i + width, j)) width++;
let depth = 1;
while (Array.from({ length: width }, (_, k) => fits(i + k, j + depth)).every(Boolean)) depth++;
```

Stěny vznikají jen tam, kde je soused **nižší** (výška stěny = rozdíl výšek), a navazující úseky se
stejnou výškou i barvou se slijí do pásů. Plochý kvádr tak dá přesně 10 trojúhelníků (střecha
+ 4 stěny, spodek není vidět) – to ověřuje první test v `buildingLod.test.ts`.

**Proč UV a ne barvy vrcholů.** Zjednodušený model si ponechává **UV do palety** původního modelu.
Díky tomu:

- používá **stejný materiál** a patří do stejné `BatchedMesh` dávky jako plné modely,
- funguje **přebarvení fasád** (posun UV, [díl 05](05-modely-glb.md)) – zjednodušuje se už
  přebarvený model,
- funguje **osvětlení lamp** na fasádách ([díl 16](16-osvetleni-den-noc.md)), protože jde o stejný
  upravený materiál.

Trojúhelníky musí mířit ven (pořadí vrcholů proti směru hodin při pohledu zvenku), jinak by je
backface culling zahodil. Funkce `quad` proto pořadí otočí podle požadované normály, a test
„plochy míří ven podle normál“ to hlídá. Třetí test ověřuje, že věž na nižší budově přidá stěny
jen nad sousední střechou.

### 13. LOD stromů

Stromy z nature kitu mají koruny s mnoha ploškami. Zjednodušení v `treeLod.ts` využívá toho, že
koruna i kmen jsou zhruba **rotačně souměrné** kolem svislé osy. Místo výškové mapy se tedy dělá
„soustružený“ tvar (lathe):

```
model koruny      průřezy ve 4 výškách       hranol se 6 stěnami
    /\               ─── r₃ (malý)                 /\
   /  \              ───── r₂                     /  \
  /    \             ─────── r₁                  /    \
  \____/             ────── r₀                   \____/
```

1. Ve `levels` výškách se změří **průřez**: největší vzdálenost od osy, kde hrany trojúhelníků
   protínají vodorovnou rovinu (`crossSection`). Krajní vrstvy se měří kousek od spodku a vršku
   (`EDGE_INSET`), kde má díl ještě skutečnou šířku.
2. Z poloměrů vznikne hranol se `sides` stěnami: kmen 4 stěny a 2 vrstvy, koruna 6 stěn a 4 vrstvy
   (`TRUNK_LOD`, `CROWN_LOD`).
3. Když je horní průřez menší než 30 % největšího (`APEX_RATIO`), vrchol se sbíhá do **špičky**
   (jehličnany); jinak dostane plochý vršek. Spodek zůstává otevřený – kamera se dívá shora.

```ts
const apex = rings[levels - 1].radius < widest * APEX_RATIO;
// …
for (let k = 0; k < sides; k++) {
  if (apex) triangle(ring(lastRing, k), ring(lastRing, k + 1), tip);
  // Plochý vršek jako vějíř z prvního vrcholu
  else if (k > 0 && k < sides - 1) triangle(ring(lastRing, 0), ring(lastRing, k), ring(lastRing, k + 1));
}
```

Kmen se pozná podle názvu materiálu z kitu (`woodBark…`). Pokud by zjednodušení nezmenšilo počet
trojúhelníků, díl zůstane původní:

```ts
if (!geometry || geometry.getAttribute('position').count / 3 >= triangles) {
  geometry?.dispose();
  return part;
}
```

Zjednodušené stromy mají stejný materiál jako plné, takže dál fungují barvy ročních období i vítr
v shaderu. Obě sady instancí vznikají v `refresh()` najednou a vykácený strom se schová v obou
(`meshesByModel` obsahuje plné i zjednodušené díly). Přepínání je stejné jako u budov
(`TREE_LOD_ZOOM = 0.5`). Testy v `treeLod.test.ts` ověřují, že kužel skončí špičkou a válec
plochým vrškem a že všechny plochy míří ven.

## Úskalí

- **Nejdřív změřit.** Commit `c5729ee` začíná rozpisem, kolik která vrstva stojí (terén 9,3 ms,
  silnice 4,1 ms, koleje 2,1 ms). Bez toho by se snadno optimalizovalo něco, co nebylo problém.
- **Zahozený log.** Čtenář, který zaostane (třeba vrstva vytvořená později), musí umět překreslit
  všechno – proto `take()` vrací `null`, a ne prázdné pole.
- **`frustumCulled` u dynamických instancí** (na co si dát pozor). Kdyby zůstal zapnutý, three.js by
  použil obalovou kouli spočtenou při vytvoření; instance, které z ní vyjedou, by na kraji obrazovky
  nečekaně mizely.
- **Bodová světla** jako výkonnostní past – celé v [dílu 16](16-osvetleni-den-noc.md)
  (`cdf0c14` → `95adfb8`).
- **LOD skoky.** Přepnutí při zoomu 0,5 je vidět jako drobná změna siluet. Práh je zvolený tak, že
  buňka výškové mapy je v tu chvíli menší než dva pixely; při vyšším prahu by byl skok výraznější,
  při nižším by plné modely stály výkon déle.
- **Stěny pod přesahem** (na co si dát pozor). Kdyby se barva stěny brala jen ze sloupce těsně za
  stěnou, pod přesahem střechy by tam žádná svislá plocha nebyla a sloupec by dostal barvu střechy.
  Proto `wallUv` hledá až o dva sloupce dál (`step < 3`) a barvu střechy použije, jen když nic
  nenajde (schody šikmé střechy).

## Scénář videa

1. **Hook:** velká mapa 512×512, oddálení na celé město, FPS počítadlo stojí.
2. **Rozpočet snímku:** nákres CPU vs. GPU, 16,6 ms; jak poznat úzké hrdlo.
3. **Měření:** zapnout FPS v Nastavení, ukázat `renderer.info.render.calls` v konzoli, nahrát profil
   při stavbě koleje (na commitu před `c5729ee`).
4. **Log změn:** nákres logu s kurzory, projít `GameMap.record`, `changesSince`, `MapChanges.take`;
   čísla 15,6 → 2,0 ms.
5. **addUpdateRange a skrývání instancí** nulovou maticí.
6. **CPU úspory:** freezeStatic, labelScene, alokace ve smyčce (ukázat v profileru pilu GC).
7. **Culling:** proč automatický culling u instancí nefunguje, `inView`, `mesh.count`.
8. **Prahy zoomu a stropy:** tabulka, oddálit a ukázat, co mizí.
9. **LOD budov:** wireframe (`material.wireframe = true`) plné vs. zjednodušené budovy; projít
   čtyři kroky algoritmu s nákresy; vysvětlit barycentrické souřadnice.
10. **LOD stromů:** průřezy, hranol, špička vs. plochý vršek.
11. **Shrnutí:** měřit → nepočítat zbytečně → nekreslit zbytečně → kreslit jednodušeji.

## Cvičení

- Vypište `renderer.info.render.calls` a `triangles` při zoomu 0,49 a 0,51 (těsně kolem prahu LOD).
  O kolik se liší?
- Přidejte do `createLodGeometry` parametr `cells` a vyzkoušejte 5 a 20 buněk. Při jakém zoomu by
  se který hodil? Zkuste udělat tři úrovně detailu.
- Najděte ve hře další vrstvu, která by si zasloužila práh zoomu (nápověda: semafory, závory,
  návěstidla).
- Vytvořte v DevTools profil, kde se při procházení mapy projevuje garbage collector. Pak najděte
  v kódu smyčku, která alokuje, a přepište ji na znovupoužívané objekty.
- V `src/world/map.ts` zmenšete `MAX_CHANGE_LOG` na 10 a ověřte, že hra stále funguje (jen pomaleji).
  Proč je pojistka „překresli vše“ důležitá?
