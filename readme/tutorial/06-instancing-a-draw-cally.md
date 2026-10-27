# Díl 06 – Tisíce objektů: draw cally, instancing a batching

> **Soubory:** `src/render/buildings.ts` (`GeometryBatch`, `BuildingBatches`), `src/render/trees.ts`,
> `src/render/rail.ts` (`box`, `pieceGeometry`, `TrackView`), `src/render/roads.ts` (lampy),
> `src/render/fallingLeaves.ts`, `src/render/ambientProps.ts`, `src/render/staticObjects.ts`
> **Commity:** `0c3ee3f` (Fáze 2 – instancované budovy), `db8ceee` (stromy), `5d8dbee` (koleje),
> `c5729ee` (Fáze 9 – skrývání stromů), `ce81cba` (optimalizace: BatchedMesh, freezeStatic)

## O čem je tento díl

Mapa 256×256 má desítky tisíc stromů, tisíce budov, stovky lamp a kusů kolejí. Kdybychom každý
objekt vložili do scény jako samostatný `Mesh`, hra by se zadusila dřív, než by GPU vůbec začalo
pořádně pracovat. V tomhle dílu:

- vysvětlíme, co je **draw call** a proč je drahý hlavně pro CPU,
- projdeme čtyři strategie kreslení mnoha objektů: samostatné meshe, **sloučená geometrie**,
  **InstancedMesh** a **BatchedMesh**,
- ukážeme, kde je hra používá a proč zrovna tam,
- vyřešíme dvě praktické věci: souběh asynchronních přestaveb (čítač `generation`) a zbytečné
  přepočítávání matic statických objektů (`freezeStatic`).

## Teorie

### Co se děje při `renderer.render()`

Pro každý viditelný `Mesh` three.js (zjednodušeně) udělá:

```
CPU                                                   GPU
 ├─ spočítá matrixWorld objektu (pokud se změnila)
 ├─ frustum culling: je bounding sphere v záběru?
 ├─ vybere/zkompiluje shader program pro materiál
 ├─ nastaví stav: program, textury, blending, depth…   ──►  přepnutí stavu
 ├─ nahraje uniformy (matice objektu, barva…)          ──►
 └─ gl.drawElements(…)  ← DRAW CALL                    ──►  vrcholy → trojúhelníky → pixely
```

GPU je extrémně rychlé v kreslení **velkého množství trojúhelníků najednou**. Pomalá je ta
„administrativa“ kolem: každý draw call stojí CPU čas v JavaScriptu, ve WebGL vrstvě prohlížeče
i v ovladači. Orientačně: pár set draw callů za snímek je v pohodě, desítky tisíc ne – a to bez
ohledu na to, jestli má každý objekt 12 trojúhelníků, nebo 1 200.

**Pravidlo:** méně draw callů s víc trojúhelníky je skoro vždy lepší než mnoho malých.

### Jak to měřit

three.js počítá statistiky posledního snímku v `renderer.info`. Hra je sama nevypisuje, ale do
konzole si je přidáte jedním řádkem (třeba dočasně na konec `GameView.frame()`):

```ts
console.log(this.renderer.info.render.calls, this.renderer.info.render.triangles);
```

`calls` je počet draw callů, `triangles` počet trojúhelníků. Hra sama ukazuje jen FPS v horní
liště (`Hud.countFrame` v `src/ui/hud.ts`).

### Čtyři strategie

```
1) samostatné Meshe       ■ ■ ■ ■ ■ ■     N objektů  = N draw callů        flexibilní, pomalé
2) sloučená geometrie     ▦               1 geometrie = 1 draw call         rychlé, ale „zmrazené“
3) InstancedMesh          ■×N             1 geometrie × N matic = 1 call    stejný tvar, různé polohy
4) BatchedMesh            ■▲●×N           K geometrií × N instancí = 1 call různé tvary, stejný materiál
```

**Sloučení geometrie** (`mergeGeometries`) slepí vrcholy více geometrií do jednoho bufferu.
Výsledek je obyčejná geometrie – nejde jednotlivé kusy posunout ani schovat bez přestavby.

**Instancing** pošle GPU jednu geometrii a pole matic. Vertex shader dostane navíc atribut
`instanceMatrix` a pro každou kopii (instanci) ho použije:

```glsl
// zjednodušeně, co three.js vloží do vertex shaderu InstancedMesh
vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
```

Celý les jednoho druhu stromu je tak jeden draw call. Omezení: všechny instance mají **stejnou
geometrii a stejný materiál**. Liší se jen maticí (a volitelně barvou `instanceColor`).

**BatchedMesh** (v three.js od r159) jde dál: do jednoho velkého bufferu nahraje **více různých
geometrií** a každá instance si vybere, kterou z nich kreslí. Pod kapotou používá
multi-draw (`WEBGL_multi_draw`) – z pohledu CPU je to jeden příkaz. Omezení: stejný materiál
a stejná sada atributů pro všechny geometrie v dávce.

## Implementace

### 1. Sloučená geometrie: koleje, nástupiště, depa

Procedurální stavby v `src/render/rail.ts` jsou poskládané z kvádrů. Každý kvádr nese barvu ve
vrcholech, takže celé depo může mít jeden materiál `MeshLambertMaterial({ vertexColors: true })`:

```ts
// Kvádr s barvou ve vrcholech, posunutý na (x, y, z) dle spodní hrany
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Depo s vjezdem ve směru +X
function depotGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.7, 0.42, 0.04, WALL, -0.05, 0, -0.36),
    box(0.7, 0.42, 0.04, WALL, -0.05, 0, 0.36),
    // …
    box(0.82, 0.06, 0.86, ROOF, -0.05, 0.42, 0),
  ])!;
}
```

Barva ve vrcholech místo barvy materiálu je klíčový trik: šest kvádrů různých barev by jinak
potřebovalo šest materiálů a šest draw callů. Takhle je depo jedna geometrie, jeden materiál,
jeden draw call. `mergeGeometries` vyžaduje, aby všechny vstupy měly stejné atributy – proto
každý kvádr dostane atribut `color`, i když by jinak stačila barva materiálu.

Stejně vzniká kus koleje (štěrk + pražce + dvě kolejnice), nástupiště, mosty a světla vozidel
(`lightMarkerGeometry` v `nightLights.ts`: „jeden draw call na vozidlo“).

### 2. InstancedMesh: kusy kolejí, lampy, stromy

Kus koleje je sloučená geometrie a celá síť kolejí je pak **instancovaná**: jeden `InstancedMesh`
pro rovné kusy, jeden pro rohové, jeden pro přejezdy a jeden pro mostovky (`TrackView`). Celá
železnice hráče tak stojí čtyři draw cally, ať je dlouhá jakkoli.

```ts
private replace(old: THREE.InstancedMesh, geometry: THREE.BufferGeometry, items: TrackItem[], deck = false) {
  let mesh = old;
  if (old.instanceMatrix.count < items.length) {
    this.object.remove(old);
    old.dispose();
    mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(64, items.length * 2));
    this.object.add(mesh);
  }
  const m = new THREE.Matrix4();
  items.forEach((item, i) => {
    const lift = item.bridge && !deck ? BRIDGE_DECK : 0;
    mesh.setMatrixAt(i, pieceMatrix(item.x, item.y, item.piece, deck ? -0.002 : lift, m));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
```

Tři věci, které se u InstancedMesh opakují všude:

- **Kapacita vs. `count`.** Velikost bufferu matic se zadává v konstruktoru a nejde zvětšit.
  Kreslí se ale jen prvních `count` instancí. Proto se alokuje s rezervou (`items.length * 2`)
  a nový mesh se vytvoří, až když rezerva dojde.
- **`instanceMatrix.needsUpdate = true`** – bez toho three.js nové matice na GPU nepošle.
- **`computeBoundingSphere()`** – three.js dělá frustum culling celého InstancedMeshe podle
  jedné koule přes všechny instance. Když ji po změně nepřepočítáte, může mesh zmizet, protože
  „je mimo záběr“ podle staré koule.

Pouliční lampy v `roads.ts` jsou dva InstancedMeshe (sloupy a hlavy), protože hlava má jiný
materiál – v noci svítí (`emissive`, [díl 16](16-osvetleni-den-noc.md)). `AmbientPropsView`
(lavičky, popelnice, keře…) seskupuje drobnosti podle klíče `tvar:barva` a z každé skupiny
udělá jeden InstancedMesh.

### 3. Stromy: model z více dílů a skrývání nulovou maticí

Strom z nature kitu má víc dílů (typicky kmen a korunu) s různými materiály. Instancuje se tedy **každý
díl zvlášť**, se stejnými maticemi umístění (`TreesView.refresh` v `trees.ts`):

```ts
const instanced = (parts: Parts, model: number): THREE.InstancedMesh[] =>
  parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, matrices[model].length));
    const m = new THREE.Matrix4();
    matrices[model].forEach((placement, i) => mesh.setMatrixAt(i, m.multiplyMatrices(placement, part.matrix)));
    mesh.count = matrices[model].length;
    mesh.computeBoundingSphere();
    return mesh;
  });
```

Matice instance je zase řetěz z [dílu 05](05-modely-glb.md): `placement × part.matrix`, tedy
poloha na dlaždici × normalizace dílu. 15 modelů stromů × jejich díly = pár desítek draw callů pro celý les.

Co když hráč postaví kolej přes les? Přestavět všechny instance by trvalo (v commitu `c5729ee`
se měřilo, že stavba koleje na mapě 512×512 stála přes 15 ms na dílek). Stromy proto jen ubývají
a vykácený strom se **schová maticí s nulovým měřítkem**:

```ts
// Vykácený strom: nulové měřítko instanci schová
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// Stromy jen ubývají: vykácené dlaždice se skryjí bez přestavby celé vrstvy
sync(): void {
  // …
  for (const i of changes) {
    const instances = this.instancesByTile.get(i);
    if (!instances || this.map.tiles[i] === TileType.Trees) continue;
    this.instancesByTile.delete(i);
    for (const [model, index] of instances) {
      for (const mesh of this.meshesByModel[model]) {
        mesh.setMatrixAt(index, HIDDEN);
        mesh.instanceMatrix.addUpdateRange(index * 16, 16);
        touched.add(mesh);
      }
    }
  }
  for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
}
```

- Matice samých nul „smáčkne“ všechny vrcholy do jednoho bodu, trojúhelníky mají nulovou plochu
  a GPU je zahodí ještě před rasterizací. Draw call se tím nezmenší, ale skrytí je okamžité.
- `addUpdateRange(index * 16, 16)` říká, že se změnilo jen 16 čísel (jedna matice 4×4). three.js
  pak přes `bufferSubData` pošle na GPU jen tenhle kousek, ne celý buffer s desítkami tisíc matic.
- Mapa `instancesByTile` pamatuje, které instance patří ke které dlaždici – bez ní bychom nevěděli,
  co schovat.

### 4. Instance, které se mění každý snímek: listí

Padající listí ([díl 15](15-casticove-efekty.md)) přepisuje matice každý snímek, ale jen pro
listy v záběru. Mesh má pevnou kapacitu `MAX_VISIBLE_LEAVES = 4000` a nastavuje se `count`
a rozsah k nahrání:

```ts
this.mesh.count = count;
const { instanceMatrix, instanceColor } = this.mesh;
instanceMatrix.clearUpdateRanges();
instanceMatrix.addUpdateRange(0, count * 16);
instanceMatrix.needsUpdate = true;
```

Mesh má `frustumCulled = false` – instance mimo záběr vyřadil už náš kód, a bounding sphere by
se jinak musela počítat každý snímek. Chodci (`pedestrians.ts`) navíc nastavují
`instanceMatrix.setUsage(THREE.DynamicDrawUsage)` jako nápovědu ovladači, že se buffer často mění.

### 5. Budovy: od InstancedMesh k BatchedMesh

Budovy byly instancované od Fáze 2 – jeden InstancedMesh **na každý díl každého modelu**:

```ts
// Budovy všech měst jako instancované meshe, jeden na každou část modelu   (stará verze)
const mesh = new THREE.InstancedMesh(part.geometry, part.material, group.matrices.length);
```

S přibývajícími variantami to ale rostlo multiplikativně: přes 50 modelů budov × 10 barevných fasád
× díly modelu × verze se sněhem. Každá kombinace byla samostatný InstancedMesh a draw call –
i když všechny používají **stejnou texturu palety**. V commitu `ce81cba` se budovy přepsaly na
`BatchedMesh`: všechny díly se stejným materiálem a stejnými atributy jdou do jedné dávky.

Klíč dávky:

```ts
// Všechny modely jednoho kitu sdílejí paletu colormap, každý soubor má ale vlastní kopii materiálu;
// díly se proto řadí podle kitu, názvu materiálu a atributů a kreslí se prvním materiálem skupiny
const key = `${kit}|${part.material.type}|${part.material.name}|${attributeSignature(part.geometry)}`;
```

a signatura atributů, protože BatchedMesh vyžaduje u všech geometrií stejnou sadu:

```ts
// Atributy a index geometrie; do jedné dávky smějí jen geometrie se stejnými
function attributeSignature(geometry: THREE.BufferGeometry): string {
  const attributes = Object.entries(geometry.attributes)
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}`)
    .sort();
  return `${attributes.join(',')}|${geometry.index ? 'indexed' : 'flat'}`;
}
```

Budovy s okny ze shaderu mají navíc atributy `facade` a `facadeSurface` ([díl 13](13-shadery-okna-a-vitr.md)),
proto skončí ve vlastní dávce – ostatně mají i jiný (zkopírovaný) materiál.

### 6. GeometryBatch: rezerva a přepis místo přestavby

Třída `GeometryBatch` obaluje jeden BatchedMesh. BatchedMesh má tři kapacity – počet instancí,
počet vrcholů a počet indexů – a na rozdíl od InstancedMesh je umí zvětšit (`setInstanceCount`,
`setGeometrySize`). Zvětšení ale znamená realokaci bufferů, takže se dělá s rezervou:

```ts
// Kapacita dávky roste s rezervou, aby se buffery při růstu měst nepřestavovaly často
const GROWTH = 1.5;

// Jeden BatchedMesh pro díly se stejným materiálem a atributy, kreslí se jedním voláním. Geometrie se do
// dávky nahrají jen jednou, při přestavbě měst se přepisují jen instance.
export class GeometryBatch {
  constructor(material: THREE.Material, items: readonly BatchItem[]) {
    const fresh = this.freshGeometries(items);
    this.vertexCapacity = Math.ceil(Math.max(1, sumVertices(fresh)) * GROWTH);
    this.indexCapacity = Math.ceil(Math.max(1, sumIndices(fresh)) * GROWTH);
    this.mesh = new THREE.BatchedMesh(
      Math.ceil(Math.max(1, items.length) * GROWTH),
      this.vertexCapacity,
      this.indexCapacity,
      material,
    );
    // Neprůhledné budovy řadit netřeba, za snímek se jen vyřadí ty mimo záběr
    this.mesh.sortObjects = false;
    this.set(items);
  }
```

Metoda `set` je jádro. Když město vyroste, nevytváří nic od nuly:

```ts
set(items: readonly BatchItem[]): void {
  const { mesh } = this;
  const fresh = this.freshGeometries(items);
  // … případně zvětšit setGeometrySize s rezervou GROWTH
  for (const geometry of fresh) {
    this.geometryIds.set(geometry, mesh.addGeometry(geometry));
    // … počítadla vrcholů a indexů
  }

  if (items.length > mesh.maxInstanceCount) mesh.setInstanceCount(Math.ceil(items.length * GROWTH));
  items.forEach(({ geometry, matrix }, i) => {
    const geometryId = this.geometryIds.get(geometry)!;
    let id = this.instanceIds[i];
    if (id === undefined) {
      id = mesh.addInstance(geometryId);
      this.instanceIds.push(id);
    } else {
      mesh.setGeometryIdAt(id, geometryId);
    }
    mesh.setMatrixAt(id, matrix);
  });
  for (const id of this.instanceIds.splice(items.length)) mesh.deleteInstance(id);
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}
```

- `addGeometry` nahraje geometrii do sdíleného bufferu **jen jednou** (mapa `geometryIds`).
  Nový model nebo nová fasáda přidá vrcholy, opakované použití nestojí nic.
- Existující instance se **přepíšou** (`setGeometryIdAt` + `setMatrixAt`) – slot č. 5 může být
  minule kancelář a teď rodinný dům. Instance navíc se smažou (`deleteInstance`).
- `sortObjects = false`: BatchedMesh umí instance řadit podle vzdálenosti (kvůli průhlednosti
  nebo early-z). U neprůhledných budov to jen stojí CPU. Per-instance frustum culling
  (`perObjectFrustumCulled`, výchozí zapnutý) zůstává – budovy mimo záběr se nekreslí.

Výsledek: všechny budovy jednoho kitu a materiálu = jeden draw call, plus jedna dávka se sněhem
na střechách ([díl 14](14-rocni-obdobi.md)), plus totéž pro zjednodušené LOD modely
([díl 17](17-optimalizace-a-lod.md)), z nichž je vždy vidět jen jedna sada.

### 7. Souběh asynchronních přestaveb: `generation`

`BuildingsView.rebuild` je `async` – čeká na načtení modelů. Když město vyroste dvakrát rychle
po sobě, může starší přestavba doběhnout **po** novější a přepsat ji starými daty. Řeší to
jednoduchý čítač:

```ts
async rebuild(towns: readonly Town[]): Promise<void> {
  const generation = ++this.generation;
  // … seskupení budov podle modelu a fasády
  const loaded = await Promise.all(/* … loadFacade … */);
  // Mezitím mohl začít novější rebuild
  if (generation !== this.generation) return;

  this.detailed.set(loaded);
  this.simplified.set(loaded.map((group) => ({ ...group, parts: lodOf(group.parts) })));
}
```

Každé volání si zapamatuje své číslo; po `await` pokračuje jen to nejnovější. Stejný vzor má
`TreesView.refresh`. Podobně `IndustriesView.build` kontroluje, jestli závod mezitím nezanikl.

### 8. Statické objekty: `freezeStatic`

Průmyslové areály ([díl 15](15-casticove-efekty.md) – kouř, větrník) jsou složené ze stovek
malých meshů v hierarchii skupin. three.js ve výchozím stavu při každém `render()` přepočítá
`matrix` a `matrixWorld` **každého** objektu ve scéně (`matrixAutoUpdate = true`). Pro objekty,
které se nehýbou, je to zbytečná práce:

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

`matrixWorld` se dál počítá z rodiče, takže když by se pohnula celá skupina, děti ji následují.
Animované části (lopatky větrníku, kouř) se přeskočí i s potomky.

Ve stejném commitu se z hlavní scény vyčlenily HTML popisky do vlastní `labelScene` –
`CSS2DRenderer` jinak při každém snímku procházel tisíce objektů hlavní scény, jen aby našel
pár popisků ([díl 10](10-ui-nad-3d.md)).

## Kdy použít co

| Situace | Řešení | Příklad ve hře |
| --- | --- | --- |
| Pár unikátních objektů, často se mění | samostatné `Mesh` | přejezdy se závorami, vlaky (klony modelů) |
| Statický tvar z mnoha kusů různých barev | `mergeGeometries` + barvy ve vrcholech | depo, nástupiště, kus koleje, mosty |
| Stejný tvar na mnoha místech | `InstancedMesh` | kusy kolejí, stromy, lampy, návěstidla, listí, chodci |
| Různé tvary se stejným materiálem | `BatchedMesh` | budovy měst (+ sníh, + LOD) |
| Statická hierarchie mnoha meshů | `matrixAutoUpdate = false` | průmyslové areály |

## Úskalí

- **InstancedMesh nejde zvětšit.** Kdo zapomene na rezervu, vytváří nový mesh při každém
  přidaném kusu koleje. `TrackView` alokuje dvojnásobek, `PedestriansView.allocate` taky.
- **Zapomenutý `computeBoundingSphere()`** – objekty „náhodně“ mizí na okraji obrazovky,
  protože three.js cullingem vyřadí celý mesh podle staré koule.
- **Výběr myší je u instancí složitější.** `Raycaster` u InstancedMesh vrací `instanceId`
  a z něj je potřeba dohledat herní objekt. Vlaky, na které se kliká, jsou ve hře běžné klony
  modelů ve skupině a `TrainsView.pick` jen hledá, do které skupiny zásah patří
  ([díl 08](08-vlaky.md)).
- **Kombinatorický výbuch variant.** Před `ce81cba` stačilo přidat 10 fasád a počet draw callů
  budov se zdesetinásobil. Batching podle materiálu tohle odstřihl: nová varianta přidá jen
  geometrii, ne draw call.
- **Async bez `generation`** se projevuje nepravidelně – jen při rychlém sledu událostí (růst
  města + načtení hry). Takové chyby se špatně hledají, proto je lepší čítač psát rovnou.

## Scénář videa

1. **Hook:** prázdná scéna s 10 000 krychlemi jako samostatnými meshi → FPS padá. Totéž jako
   InstancedMesh → plynulé.
2. **Teorie:** nákres CPU → GPU a draw callu, „administrativa je drahá, ne trojúhelníky“.
3. **Měření:** přidat `renderer.info` výpis do hry, ukázat čísla na velké mapě.
4. **Sloučená geometrie:** `box()` s barvou ve vrcholech, `depotGeometry()`.
5. **InstancedMesh:** `TrackView.replace` – kapacita, count, needsUpdate, bounding sphere.
6. **Stromy:** postavit kolej přes les, vysvětlit `HIDDEN` a `addUpdateRange`.
7. **BatchedMesh:** nákres „K geometrií v jednom bufferu“, klíč dávky, `GeometryBatch.set`.
   Ukázat `renderer.info.render.calls` před (`git checkout ce81cba~1`) a po.
8. **Souběh:** animace dvou přestaveb s `await`, čítač `generation`.
9. **freezeStatic** ve dvou větách.
10. **Tabulka „kdy co“** a pozvánka na stavbu kolejí.

## Cvičení

- Vypište `renderer.info.render.calls` při oddáleném a přiblíženém pohledu. Proč se liší?
  (Nápověda: per-instance culling BatchedMesh a LOD.)
- Změňte v `TrackView.replace` rezervu z `items.length * 2` na `items.length`. Kolikrát se
  při tažení dlouhé trati vytvoří nový mesh?
- Zkuste schovat strom místo nulové matice posunem pod terén (`makeTranslation(0, -10, 0)`).
  Funguje to? Co by se stalo s bounding sphere?
- Převeďte `SignalsView` (návěstidla) z `InstancedMesh` na `BatchedMesh`. Vyplatí se to?
