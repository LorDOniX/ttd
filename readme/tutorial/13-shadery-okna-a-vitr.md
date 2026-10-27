# Díl 13 – Shadery II: okna na fasádách a vítr ve stromech

> **Soubory:** `src/render/windows.ts`, `src/render/buildings.ts`, `src/render/trees.ts`, `src/render/nightLights.ts`
> **Commity:** `faaf9c9` (nature kit; textury oken), `3eba113` (efekty kouře, vítr ve stromech),
> `ea5b061` (osvětlení fasád)

## O čem je tento díl

V [dílu 12](12-shadery-voda.md) jsme se naučili vkládat kód do shaderů materiálů three.js.
Voda si vystačila se světovou polohou pixelu. Teď uděláme dva kroky dál:

1. **Okna na mrakodrapech.** Modely `low-detail-building-*` z Kenney City Kitu mají holé bílé
   stěny. Nakreslíme na ně okna po patrech a prosklené fasády s příčkami, a to procedurálně
   v shaderu. K tomu si geometrii připravíme na CPU: najdeme rovinné stěny a každému vrcholu
   přidáme **vlastní atribut** s polohou na stěně a rozměry stěny.
2. **Vítr ve stromech.** Tentokrát nezměníme barvu pixelu, ale **polohu vrcholu** ve vertex shaderu.
   Každý strom v lese se houpe s jinou fází, přestože jsou všechny jedna instancovaná geometrie.

Divák si odnese:

- jak do geometrie přidat vlastní atribut a přečíst ho v shaderu,
- jak rozpoznat rovinné plochy modelu algoritmem union-find,
- jak nakreslit opakovaný vzor (mřížku oken) přes `floor`/`fract`/`mod` a vyhladit ho přes `fwidth`,
- jak ve vertex shaderu přečíst polohu instance z `instanceMatrix`,
- proč se `onBeforeCompile` dá řetězit (okna + světlo lamp z [dílu 16](16-osvetleni-den-noc.md)).

## Teorie

### Proč ne textura

Nabízí se nakreslit okna do obrázku a namapovat ho na stěny. Má to tři problémy:

- **UV souřadnice modelu ukazují do palety.** Kenney modely nemají „rozbalené“ stěny; každý
  trojúhelník má UV doprostřed jednoho barevného políčka `colormap.png` ([díl 05](05-modely-glb.md)).
  Pro texturu oken bychom museli UV přepočítat a druhou texturu přidat do materiálu.
- **Stěny mají různé rozměry.** Textura by se na široké stěně roztáhla a na úzké smrskla. Okna
  mají mít stále stejnou velikost a počet podle šířky a výšky stěny.
- **Ostrost.** Při velkém přiblížení se textura rozmaže, při oddálení zrní. Procedurální vzor
  má ostré hrany v libovolném zoomu a vyhladit ho umíme přesně na šířku pixelu.

Shader ale potřebuje vědět, **kde na stěně pixel leží** a **jak velká stěna je**. Tohle se z jednoho
trojúhelníku nedá poznat: stěna je obvykle složená z několika trojúhelníků. Proto informaci
spočítáme předem na CPU a uložíme ji do vrcholů jako atribut.

### Vlastní atributy

`BufferGeometry` může mít libovolné atributy, nejen `position`, `normal`, `uv`. Stačí:

```ts
geometry.setAttribute('facade', new THREE.BufferAttribute(facade, 4));
```

a ve vertex shaderu deklarovat `attribute vec4 facade;`. Three.js atribut najde podle jména a připojí
ho k programu. Do fragment shaderu ho předáme varyingem, a ten se mezi vrcholy interpoluje.

Trik oken: atribut `facade` má čtyři složky.

```
facade.xy = poloha vrcholu na stěně od jejího levého dolního rohu (vodorovně, svisle)
facade.zw = šířka a výška celé stěny (stejné pro všechny vrcholy stěny)

   (0, h)┌────────────────────┐(w, h)        zw = (w, h) ve všech čtyřech rozích
         │                    │
         │       • (x, y)     │              xy se mezi rohy lineárně interpoluje,
         │                    │              takže fragment dostane přesnou polohu
   (0, 0)└────────────────────┘(w, 0)        pixelu na stěně
```

Protože `zw` je ve všech vrcholech stejné, interpolace ho nezmění. Každý pixel tak zná polohu
na stěně i rozměry celé stěny, a z toho spočte, kolik oken se na ni vejde.

### Union-find: které trojúhelníky tvoří jednu stěnu

Model je „polévka“ trojúhelníků. Chceme je seskupit do rovinných stěn: trojúhelníky se stejným
směrem normály, které spolu sousedí. Na to je ideální struktura **union-find** (disjoint set):

```
  každý prvek ukazuje na rodiče; kořen = zástupce skupiny
  find(i):  jdi po rodičích až ke kořeni (a cestou zkracuj cestu)
  union(a, b): parent[find(a)] = find(b)

  trojúhelníky:  0   1   2   3        0 a 1 sdílí vrchol → union(0, 1)
  rodiče:       [1] [1] [2] [2]       2 a 3 sdílí vrchol → union(3, 2)
                 └─►1    └◄─3         výsledek: dvě stěny {0,1} a {2,3}
```

Po zpracování všech trojúhelníků má každá stěna jednoho zástupce a my pro ni spočítáme
ohraničující obdélník.

### Antialiasovaný obdélník

Okno je obdélník kolem středu buňky. Test „je pixel uvnitř“ by byl `d < size` (kde `d` je vzdálenost
od středu po osách). Ostrý `if` dává zubaté hrany a při oddálení blikání. Proto místo ostrého
přechodu použijeme `smoothstep` široký přesně jeden pixel:

```
           uvnitř                    hrana                   venku
  1 ┤●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●╲
    │                                  ╲   šířka přechodu = 1 pixel
  0 ┤                                    ╲●●●●●●●●●●●●●●●●●●●●●
    └──────────────────────────────┬─────┬──────────────► d
                          size − px/2   size + px/2
```

Velikost pixelu na stěně dodá `fwidth(vFacade.xy)`, stejně jako u vody.

### Vertex shader a instance

U vody jsme měnili barvu ve fragment shaderu. Vítr mění polohu ve vertex shaderu: za
`#include <begin_vertex>` existuje `vec3 transformed` (lokální poloha vrcholu) a cokoli do ní
přičteme, se pak promítne kamerou. V `project_vertex` three.js poté provede
`mvPosition = instanceMatrix * mvPosition` (u instancovaných meshů).

`instanceMatrix` je matice 4×4 konkrétní instance. GLSL ukládá matice **po sloupcích**, takže
`instanceMatrix[3]` je čtvrtý sloupec, tedy **posun**, neboli poloha stromu na mapě:

```
          sloupec 0  1  2  3
        ┌                    ┐
        │  r  r  r  tx  │     instanceMatrix[3].x = tx  (x na mapě)
        │  r  r  r  ty  │     instanceMatrix[3].z = tz  (y dlaždice na mapě)
        │  r  r  r  tz  │
        │  0  0  0  1   │     r = rotace a měřítko
        └                    ┘
```

Z polohy stromu uděláme fázi sinusu. Sousední stromy se tak houpou skoro stejně a po lese běží
vlna jako při skutečném závanu větru.

## Implementace: okna

### 1. Které budovy a které plochy

Okna dostanou jen modely bez detailů (`src/render/buildings.ts`):

```ts
// Modely bez detailů mají holé stěny, okna se jim dokreslují shaderem
function needsWindows(model: string): boolean {
  return model.startsWith('low-detail-building-');
}
```

Druh plochy se pozná podle barvy v paletě: bílé stěny dostanou okna po patrech, šedé panely
prosklenou fasádu s příčkami, ostatní nic:

```ts
// Světlé stěny dostanou okna po patrech, tmavé panely příčky prosklené fasády
function windowSurface(u: number, v: number): Surface {
  const at = paletteCell(u, v);
  return at === WHITE ? Surface.Wall : at === GRAY ? Surface.Glass : Surface.Plain;
}
```

Pořadí kroků je důležité. Fasády se přebarvují posunem UV na jiné políčko palety (díl 05), takže
okna se musí určit **před** přebarvením, dokud jsou stěny ještě bílé:

```ts
// Okna se určují z původních barev palety, proto před přebarvením fasády
function loadWindowed(kit: Kit, model: string): Promise<Part[]> {
  if (!needsWindows(model)) return loadPrototype(kit, model);
  // …
    pending = loadPrototype(kit, model).then((parts) => addWindows(parts, windowSurface));
  // …
}
```

`recolor` pak geometrii klonuje i s novými atributy, takže okna zůstanou i na přebarvené budově.

### 2. Rozměry oken

Všechno je v souřadnicích normalizované budovy, kde dlaždice má šířku 1 (`src/render/windows.ts`):

```ts
// Rozměry v normalizované budově (dlaždice = 1): výška patra, rozteč oken a příček a velikost okna
const FLOOR = 0.15;
const COLUMN = 0.13;
const MULLION = 0.07;
const WINDOW = [0.07, 0.085];
// Užší nebo nižší plochy (pásky, nástavby na střeše) okna nedostanou
const MIN_WALL = [0.3, 0.14];
```

### 3. addWindows: z trojúhelníků stěny

Funkce dostane díly modelu a pro každý díl spočte dva nové atributy. Nejdřív geometrii převede
na neindexovanou (každý trojúhelník má vlastní tři vrcholy, takže každý vrchol může nést údaje své
stěny) a body převede do normalizované budovy:

```ts
const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
const position = geometry.getAttribute('position');
const uv = geometry.getAttribute('uv');
const triangles = position.count / 3;
const facade = new Float32Array(position.count * 4);
const kinds = new Float32Array(position.count);

// Body v normalizované budově, vodorovná souřadnice podél plochy a výška
const points: THREE.Vector3[] = [];
for (let i = 0; i < position.count; i++)
  points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(part.matrix));
const along = new Float32Array(position.count);
```

Pak pro každý trojúhelník:

```ts
for (let t = 0; t < triangles; t++) {
  const [a, b, c] = [points[t * 3], points[t * 3 + 1], points[t * 3 + 2]];
  // Normála z polohy vrcholů, normály vrcholů jsou na zaoblených hranách modelu skloněné
  const n = edge1.subVectors(b, a).cross(edge2.subVectors(c, a)).normalize();
  if (Math.abs(n.y) > 0.1) continue;
  // … průměrné UV trojúhelníku → druh plochy
  const kind = surface(u, v);
  if (kind === Surface.Plain) continue;
  kindOf[t] = kind;
  // Směr plochy po stupních, aby drobné nepřesnosti nerozdělily jednu stěnu
  const degrees = (Math.round((Math.atan2(n.x, n.z) * 180) / Math.PI) + 360) % 360;
  const angle = (degrees * Math.PI) / 180;
  const [nx, nz] = [Math.sin(angle), Math.cos(angle)];
  for (let k = 0; k < 3; k++) {
    const i = t * 3 + k;
    // Vodorovná osa plochy vede zleva doprava při pohledu zvenku
    along[i] = points[i].x * nz - points[i].z * nx;
    const vertexKey = `${kind}|${degrees}|${key(points[i])}`;
    const other = byVertex.get(vertexKey);
    if (other === undefined) byVertex.set(vertexKey, t);
    else parent[find(t)] = find(other);
  }
}
```

Co se tu děje:

- **Normála z vektorového součinu.** `(b − a) × (c − a)` je vektor kolmý k trojúhelníku. Normály
  uložené ve vrcholech nepoužíváme, protože na zaoblených hranách jsou „ohnuté“ a trojúhelník u hrany
  by vypadal šikmo.
- **Jen svislé plochy.** `|n.y| > 0.1` jsou střechy a podlahy.
- **Směr zaokrouhlený na stupně.** Úhel normály v rovině XZ (`atan2(n.x, n.z)`) zaokrouhlený na
  celé stupně. Dvě poloviny jedné stěny mají kvůli zaokrouhlení float čísel trochu jiné normály,
  a bez zaokrouhlení by se rozpadly na dvě stěny s různou mřížkou oken.
- **Vodorovná osa „along“.** Na stěně potřebujeme 2D souřadnice. Svislá je prostě `y`. Vodorovná je
  průmět bodu do směru tečny stěny `t = (nz, −nx)`, tedy kolmého na normálu v rovině XZ:

  ```
          normála n = (nx, nz)
              ▲
              │
     ─────────┼─────────►  tečna t = (nz, −nx)
          stěna           along = p · t = x·nz − z·nx
  ```

- **Union přes společný vrchol.** Klíč vrcholu je druh plochy, směr a poloha zaokrouhlená na tisíciny.
  Když na stejný klíč narazí druhý trojúhelník, oba patří do jedné stěny. Protože klíč obsahuje směr,
  dvě stěny na rohu budovy (sdílí hranu, ale mají jiný směr) se nespojí.

`find` je klasický union-find se zkracováním cesty:

```ts
const parent = Array.from({ length: triangles }, (_, i) => i);
const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
```

### 4. Obdélník stěny a zápis atributů

Pro každého zástupce se spočte rozsah `along` a `y`, a pak každý vrchol dostane polohu relativně
k levému dolnímu rohu a rozměry:

```ts
for (let t = 0; t < triangles; t++) {
  if (!kindOf[t]) continue;
  const [u0, y0, u1, y1] = bounds.get(find(t))!;
  for (let k = 0; k < 3; k++) {
    const i = t * 3 + k;
    facade.set([along[i] - u0, points[i].y - y0, u1 - u0, y1 - y0], i * 4);
    kinds[i] = kindOf[t];
  }
}

geometry.setAttribute('facade', new THREE.BufferAttribute(facade, 4));
geometry.setAttribute('facadeSurface', new THREE.BufferAttribute(kinds, 1));
```

Plochy bez oken mají `facadeSurface = 0`, shader je přeskočí.

Výpočet běží jednou pro každý model (výsledek je v cache `windowed`), ne pro každou budovu ve městě.

### 5. Materiál s okny

```ts
const SHADER_VERTEX = /* glsl */ `
attribute vec4 facade;
attribute float facadeSurface;
varying vec4 vFacade;
varying float vFacadeSurface;
`;

// Kopie materiálu, která na plochy s atributem facade dokreslí okna
function windowMaterial(material: THREE.Material): THREE.Material {
  let result = windowMaterials.get(material);
  if (!result) {
    result = material.clone();
    result.onBeforeCompile = (shader) => {
      shader.vertexShader =
        SHADER_VERTEX +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvFacade = facade;\nvFacadeSurface = facadeSurface;',
        );
      shader.fragmentShader =
        SHADER_FRAGMENT +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nif (vFacadeSurface > 0.5) applyFacade(diffuseColor.rgb);',
        );
    };
    result.customProgramCacheKey = () => 'facade-windows';
    windowMaterials.set(material, result);
  }
  return result;
}
```

Rozdíly proti vodě:

- **Materiál se klonuje.** Původní materiál z GLB používají i budovy bez oken. Kdybychom mu nastavili
  `onBeforeCompile`, shader by se změnil všem.
- **Vložení za `map_fragment`.** Tam se do `diffuseColor` načte barva z palety. Okna kreslíme přes ni,
  ještě před osvětlením, takže v noci ztmavnou spolu se stěnou.
- **Vlastní atributy a batching.** Budovy se kreslí v `BatchedMesh` po skupinách se stejným
  materiálem a sadou atributů (`attributeSignature`, [díl 06](06-instancing-a-draw-cally.md)).
  Geometrie s `facade` tak skončí ve vlastní dávce s materiálem oken a nepomíchají se s ostatními.

### 6. Fragment shader: okna po patrech

```glsl
void applyFacade(inout vec3 color) {
  vec2 size = vFacade.zw;
  vec2 pixel = fwidth(vFacade.xy);
  if (vFacadeSurface < 1.5) {
    if (size.x < ${MIN_WALL[0]} || size.y < ${MIN_WALL[1]}) return;
    vec2 cells = max(vec2(1.0), floor(size / vec2(${COLUMN}, ${FLOOR}) + 0.3));
    vec2 cell = size / cells;
    vec2 id = floor(vFacade.xy / cell);
    vec2 local = vFacade.xy - id * cell;
    // …
```

Shader je řetězec v template literálu, takže konstanty z TypeScriptu se do něj vloží přes `${…}`
a GPU dostane rovnou čísla (`0.13`, `0.15`…). Jedna hodnota tak platí pro CPU i shader. Pozor jen
na to, aby vložené číslo bylo v GLSL platný float: `0.3` je v pořádku, celé číslo `1` by se muselo
vložit jako `1.0`.

Krok za krokem:

1. **Kolik oken se vejde.** `size / (COLUMN, FLOOR)` je počet sloupců a pater, `+ 0.3` a `floor`
   zaokrouhlí nahoru až od 0,7. Na stěnu se vždy vejde aspoň jedno okno.
2. **Roztažení buněk.** `cell = size / cells` – buňky se roztáhnou tak, aby stěnu vyplnily přesně.
   Okna proto nikdy nejsou na kraji useknutá.
3. **Index a lokální poloha.** `id` je číslo sloupce a patra, `local` poloha uvnitř buňky. Tohle je
   obecný vzor pro opakování čehokoli v rovině.

```
  vFacade.xy ──► floor(xy / cell) = id      xy − id·cell = local
  ┌──────┬──────┬──────┐
  │ ┌──┐ │ ┌──┐ │ ┌──┐ │  patro 2          každá buňka má okno uprostřed,
  │ └──┘ │ └──┘ │ └──┘ │                   trochu nad středem (0.55),
  ├──────┼──────┼──────┤                   aby pod ním zbyl parapet
  │ ┌──┐ │ ┌──┐ │ ┌──┐ │  patro 1
  │ └──┘ │ └──┘ │ └──┘ │
  ├──────┼──────┼──────┤
  │ ┌──┐ │ ┌──┐ │ ┌──┐ │  patro 0
  │ └──┘ │ └──┘ │ └──┘ │
  └──────┴──────┴──────┘
```

Okno a rám:

```glsl
vec2 pane = min(vec2(${WINDOW[0] / 2}, ${WINDOW[1] / 2}), cell * vec2(0.32, 0.3));
vec2 d = abs(local - cell * vec2(0.5, 0.55));
float glass = facadeBox(d, pane, pixel);
float frame = facadeBox(d, pane + 0.008, pixel);
// Sklo světlá ke kraji okna a každé okno má trochu jiný odlesk
float shine = facadeHash(id + floor(size * 100.0)) * 0.5 + (local.y - cell.y * 0.55 + pane.y) / (pane.y * 2.0) * 0.5;
vec3 tint = mix(vec3(0.07, 0.11, 0.2), vec3(0.2, 0.3, 0.45), shine);
color = mix(color, color * 0.62, frame - glass);
color = mix(color, tint, glass);
```

- `pane` – poloviční rozměry okna, na malé buňce se zmenší, aby mezi okny zůstala zeď.
- `d` – vzdálenost od středu okna po osách. `abs` dělá test souměrný, takže stačí porovnat
  s polovičními rozměry.
- `frame − glass` je **prstenec** kolem okna široký 0,008: plocha „uvnitř většího obdélníku, ale
  ne uvnitř menšího“. Rám je ztmavená barva stěny, takže na barevné fasádě je barevný.
- `shine` – dvě složky odlesku: náhodná podle okna (`facadeHash(id + …)`, do hashe vstupuje
  i velikost stěny, aby se vzor neopakoval na každé stěně stejně) a svislý přechod uvnitř okna.
  Okno pak není jednolitě tmavé, ale odráží oblohu.

`facadeBox` je antialiasovaný obdélník z teorie:

```glsl
// 1 uvnitř obdélníku s polovičními rozměry size kolem středu, změkčené na šířku pixelu
float facadeBox(vec2 d, vec2 size, vec2 pixel) {
  vec2 inside = smoothstep(size + pixel * 0.5, size - pixel * 0.5, d);
  return inside.x * inside.y;
}
```

Součin `inside.x * inside.y` dělá průnik obou os: pixel je v okně, jen když je uvnitř vodorovně
i svisle.

### 7. Prosklená fasáda

Šedé panely dostanou místo oken hustou síť příček:

```glsl
} else {
  vec2 cells = max(vec2(1.0), floor(size / vec2(${MULLION}, ${FLOOR}) + 0.5));
  vec2 cell = size / cells;
  vec2 local = mod(vFacade.xy, cell);
  vec2 edge = min(local, cell - local);
  vec2 bar = smoothstep(vec2(0.007) + pixel * 0.5, vec2(0.007) - pixel * 0.5, edge);
  color = mix(color * vec3(0.8, 0.88, 1.05), vec3(0.6), max(bar.x, bar.y) * 0.75);
}
```

`edge` je vzdálenost k nejbližší hraně buňky. Když je menší než 0,007, jsme na příčce. `max` místo
součinu dělá sjednocení: příčka je svislá **nebo** vodorovná. Sklo se zároveň trochu
namodralí (`vec3(0.8, 0.88, 1.05)`).

### 8. Řetězení s nočním světlem

Na budovy svítí v noci pouliční lampy ([díl 16](16-osvetleni-den-noc.md)). To se dělá stejnou
technikou: `withLampLight` vloží do shaderu čtení zapečené mapy světel. Okenní materiál ale už
`onBeforeCompile` má. Proto `withLampLight` předchozí háček nepřepíše, ale zavolá ho a připojí se
za něj, a stejně spojí i klíč programu (`src/render/nightLights.ts`):

```ts
const previous = material.onBeforeCompile.bind(material);
const previousKey = material.customProgramCacheKey.bind(material);
material.onBeforeCompile = (shader, renderer) => {
  previous(shader, renderer);
  Object.assign(shader.uniforms, LAMP_UNIFORMS);
  // … vložení za project_vertex a lights_fragment_maps
};
material.customProgramCacheKey = () => `${previousKey()}|lamp-light`;
```

Výsledný klíč okenního materiálu je `facade-windows|lamp-light`. Řetězení funguje, protože každý
háček nahrazuje jiný `#include`: okna `begin_vertex` a `map_fragment`, světlo `project_vertex`
a `lights_fragment_maps`. Kdyby oba nahrazovaly stejný řádek, fungovalo by to taky, protože druhý
`replace` najde `#include` znovu (první ho v textu ponechal).

## Implementace: vítr ve stromech

Stromy z nature kitu mají kovový `MeshStandardMaterial` a tyrkysové listí. Hra je při načtení
nahradí vlastním `MeshLambertMaterial` s barvou podle ročního období ([díl 14](14-rocni-obdobi.md))
a při té příležitosti přidá vítr (`src/render/trees.ts`):

```ts
const treeTime = { value: 0 };

function treeMaterial(material: THREE.Material): THREE.Material {
  let result = treeMaterials.get(material.name);
  if (!result) {
    // …
    result = new THREE.MeshLambertMaterial({ color, name: material.name });
    result.onBeforeCompile = (shader) => {
      shader.uniforms.treeTime = treeTime;
      shader.vertexShader =
        'uniform float treeTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
             float wind = sin(treeTime * 0.8 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5);
             transformed.x += wind * max(position.y, 0.0) * 0.014;
             transformed.z += wind * max(position.y, 0.0) * 0.006;
           #endif`,
        );
    };
    result.customProgramCacheKey = () => 'tree-wind';
    treeMaterials.set(material.name, result);
  }
  return result;
}
```

Rozbor:

- **Fáze z polohy instance.** `instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5` – sinus se
  posouvá podle polohy stromu, takže vlna běží lesem šikmo přes mapu. Sousední stromy se hýbou
  podobně, vzdálené jinak.
- **Výchylka úměrná výšce.** `max(position.y, 0.0)` – kořeny stojí, koruna se hýbe nejvíc, jako
  páka. Proto se strom ohýbá, ne posouvá. `position` je původní poloha vrcholu v modelu, ještě
  před jakoukoli transformací.
- **Malá čísla.** 0,014 a 0,006 v jednotkách modelu. Strom se má sotva znatelně pohupovat;
  větší výchylka působí jako vichřice nebo jako gumový strom.
- **`#ifdef USE_INSTANCING`.** Three.js definuje `USE_INSTANCING` jen při kreslení `InstancedMesh`.
  Bez instance by `instanceMatrix` neexistovala a shader by se nezkompiloval. Hra to obchází tak,
  že i samostatný strom v průmyslovém areálu je `InstancedMesh` s jedinou instancí:

  ```ts
  // Instancovaný mesh, protože vítr ve stromovém shaderu působí jen na instance
  const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1);
  ```

- **Pozor na prostor.** Výchylka se přičítá k `transformed`, tedy v prostoru modelu, **před**
  `instanceMatrix`. Instance má náhodnou rotaci kolem svislé osy a měřítko, takže se výchylka
  s rotací stromu otočí. Každý strom se tak kývá trochu jiným směrem. U lesa to nevadí (spíš
  pomáhá), ale kdo chce jednotný směr větru, musí výchylku přičíst ve světových souřadnicích
  (viz cvičení).
- **Jeden program pro všechny stromy.** Materiály se cachují podle jména (`leafsGreen`, `woodBark`…),
  všechny mají stejný klíč `tree-wind`, takže GPU kompiluje jediný program. Stejný materiál používají
  i zjednodušené stromy z LOD ([díl 17](17-optimalizace-a-lod.md)), takže se houpou taky.

Čas větru posouvá `TreesView.update(seconds)` z `GameView.frame()`, a to časem efektů, který při
pauze stojí:

```ts
update(seconds: number): void {
  treeTime.value = seconds;
}
```

## Úskalí

- **Okna vznikla v jednom commitu** (`faaf9c9`) a od té doby se nezměnila. Pozdější úpravy budov
  (barevné fasády, `BatchedMesh`, LOD) s nimi musely počítat: okna se určují před přebarvením,
  geometrie s atributy oken mají vlastní dávku a low-detail budovy se do LOD nezjednodušují,
  protože mají málo trojúhelníků a jejich okna jsou zadarmo (`LOD_MIN_TRIANGLES = 600`
  v `buildings.ts`).
- **Ohnuté normály.** První nápad je vzít normály vrcholů. Na hranách modelu jsou ale vyhlazené
  a stěna by se rozpadla. Proto se normála počítá z poloh vrcholů trojúhelníku.
- **Úzké pásky.** Bez `MIN_WALL` dostaly okna i úzké římsy a nástavby na střeše a budova vypadala
  jako děrovaná. Plochy užší než 0,3 a nižší než 0,14 se přeskočí.
- **Klon materiálu.** Kdo vloží `onBeforeCompile` do sdíleného materiálu z GLB, dostane okna na
  všech budovách z kitu, i na těch detailních, které okna už mají v geometrii.
- **Vítr jen na instancích.** Strom vložený jako obyčejný `Mesh` se nehýbe a nikdo neví proč.
  Komentář u `treeObject` to vysvětluje.

## Scénář videa

1. **Hook:** mrakodrap z City Kitu bez oken (holé bílé stěny) vs. ve hře s okny, přiblížit až na
   okna a ukázat ostré hrany.
2. **Proč ne textura:** otevřít `colormap.png`, ukázat, že UV ukazují do palety.
3. **Vlastní atribut:** nákres `facade.xy` a `facade.zw` na stěně.
4. **Union-find:** animovaný nákres trojúhelníků slučovaných do stěn. Ladicí trik: dočasně v shaderu
   obarvit stěny podle `vFacade.zw` a ukázat, že každá stěna má jednu barvu.
5. **Mřížka:** `floor`/`fract` ve 2D, postupně zapnout okno, rám, odlesk.
6. **Antialiasing:** nahradit `facadeBox` ostrým `step`, oddálit a ukázat blikání. Pak vrátit.
7. **Prosklená fasáda:** `mod`, `edge`, sjednocení přes `max`.
8. **Řetězení háčků:** ukázat klíč `facade-windows|lamp-light`, přepnout na noc.
9. **Vítr:** les zblízka, pak v shaderu zvětšit koeficient 0,014 desetkrát a ukázat vlnu běžící
   lesem.
10. **instanceMatrix[3]:** nákres matice po sloupcích.
11. **Outro:** příště roční období: přebarvení terénu, stromů a sníh na střechách.

## Cvičení

- Rozsviťte v noci náhodná okna: přidejte uniformu `nightAmount` a v `applyFacade` podle
  `facadeHash(id)` přimíchejte k části oken teplou žlutou. Pozor, okna se kreslí před osvětlením,
  takže je v noci osvětlení ztmaví. Svítící okna je potřeba přidat do `emissive` (nápověda:
  chunk `emissivemap_fragment` a proměnná `totalEmissiveRadiance`).
- Změňte `FLOOR` a `COLUMN` a sledujte, jak se mění měřítko budov. Při jaké výšce patra začne
  mrakodrap vypadat jako panelák?
- Udělejte vítr jednotný ve světě: místo přičtení k `transformed` v prostoru modelu spočítejte
  výchylku tak, aby po vynásobení `instanceMatrix` mířila vždy ve stejném směru (inverze rotace,
  nebo posun až v `project_vertex`).
- Přidejte do větru druhou, rychlejší a menší vlnu (třepetání listí), aby pohyb nebyl tak
  pravidelný.
