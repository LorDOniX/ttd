# Díl 15 – Částicové efekty: kouř, listí, mlha, včely

> **Soubory:** `src/render/industries.ts` (kouř), `src/render/fallingLeaves.ts`, `src/render/forestMist.ts`,
> `src/render/animals.ts`, `src/render/gameView.ts`
> **Commity:** `3eba113` (efekty kouře), `6d1b1fe` (padající listí), `86d5ac0` (včely), `5a478de` (mlha),
> `3349613` (fix kouře + FPS), `0d79d89` (pauza částicových systémů)

## O čem je tento díl

Statická scéna vypadá jako maketa. Stačí pár drobností, které se hýbou, a svět ožije: kouř z komínů
elektrárny, listí padající v podzimním lese, opar mezi stromy, včely nad pasekou. V tomhle dílu:

- vysvětlíme, jak GPU kreslí **průhledné** objekty a proč jsou s nimi potíže (pořadí, depth buffer),
- postavíme **kouř** z obyčejných koulí, které rostou a mizí,
- uděláme **padající listí** jako *bezstavové částice*: žádné pole částic, žádná simulace, jen funkce
  času a hashe dlaždice,
- vrstvíme **mlhu** z průsvitných ploch s procedurální texturou,
- necháme lesem chodit **zvířata** a létat **včely**,
- zařídíme, aby efekty **stály při pauze** a aby se **nekreslily, když nejsou vidět**.

Na konci divák uvidí podzimní les při plném přiblížení: kroužící listy, které dosedají na zem
a zmenšují se, nízký opar a kouřící pilu v pozadí.

## Teorie

### Jak se kreslí neprůhledné objekty: depth buffer

GPU kreslí trojúhelník po trojúhelníku. Aby bližší objekt zakryl vzdálenější bez ohledu na to,
který se kreslí první, má každý pixel kromě barvy ještě **hloubku** (depth buffer, z-buffer):

```
pro každý pixel trojúhelníku:
  if (hloubka_pixelu < depthBuffer[x, y]) {   // depthTest
    colorBuffer[x, y] = barva                  // zápis barvy
    depthBuffer[x, y] = hloubka_pixelu         // depthWrite
  }
```

U neprůhledných objektů je to geniální: pořadí kreslení je jedno, výsledek je vždy správný.

### Proč průhlednost všechno kazí

Průsvitný pixel nemá barvu *nahradit*, ale *smíchat* s tím, co už v bufferu je (alpha blending):

```
výsledek = barva_zdroje · α  +  barva_v_bufferu · (1 − α)
```

Tím vzniká závislost na pořadí. Za průsvitnou koulí kouře musí být **už nakreslené** všechno, co
je za ní – jinak se nemá s čím míchat. Proto three.js kreslí scénu ve dvou průchodech:

1. **neprůhledné objekty** (seřazené zepředu dozadu, aby depth test zahodil co nejvíc pixelů brzo),
2. **průhledné objekty** (`material.transparent = true`) seřazené **zezadu dopředu** podle
   vzdálenosti *středu objektu* od kamery.

Řadí se celé objekty, ne trojúhelníky ani instance. Dvě protínající se průsvitné koule, nebo
tisíc instancí v jednom `InstancedMesh`, tedy správně seřadit nejde.

### `depthWrite: false`

Představte si dvě průsvitné koule kouře za sebou, které se kreslí v „špatném“ pořadí (bližší
první). Bližší zapíše do depth bufferu svou hloubku, a když přijde na řadu vzdálenější, depth
test ji v překryvu **zahodí** – v kouři vznikne ostrá díra ve tvaru bližší koule.

Řešení: průsvitné částice hloubku **testují** (schovají se za budovu), ale **nezapisují**:

```
depthTest:  true   – kouř za komínem není vidět
depthWrite: false  – kouř nezakrývá jiný kouř, jen se s ním míchá
```

Při špatném pořadí je pak výsledek jen trochu jinak tónovaný, což u kouře nebo mlhy nikdo nepozná.

### `renderOrder`

Řazení podle vzdálenosti lze přebít ručně: `object.renderOrder` má přednost před vzdáleností.
Hra ho používá jako vrstvy: záře měst v noci má `renderOrder = 1`, kouř a mlha `2`. Kouř se tak
vždy kreslí až po záři a míchá se s ní, ne naopak.

### Additive blending

Pro světlo platí jiný vzorec – světlo se **sčítá**:

```
výsledek = barva_zdroje · α + barva_v_bufferu
```

Sčítání je komutativní, takže **na pořadí vůbec nezáleží**. Proto se aditivně kreslí záře, jiskry,
ohně a světelné kužely (`blending: THREE.AdditiveBlending`). Ve hře takhle svítí záře měst
v noci ([díl 16](16-osvetleni-den-noc.md)). Kouř ale světlo nevyzařuje, ten zakrývá – potřebuje
klasický alpha blending.

### Alternativa: alpha test

Když je pixel buď celý vidět, nebo vůbec (list, plot, tráva), není potřeba míchat. `alphaTest: 0.5`
pixely s nízkou alfou zahodí a zbytek se kreslí jako neprůhledný – se zápisem hloubky a bez řazení.
Takhle se ve hře kreslí silnice z atlasu ([díl 07](07-stavba-koleji.md)).

### Stavové a bezstavové částice

Klasický částicový systém drží pole částic a každý snímek je posune o `rychlost · dt`, nové rodí,
staré zabíjí. Pro listí v celém lese by to znamenalo statisíce záznamů.

**Bezstavová** částice je čistá funkce:

```
poloha = f(parametry_z_hashe_dlaždice, čas)
```

Parametry (výška, rychlost, fáze, barva) se spočtou z hashe souřadnic dlaždice, poloha z času.
Nic se neukládá; částici můžeme kdykoliv „vytvořit“ znovu a bude přesně tam, kde by byla. Díky tomu
stačí počítat jen částice **v záběru kamery**. Cena: částice nemůže reagovat na okolí (vítr,
kolize). Pro dekorativní efekty je to ale ideální.

## Implementace

### 1. Kouř z komínů

Kouř vznikl ve stejném commitu jako animované díly průmyslu (`3eba113`). Jeden „oblak“ jsou čtyři
koule s posunutou fází. Každá koule běží v cyklu 0 → 1: stoupá, roste, slábne, a na konci cyklu
skočí zpět dolů – ale protože je v tu chvíli úplně průhledná, skok není vidět.

```ts
function smoke(): THREE.Group {
  const plume = new THREE.Group();
  const puffs = Array.from({ length: 4 }, (_, i) => {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x45494a, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    puff.renderOrder = 2;
    plume.add(puff);
    return { mesh: puff, phase: i / 4 };
  });
  return animated(plume, (seconds) => {
    for (const { mesh: puff, phase } of puffs) {
      const cycle = (seconds * 0.38 + phase) % 1;
      puff.position.set(Math.sin(seconds * 0.7 + phase * Math.PI * 2) * cycle * 0.11, cycle * 0.75, 0);
      puff.scale.setScalar(0.7 + cycle * 1.5);
      (puff.material as THREE.MeshBasicMaterial).opacity = (1 - cycle) * 0.42;
    }
  });
}
```

Rozbor parametrů cyklu:

```
cycle:        0 ─────────────────────────► 1   (pak skok na 0)
výška y:      0                            0,75
měřítko:      0,7                          2,2      (koule se rozplývá)
opacity:      0,42                         0        (mizí)
výchylka x:   sin(...) · cycle · 0,11      – čím výš, tím víc se kouř vlní
```

- **`MeshBasicMaterial`** – kouř se neosvětluje, barvu má danou. Šedé koule pod Lambertem by měly
  světlou a stinnou stranu a vypadaly by jako kuličky, ne jako dým.
- **Vlastní materiál pro každou kouli** – `opacity` je vlastnost materiálu, a každá koule má jinou.
  Stojí to draw call na kouli, ale komínů je na mapě pár desítek, takže to nevadí. U tisíců částic
  by se opacity musela předat jinak (atribut instance, viz listí níže).
- **Nízký počet segmentů** `SphereGeometry(0.15, 8, 6)` – rozmazaná průsvitná koule obrys skryje.

Kouř se navěsí nad komín podle výšky modelu, kterou si funkce `kenney()` uloží do `userData`:

```ts
async function smokingChimney(name: string, footprint: number, x: number, z: number): Promise<THREE.Object3D> {
  const chimney = await kenney(name, footprint, x, z);
  const plume = smoke();
  plume.position.y = chimney.userData.modelHeight + 0.02;
  chimney.add(plume);
  return chimney;
}
```

Animaci nese objekt sám, v `userData.updateAnimation`:

```ts
function animated<T extends THREE.Object3D>(object: T, update: (seconds: number) => void): T {
  object.userData.updateAnimation = update;
  return object;
}
```

Při stavbě areálu se strom objektů jednou projde a všechny animace se posbírají do pole; každý
snímek se pak volá jen toto pole, bez procházení scény:

```ts
area.traverse((part) => {
  const update = part.userData.updateAnimation;
  if (typeof update === 'function') view.animations.push(update as (seconds: number) => void);
  // …
});
```

Stejný mechanismus používají otáčející se kola těžní věže, kývající se čerpadla ropy a lopatky
větrného mlýna. Zbytek areálu je statický a jeho matice se „zmrazí“ (`freezeStatic`, [díl 17](17-optimalizace-a-lod.md)) –
objekty s `updateAnimation` se ze zmrazení vynechají.

### 2. Padající listí

#### Kde listí padá

Ne z každého stromu. O tom, jestli z dlaždice padá listí, rozhoduje hash – stejný typ hashe,
který známe z rozmístění stromů ([díl 04](04-generovani-sveta.md)):

```ts
export function hasFallingLeaves(map: GameMap, x: number, y: number): boolean {
  return map.tiles[y * map.width + x] === TileType.Trees && tileHash(x, y, 300) < LEAF_CHANCE;
}
```

`LEAF_CHANCE = 0.27`, tedy zhruba z každé čtvrté lesní dlaždice, a z každé `LEAVES_PER_TILE = 3`
listy.

#### Parametry listu z hashe

```ts
// Parametry k-tého listu dlaždice jsou z hashe, takže se listy nikde neukládají a vznikají jen v záběru
export function fallingLeaf(x: number, y: number, k: number, out = {} as FallingLeaf): FallingLeaf {
  const salt = k * 16;
  out.x = x + 0.25 + tileHash(x, y, 301 + salt) * 0.5;
  out.z = y + 0.25 + tileHash(x, y, 302 + salt) * 0.5;
  out.height = 0.85 + tileHash(x, y, 303 + salt) * 0.75;
  out.phase = tileHash(x, y, 304 + salt);
  out.speed = 0.12 + tileHash(x, y, 305 + salt) * 0.06;
  // … drift, rotation, size, tint
  return out;
}
```

Každý parametr má vlastní „sůl“, aby spolu nekorelovaly (vysoký list nesmí být automaticky
i rychlý). Parametr `out` umožňuje znovupoužít jeden objekt – ve smyčce přes tisíce listů tak
nevzniká žádný odpad pro garbage collector.

#### Kyvadlový let

List nepadá rovně. Skutečný list se houpe ze strany na stranu jako kyvadlo a v krajních bodech se
naklopí a trochu zvedne. Funkce `place()` to skládá ze sinusů:

```ts
const progress = (seconds * leaf.speed + leaf.phase) % 1;
const fall = Math.min(1, progress / LAND_AT);
// Kyvadlový let: list se houpá ze strany na stranu, na krajních bodech se nakloní a mírně zvedne;
// těsně nad zemí se kyv utlumí, aby list dosedl naplocho
const air = Math.min(1, (1 - fall) * 8);
const swing = Math.sin(seconds * 2.4 + leaf.phase * Math.PI * 2) * air;
const yaw = leaf.rotation + Math.sin(seconds * 0.5 + leaf.phase * 3) * 0.6;
this.position.set(
  leaf.x + leaf.driftX * fall + Math.sin(yaw) * swing * 0.1,
  Math.max(0.012, leaf.height * (1 - fall)) + swing * swing * 0.03,
  leaf.z + leaf.driftZ * fall + Math.cos(yaw) * swing * 0.1,
);
```

Časová osa jednoho listu:

```
progress  0 ──── 0,05 ─────────────────────── 0,88 ────────── 1
          vyroste      padá a houpe se         dopadne  leží a zmenšuje se
          (grow)       (fall 0→1, swing)       (LAND_AT)  (shrink)
```

- `swing * swing * 0.03` – **kvadrát** výchylky: list se zvedá na obou krajích kyvu, ne jen na
  jednom. Přesně tohle dělá kyvadlo.
- `air` – posledních 1/8 pádu se kyv tlumí k nule, aby list dosedl naplocho, a ne „zapíchnutý“.
- Náklon `-swing * 0.65` kolem osy X v pořadí rotací `'YXZ'`: nejdřív otočení podle směru letu
  (`yaw`), pak náklon do strany kyvu.
- List se na začátku z ničeho zvětší (`grow`) a na zemi zmenší (`shrink`) – stejný trik jako
  průhlednost na konci cyklu kouře: skok zpět na začátek není vidět.

#### Low-poly list

Geometrie listu je ručně zapsaných 9 trojúhelníků: stopka, žilka a dvě poloviny čepele zvednuté
do tvaru V (`fold`). Barvy vrcholů dělají světlejší žilku, tmavší okraje a hnědou stopku:

```
              l1───l2───l3
             / \   |   / \
  stem─base ────── mid ────── tip       pohled shora; l* a r* jsou zvednuté o fold
             \ /   |   \ /
              r1───r2───r3
```

```ts
const LEAF_MATERIAL = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  side: THREE.DoubleSide,
});
```

- **`flatShading`** – každý trojúhelník má jednu normálu, takže plošky čepele jsou při naklápění
  různě světlé. List tak „bliká“ podle natočení ke slunci, což při pohybu působí velmi živě.
- **`DoubleSide`** – list se točí a je vidět i zespodu; bez toho by GPU rub zahodilo (backface culling).
- Barva vrcholu se **násobí** barvou instance. Každý list má navíc jednu z předpočítaných barev
  `LEAF_TINTS` (6 podzimních tónů × 4 odstíny přes `offsetHSL`).

#### Jeden InstancedMesh na celé listí

Všechny listy jsou instance jednoho meshe s pevnou kapacitou:

```ts
private readonly mesh = new THREE.InstancedMesh(LEAF_GEOMETRY, LEAF_MATERIAL, MAX_VISIBLE_LEAVES);
```

Každý snímek se instance vyplní znovu, jen pro listy v záběru, a do GPU se pošle jen použitá část:

```ts
if (this.place(fallingLeaf(x, y, k, this.leaf), seconds, frustum)) {
  this.mesh.setMatrixAt(count, this.matrix);
  this.mesh.setColorAt(count, LEAF_TINTS[this.leaf.tint]);
  count++;
}
// …
this.mesh.count = count;
const { instanceMatrix, instanceColor } = this.mesh;
instanceMatrix.clearUpdateRanges();
instanceMatrix.addUpdateRange(0, count * 16);
instanceMatrix.needsUpdate = true;
```

- `setColorAt` vytvoří atribut `instanceColor` – barva **na instanci**, proto stačí jeden materiál.
- `mesh.count` říká GPU, kolik instancí kreslit; kapacita bufferu zůstává.
- `addUpdateRange(0, count * 16)` – matice má 16 floatů, nahraje se jen prvních `count` matic.
- `MAX_VISIBLE_LEAVES = 4000` je strop: velký výřez lesa nesmí zahltit snímek.
- `frustumCulled = false` – three.js by jinak testoval kouli kolem *všech* instancí, kterou by
  bylo nutné každý snímek přepočítat. Výřez řešíme sami (viz dál).

#### Které dlaždice kamera vidí

Procházet celou mapu 512×512 každý snímek je zbytečné. `visibleTiles()` spočte obdélník dlaždic,
které kamera může vidět. Trik: rohy obrazovky se **unprojectnou** zpět do světa:

```ts
for (const nx of [-1, 1]) {
  for (const ny of [-1, 1]) {
    this.near.set(nx, ny, -1).unproject(camera);
    this.far.set(nx, ny, 1).unproject(camera);
    for (const height of [0, LEAF_TOP]) {
      const t = (height - this.near.y) / (this.far.y - this.near.y);
      const x = this.near.x + (this.far.x - this.near.x) * t;
      const z = this.near.z + (this.far.z - this.near.z) * t;
      // … min/max
    }
  }
}
```

```
     obrazovka (NDC)            svět
   (-1,1)      (1,1)
     ┌──────────┐          paprsek z rohu: near (z=-1) → far (z=1)
     │          │             \
     │          │              \  y = LEAF_TOP (1,65)  ← průsečík 1
     └──────────┘               \
   (-1,-1)     (1,-1)            \ y = 0 (zem)         ← průsečík 2
```

`unproject` převede bod z normalizovaných souřadnic obrazovky (NDC, −1..1) přes inverzní
projekci a inverzní matici kamery do světa. Pro každý roh dostaneme paprsek a protneme ho se
dvěma vodorovnými rovinami: zemí a nejvyšší výškou listu. Osm průsečíků ohraničí obdélník v XZ.
Proč dvě výšky? Při šikmém pohledu je list vysoko nad dlaždicí, která je mimo obrazovku, sám ale
vidět je. Okraj se rozšíří ještě o 1 dlaždici, protože list se od své dlaždice vzdálí driftem.

Uvnitř obdélníku se pak každý list ještě testuje přesně (`frustum.containsPoint`).

### 3. Mlha v lese

Mlha (`5a478de`) je zapínatelná v Nastavení a zobrazuje se jen na podzim. Je to opět
`InstancedMesh`, tentokrát vodorovných čtverců s texturou chomáče.

#### Procedurální textura chomáče

Textura 64×64 se vypočítá v JavaScriptu do `DataTexture`. Alfa je eliptický přechod od středu,
rozbitý několika sinusy, aby okraj nebyl kruhový:

```ts
const radius = Math.hypot(px * 0.92, py * 1.15);
const edge = Math.max(0, 1 - radius);
const wisps =
  0.72 +
  0.2 * Math.sin(px * 5 + Math.sin(py * 4) * 2) +
  0.14 * Math.sin(py * 9 + px * 3) +
  0.1 * Math.sin(px * 15 - py * 8);
const lobes = 0.72 + 0.28 * Math.sin(px * 3 + Math.sin(py * 3) * 2);
const alpha = Math.round(255 * Math.pow(edge, 0.9) * Math.max(0.16, wisps) * lobes);
pixels.set([224, 231, 228, alpha], (y * size + x) * 4);
```

Vnořený sinus `sin(px * 5 + sin(py * 4) * 2)` je levná náhrada šumu: vlny se zkroutí do
nepravidelných „vláken“. Barva je pro všechny pixely stejná, tvar nese jen alfa.

#### Tři vrstvy

```ts
const LAYERS = [
  { y: 0.015, width: 1, depth: 1, opacity: 0.62, drift: 0.08 },
  { y: 0.105, width: 1.38, depth: 1.25, opacity: 0.42, drift: 0.15 },
  { y: 0.22, width: 1.75, depth: 1.45, opacity: 0.28, drift: 0.23 },
] as const;
```

```
  y=0,22   ~~~~~~~~~~~~~~~~~~~~~~~~~~~    největší, nejřidší, nejvíc se unáší
  y=0,105    ~~~~~~~~~~~~~~~~~~~~~
  y=0,015      ~~~~~~~~~~~~~~~            nejmenší, nejhustší, u země
  ─────────────────────────────────── zem
```

Každá vrstva je vlastní `InstancedMesh` s klonem materiálu s jinou `opacity` (opacity je
uniform, tedy pro celý draw call stejná). Výš je mlha řidší a víc se rozplývá – při pohledu
z izometrické kamery to dává dojem objemu, i když jde jen o tři ploché vrstvy. Polohy se
každý snímek posouvají po malých kružnicích (`Math.sin(layerDrift * 0.7) * puff.drift`) a čtverce
se pomalu otáčejí, takže se opar „převaluje“.

Materiál má `depthWrite: false` a `renderOrder = 2` (stejně jako kouř) a `toneMapped: false`.

### 4. Zvířata a včely

Zvířata z kitu *cube pets* (`animals.ts`) jsou na pomezí částic a herních objektů. Jejich výchozí
rozmístění je opět z hashe (jen lesní dlaždice s aspoň dvěma lesními sousedy, u vody může být
bobr), ale chodí – mají tedy stav: odkud, kam, kolik ušla, jak dlouho ještě stojí.

Pohyb je jednoduchý: zvíře stojí, pak si vybere sousední lesní dlaždici (přednostně jinou, než
odkud přišlo), lineárně k ní dojde, natočí se směrem chůze a zase chvíli stojí. Volba souseda je
z hashe dlaždice a čísla kroku, takže je deterministická.

Včely (`86d5ac0`) mají navíc výšku letu a nad pohybem po dlaždicích kmitají:

```ts
// Včela ve vzduchu kmitá nahoru a dolů a kličkuje do stran
private animalMatrix(animal: RoamingAnimal): THREE.Matrix4 {
  const position = new THREE.Vector3(animal.x, 0, animal.z);
  if (animal.altitude > 0) {
    const t = this.time + animal.phase;
    position.x += Math.sin(t * 1.5) * 0.06;
    position.z += Math.cos(t * 1.2 + animal.phase) * 0.06;
    position.y = animal.altitude + Math.sin(t * 5) * 0.025 + Math.sin(t * 1.3) * 0.05;
  }
  // …
}
```

Rychlé kmitání (`t * 5`) dává bzučení, pomalé (`t * 1.3`) houpání. Fáze z hashe zajistí, že
včely nekmitají synchronně. V zimě včely nelétají – jejich instance dostanou nulovou matici
`HIDDEN = makeScale(0, 0, 0)`, což je nejlevnější způsob, jak jednu instanci schovat.

### 5. Čas efektů a pauza

První verze předávala efektům reálný čas: `const seconds = now / 1000`. Výsledek? Při pauze hra
stála, ale kouř dál stoupal, listí padalo a voda se vlnila. Commit `0d79d89` zavedl vlastní čas
efektů, který při pauze stojí:

```ts
// Čas animací scény (kouř, listí, vlnky…) v sekundách; při pauze stojí
private effectsSeconds = 0;
// …
if (!this.game.clock.paused) this.effectsSeconds += Math.min(dtMs, 100) / 1000;
```

`Math.min(dtMs, 100)` řeší druhý problém: když je záložka prohlížeče na pozadí,
`requestAnimationFrame` neběží, a po návratu by `dt` bylo třeba 30 sekund – kouř by poskočil.
S omezením na 100 ms se animace po návratu prostě plynule rozběhne.

Protože jsou listí, mlha i voda funkce času (bezstavové), stačí jim místo `now` předat
`effectsSeconds` a pauza funguje sama. Stejně se přepnuly i blikající přejezdy:
`this.crossings.update(seconds * 1000, …)`.

### 6. Efekty se kreslí, jen když mají smysl

Každý efekt má práh zoomu, pod kterým by byl menší než pár pixelů a jen by stál výkon:

| Efekt | Konstanta | Hodnota |
| --- | --- | --- |
| padající listí | `LEAF_MIN_ZOOM` | 0,9 |
| mlha v lese | `FOREST_MIST_MIN_ZOOM` | 0,65 |
| zvířata a včely | `ANIMALS_MIN_ZOOM` | 0,45 |

A podmínky ročního období – listí i mlha jen na podzim:

```ts
update(seconds: number, camera: THREE.Camera & { zoom: number }, frustum: THREE.Frustum): void {
  const active = this.season === 'autumn' && camera.zoom >= LEAF_MIN_ZOOM;
  this.mesh.visible = active;
  if (!active) return;
  // …
}
```

Neviditelný efekt se nejen nekreslí, ale ani nepočítá – `return` je hned na začátku `update()`.
U zvířat se při oddálení neposouvají ani jejich polohy (`if (… || !this.object.visible) return;`).

## Úskalí

- **Kouř a osvětlení lamp (`3349613`).** Když přibylo noční osvětlení fasád
  ([díl 16](16-osvetleni-den-noc.md)), funkce `withLampLight` začala do shaderů všech materiálů
  v areálech vkládat výpočet světla lamp. Jenže kouř má `MeshBasicMaterial`, jehož shader nepočítá
  osvětlení – nemá normálu ani proměnnou `irradiance`, do které se kód vkládal. Oprava je jeden řádek:

  ```ts
  // Neosvětlený materiál (např. kouř) nemá ve shaderu normálu ani irradiance
  if (material instanceof THREE.MeshBasicMaterial) return;
  ```

  Ponaučení: když vkládáte kód do vestavěných shaderů, ověřte, že cílový chunk v daném typu
  materiálu opravdu existuje.
- **Efekty běžely při pauze** – viz `effectsSeconds` výše (`0d79d89`).
- **Řazení průhledných instancí.** Instance v jednom `InstancedMesh` se neřadí. U mlhy to nevadí
  díky `depthWrite: false` a nízké opacitě; kdyby vrstvy měly vysokou opacitu, bylo by na
  překryvech vidět, které se kreslily první.
- **Listí v zimě.** Listí se zapíná podle *převažujícího* období (`dominantSeason`), ne podle
  plynulého přechodu – list nemůže být „napůl“ ([díl 14](14-rocni-obdobi.md)).

## Scénář videa

1. **Ukázka:** podzimní les zblízka, kouřící elektrárna, zapnutí mlhy v Nastavení, včely nad lesem.
2. **Teorie průhlednosti:** nakreslit depth buffer, ukázat díru v kouři při `depthWrite: true`
   (dočasně přepnout v kódu), vysvětlit dva průchody three.js a `renderOrder`.
3. **Kouř:** projít `smoke()`, ukázat graf cyklu (výška, měřítko, opacity), mechanismus
   `updateAnimation`.
4. **Bezstavové částice:** srovnání „pole částic“ vs. „funkce času“; `fallingLeaf()` a soli hashe.
5. **Kyvadlo:** zpomalit čas (`seconds * 0.2`) a ukázat jeden list: kyv, zvednutí, dosednutí.
6. **InstancedMesh + setColorAt:** jeden draw call na všechno listí; `addUpdateRange`.
7. **visibleTiles:** nákres paprsků z rohů obrazovky, dočasně vypnout okraj +1 a ukázat, jak listy
   na kraji obrazovky mizí.
8. **Mlha:** vykreslit samotnou texturu chomáče, pak jednu vrstvu, pak všechny tři.
9. **Včely a zvířata:** krátce, ukázat skrytí instance nulovou maticí.
10. **Pauza:** pauza před a po commitu `0d79d89`; omezení `dt` na 100 ms při přepnutí záložky.
11. **Zoom prahy:** oddálit a ukázat, jak efekty mizí; zmínit, že se ani nepočítají.

## Cvičení

- Přidejte kouř i komínům rodinných domků v zimě. Kolik draw callů to přidá při 500 domech? Jak by
  se kouř musel přepsat na `InstancedMesh` (nápověda: opacity jako atribut instance nebo barva
  instance blížící se barvě pozadí)?
- Změňte `LAND_AT` na 1 – listy zmizí ve vzduchu. Proč? Co přesně dělá fáze ležení na zemi?
- Zkuste vyrobit sněžení v zimě stejnou technikou jako listí: parametry z hashe, poloha z času,
  bez stavu. Vločkám stačí `PlaneGeometry` otočená ke kameře a aditivní blending.
- V `visibleTiles` nahraďte výšku `LEAF_TOP` nulou a při šikmém pohledu sledujte horní okraj
  obrazovky.
- Nastavte mlze `depthWrite: true` a pozorujte ostré hrany na překryvech vrstev.
