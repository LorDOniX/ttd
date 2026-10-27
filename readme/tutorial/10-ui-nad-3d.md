# Díl 10 – Uživatelské rozhraní nad 3D scénou

> **Soubory:** `src/ui/windows.ts`, `src/ui/hud.ts`, `src/ui/theme.ts`, `src/ui/dom.ts`, `src/ui/shortcuts.ts`,
> `src/ui/minimap.ts`, `src/style.css`, `src/render/labels.ts`, `src/render/icons.ts`,
> `src/render/gameView.ts` (`bindLabelEvents`), `src/screens/title.ts`
> **Commity:** `498e706` (Fáze 3: HUD a okna), `39a6d01` (minimapa), `30914c0` (úvodní obrazovka),
> `eb50ca9` (světlý a tmavý vzhled), `57701b2` (okna si pamatují polohu), `c3e8722` (klik na popisek),
> `6ef3132` (dialogy nad popisky), `ed03f45` (3D miniatury), `ce81cba` (oddělená scéna popisků),
> `3349613` (počítadlo FPS)

## O čem je tento díl

3D scéna je jen plátno (`<canvas>`). Všechno, co hráč čte a na co kliká – horní lišta, okna vlaků,
popisky měst, minimapa – je obyčejné HTML položené nad ním. Na konci dílu divák ví:

- proč UI není ve WebGL a jak HTML vrstvy skládat nad canvas,
- jak `CSS2DRenderer` přilepí HTML popisek na bod ve 3D světě (a jak to funguje matematicky),
- jak zařídit, aby popisky šly kliknout, ale nekradly kameře kolečko,
- jak vyrobit ikony nástrojů a miniatury vlaků **renderováním 3D modelů do obrázku**,
- jak udělat minimapu, okna s pamětí polohy, světlý/tmavý vzhled a klávesové zkratky.

## Teorie

### Proč UI v HTML

Ve WebGL by každé tlačítko znamenalo vlastní geometrii, texturu s textem, hit-testing a layout.
Prohlížeč tohle všechno umí zadarmo: text s diakritikou, `<select>`, `<input>`, scrollování,
přístupnost, CSS. Cena je jen jedna: HTML a WebGL jsou dvě oddělené vrstvy, takže je musíme
**zarovnat** (popisky) a **domluvit se, kdo dostane událost myši** (kamera vs. popisek vs. okno).

```
  z-index ↑
  ┌─────────────────────────────────────────┐
  │ okna (.window), lišty (.toolbar)        │  pointer-events: auto
  ├─────────────────────────────────────────┤
  │ vrstva popisků (.label-layer)           │  pointer-events: none, popisky auto
  ├─────────────────────────────────────────┤
  │ <canvas> WebGL – 3D scéna               │  kamera, stavba, klikání na mapu
  └─────────────────────────────────────────┘
```

### Promítnutí 3D bodu na obrazovku

Popisek města má ve světě polohu, třeba `(town.x + 0.5, 1.5, town.y + 0.5)`. Abychom věděli, kam
na obrazovce dát `<div>`, musíme bod projít stejnou cestou, jakou GPU prochází každý vrchol:

```
 bod ve světě ──(view matice)──► souřadnice kamery ──(projekční matice)──► clip / NDC
   (x, y, z)     camera.matrixWorldInverse              camera.projectionMatrix     (-1..1, -1..1)

 NDC → pixely:  px = ( ndc.x + 1) / 2 · šířka
                py = (-ndc.y + 1) / 2 · výška      (osa Y v CSS jde dolů)
```

U ortografické kamery (viz [díl 02](02-izometricka-kamera.md)) je projekce lineární, takže popisek
při zoomu nemění velikost – mění se jen vzdálenosti mezi popisky. Přesně tohle chceme: text
zůstane čitelný při jakémkoli přiblížení.

Tohle za nás dělá `CSS2DRenderer` z three.js examples. Projde scénu, u každého `CSS2DObject` spočte
NDC, nastaví elementu CSS `transform: translate(…)`, schová ho, když je mimo záběr (NDC z mimo
−1..1), a podle vzdálenosti od kamery mu nastaví `z-index`, aby se bližší popisky kreslily navrch.

### Render-to-image

Ikona „postav nádraží“ v liště by mohla být PNG nakreslené v editoru. Hezčí a konzistentní je
vykreslit skutečnou 3D geometrii nádraží stejným světlem a pod stejným úhlem jako ve hře
a výsledek uložit jako obrázek. WebGL canvas jde převést na data URL (`canvas.toDataURL()`),
pokud renderer zachová kreslicí buffer (`preserveDrawingBuffer: true`) – jinak ho prohlížeč po
zobrazení smaže a dostali bychom průhledný obrázek.

## Implementace

### 1. Malý pomocník na DOM

Bez frameworku, jen jedna funkce v `src/ui/dom.ts`:

```ts
// Malý pomocník pro tvorbu DOM prvků
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}
```

Typ `HTMLElementTagNameMap[K]` zajistí, že `h('canvas', { width: 256 })` vrátí `HTMLCanvasElement`
a TypeScript zná jeho vlastnosti. Pro hru s desítkami oken to stačí – okna se při změně dat
jednoduše přegenerují celá.

### 2. Okna nad scénou

`WindowManager` (`src/ui/windows.ts`) otevírá okna podle id. Otevření okna se stejným id jen
vymění obsah, takže kliknutí na vlak, jehož okno už je otevřené, nevytvoří duplikát. Poloha se
pamatuje v `localStorage` **podle druhu okna** – všechna okna vlaků sdílejí jednu polohu:

```ts
// Okna stejného druhu (např. všechny vlaky) sdílejí polohu: train-3 → train
function positionKey(id: string): string {
  return id.replace(/-\d+$/, '');
}
```

Zajímavý detail je obnova obsahu za běhu. Okno stanice se překresluje při každé události
`stationsChanged`, tedy klidně několikrát za sekundu. Kdyby se obsah vyměnil ve chvíli, kdy hráč
drží tlačítko myši nebo má otevřený `<select>`, kliknutí by se ztratilo. Proto se nový obsah
odloží do `pending` a vymění se až po puštění tlačítka nebo ztrátě fokusu:

```ts
private flush(win: OpenWindow): void {
  if (!win.pending || this.pressed === win) return;
  const active = document.activeElement;
  const editing =
    (active instanceof HTMLSelectElement || active instanceof HTMLInputElement) && win.el.contains(active);
  if (editing) return;
  win.body.replaceChildren(win.pending);
  win.pending = null;
}
```

Okna se umisťují podle kontextu: okno z horní lišty pod svou ikonu (`placeBelow`), okno otevřené
kliknutím na popisek ve 3D nad ten popisek (`openAbove` + `placeAbove`, commit `6ef3132`). Na
`DOMRect` popisku se dostaneme přes `getBoundingClientRect()` – spojení 3D a HTML funguje
oběma směry.

### 3. Horní lišta, stavová lišta a FPS

`Hud` (`src/ui/hud.ts`) staví lištu a poslouchá události hry (`money`, `news`, `pause`, `speed`) –
to je přesně vzor z [dílu 09](09-cas-ekonomika-ukladani.md). Počítadlo snímků (commit `3349613`)
nepočítá FPS z jednoho `dt` (to by skákalo), ale počítá snímky a jednou za sekundu vydělí:

```ts
// Volá se každý snímek; údaj se obnoví jednou za sekundu
countFrame(now: number): void {
  if (this.fpsEl.hidden) return;
  if (this.fpsStart === null) {
    this.fpsStart = now;
    return;
  }
  this.fpsFrames++;
  const elapsed = now - this.fpsStart;
  if (elapsed < 1000) return;
  this.fpsEl.textContent = `${Math.round((this.fpsFrames * 1000) / elapsed)} FPS`;
  this.fpsFrames = 0;
  this.fpsStart = now;
}
```

Psát do DOM každý snímek je zbytečná práce pro layout prohlížeče; jednou za sekundu je zadarmo.
Tohle počítadlo je první nástroj, který budeme používat v [dílu 17](17-optimalizace-a-lod.md).

### 4. Světlý a tmavý vzhled

Celé barevné schéma jsou CSS proměnné (`src/style.css`):

```css
/* Světlý motiv je výchozí, tmavý zapíná data-theme="dark" na <html> */
:root {
  --text: #222;
  --panel: #d9d6cc;
  --window: #ecebe6;
  /* … */
}

:root[data-theme='dark'] {
  --text: #eee;
  --panel: #4a4a46;
  --window: #575752;
  /* … */
}
```

A přepnutí je jeden atribut (`src/ui/theme.ts`):

```ts
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
```

`main.ts` volá `applyTheme(loadTheme())` ještě před vytvořením čehokoli jiného, aby UI při načtení
neprobliklo ve špatné barvě.

### 5. Popisky ve 3D: CSS2DRenderer

`TownLabels` (`src/render/labels.ts`) vytvoří vlastní `CSS2DRenderer`, jehož kořenový `<div>` leží
přes celé okno nad canvasem. Každý popisek je `CSS2DObject` – objekt scény, který místo geometrie
nese HTML element:

```ts
rebuild(towns: readonly Town[]): void {
  this.object.clear();
  this.labels.clear();
  for (const town of towns) {
    const el = document.createElement('div');
    el.className = `town-label town-label--${town.kind}`;
    el.dataset.kind = 'town';
    el.dataset.id = String(town.id);
    const label = new CSS2DObject(el);
    label.position.set(town.x + 0.5, 1.5, town.y + 0.5);
    this.object.add(label);
    this.labels.set(town.id, el);
    this.update(town);
  }
}
```

Výška `1.5` není náhoda: popisek visí nad městem ve výšce střech, takže při otáčení kamery „sedí“
nad zástavbou, ne na zemi. Popisky stanic jsou níž (`0.8`), závodů výš (`2.2`).

Atributy `data-kind` a `data-id` slouží ke kliknutí – jeden posluchač na celé vrstvě najde
nejbližší element s `data-kind` (event delegation):

```ts
layer.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
  if (el)
    this.onLabelClick({
      kind: el.dataset.kind as LabelTarget['kind'],
      id: Number(el.dataset.id),
      rect: el.getBoundingClientRect(),
    });
});
```

#### Oddělená scéna popisků

Původně byly popisky přímo v hlavní scéně a `labels.render(this.scene, camera)` dostával celou
scénu. `CSS2DRenderer` ale při každém renderu **prochází celý strom objektů** a hledá v něm
`CSS2DObject`y. Ve scéně s tisíci meshi (díly průmyslových areálů, světla, vozidla) to byla práce
navíc každý snímek. Commit `ce81cba` proto popisky přesunul do vlastní malé scény:

```ts
// Jen HTML popisky, aby je CSS2DRenderer nehledal mezi tisíci objekty hlavní scény
private readonly labelScene = new THREE.Scene();
// …
this.labelScene.add(this.labels.object, stationLabels.object, this.floatingTexts.object, this.industries.labels);
// …
this.renderer.render(this.scene, this.camera.camera);
this.labels.render(this.labelScene, this.camera.camera);
```

Obě scény se renderují **stejnou kamerou**, takže popisky přesně sedí na 3D objektech. Obecné
poučení: scéna v three.js není „svět“, je to jen strom k průchodu. Klidně jich mějte víc.

#### Kdo dostane myš

Vrstva popisků leží nad canvasem, takže by „sežrala“ kolečko i pravé tlačítko, a kamera by nad
popiskem nešla ovládat. CSS to řeší z většiny: vrstva má `pointer-events: none` a události
dostávají jen samotné popisky:

```css
.label-layer {
  /* … */
  pointer-events: none;
}

.label-layer:not(.label-layer--passive) [data-kind] {
  pointer-events: auto;
  cursor: pointer;
}
```

Nad samotným popiskem ale kolečko pořád končí v HTML. `bindLabelEvents()` ho proto **přepošle**
na canvas jako novou událost se stejnými parametry:

```ts
// Kolečko a posun pravým tlačítkem nad popiskem patří kameře
layer.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', e));
  },
  { passive: false },
);
layer.addEventListener('pointerdown', (e) => {
  if (e.button === 2) canvas.dispatchEvent(new PointerEvent('pointerdown', e));
});
layer.addEventListener('contextmenu', (e) => e.preventDefault());
```

`new WheelEvent('wheel', e)` zkopíruje `clientX/clientY` i `deltaY`, takže zoom ke kurzoru funguje
i nad popiskem. Stačí přeposlat `pointerdown` – kamera si pak zavolá `setPointerCapture`
a `pointermove` už dostává canvas přímo.

Se zapnutým stavebním nástrojem popisky kliknutí nechytají vůbec (třída `label-layer--passive`
přes `setLabelsInteractive(false)`), aby šlo stavět i pod nimi.

### 6. Plovoucí výdělek

Zelená částka nad stanicí je taky `CSS2DObject`. Animace je čistě změna 3D polohy a průhlednosti
elementu (`FloatingTexts` v `src/render/labels.ts`):

```ts
update(now: number): void {
  for (let i = this.items.length - 1; i >= 0; i--) {
    const item = this.items[i];
    const t = (now - item.start) / FLOAT_MS;
    if (t >= 1) {
      this.object.remove(item.label);
      this.items.splice(i, 1);
      continue;
    }
    item.label.position.y = item.y + t * FLOAT_RISE;
    item.label.element.style.opacity = String(1 - t * t);
  }
}
```

Text stoupá ve **světových** souřadnicích (`position.y`), ne v pixelech – takže při otočené kameře
stoupá pořád „nahoru“ ve scéně. Průhlednost `1 − t²` drží text dlouho čitelný a mizí až na konci.
Iterace odzadu umožní bezpečně mazat položky během průchodu.

### 7. 3D ikony a miniatury

`src/render/icons.ts` má vlastní malý `WebGLRenderer` (128×128), který nikdy není v DOM:

```ts
function iconRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
  }
  return renderer;
}
```

- `alpha: true` – průhledné pozadí, ikona sedí na libovolné barvě tlačítka.
- `preserveDrawingBuffer: true` – obsah canvasu přežije do `toDataURL()`.
- Jeden renderer pro všechny ikony – každý WebGL kontext je drahý a prohlížeče jich povolí jen
  omezený počet.

Funkce `snapshot()` postaví dočasnou scénu se stejnými světly jako hra a ortografickou kameru ze
stejného směru (dimetrie 2:1, `ISO_DIRECTION`). Pak musí vyřešit, jak velký výřez nastavit, aby
objekt **přesně vyplnil čtverec**. Řešení: promítnout 8 rohů bounding boxu do souřadnic kamery
a vzít jejich 2D obdélník:

```
            kamera se dívá ↘
      +-------+                     ┌──────────────┐
     /|      /|      promítnutí      │   ◇──◇       │  výřez = obal 8 promítnutých
    +-------+ |   ─────────────►     │  ◇    ◇      │  rohů, zvětšený na čtverec
    | +-----|-+   (matrixWorldInverse│   ◇──◇       │  (+4 % okraj)
    |/      |/     kamery)           └──────────────┘
    +-------+
```

```ts
// Obrys kvádru v rovině kamery určí výřez
const view = new THREE.Box2();
const corner = new THREE.Vector3();
for (let i = 0; i < 8; i++) {
  corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
  corner.applyMatrix4(camera.matrixWorldInverse);
  view.expandByPoint(new THREE.Vector2(corner.x, corner.y));
}
const mid = view.getCenter(new THREE.Vector2());
const size = view.getSize(new THREE.Vector2());
const half = (Math.max(size.x, size.y) / 2) * 1.04;
camera.left = mid.x - half;
camera.right = mid.x + half;
camera.top = mid.y + half;
camera.bottom = mid.y - half;
```

Trik s `i & 1`, `i & 2`, `i & 4` projde všechny kombinace min/max ve třech osách – osm rohů kvádru
bez vnořených cyklů. `matrixWorldInverse` převede bod do souřadnic kamery, kde x a y jsou přímo
souřadnice v rovině obrazovky; protože je kamera ortografická, není potřeba dělit hloubkou.

Výsledek se cachuje jako `Promise<string>` podle klíče, takže každá ikona se vykreslí jen jednou:

```ts
// Obrázek modelu z kitu (např. lokomotivy nebo auta) bez podkladu
export function modelIcon(kit: Kit, model: string): Promise<string> {
  return cached(`${kit}/${model}`, async () => [await loadModel(kit, model)]);
}
```

Ikona v liště se zobrazí okamžitě jako textový znak a obrázek ho nahradí, až bude hotový
(`iconElement`). Když WebGL selže, zůstane znak – UI nikdy nečeká na 3D.

Pozor na sdílené geometrie: scéna ikony používá stejné funkce jako hra (`createStationObject`,
`roadGeometry`, `buildIndustryPreview`), takže ikona je vždy aktuální podoba stavby – změna modelu
nádraží se automaticky promítne i do ikony.

### 8. Minimapa

Minimapa (`src/ui/minimap.ts`) je 2D canvas o velikosti mapy (1 pixel = 1 dlaždice), CSS ho
zvětší na 256 px. Celá mapa se nakreslí jednou přes `ImageData`, pak se dokreslují jen změněné
dlaždice – stejným logem změn `MapChanges` jako terén ([díl 03](03-teren.md)):

```ts
// Jen změněné dlaždice od posledního kreslení
const changes = new MapChanges(map);
const syncTerrain = (): void => {
  const changed = changes.take();
  if (changed === null) return drawTerrain();
  const ctx = terrain.getContext('2d')!;
  for (const i of new Set(changed)) {
    const [r, g, b] = COLORS[map.tiles[i] as TileType] ?? COLORS[TileType.Grass];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i % map.width, Math.floor(i / map.width), 1, 1);
  }
};
```

Nad terénem je druhý canvas s vlaky a obrysem pohledu. Obrys je hezká ukázka zpětné projekce: rohy
okna prohlížeče se promítnou paprskem z kamery na zem (`camera.groundPoint`). U izometrické
kamery je výsledek kosočtverec, ne obdélník – přesně to, co hráč na obrazovce vidí.

```ts
// Výřez obrazovky jako průmět rohů okna na zem
const corners = [
  [rect.left, rect.top],
  [rect.right, rect.top],
  [rect.right, rect.bottom],
  [rect.left, rect.bottom],
].map(([cx, cy]) => camera.groundPoint(cx, cy));
```

Překreslení běží v `setInterval` po 200 ms, ne každý snímek – minimapa nepotřebuje 60 FPS.

### 9. Klávesové zkratky

`Shortcuts` (`src/ui/shortcuts.ts`) poslouchá `KeyboardEvent.code`, ne `key`:

```ts
// KeyboardEvent.code – fyzická klávesa, takže zkratky sedí i na české klávesnici
codes: string[];
```

Na české klávesnici dává klávesa „1“ bez Shiftu znak `+`, takže `e.key === '1'` by nefungovalo.
`e.code === 'Digit1'` je fyzická klávesa bez ohledu na rozložení. Šipky se nevykonávají jako
jednorázové akce, ale drží se v množině `held` a herní smyčka si každý snímek přečte
`panDirection()` a posune kameru úměrně `dt`. Při ztrátě fokusu okna (`blur`) se množina vymaže,
jinak by se mapa po Alt+Tab posouvala donekonečna.

### 10. Úvodní obrazovka

Úvodní obrazovka (`src/screens/title.ts`, commit `30914c0`) není video ani obrázek, ale **skutečná
hra** běžící na pozadí: vygeneruje mapu 128×128 se seedem `ttd-title`, nechá města růst do roku 2025
(commit `d21d3c8` – aby v centrech byly mrakodrapy), postaví tři tratě s vlaky a spustí stejný
`GameView` jako hra. Rozdíly jsou jen v nastavení:

```ts
view.setSeasonMode('summer');
view.terrain.setGridVisible(false);
view.setLabelsInteractive(false);
// …
view.renderer.setAnimationLoop((now: number) => {
  const dt = now - lastFrame;
  lastFrame = now;
  view.camera.spin((SPIN_PER_SECOND * dt) / 1000);
  view.frame(now, dt * DEMO_SPEED, dt);
});
```

`IsoCamera.spin()` pootočí azimut kamery bez animace, takže kamera plynule krouží kolem města
(0,05 rad/s). Herní čas běží 3× rychleji (`DEMO_SPEED`), ale městská doprava dostane třetí parametr
`dt` – auta a chodci jezdí normálním tempem, jinak by vypadali jako v němém filmu.

Opakované použití `GameView` pro úvodní obrazovku je odměna za oddělení vrstev: nic speciálního
pro menu se psát nemuselo.

## Úskalí

- **Kolečko nad popiskem nezoomovalo** – řešené přeposíláním událostí (commit `c3e8722`).
- **Okna se obnovovala pod rukama.** Okno vlaku se překreslovalo během kliknutí a klik se ztratil.
  Řešení přes `pending` a `flush()` po `pointerup` (pozor: `setTimeout`, aby `click` doběhl dřív, než
  se tlačítko nahradí).
- **z-index popisků.** `CSS2DRenderer` nastavuje popiskům `z-index` podle vzdálenosti, takže by
  mohly přerůst lištu nebo okna. Vrstva popisků proto má vlastní `z-index: 1`, který vytvoří
  stacking context – vnitřní z-indexy nepřelezou ven.
- **Velký průchod scény.** `CSS2DRenderer` nad hlavní scénou → samostatná `labelScene` (commit
  `ce81cba`).
- **Ikony bez obsahu.** Bez `preserveDrawingBuffer` vrací `toDataURL()` prázdný obrázek.

## Scénář videa

1. **Rozložit vrstvy:** v DevTools schovat canvas, pak vrstvu popisků – ukázat, že UI je HTML.
2. **Projekce bodu:** nakreslit cestu svět → kamera → NDC → pixely, ukázat `CSS2DObject`
   u popisku města a změnu `transform` v DevTools při posunu kamery.
3. **labelScene:** vysvětlit, proč druhá scéna se stejnou kamerou.
4. **Myš:** zkusit zoom nad popiskem bez přeposílání (zakomentovat) a s ním.
5. **Okna:** otevřít okno z lišty a nad popiskem, přetáhnout, zavřít, otevřít znovu – pamatuje
   si polohu.
6. **3D ikony:** ukázat ikony v liště, pak `snapshot()` – projekce 8 rohů, `toDataURL`.
7. **Minimapa:** stavět kolej a sledovat, jak se dokresluje; kosočtverec pohledu.
8. **Úvodní obrazovka:** ukázat, že je to `GameView` s `spin()`.
9. **Tmavý vzhled:** přepnout v nastavení, ukázat CSS proměnné.

## Cvičení

- Přidejte ikonu „návěstidlo“ ve dvou barvách (zelená a červená) a porovnejte je vedle sebe.
- Upravte `FloatingTexts`, aby výdělek nad 100 000 Kč byl větší a stoupal rychleji.
- Na minimapě vykreslete i silniční vozidla (`game.roadFleet.vehicles`).
- Zkuste dát popisky zpět do hlavní scény a změřte v profileru, kolik trvá `labels.render()`
  na velké mapě s mnoha závody.
- Přidejte klávesovou zkratku `L` pro přepnutí noci (`actions.toggleNight`) vedle ostatních
  v `src/screens/game.ts`. Proč použít `code`, a ne `key`?
