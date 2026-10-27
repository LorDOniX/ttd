# Díl 12 – Shadery I: voda a led

> **Soubory:** `src/render/water.ts`, `src/render/terrain.ts`, `src/render/gameView.ts`
> **Commity:** `73762c8` (stavba přes vodu, shadery vody), `0d79d89` (pauza částicových systémů, led na vodě)

## O čem je tento díl

Až dosud jsme scénu skládali z geometrie a hotových materiálů three.js. Voda ale byla jen modrá
plocha a mrtvá modrá plocha vypadá jako modrý koberec. V tomhle dílu poprvé napíšeme kód, který
běží přímo na grafické kartě, tedy **shader**. Na konci bude divák rozumět:

- co se děje mezi „mám trojúhelník“ a „mám barevné pixely“ (grafická pipeline),
- čím se liší `attribute`, `uniform` a `varying`,
- základům GLSL: `vec2/vec3`, `mix`, `smoothstep`, `fract`, `sin`, `fwidth`,
- jak three.js skládá shader materiálu z kousků (chunků) a jak do něj přes `onBeforeCompile`
  vložit vlastní kód, aniž bychom přišli o světla, mlhu a další funkce materiálu,
- jak vznikají animované vlnky, záblesky slunce, a v zimě led s prasklinami mezi krami,
- proč se detail vody při oddálení schválně ztlumí (aliasing, „třpyt“).

Výsledek: vlnící se hladina, která při pauze stojí, při oddálení se zklidní a v zimě postupně
zamrzá od břehů.

## Teorie

### Co GPU dělá s trojúhelníkem

Když zavoláme `renderer.render(scene, camera)`, three.js pro každý viditelný mesh pošle na GPU
draw call: „tady jsou vrcholy, tady je program, nakresli to“. Program má dvě části:

```
  atributy vrcholů                        uniformy (společné pro celý draw call)
  (position, normal, color, uv…)          (matice kamery, čas, barva světla…)
          │                                          │
          ▼                                          │
  ┌──────────────────┐                               │
  │  VERTEX SHADER   │ ◄─────────────────────────────┤
  │  1× pro vrchol   │  spočte gl_Position (kde na   │
  │                  │  obrazovce vrchol leží)       │
  │                  │  a „varyings“ pro fragmenty   │
  └────────┬─────────┘                               │
           ▼                                         │
  ┌──────────────────┐                               │
  │   RASTERIZACE    │  zjistí, které pixely         │
  │  (pevná funkce)  │  trojúhelník pokrývá, a       │
  │                  │  INTERPOLUJE varyings         │
  └────────┬─────────┘                               │
           ▼                                         │
  ┌──────────────────┐                               │
  │ FRAGMENT SHADER  │ ◄─────────────────────────────┘
  │  1× pro pixel    │  spočte barvu pixelu
  └────────┬─────────┘
           ▼
     test hloubky, míchání průhlednosti → obrázek
```

Klíčové je, že vertex shader běží pro každý **vrchol** (terén 256×256 má 262 144 vrcholů),
fragment shader pro každý **pixel** trojúhelníku (u celoobrazovkové vody to jsou miliony za snímek).
Všechny instance běží paralelně a nevidí na sebe: shader nemůže „zeptat se souseda“, má jen svoje
vstupy.

### Tři druhy vstupů

| Kvalifikátor | Odkud | Mění se | Příklad ve hře |
| --- | --- | --- | --- |
| `attribute` | buffer geometrie | pro každý vrchol | `position`, `normal`, `color`, u oken `facade` (díl 13) |
| `uniform` | z JavaScriptu | jednou za draw call | `waterTime`, `waterIce` |
| `varying` | výstup vertex shaderu | interpolovaný pro každý pixel | `vWaterPosition`, `vWaterUp` |

Interpolace varyingů je kouzlo, na kterém stojí skoro všechno: když vertex shader do varyingu
zapíše světovou polohu vrcholu, fragment shader dostane světovou polohu **přesně toho pixelu**,
lineárně dopočtenou mezi třemi vrcholy trojúhelníku. Dlaždice vody má jen čtyři vrcholy, ale vlnky
na ní můžeme kreslit s přesností na pixel.

### GLSL v kostce

GLSL vypadá jako C s vektorovými typy:

```glsl
vec2 p = vec2(1.0, 2.0);   // float se vždy píše s tečkou: 1.0, ne 1
vec3 c = vec3(0.8, 0.9, 0.97);
p.x; c.rgb; c.xz;          // „swizzle“: libovolný výběr a pořadí složek
c *= 1.1;                  // operace po složkách
```

Funkce, které budeme potřebovat:

| Funkce | Co dělá |
| --- | --- |
| `mix(a, b, t)` | lineární prolnutí `a + (b − a)·t`; `t = 0` → a, `t = 1` → b |
| `smoothstep(e0, e1, x)` | 0 pod `e0`, 1 nad `e1`, mezi nimi hladká S-křivka `3t² − 2t³` |
| `fract(x)` | desetinná část čísla, `x − floor(x)` |
| `floor(x)` | dolní celá část; s `fract` rozdělí rovinu na buňky |
| `sin(x)` | sinus; základ všech vlnek |
| `dot(a, b)` | skalární součin; `dot(c, vec3(1.0/3.0))` je průměr složek |
| `length(v)` | délka vektoru |
| `fwidth(v)` | jak moc se `v` změní mezi sousedními pixely (viz dál) |

`smoothstep` je nejpoužívanější funkce celé hry. Funguje jako „měkký if“:

```
 1 ┤              ●●●●●●●●
   │            ●
   │           ●            smoothstep(0.2, 0.6, x)
   │          ●
 0 ┤●●●●●●●●●
   └────────┬───┬──────────► x
           0.2 0.6
```

Když prohodíme hranice (`smoothstep(0.25, 0.06, x)`), dostaneme obrácenou křivku: 1 pro malé `x`,
0 pro velké. Přesně tak to dělá voda při oddálení.

### fwidth: jak velký je pixel

GPU nepočítá fragmenty po jednom, ale v blocích 2×2 pixely. Díky tomu umí pro libovolnou hodnotu
spočítat, o kolik se liší u sousedního pixelu vpravo (`dFdx`) a dole (`dFdy`).
`fwidth(v) = abs(dFdx(v)) + abs(dFdy(v))`.

Když do `fwidth` dáme světovou polohu na mapě, dostaneme **velikost jednoho pixelu v dlaždicích**:

```
  přiblíženo (zoom 4)              oddáleno (zoom 0.3)
  ┌─┬─┬─┬─┬─┬─┬─┐                  ┌───────┐
  ├─┼─┼─┼─┼─┼─┼─┤ pixel = 0.02     │       │ pixel = 0.25 dlaždice
  ├─┼─┼─┼─┼─┼─┼─┤ dlaždice         │   ●   │ jedna vlnka (perioda ~0.2)
  └─┴─┴─┴─┴─┴─┴─┘ vlnka = desítky  │       │ je menší než pixel
                  pixelů           └───────┘
```

Proč nás to zajímá: když je vzor jemnější než pixel, každý pixel „trefí“ jinou fázi vlnky a obraz
začne zrnit a při pohybu kamery blikat. Tomu se říká **aliasing** (podvzorkování, Nyquistova mez:
na jednu periodu vzoru potřebujeme aspoň dva pixely). Řešení je jednoduché: když je pixel velký,
vzor ztlumíme.

### Jak three.js staví shader materiálu

`MeshLambertMaterial` není jeden soubor shaderu. Je to šablona složená z desítek kousků, které
three.js vkládá direktivou `#include <název>`. Zkrácený vertex shader Lambertu
(`node_modules/three/src/renderers/shaders/ShaderLib/meshlambert.glsl.js`):

```glsl
#include <common>
#include <color_pars_vertex>
// …
void main() {
  #include <uv_vertex>
  #include <color_vertex>
  // …
  #include <beginnormal_vertex>
  // …
  #include <begin_vertex>
  // …
  #include <project_vertex>
  // …
}
```

a fragment shader:

```glsl
void main() {
  // …
  #include <map_fragment>
  #include <color_fragment>
  // …
  #include <lights_fragment_begin>
  #include <lights_fragment_maps>
  #include <lights_fragment_end>
  // …
}
```

Co je v kouscích, které budeme potřebovat (přesně z `ShaderChunk/`):

```glsl
// begin_vertex: lokální poloha vrcholu, kterou pak upravují další kroky
vec3 transformed = vec3( position );

// project_vertex: instancing/batching, kamera a projekce
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;

// color_fragment: barva vrcholu násobí základní barvu
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif
```

### Proč ne vlastní ShaderMaterial

Mohli bychom napsat celý shader od nuly (`THREE.ShaderMaterial`). Jenže pak bychom museli sami
napsat osvětlení hemisférickým i směrovým světlem, light mapu nočních lamp (díl 16), barvy vrcholů,
instancing, batching… Terén by v noci nepotemněl a lampy by na vodu nesvítily.

Místo toho necháme three.js sestavit jeho shader a **těsně před kompilací do něj vložíme pár řádků**.
K tomu slouží háček `material.onBeforeCompile(shader)`: dostaneme zdrojáky vertex a fragment shaderu
jako řetězce a objekt jejich uniforem. Vložení je obyčejné `String.replace` na řádek `#include`:

```
'#include <color_fragment>'
        ▼ replace
'#include <color_fragment>\nif (…) applyWater(diffuseColor.rgb);'
```

Kód za `color_fragment` vidí `diffuseColor` už vynásobenou barvou vrcholu, ale ještě **před**
osvětlením. Voda, kterou tu přebarvíme, se tedy dál normálně osvětluje: v noci ztmavne a lampy
u břehu na ni svítí.

### Cache programů

Kompilace shaderu trvá desítky milisekund, proto three.js zkompilovaný program sdílí mezi všemi
materiály se stejným „klíčem“. Klíč se skládá z typu materiálu, zapnutých funkcí (mapa, barvy
vrcholů, instancing…) a z výsledku `material.customProgramCacheKey()`. Výchozí implementace
v three.js vrací `this.onBeforeCompile.toString()`, tedy zdroják funkce.

Tady je past: když dvě funkce `onBeforeCompile` mají **stejný zdroják, ale jiné zachycené
proměnné**, three.js je považuje za stejné a druhý materiál dostane program prvního. `withWater`
vkládá výšku hladiny `surfaceY` přímo do řetězce shaderu, zatímco zdroják arrow funkce je pro
každou výšku stejný. Ve hře to nevadí, protože terén i břehy používají stejnou výšku, ale kdo by
chtěl vodu ve dvou výškách, musí výšku přidat do klíče (nebo ji předat jako uniform).

Hra klíč nastavuje explicitně, aby bylo jasné, co se sdílí:

```ts
material.customProgramCacheKey = () => 'water';
```

### Sdílené uniformy

Uniforma v three.js je objekt `{ value }`. Když stejný objekt vložíme do uniforem více materiálů,
stačí změnit `value` na jednom místě a změna platí pro všechny:

```ts
// Čas animace v sekundách, sdílený všemi materiály s vodou
const time = { value: 0 };
// Zamrznutí hladiny 0 (voda) až 1 (celá pod ledem)
const ice = { value: 0 };
```

Žádné procházení scény, žádné `material.needsUpdate`. Three.js při každém draw callu nahraje do GPU
aktuální `value`.

## Implementace

### 1. Kde je voda

Z [dílu 03](03-teren.md) víme, že terén je jediná geometrie a dlaždice vody mají vrcholy o
`WATER_DEPTH` níž. Na rozhraní je svislý hliněný břeh, nad ním písčitý lem a přes vodu u břehu
leží „vějíř“ mělčiny:

```
   tráva       písek     ┌ břeh (svislá stěna, normála vodorovně)
  ──────────┬──────────┐ │
   y = 0    │ y=0.002  │ │
            └──────────┤◄┘
                       │       mělčina y = −0.059      hloubka y = −0.06
                       └────────────────────────────────────────────────
                                ▲ hladina: surfaceY = −0.055
```

Materiál terénu ale kreslí trávu, chodníky i vodu najednou. Shader proto musí sám poznat, který
pixel je hladina: plocha musí být **vodorovná** (normála míří nahoru) a **pod úrovní hladiny**.
V `TerrainView` (`src/render/terrain.ts`):

```ts
// Hladina (dlaždice vody i mělčina) má animované vlnky
const surface = -WATER_DEPTH + 0.005;
const mesh = new THREE.Mesh(this.geometry, withWater(this.groundMaterial, surface));
// …
this.shore = new THREE.Mesh(
  this.buildShore(),
  withWater(new THREE.MeshLambertMaterial({ vertexColors: true }), surface),
);
```

Stejnou funkci dostane i geometrie břehů, protože v ní leží mělčina. Svislá stěna břehu má
`normal.y = 0`, písčitý lem leží nad terénem, takže ani jedno vlnky nedostane.

### 2. withWater: vložení kódu

Celá funkce (`src/render/water.ts`):

```ts
const VERTEX = /* glsl */ `
varying vec3 vWaterPosition;
varying float vWaterUp;
`;

// Doplní materiálu animovanou hladinu na vodorovné plochy pod úrovní surfaceY
export function withWater(material: THREE.Material, surfaceY: number): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterIce = ice;
    shader.vertexShader =
      VERTEX +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWaterUp = normal.y;',
      );
    shader.fragmentShader =
      FRAGMENT +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\nif (vWaterUp > 0.5 && vWaterPosition.y < ${surfaceY.toFixed(4)}) applyWater(diffuseColor.rgb);`,
      );
  };
  material.customProgramCacheKey = () => 'water';
  return material;
}
```

Rozebrané po řádcích:

- `VERTEX` a `FRAGMENT` se **přidají na začátek** shaderu. Deklarace varyingů a uniforem musí být
  mimo `main()`, a začátek souboru je nejjednodušší místo.
- Za `begin_vertex` už existuje proměnná `transformed`, lokální poloha vrcholu. `modelMatrix`
  ji převede do světa. Výsledek uložíme do varyingu, takže fragment shader dostane světovou polohu
  každého pixelu, tedy souřadnice na mapě v dlaždicích.
- `vWaterUp = normal.y` – svislá složka normály. Terén není otočený, takže lokální normála je
  zároveň světová.
- Za `color_fragment` voláme `applyWater` jen pro vodorovné plochy pod hladinou. Výšku hladiny
  vkládáme jako číselný literál (`-0.0550`).
- `shader.uniforms.waterTime = time` – tady se napojí sdílený objekt uniformy.

### 3. Vlnky

Začátek `applyWater`:

```glsl
void applyWater(inout vec3 color) {
  vec2 p = vWaterPosition.xz;
  float t = waterTime;
  float pixel = length(fwidth(p));
  float detail = smoothstep(0.25, 0.06, pixel);
  // …
```

`p` je poloha na mapě v dlaždicích, `inout` znamená, že funkce barvu čte i přepisuje. `pixel` je
velikost pixelu v dlaždicích a `detail` je 1, když je pixel menší než 0,06 dlaždice, a 0, když je
větší než 0,25.

Pro představu: kamera má `viewSize = 12` ([díl 02](02-izometricka-kamera.md)), takže výška okna
zabírá při zoomu 1 dvacet čtyři „jednotek obrazovky“. Na Full HD je to zhruba 0,022 dlaždice na
pixel ve směru obrazovky. Na zemi je svislý krok obrazovky kvůli sklonu kamery 30° dvakrát delší
a `fwidth` sčítá oba směry, takže `pixel` vychází zhruba 0,07 / zoom. Vlnky jsou tedy naplno vidět
od zoomu kolem 1,1 a pod zoomem kolem 0,27 úplně zmizí.

Samotná vlna:

```glsl
float wave =
  sin(p.x * 5.0 + t * 1.1 + sin(p.y * 3.0 + t * 0.6) * 1.5) +
  sin(p.y * 6.0 - t * 0.9 + sin(p.x * 2.5 - t * 0.5) * 1.5);
```

Postavme ji postupně:

1. `sin(p.x * 5.0)` – rovné pruhy kolmo na osu X, perioda 2π/5 ≈ 1,26 dlaždice.
2. `+ t * 1.1` – pruhy se posouvají v čase.
3. `+ sin(p.y * 3.0 + t * 0.6) * 1.5` – fáze první vlny se mění podle `y`. Pruhy se zvlní a vlnění
   se samo pohybuje. Tomu se říká **domain warping**: nedeformujeme výsledek, ale vstupní
   souřadnice.
4. Druhý sinus dělá totéž v ose Y s jinými čísly. Součet dvou nesouměřitelných vln nevytváří
   viditelnou mřížku.

```
 1. sin(x)        3. s warpingem      4. součet dvou
 │ │ │ │ │        ) ) ) ) )           ≈≈ ~≈ ≈~ ≈≈
 │ │ │ │ │        ( ( ( ( (           ~≈ ≈≈ ~≈ ≈~
 │ │ │ │ │        ) ) ) ) )           ≈~ ≈≈ ≈~ ~≈
```

`wave` je v rozsahu −2 až 2 a mění jas: `color *= 1.0 + wave * 0.04 * open`, tedy ±8 %. Na vodě
nepotřebujeme výškovou deformaci geometrie, stačí, že se střídají světlejší a tmavší pásy.

### 4. Záblesky slunce

```glsl
// Drobné záblesky slunce v menším měřítku než vlnky, zdeformované vlnou, aby netvořily mřížku
vec2 g = p + wave * 0.12;
float glint = sin(g.x * 11.0 + g.y * 7.0 + t * 1.7) * sin(g.y * 9.0 - g.x * 5.0 - t * 1.3);
float open = (1.0 - frozen) * detail;
color *= 1.0 + wave * 0.04 * open;
color = mix(color, vec3(0.8, 0.9, 0.97), smoothstep(0.88, 0.98, glint) * smoothstep(0.5, 1.5, wave) * 0.4 * open);
```

Součin dvou šikmých sinusů dává „kostičkovaný“ vzor hrbolků. `smoothstep(0.88, 0.98, glint)`
z nich nechá jen úplné vršky, tedy malé tečky. Druhý `smoothstep(0.5, 1.5, wave)` je povolí jen
na hřebenech velkých vln. Souřadnice `g` jsou posunuté vlnou, takže tečky neleží v pravidelné
mřížce, ale „plavou“. Výsledek se namíchá k téměř bílé barvě, nejvýš na 40 %.

`open` spojuje dvě podmínky: vlny a záblesky jsou vidět jen tam, kde voda nezamrzla a kde je
dost pixelů.

### 5. Mělčina z jasu

Led se má u břehu tvořit dřív a být zasněžený. Shader ale neví, kde je břeh, má jen barvu.
Geometrie mělčiny přitom barví vodu od světle modré `SHALLOW` (0x5aa3cc) u břehu po tmavší `WATER`
(0x3a6fb0). Stačí tedy změřit jas:

```glsl
// Mělčina u břehu je světlejší než hloubka
float shallow = smoothstep(0.22, 0.34, dot(color, vec3(1.0 / 3.0)));
```

Pozor, barvy v shaderu jsou **lineární**: three.js převádí hex barvu z sRGB do lineárního
prostoru. Průměr složek tak vychází zhruba 0,21 pro hloubku a 0,36 pro mělčinu, a hranice 0,22 až
0,34 je mezi nimi. Kdo by porovnával s hex hodnotami (0x3a = 58 = 0,23), nastaví prahy špatně.

### 6. Hash a šum v shaderu

Na led potřebujeme náhodu. Shader ale nemá `Math.random()` a ani ho nechceme: každý pixel musí
dostat při každém snímku stejné číslo. Používá se klasický „hash“:

```glsl
float iceHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
```

`dot` udělá z bodu jedno číslo, `sin` ho zamotá, násobení velkým číslem zvětší rozdíly a `fract`
vezme jen desetinnou část. Výsledek vypadá jako náhodné číslo 0..1, ale je to čistá funkce polohy.
(Na velmi velkých souřadnicích a slabých GPU s nižší přesností se tenhle hash začne opakovat; pro
mapu do 512 dlaždic to stačí.)

Z hashe se dělá **value noise** stejně jako na CPU v [dílu 04](04-generovani-sveta.md): hodnoty
v rozích buňky mřížky se hladce prolnou.

```glsl
float iceNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(iceHash(i), iceHash(i + vec2(1.0, 0.0)), u.x),
    mix(iceHash(i + vec2(0.0, 1.0)), iceHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
```

`u = f*f*(3−2f)` je stejná křivka jako u `smoothstep`, díky ní nejsou na hranách buněk vidět zlomy.

### 7. Praskliny: Voronoi

Kry v ledu mají tvar nepravidelných mnohoúhelníků. Na to je ideální **Voronoiův diagram**: do každé
buňky mřížky dáme jeden náhodný bod a každý pixel patří k nejbližšímu bodu. Hranice mezi oblastmi
jsou praskliny.

```
  ┌───────┬───────┬───────┐
  │   ●   │       │ ●     │      ● náhodný bod v buňce (iceHash2)
  │      ╲│   ●  ╱│       │      ╲ ╱ hranice oblastí = místa, kde jsou
  ├───────╲──────╱┼───────┤          dva nejbližší body stejně daleko
  │    ●   ╲────╱ │   ●   │
  │         │     │       │      d1 = vzdálenost k nejbližšímu bodu
  └───────┴─┴─────┴───────┘      d2 = vzdálenost k druhému nejbližšímu
                                 na hranici je d2 − d1 = 0
```

```glsl
// Vzdálenost k hraně nejbližší Voronoiovy buňky, hrany tvoří praskliny mezi krami
float iceCracks(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float d = length(g + iceHash2(i + g) - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return d2 - d1;
}
```

Stačí prohledat 3×3 okolních buněk, protože nejbližší bod nemůže být dál. `d2 − d1` je přibližná
vzdálenost od hranice, uprostřed kry velká, na prasklině nula.

Z „vzdálenosti od hranice“ se čára vyrobí prahem. Aby čára nezrnila, je okraj prahu široký přesně
podle velikosti pixelu:

```glsl
// Prasklina šířky width, vyhlazená podle velikosti pixelu ve světových souřadnicích
float iceCrackLine(vec2 p, float scale, float width, float pixel) {
  float aa = pixel * scale * 1.5;
  return 1.0 - smoothstep(width, width + aa, iceCracks(p * scale));
}
```

Proč `pixel * scale`: Voronoi počítáme v souřadnicích `p * scale`. V nich je pixel `scale`krát
větší než ve světových souřadnicích. Tohle je obecný recept na **analytický antialiasing**:
okraj tvaru vyhladit na šířku jednoho až dvou pixelů, ani víc (rozmazané), ani míň (zubaté).

### 8. Barva ledu

```glsl
vec3 iceColor(vec2 p, float shallow, float detail, float pixel) {
  float drift = iceNoise(p * 1.3) * 0.6 + iceNoise(p * 4.1) * 0.4;
  float snow = clamp(shallow * 0.55 + smoothstep(0.5, 0.82, drift) * 0.75, 0.0, 1.0);
  vec3 color = mix(vec3(0.36, 0.53, 0.67), vec3(0.72, 0.81, 0.87), snow);
  // Šmouhy a bublinky zamrzlé v ledu
  color *= 1.0 + (iceNoise(vec2(p.x * 9.0 + p.y * 2.0, p.y * 1.7)) - 0.5) * 0.1 * detail;
  float cracks = iceCrackLine(p, 1.4, 0.035, pixel) * 0.7 + iceCrackLine(p, 4.2, 0.02, pixel) * 0.18 * detail;
  return mix(color, vec3(0.2, 0.33, 0.47), clamp(cracks, 0.0, 1.0) * (1.0 - snow * 0.7));
}
```

Vrstvy, jak se skládají:

1. **Sníh na ledu** (`snow`): dvě oktávy šumu dají závěje, u břehu (`shallow`) je sněhu víc.
2. **Základní barva**: od čirého modrošedého ledu po zasněžený.
3. **Šmouhy**: šum natažený v jednom směru (`p.x * 9 + p.y * 2`) dá protáhlé pruhy. Jen ±5 %
   a jen přiblížené.
4. **Praskliny ve dvou měřítkách**: velké kry (`scale 1.4`) a jemné vlásečnice (`scale 4.2`),
   jemné jen přiblížené.
5. **Sníh překryje praskliny**: `(1.0 − snow * 0.7)`.

### 9. Zamrzání po ostrůvcích

Uniforma `waterIce` plynule roste od 0 do 1. Kdyby celý rybník zamrzl naráz, vypadalo by to jako
přepnutí textury. Místo toho má každý bod hladiny vlastní „pořadí zamrznutí“:

```glsl
float frozen = 0.0;
if (waterIce > 0.0) {
  float freezeOrder = iceNoise(p * 0.35) * 0.7 + (1.0 - shallow) * 0.3;
  frozen = smoothstep(0.0, 0.1, waterIce * 1.1 - freezeOrder);
}
```

- `iceNoise(p * 0.35)` – šum s velkými skvrnami (perioda kolem tří dlaždic). Body s nízkou
  hodnotou zamrznou první.
- `(1.0 − shallow) * 0.3` – hloubka zamrzá později než mělčina u břehu.
- `waterIce * 1.1 − freezeOrder` – jak roste `waterIce`, přes nulu přechází čím dál víc bodů.
  Koeficient 1,1 zajistí, že při `waterIce = 1` je zamrzlé opravdu všechno (`freezeOrder` je nejvýš 1).
- `smoothstep(0.0, 0.1, …)` – hrana ledu je měkká, ne ostrá.

```
 waterIce = 0.3            waterIce = 0.6             waterIce = 1.0
 ░░▓▓░░░░░░░░░░            ░▓▓▓▓░░░▓▓░░░░             ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
 ▓▓▓░░░░░░░▓▓░░            ▓▓▓▓▓░░▓▓▓▓░░▓             ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
 ▓░░░░░░░░░░░░▓            ▓▓▓░░░░░▓▓░░▓▓             ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
   ▓ = led (nejdřív u břehů a v „ostrůvcích“ šumu)
```

Konec funkce:

```glsl
if (frozen < 1.0) {
  // … vlny a záblesky
}
if (frozen > 0.0) color = mix(color, iceColor(p, shallow, detail, pixel), frozen);
```

Podmínky mají i výkonový smysl: pod souvislým ledem se vlnky vůbec nepočítají a v létě se nepočítá
led (včetně drahé smyčky 3×3 ve Voronoi). Větvení v shaderu je levné, když se všechny sousední
pixely rozhodnou stejně, a to u celých ploch vody platí.

### 10. Strana JavaScriptu

Na CPU zbývají dvě funkce:

```ts
// Posune animaci vody; stačí jednou za snímek
export function updateWater(seconds: number): void {
  time.value = seconds;
}

// Zamrznutí všech vodních ploch 0 až 1
export function setWaterIce(amount: number): void {
  ice.value = amount;
}
```

`GameView.frame()` volá `updateWater(this.effectsSeconds)`. To je čas efektů, který při pauze stojí
(díl 15). Led nastavuje terén při změně ročního období, podíl zimy dodá `seasonWeight(blend, 'winter')`
([díl 14](14-rocni-obdobi.md)):

```ts
setSeason(blend: SeasonBlend): void {
  // …
  setWaterIce(seasonWeight(blend, 'winter'));
```

## Úskalí

- **Čas z `onBeforeRender`.** První verze (`73762c8`) posouvala čas vody v háčku meshe terénu:
  `mesh.onBeforeRender = () => updateWater(performance.now() / 1000)`. Fungovalo to, protože
  uniforma je sdílená a břehy ji dostaly taky, ale voda tekla i při pauze. Commit `0d79d89`
  zavedl `effectsSeconds` v `GameView` a všechny animace (voda, kouř, listí, závory) teď berou
  čas odtud. Při pauze stojí celý svět, ne jen vlaky.
- **Třpyt při oddálení.** Bez `detail` se vlnky při oddálení měnily v blikající šum. Od první verze
  proto vlny i záblesky násobí `smoothstep(0.25, 0.06, …fwidth…)`. Stejný princip pak používají
  praskliny v ledu a okna na budovách (díl 13).
- **Vodorovnost a výška.** Podmínka `vWaterUp > 0.5 && y < surfaceY` vypadá zbytečně, ale bez ní
  by vlnky dostal i hliněný břeh a písčitý lem, které leží ve stejné geometrii břehů.
- **Klíč programu.** Výška hladiny je zapečená v řetězci shaderu, ale `customProgramCacheKey` je pro
  všechny stejné `'water'`. Dokud mají všechny vodní materiály stejnou výšku, je to v pořádku.
- **Lineární barvy.** Prahy mělčiny jsou v lineárním prostoru. Při změně barev vody v `terrain.ts`
  se musí přepočítat i prahy v shaderu.

## Scénář videa

1. **Hook:** statická modrá voda (starý commit) vedle animované vody a zamrzlého jezera.
2. **Pipeline:** nákres vertex → rasterizace → fragment. Zdůraznit „pro každý pixel“ a interpolaci
   varyingů.
3. **attribute / uniform / varying:** tabulka, u každého příklad z vody.
4. **GLSL za 3 minuty:** `vec`, swizzle, graf `smoothstep`.
5. **Jak three.js staví shader:** otevřít `meshlambert.glsl.js` v `node_modules`, ukázat `#include`
   a obsah `begin_vertex` a `color_fragment`.
6. **onBeforeCompile:** projít `withWater`. Živě: dočasně přidat `console.log(shader.fragmentShader)`
   a ukázat sestavený shader v konzoli.
7. **Vlnky živě:** v `applyWater` postupně zapínat `sin(p.x*5)`, pak `t`, pak warping, pak druhou
   vlnu. Vite po uložení stránku sám přenačte.
8. **fwidth:** dočasně `color = vec3(pixel * 4.0);`, zoomovat a ukázat, jak se mění jas. Pak
   vypnout `detail` a ukázat třpyt při oddálení.
9. **Led:** Voronoi nákres, pak `color = vec3(iceCracks(p * 1.4));` jako ladicí výstup.
10. **Zamrzání:** v Nastavení přepínat roční období, ukázat ostrůvky ledu u břehů.
11. **Outro:** stejným trikem příště nakreslíme okna na budovy a rozhýbeme stromy.

## Cvičení

- Změňte koeficienty vlny (`5.0`, `6.0`, `1.5`) a sledujte, jak se mění charakter hladiny. Najděte
  kombinaci, která vypadá jako rozbouřené moře.
- Přidejte uniformu `waterWind` (0..1), která zvětší amplitudu vln a rychlost. Nezapomeňte ji vložit
  do `shader.uniforms`.
- Nahraďte `d2 − d1` jen hodnotou `d1` a podívejte se, jak vypadá „buněčný“ vzor místo prasklin.
- Zkuste dát vodě dvě výšky hladiny (třeba rybník nad úrovní řeky) a ověřte past s cache programů.
  Opravte ji tak, že výšku přidáte do `customProgramCacheKey`, nebo z ní uděláte uniformu.
- Ladicí trik: dočasně obarvěte vodu podle `shallow` (`color = vec3(shallow)`) a zkontrolujte, že
  mělčina u břehů opravdu vychází bíle.
