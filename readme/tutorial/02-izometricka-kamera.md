# Díl 02 – Izometrická kamera jako v OpenTTD

> **Soubory:** `src/render/camera.ts`, `src/render/camera.test.ts`
> **Commity:** `7e98305` (Fáze 1: mapa a izometrická kamera), `0b64f9e` (otočení o 45°),
> `84e213b` (otáčení po 90°), `cf3253a` (pohled se ukládá), `c03b945` (větší zoom, frustum),
> `7b24377` (rotace tažením, oprava rychlého klikání)

## O čem je tento díl

OpenTTD je 2D hra kreslená ze spritů pod pevným úhlem. My kreslíme ve 3D, ale chceme, aby to
vypadalo stejně: dlaždice jako kosočtverec s poměrem stran 2:1, žádná perspektiva, budovy
vzadu stejně velké jako vpředu. Postavíme třídu `IsoCamera`, která umí:

- dimetrický pohled 2:1 spočítaný přesně, ne odhadem,
- zoom kolečkem **ke kurzoru** (bod pod myší se nehne),
- posun pravým tlačítkem, při kterém mapa jede přesně s myší,
- otočení o 90° s plynulou animací a volné otáčení s Shiftem,
- převod kliknutí na dlaždici (raycasting) a test „je objekt v záběru?“ (frustum).

## Teorie

### Perspektivní vs. ortografická projekce

Kamera dělá jedinou věc: převádí bod ve 3D světě na bod na obrazovce. Ten převod je matice
(projekční matice × matice pohledu). Existují dva základní druhy:

```
  Perspektivní                         Ortografická
  (PerspectiveCamera)                  (OrthographicCamera)

        oko                             ┌──────────────┐
        /|\                             │              │  paprsky rovnoběžné,
       / | \   paprsky z jednoho bodu   │              │  objekt stejně velký
      /  |  \  → vzdálené objekty menší │              │  v jakékoli vzdálenosti
     /   |   \                          │              │
    /____|____\  frustum = komolý jehlan└──────────────┘  frustum = kvádr
```

Pro budovatelskou hru chceme ortografickou: dlaždice musí být všude stejně velké, rovnoběžky
zůstanou rovnoběžkami a „zoom“ je jen zvětšení obrázku, ne pohyb kamery.

U `OrthographicCamera` nastavujeme obdélník `left/right/top/bottom` v jednotkách světa a vlastnost
`zoom`, kterou three.js obdélník dělí. `zoom = 2` znamená „vidím polovinu šířky i výšky“.

### Izometrie, dimetrie a proč 30°

Kamera se dívá z rohu mapy (po úhlopříčce dlaždic) a shora pod úhlem **elevace φ**.
Podívejme se, jak se při tom zobrazí jedna dlaždice 1×1:

```
  pohled shora                       pohled kamery (obrazovka)

     ┌───┐                                   /\
     │   │   úhlopříčka napříč (√2)         /  \     šířka = √2          (beze změny)
     └───┘   úhlopříčka podél  (√2)         \  /     výška = √2 · sin φ  (zkrácená)
                                             \/
```

Úhlopříčka kolmá ke směru pohledu leží v rovině obrazovky, takže zůstane dlouhá √2. Úhlopříčka
ve směru pohledu se „sklopí“ a na obrazovce ji vidíme zkrácenou na `√2 · sin φ`. Poměr šířky
a výšky kosočtverce je tedy:

```
  šířka / výška = 1 / sin φ
```

OpenTTD (a většina pixel-art „izometrie“) používá poměr **2:1**, protože se v pixelech dobře
kreslí (čára o dva pixely doprava a jeden nahoru). Z toho:

```
  1 / sin φ = 2   →   sin φ = 1/2   →   φ = 30°
```

Přesně vzato to není izometrie (ta má všechny tři osy zkrácené stejně, φ ≈ 35,26°, poměr √3:1),
ale **dimetrie**. První commit používal kameru v `(20, 20, 20)`, což je právě izometrie
s φ ≈ 35,26° – dlaždice vypadaly „vyšší“ než v OpenTTD.

Teď směr kamery. Kamera stojí v rohu mapy, takže vodorovná složka směru je `(1, ?, 1)` s délkou
√2. Chceme, aby `tan φ = y / √2`, tedy:

```
  y = √2 · tan 30°
```

V kódu přesně tak:

```ts
// Dimetrie 2:1 jako v OpenTTD: kamera z rohu mapy pod elevací 30°
const ISO_DIRECTION = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();
```

Vektor míří **od cíle ke kameře**. Kamera se umístí do `target + ISO_DIRECTION · 100` a dívá se
na `target`. Vzdálenost 100 je u ortografické kamery na obrazu nepozorovatelná – určuje jen,
kde leží ořezové roviny.

### Proč záporné `near`

```ts
this.camera.near = -1000;
this.camera.far = 1000;
```

U perspektivní kamery musí být `near > 0` (dělí se vzdáleností). U ortografické ne – rovina
`near` může ležet klidně **za** kamerou. Hodnoty ±1000 znamenají: kresli všechno v pásu
2000 jednotek kolem kamery, bez ohledu na to, kde přesně kamera stojí. Nikdy se tak nestane, že
by se při posunu nebo zoomu oříznul kus terénu nebo vysoký mrakodrap.

Cena: hloubkový buffer má omezenou přesnost a rozprostírá se přes 2000 jednotek. U ortografické
projekce je ale hloubka lineární (na rozdíl od perspektivy), takže přesnost stačí. Problémy
s „blikáním“ dvou ploch v téže výšce (z-fighting) přesto vzniknou – řešíme je posunem o milimetry
(`lift = 0.01` u mřížky, `0.005` u silnic) nebo `polygonOffset` ([díl 14](14-rocni-obdobi.md)).

### NDC a raycasting

Abychom zjistili, na kterou dlaždici hráč kliknul, potřebujeme jít opačným směrem než renderer:
z pixelu na obrazovce do světa.

**Normalized Device Coordinates (NDC)** jsou souřadnice obrazovky v rozsahu −1..1, s osou Y
nahoru (na rozdíl od pixelů, kde Y roste dolů):

```
  pixel (0,0) ───────────── (w,0)        NDC (-1, 1) ──────── (1, 1)
       │                      │                │                 │
       │                      │      →         │      (0,0)      │
       │                      │                │                 │
  (0,h) ─────────────────── (w,h)            (-1,-1) ──────── (1,-1)

  ndc.x =  (px / w) * 2 - 1
  ndc.y = -(py / h) * 2 + 1
```

`Raycaster.setFromCamera(ndc, camera)` z NDC vyrobí paprsek. U ortografické kamery mají všechny
paprsky **stejný směr** (směr pohledu) a liší se jen počátkem. Průsečík s rovinou země `y = 0`
je pak obyčejná rovnice přímky a roviny:

```
  bod paprsku:   P(t) = O + t · D
  rovina země:   N · P + d = 0,   N = (0, 1, 0), d = 0
  řešení:        t = -(N · O + d) / (N · D) = -O.y / D.y
```

### Frustum

Frustum je prostor, který kamera vidí – u ortografické kamery kvádr ohraničený šesti rovinami.
three.js ho umí vytáhnout přímo z matice `projekce × pohled`: každá rovina je součet nebo rozdíl
dvou řádků té matice. Test „leží koule ve frustu?“ je pak šest skalárních součinů – pro každou
rovinu `vzdálenost středu ≥ −poloměr`. Používáme ho všude tam, kde ručně vynecháváme objekty
mimo obrazovku ([díl 17](17-optimalizace-a-lod.md)).

## Implementace

### Konstrukce a velikost obrazu

```ts
export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera();
  readonly target = new THREE.Vector3();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  // …
  constructor(
    private readonly dom: HTMLElement,
    private readonly bounds: THREE.Box2,
    private readonly viewSize = 12,
  ) {
    const center = bounds.getCenter(new THREE.Vector2());
    this.target.set(center.x, 0, center.y);
    this.camera.near = -1000;
    this.camera.far = 1000;
    this.resize();
    this.bindEvents();
  }

  resize(): void {
    const aspect = this.dom.clientWidth / this.dom.clientHeight;
    this.camera.left = -this.viewSize * aspect;
    this.camera.right = this.viewSize * aspect;
    this.camera.top = this.viewSize;
    this.camera.bottom = -this.viewSize;
    this.camera.updateProjectionMatrix();
    this.updatePosition();
  }
```

Kamera se neovládá polohou, ale **cílem** (`target` – bod na zemi uprostřed obrazovky). Poloha se
z cíle vždy dopočítá:

```ts
private updatePosition(): void {
  this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.min.x, this.bounds.max.x);
  this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.min.y, this.bounds.max.y);
  const direction = ISO_DIRECTION.clone().applyAxisAngle(UP, this.azimuth);
  this.camera.position.copy(this.target).addScaledVector(direction, 100);
  this.camera.lookAt(this.target);
  this.camera.updateMatrixWorld();
}
```

- `bounds` je obdélník mapy, takže kamera neuteče do prázdna.
- `azimuth` je natočení kolem svislé osy (rotace pohledu, viz níže).
- `updateMatrixWorld()` hned přepočte matice. Bez toho by raycasting ve stejném eventu pracoval
  se starou polohou kamery (renderer matice přepočítá až při kreslení).

### Raycasting a bod na zemi

```ts
// Paprsek z kamery skrz bod obrazovky
ray(clientX: number, clientY: number): THREE.Raycaster {
  const rect = this.dom.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  this.raycaster.setFromCamera(ndc, this.camera);
  return this.raycaster;
}

// Průsečík paprsku z kurzoru se zemí (y = 0)
groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
  return this.ray(clientX, clientY).ray.intersectPlane(this.groundPlane, new THREE.Vector3());
}
```

Dlaždice pod kurzorem je pak jen `Math.floor(point.x), Math.floor(point.z)` (souřadnice
z [dílu 00](00-uvod.md)). Paprsek `ray()` se používá i pro výběr vlaku nebo auta: `GameView`
volá `this.trains.pick(this.camera.ray(clientX, clientY))` a `TrainsView.pick()` projde výsledky
`raycaster.intersectObject(this.object, true)` a od zasaženého meshe dohledá rodiče, kterému
vlak patří (vozidel je málo, takže raycast proti jejich trojúhelníkům je levný).

Proč průsečík s rovinou, a ne raycast proti meshi terénu? Rovina je jedna rovnice, raycast proti
131 tisícům trojúhelníků (mapa 256×256) by byl řádově pomalejší – a terén je stejně rovný.

### Zoom ke kurzoru

Nejjednodušší zoom (`camera.zoom *= factor`) zvětšuje kolem středu obrazovky. Hráč ale chce
zvětšit to, na co ukazuje myší. Trik: zapamatujeme si bod na zemi pod kurzorem, změníme zoom,
zjistíme, kam se pod kurzorem „posunul svět“, a cíl kamery posuneme o rozdíl zpátky:

```ts
this.dom.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const before = this.groundPoint(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.camera.updateProjectionMatrix();
    // Zoom ke kurzoru: bod pod kurzorem zůstává na místě
    const after = this.groundPoint(e.clientX, e.clientY);
    if (before && after) {
      this.target.add(before.sub(after));
      this.updatePosition();
    }
  },
  { passive: false },
);
```

```
  před zoomem:  kurzor ukazuje na bod B
  po zoomu:     kurzor ukazuje na bod A (svět se „roztáhl“ od středu)
  oprava:       target += B - A   → pod kurzorem je zase B
```

`Math.exp(-deltaY · k)` dělá zoom **multiplikativní**: stejný pohyb kolečkem vždy zvětší o stejné
procento, ať jste blízko, nebo daleko. Lineární `zoom += 0.1` by byl při oddálení skokový a při
přiblížení pomalý. `{ passive: false }` je nutné, jinak prohlížeč nedovolí `preventDefault()` a
stránka by scrollovala.

Rozsah zoomu je `MIN_ZOOM = 0.25` až `MAX_ZOOM = 12`. Původně bylo maximum 4. Když přibyli
chodci (`c03b945`), bylo potřeba přiblížit víc: „Nejbližší pohled ukáže zhruba dvě dlaždice na
výšku, aby byly vidět detaily postav a budov.“ (`viewSize = 12` → 24 dlaždic na výšku, děleno 12.)

### Posun ukotvením bodu

Stejná myšlenka: při stisku pravého tlačítka si zapamatujeme bod na zemi (`panAnchor`). Při
pohybu myši posuneme kameru tak, aby kotva byla zase pod kurzorem:

```ts
this.dom.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  this.dom.setPointerCapture(e.pointerId);
  this.rotatingPointer = e.shiftKey;
  this.panAnchor = this.rotatingPointer ? null : this.groundPoint(e.clientX, e.clientY);
  // …
});

this.dom.addEventListener('pointermove', (e) => {
  // … (otáčení s Shiftem)
  if (!this.panAnchor) return;
  const current = this.groundPoint(e.clientX, e.clientY);
  if (!current) return;
  this.target.add(this.panAnchor.clone().sub(current));
  this.updatePosition();
});
```

Mapa se tak „drží“ za kurzorem pixel po pixelu v jakémkoli zoomu a natočení – nikde není žádná
konstanta rychlosti posunu. `setPointerCapture` zajistí, že pohyb dostáváme i když myš opustí
canvas (třeba nad oknem UI).

### Posun klávesami: proč dělit `|up|²`

Šipkami se mapa posouvá o zlomek obrazovky za sekundu. Tady už kotvu nemáme, musíme spočítat,
jak daleko po zemi odpovídá posun obrazu:

```ts
// Posun pohledu o zlomky výšky obrazovky (kladné dx doprava, dy nahoru), nezávisle na otočení a zoomu
pan(dx: number, dy: number): void {
  const span = (2 * this.viewSize) / this.camera.zoom;
  const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).setY(0);
  // Svislý posun na obrazovce je na zemi delší o 1 / sin(elevace) = 1 / |up|
  up.divideScalar(up.lengthSq());
  this.target.addScaledVector(right, dx * span).addScaledVector(up, dy * span);
  this.updatePosition();
}
```

- `span` je výška obrazovky ve světových jednotkách (`2 · viewSize / zoom`).
- Sloupce matice `matrixWorld` kamery jsou její osy ve světě: sloupec 0 = „doprava“, sloupec
  1 = „nahoru na obrazovce“.
- Osa „doprava“ je vodorovná, stačí ji znormovat.
- Osa „nahoru“ je skloněná (míří šikmo vzhůru do scény). Její vodorovná složka má délku
  `sin φ = 0,5` (kosinus doplňkového úhlu):

```
          up kamery (délka 1)
            ↖
             \  90° - φ
              \
   ─────────────●─────── země
         vodorovná složka = sin φ
```

Posun o 1 jednotku nahoru na obrazovce odpovídá posunu o `1 / sin φ = 2` jednotky po zemi (země
je zkrácená stejně jako dlaždice). Vektor `up` délky `sin φ` tedy potřebujeme natáhnout na délku
`1 / sin φ`, což je vydělení `sin² φ = |up|²`. Jedna řádka, která funguje pro libovolnou elevaci.

### Otáčení o 90° s animací

Natočení pohledu se drží ve dvou proměnných: `azimuth` (aktuální úhel) a `targetAzimuth` (kam
se má dojet). Animace jde přes `requestAnimationFrame` nezávisle na herní smyčce:

```ts
// Otočí pohled o 90° (direction 1 = po směru hodinových ručiček)
rotate(direction: 1 | -1 = 1): void {
  this.targetAzimuth = nextRotationTarget(this.targetAzimuth, direction);
  const from = this.azimuth;
  const to = this.targetAzimuth;
  const start = performance.now();
  const animation = ++this.rotationAnimation;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ROTATION_MS);
    // Při rychlém klikání novou animaci nepřeruší stará
    if (animation !== this.rotationAnimation) return;
    this.azimuth = from + (to - from) * (1 - (1 - t) * (1 - t));
    this.updatePosition();
    if (t < 1) requestAnimationFrame(step);
    else this.azimuth = this.targetAzimuth;
  };
  requestAnimationFrame(step);
}
```

- **Easing** `1 − (1 − t)²` je „ease-out“: rychlý start, pomalé dojetí. Otočení trvá
  `ROTATION_MS = 300` ms.
- **Čítač animací** (`rotationAnimation`) je jednoduchý způsob zrušení: každá nová animace
  zvýší čítač, stará smyčka při dalším snímku zjistí, že už není aktuální, a skončí. Žádné
  `cancelAnimationFrame`, žádné ukládání id.

Pomocná funkce `nextRotationTarget` řeší situaci, kdy kamera není zarovnaná na násobek 90°
(hráč otáčel tažením s Shiftem nebo klikl uprostřed animace):

```ts
export function nextRotationTarget(angle: number, direction: 1 | -1): number {
  const step = angle / ROTATION_STEP;
  const nearest = Math.round(step);
  if (Math.abs(step - nearest) < ROTATION_EPSILON) return (nearest + direction) * ROTATION_STEP;
  return (direction > 0 ? Math.floor(step) + 1 : Math.ceil(step) - 1) * ROTATION_STEP;
}
```

Ze zarovnaného úhlu pokračuje o celý krok, z mezilehlého dojede nejdřív na nejbližší hranici ve
směru kliknutí. Protože je to čistá funkce, má vlastní testy (`src/render/camera.test.ts`):

```ts
it('z mezilehlého úhlu nejdřív dojede na nejbližší hranici ve směru kliknutí', () => {
  expect(nextRotationTarget(quarterTurn * 0.4, 1)).toBe(quarterTurn);
  expect(nextRotationTarget(quarterTurn * 0.4, -1)).toBe(0);
  // …
});
```

### Frustum a „je v záběru?“

```ts
// Aktuální záběr kamery pro vynechání objektů mimo obrazovku
frustum(): THREE.Frustum {
  this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
  return this.viewFrustum.setFromProjectionMatrix(this.viewProjection);
}

// Je koule kolem bodu aspoň zčásti v záběru kamery
export function inView(frustum: THREE.Frustum, x: number, y: number, z: number, radius: number): boolean {
  sphere.center.set(x, y, z);
  sphere.radius = radius;
  return frustum.intersectsSphere(sphere);
}
```

`GameView.frame()` spočte frustum jednou za snímek a předá ho vrstvám (chodci, vozidla, listí,
noční světla). `inView` používá jednu sdílenou `Sphere` na úrovni modulu, aby se v tisících
volání za snímek nealokovaly objekty (víc v [dílu 17](17-optimalizace-a-lod.md)).

### Uložení pohledu

Pohled se ukládá s hrou (`cf3253a`) jako cíl, zoom a natočení v krocích 0–3:

```ts
get view(): ViewState {
  const rotation = Math.round(this.targetAzimuth / ROTATION_STEP);
  return { x: this.target.x, z: this.target.z, zoom: this.camera.zoom, rotation: ((rotation % 4) + 4) % 4 };
}
```

`((r % 4) + 4) % 4` je bezpečné modulo pro záporná čísla (v JS je `-1 % 4 === -1`).

## Úskalí

- **Kamera z `(20, 20, 20)` není OpenTTD.** První commit měl izometrii, dlaždice vypadaly vyšší.
  Fáze 1 zavedla přesnou dimetrii s `√2 · tan 30°`.
- **Otočení o 45° vypadalo cize.** Commit `0b64f9e` přidal otáčení po 45°, ale pohled podél os
  dlaždic dlaždice zobrazil jako čtverce a z dimetrie se stal úplně jiný styl. O pár commitů
  později (`84e213b`): „90° zachová dimetrický pohled jako v OpenTTD, jen z jiné strany.“
- **Rychlé klikání na otočení.** První verze rušila starou animaci porovnáním cílového úhlu
  (`if (to !== this.targetAzimuth) return;`). S volným otáčením tažením to přestalo stačit
  a v `7b24377` přibyl čítač animací a funkce `nextRotationTarget`.
- **Všechno, co pracuje s myší, musí fungovat v každém natočení.** Proto výběr dlaždice, posun
  i zoom vycházejí z průsečíku paprsku se zemí, ne z pixelových výpočtů. Commit `0b64f9e` to
  zmiňuje výslovně – otočení nic dalšího nerozbilo.

## Scénář videa

1. Srovnání: screenshot OpenTTD vedle naší scény z dílu 01. „Proč to vypadá jinak?“
2. Perspektivní × ortografická kamera – přepnout v kódu a ukázat rozdíl na řadě budov.
3. Nákres dlaždice a odvození `1 / sin φ = 2 → φ = 30°`. Pak `ISO_DIRECTION` v kódu.
4. Záporné `near` – ukázat, co se stane s `near = 0.1` (ořezávání při posunu).
5. `target` místo polohy kamery, `updatePosition()`.
6. NDC nákres, `groundPoint`, výpis dlaždice pod kurzorem do konzole.
7. Zoom: nejdřív naivní (ke středu), pak „ke kurzoru“ se třemi řádky opravy.
8. Posun s kotvou – ukázat, že mapa jede s myší přesně v každém zoomu.
9. `pan()` pro šipky a nákres `sin φ` – proč dělit `|up|²`.
10. Rotace: easing a čítač animací, rychlé klikání, test `nextRotationTarget`.
11. Frustum jako upoutávka na optimalizace.

## Cvičení

- Změňte elevaci na 45° (`Math.tan(Math.PI / 4)`) a ověřte, že poměr kosočtverce je √2:1.
- Přidejte do `rotate()` jiný easing, např. `t < 0.5 ? 2t² : 1 − (−2t + 2)² / 2` (ease-in-out).
- Implementujte „zoom ke kurzoru“ i pro klávesy `+`/`−` (bod uprostřed obrazovky).
- Napište funkci, která z frusta spočte obdélník viditelných dlaždic (průsečíky čtyř rohových
  paprsků se zemí). Hra ji má pro padající listí – porovnejte s `visibleTiles()`
  v `src/render/fallingLeaves.ts` ([díl 15](15-casticove-efekty.md)).
