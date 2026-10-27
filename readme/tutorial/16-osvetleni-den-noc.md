# Díl 16 – Osvětlení, den a noc

> **Soubory:** `src/render/gameView.ts` (světla scény, přechod den/noc), `src/render/nightLights.ts`,
> `src/render/roads.ts` (pouliční lampy), `src/render/industryYard.ts` (reflektory),
> `src/render/trains.ts`, `src/render/roadVehicles.ts` (světla vozidel)
> **Commity:** `33eb071` (přepínání dne a noci), `b612ace` (noční světlo), `cdf0c14` (optimalizace světel),
> `95adfb8` (nasvícení bez shaderu), `ea5b061` (osvětlení fasád), `0f7eed1` (plynulé střídání dne a noci),
> `3349613` (fix kouře)

## O čem je tento díl

Tohle je jeden z nejzajímavějších dílů celé série, protože se na něm dá ukázat, jak se grafický
problém řeší postupně – třikrát jinak, než se dojde k řešení, které je hezké **a** rychlé:

1. nejdřív si vysvětlíme, jak three.js osvětlení vůbec počítá (Lambert, hemisférické a směrové
   světlo, emissive, barevné prostory),
2. uděláme plynulý přechod dne do noci,
3. rozsvítíme pouliční lampy – nejdřív „poctivě“ bodovými světly, a uvidíme, proč to nejde,
4. přejdeme na **zapečenou light mapu** přes celou mapu: libovolný počet lamp za cenu jednoho
   čtení textury,
5. tutéž texturu použijeme v **upraveném shaderu** budov, aby lampy svítily i na fasády,
6. přidáme záři měst, svítící hlavy lamp a reflektorů a světla vozidel.

Na konci divák uvidí, jak se za soumraku postupně rozsvěcují ulice, oranžové skvrny lamp na
chodnících a stěnách domů, záři nad městy a vlaky s předními a zadními světly.

## Teorie

### Lambertův model: proč je stěna ke slunci světlejší

Matně odrážející povrch (omítka, tráva, asfalt) rozptyluje světlo do všech směrů stejně. Kolik
světla na něj dopadne, závisí jen na úhlu mezi **normálou** povrchu `N` a směrem **ke světlu** `L`:

```
            L (ke slunci)
             \    N
              \   |
               \θ |
                \ |
   ──────────────\|────────────  povrch

   dopadající světlo ~ cos θ = N · L   (oba vektory jednotkové)
```

Kolmo dopadající paprsek (`θ = 0`) dá plný jas, šikmý se rozprostře na větší plochu a dá méně,
povrch odvrácený od světla (`N · L < 0`) nedostane nic. Výsledná barva pixelu:

```
barva = albedo · ( okolní_světlo  +  Σ max(0, N · Lᵢ) · barva_světlaᵢ )
```

`albedo` je barva materiálu (z `color`, textury nebo barev vrcholů). Three.js k tomu ještě
přidává fyzikální faktor `1/π` (funkce `BRDF_Lambert` v `common.glsl.js`), proto jsou intenzity
světel ve hře větší než 1.

V three.js r151+ se Lambert počítá **po pixelech** (dřív po vrcholech). V kódu shaderu
`meshlambert.glsl.js` je to vidět jako dvě funkce:

```glsl
void RE_Direct_Lambert( … ) {
  float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
  vec3 irradiance = dotNL * directLight.color;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, … ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
```

`RE_Direct` se volá pro každé směrové, bodové a bodově kuželové světlo. `RE_IndirectDiffuse`
jednou, se součtem „nepřímého“ světla v proměnné `irradiance` – sem patří hemisférické světlo
a light mapa. Tahle proměnná bude pro nás později klíčová.

### Proč `MeshLambertMaterial`

Three.js nabízí řadu materiálů:

| Materiál | Co počítá | Cena |
| --- | --- | --- |
| `MeshBasicMaterial` | jen barvu, žádné světlo | nejlevnější |
| `MeshLambertMaterial` | difuzní světlo (N·L) | levný |
| `MeshPhongMaterial` | + odlesky | střední |
| `MeshStandardMaterial` | fyzikální model (drsnost, kovovost) | dražší |

Terén, silnice, chodníky, stromy, lampy a procedurální objekty průmyslu používají Lambert. Důvody:

- **Styl.** Low-poly svět z Kenney kitů nemá kovy ani lesklé plochy; odlesky by jen rušily.
- **Výkon.** Fragment shader Lambertu je výrazně kratší než PBR. Terén pokrývá celou obrazovku,
  takže každá instrukce navíc se platí milionkrát za snímek.

Modely načtené z GLB (budovy, vlaky, auta) si ponechávají `MeshStandardMaterial` z loaderu
s matnými parametry. Stromy se naopak na Lambert převádějí (díl 13), postavy taky – z jiného
důvodu, ke kterému se dostaneme v Úskalí.

### Hemisférické a směrové světlo

Scéna má jen dvě světla (`gameView.ts`):

```ts
this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x556644, 1.2);
scene.add(this.hemisphere);
this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
this.sun.position.set(10, 20, 5);
scene.add(this.sun);
```

**`DirectionalLight`** je slunce: nekonečně daleko, všechny paprsky rovnoběžné, směr z `position`
k počátku. Stěny natočené k `(10, 20, 5)` jsou světlejší než protější – to dává budovám tvar.

**`HemisphereLight`** je levná náhrada světla z oblohy a odraženého od země. Nemá směr paprsku,
jen dvě barvy: oblohu nahoře a zem dole. Barva pro normálu `N` se smíchá podle toho, jak moc
míří nahoru:

```glsl
float dotNL = dot( normal, hemiLight.direction );   // direction = nahoru
float hemiDiffuseWeight = 0.5 * dotNL + 0.5;        // -1..1 → 0..1
vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
```

```
        obloha (bílá)
            ▲
   střecha: N nahoru → plně bílá
   stěna:   N vodorovně → půl na půl
   spodek:  N dolů → zelenošedá (0x556644, odraz trávy)
            ▼
        zem (0x556644)
```

Díky tomu žádná plocha není úplně černá (stěny odvrácené od slunce), a spodní plochy mají jemný
zelený nádech od trávy. Bez stínů (`castShadow` hra nepoužívá) je tohle celé osvětlení dne.

### Emissive: povrch, který svítí sám

Každý osvětlený materiál má `emissive` – barvu, která se přičte **na konci**, bez ohledu na
světla:

```glsl
vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
```

Emissive nic kolem neosvětlí. Je to jen „tento povrch je jasný“. Hlava lampy s emissive je v noci
jasně oranžová, ale chodník pod ní zůstane tmavý – na to potřebujeme skutečné světlo (nebo jeho
iluzi, viz dál).

### sRGB a lineární prostor

Světlo se sčítá a násobí **lineárně**: dvě lampy dají dvojnásobek energie. Monitory a obrázky ale
ukládají barvy v **sRGB**, s gama křivkou, která dává víc úrovní tmavým odstínům (oko je v tmách
citlivější):

```
lineární 0,5  ≈  sRGB 0,735   (188 z 255)
lineární 0,2  ≈  sRGB 0,485   (124 z 255)
```

Three.js to řeší automaticky, pokud mu řekneme, v jakém prostoru data jsou:

- barvy zapsané hexem (`new THREE.Color(0xffcf83)`) považuje za sRGB a interně převede do
  lineárního prostoru,
- textura s `texture.colorSpace = THREE.SRGBColorSpace` se při čtení v shaderu převede na lineární,
- výstup rendereru (`outputColorSpace`, výchozí sRGB) se na konci shaderu převede zpět
  (chunk `colorspace_fragment`).

Celý výpočet světla tedy běží lineárně. U zapečené light mapy to využijeme.

### Tone mapping

Součet světel může přesáhnout 1. Tone mapping (`renderer.toneMapping`, např. ACES) to stlačí do
0..1 jako expozice fotoaparátu. Hra ho nepoužívá (výchozí `NoToneMapping`), přepaly se jen oříznou.
Pro low-poly styl s pastelovými barvami je to v pořádku a barvy zůstávají přesně takové, jaké jsou
v paletě. Materiály záře a mlhy přesto mají `toneMapped: false`, aby se chovaly stejně i při
pozdějším zapnutí tone mappingu.

### Proč jsou bodová světla drahá

Three.js je **forward renderer**: každý pixel každého objektu v jednom průchodu sečte příspěvky
všech světel ve scéně. Pro bodová světla vypadá smyčka v `lights_fragment_begin.glsl.js` takhle:

```glsl
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
  // …
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
```

Z toho plynou dva problémy:

1. **Cena = pixely × světla.** Terén zabírá celou obrazovku (třeba 2 miliony pixelů na 1440p
   s `devicePixelRatio`). 32 bodových světel znamená 64 milionů výpočtů světla za snímek jen pro
   zem – i pro pixely, kam žádná lampa nedosvítí.
2. **`NUM_POINT_LIGHTS` je `#define`.** Počet světel se vkládá do zdrojového kódu shaderu. Když se
   změní (přidá se lampa, jedna zmizí ze záběru), three.js musí **znovu zkompilovat shadery všech
   osvětlených materiálů**. Kompilace trvá desítky až stovky milisekund – hra se zasekne.

## Implementace

### 1. Plynulý přechod dne a noci

První verze (`33eb071`) přepínala natvrdo: kliknutí na ikonu nastavilo noční barvy. Commit
`0f7eed1` z toho udělal plynulý soumrak. Den i noc jsou páry barev:

```ts
const NIGHT_TRANSITION_MS = 2500;
const DAY_SKY = new THREE.Color(0x87b5d8);
const NIGHT_SKY = new THREE.Color(0x10182a);
const DAY_HEMISPHERE = new THREE.Color(0xffffff);
const NIGHT_HEMISPHERE = new THREE.Color(0x536b9a);
const DAY_GROUND = new THREE.Color(0x556644);
const NIGHT_GROUND = new THREE.Color(0x171b26);
const DAY_SUN = new THREE.Color(0xffffff);
const NIGHT_SUN = new THREE.Color(0x8095c0);
```

Noc není černá: obloha je tmavě modrá, „slunce“ (teď měsíc) modravé a slabé, hemisférické světlo
modrošedé. Modrý nádech je filmová konvence – oko v šeru vnímá modrou citlivěji (Purkyňův jev)
a teplé lampy proti němu vyniknou.

Stav přechodu `nightAmount` (0 = den, 1 = noc) se posouvá v reálném čase, každý snímek se
přepočtou barvy:

```ts
private updateNight(ms: number): void {
  const target = this.nightTarget ? 1 : 0;
  if (this.nightAmount === target) return;
  const step = ms / NIGHT_TRANSITION_MS;
  this.nightAmount =
    target > this.nightAmount ? Math.min(target, this.nightAmount + step) : Math.max(target, this.nightAmount - step);
  const t = THREE.MathUtils.smoothstep(this.nightAmount, 0, 1);
  this.scene.background = this.sky.lerpColors(DAY_SKY, NIGHT_SKY, t);
  this.hemisphere.color.lerpColors(DAY_HEMISPHERE, NIGHT_HEMISPHERE, t);
  this.hemisphere.groundColor.lerpColors(DAY_GROUND, NIGHT_GROUND, t);
  this.hemisphere.intensity = THREE.MathUtils.lerp(1.2, 0.28, t);
  this.sun.color.lerpColors(DAY_SUN, NIGHT_SUN, t);
  this.sun.intensity = THREE.MathUtils.lerp(1.5, 0.12, t);
  this.roads.setNightMode(this.lightsAmount);
  this.industries.setNightMode(this.lightsAmount);
}
```

- `smoothstep` místo lineárního průběhu: přechod začne i skončí pozvolna, bez „škubnutí“.
- Barvy se mění **na místě** (`lerpColors` do existujícího objektu), nic se nealokuje.
- Změna barvy nebo intenzity světla je jen nový uniform – žádná rekompilace.

Lampy se nerozsvítí hned s prvním ztmavnutím oblohy, ale až za soumraku:

```ts
// Lampy se rozsvítí až za soumraku, ne hned s prvním ztmavnutím oblohy
private get lightsAmount(): number {
  return THREE.MathUtils.smoothstep(this.nightAmount, 0.35, 0.85);
}
```

```
nightAmount   0 ──── 0,35 ─────────── 0,85 ──── 1
obloha        světlá ──────────────────────► tmavá
lightsAmount  0       0 ─────────────► 1      1
```

### 2. Pokus první: bodová světla u kamery (`b612ace`, `cdf0c14`)

Přirozený první nápad: každá lampa = `PointLight`. Protože lamp jsou tisíce, verze `b612ace` si
vzala jen 32 lamp **nejblíž kameře** a jejich polohy každý snímek přeházela:

```ts
const MAX_STREET_LAMPS = 32;
// …
const light = new THREE.PointLight(0xffcf83, 2.5, 5, 2);
```

```ts
const visible = streetLamps
  .filter((position) => {
    VIEW_SPHERE.center.set(position.x, LAMP_HEIGHT, position.z);
    return frustum.intersectsSphere(VIEW_SPHERE);
  })
  .sort((a, b) => a.distanceToSquared(cameraPosition) - b.distanceToSquared(cameraPosition))
  .slice(0, MAX_STREET_LAMPS);
```

Hned se ukázal problém s rekompilací: když bylo v záběru 5 lamp a pak 6, změnil se počet
viditelných světel a všechny shadery se přeložily. Optimalizace `cdf0c14` proto drží počet
světel **konstantní** – nevyužitá zůstávají ve scéně s nulovou intenzitou:

```ts
// Nevyužitá světla zůstávají ve scéně s nulovou intenzitou: změna jejich počtu by přeložila shadery všech materiálů
for (let index = 0; index < MAX_STREET_LAMPS; index++) {
  const bulb = LAMP_BULB.clone();
  bulb.visible = false;
  const light = new THREE.PointLight(0xffcf83, 0, 5, 2);
  this.lamps.push({ bulb, light });
  this.lampLayer.add(bulb, light);
}
```

a při oddálení celou vrstvu světel schová („jen dvě varianty, žádné další překlady“).

Zbyly ale dva neodstranitelné problémy:

- **cena**: 32 světel v každém pixelu terénu, budov i stromů, i když jsou z nich vidět tři,
- **vzhled**: lampy dál než 32. nejbližší nesvítí. Při posunu kamery se skvrny světla přeskakují
  z lampy na lampu.

### 3. Řešení: zapečená light mapa (`95adfb8`)

Klíčové pozorování: **lampy se nehýbou**. Mění se, jen když se přestaví silnice. Světlo, které
dopadá na zem, se tedy dá spočítat jednou – na CPU – a uložit do textury. Shader pak místo
smyčky přes světla udělá jediné čtení z textury.

Tomu se říká **light mapa** (zapečené světlo, baked lighting). Hry ji tradičně používají pro
statické osvětlení interiérů; my ji použijeme pro noční lampy.

#### Textura přes celou mapu

Jedna `DataTexture` pokrývá celý svět. Rozlišení se volí podle velikosti mapy, nejvýš 4 texely na
dlaždici a nejvýš 2048 px na stranu:

```ts
this.texelsPerTile = Math.max(
  1,
  Math.min(LIGHT_MAP_MAX_TEXELS_PER_TILE, Math.floor(LIGHT_MAP_MAX_SIZE / Math.max(mapWidth, mapHeight))),
);
const width = mapWidth * this.texelsPerTile;
const height = mapHeight * this.texelsPerTile;
this.lampLevels = new Uint8Array(width * height);
const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height, THREE.RGBAFormat);
texture.colorSpace = THREE.SRGBColorSpace;
texture.channel = 1;
texture.repeat.set(1 / mapWidth, 1 / mapHeight);
texture.magFilter = THREE.LinearFilter;
texture.minFilter = THREE.LinearMipmapLinearFilter;
texture.generateMipmaps = true;
```

Pro mapu 512×512 to dává 4 texely na dlaždici a texturu 2048×2048 (16 MB v RGBA). Lampa má
poloměr světla 1,4 dlaždice, tedy skvrnu o průměru asi 11 texelů – s lineárním filtrováním
dostatečně hladkou.

#### Zapečení lamp

Každá lampa „namaluje“ do textury kruhovou skvrnu:

```ts
for (const lamp of lamps) {
  const cx = lamp.x * scale;
  const cz = lamp.z * scale;
  // … obdélník texelů kolem lampy (x0..x1, z0..z1)
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      const dx = tx + 0.5 - cx;
      const dz = tz + 0.5 - cz;
      const d2 = (dx * dx + dz * dz) / (radius * radius);
      if (d2 >= 1) continue;
      const i = tz * width + tx;
      const level = Math.min(255, levels[i] + Math.round((1 - d2) * (1 - d2) * LAMP_PEAK));
      levels[i] = level;
      pixels.set(LAMP_LUT.subarray(level * 4, level * 4 + 4), i * 4);
    }
  }
}
```

**Útlum `(1 − d²)²`** (`d` = vzdálenost / poloměr):

```
jas
 1 ┤▇▇▆▅
   │    ▅▄
   │      ▃▂
   │        ▂▁
 0 ┤──────────▁▁──── d
   0          1
```

- ve středu 1, na okraji přesně 0 – skvrna nemá viditelnou hranu,
- plynulá i v derivaci na okraji (žádný „lem“),
- stačí `d²`, žádná odmocnina.

Skutečné světlo ubývá s `1/d²` a nikdy neklesne na nulu; tahle aproximace s konečným dosahem se
v hrách používá právě proto, že se dá ořezat (stejný tvar má i útlum `PointLight` s parametrem
`distance`).

**Sčítání úrovní.** Překrývající se lampy se sčítají v poli `levels` (0..255), tedy **lineárně**.
`LAMP_PEAK = 200` nechává rezervu na překryv dvou lamp, než jas narazí na strop 255.

**LUT do sRGB.** Úroveň se do textury nezapisuje přímo, ale přes předpočítanou tabulku:

```ts
// Barva texelu (sRGB bajty) pro každou úroveň jasu lampy
const LAMP_LUT = (() => {
  const lut = new Uint8Array(256 * 4);
  const color = new THREE.Color();
  for (let level = 0; level < 256; level++) {
    const hex = color
      .copy(LAMP_COLOR)
      .multiplyScalar(level / 255)
      .getHex();
    lut.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], level * 4);
  }
  return lut;
})();
```

`THREE.Color` drží barvu lineárně. `multiplyScalar` tedy škáluje jas lineárně (fyzikálně správně)
a `getHex()` výsledek převede do sRGB bajtů. Textura je označená `SRGBColorSpace`, takže GPU ji při
čtení převede zpět do lineárního prostoru. Proč ta okliky? 8 bitů na kanál je málo. V sRGB
připadá víc z 256 úrovní na tmavé odstíny, a právě slabé okraje skvrn by v lineárním 8bitovém
zápisu byly vidět jako schody (banding).

Přepéká se jen při skutečné změně poloh lamp (`sameLamps`), ne při každé přestavbě silnic.

#### Light mapa na zemi

Three.js podporuje light mapy ve všech osvětlených materiálech (`material.lightMap`). Čte se ve
chunku `lights_fragment_maps`:

```glsl
#ifdef USE_LIGHTMAP
  vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
  vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
  irradiance += lightMapIrradiance;
#endif
```

Světlo lampy se tedy přičte k **nepřímému** světlu (`irradiance`) a pak se vynásobí albedem
materiálu – světlá dlažba chodníku je pod lampou světlejší než tmavý asfalt, jak to má být.

Light mapa potřebuje UV souřadnice. Normální UV terénu ani silnic nepokrývají celý svět jednou
texturou, proto se přidá druhá sada `uv1`, kde UV = světové souřadnice:

```ts
// Souřadnice do zapečených světel lamp: světové x, z (na mapu je přepočte repeat textury)
export function withLampLightUv(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  if (!position) return geometry;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i);
    uv[i * 2 + 1] = position.getZ(i);
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
```

- `texture.channel = 1` řekne three.js, ať pro tuto texturu použije `uv1` místo `uv`
  (v shaderu se to promítne jako `LIGHTMAP_UV` → `uv1`),
- `texture.repeat = (1/mapWidth, 1/mapHeight)` převede světové souřadnice 0..mapWidth na 0..1
  (three.js z `repeat` sestaví matici `lightMapTransform`).

Materiály terénu, silnic a chodníků se zaregistrují a jejich intenzita sleduje soumrak:

```ts
light(...materials: THREE.MeshLambertMaterial[]): void {
  for (const material of materials) {
    material.lightMap = this.lampLight;
    material.lightMapIntensity = (this.lastNight ?? 0) * LAMP_LIGHT_INTENSITY;
    this.litMaterials.push(material);
  }
}
```

Výsledek: **tisíce lamp za cenu jednoho čtení textury na pixel**, bez jediného bodového světla,
bez rekompilací. Test v `nightLights.test.ts` to hlídá přímo: „nepoužívá bodová světla a stejné
lampy znovu nepřepéká“.

### 4. Lampy na fasádách: vlastní kód v shaderu (`ea5b061`)

Light mapa leží na zemi. Domy u ulice ale zůstávaly tmavé – a v noci jsou osvětlené stěny to, co
dělá město městem. Budovy light mapu jako `lightMap` použít nemohou: mají své UV (do palety) a
světlo na svislé stěně se nedá číst z místa, kde stěna stojí (tam je pod ní zem bez světla).

Řešení je vložit do shaderu budov vlastní funkci, která čte **stejnou texturu** podle světové
polohy pixelu. Technika `onBeforeCompile` je stejná jako u vody ([díl 12](12-shadery-voda.md)).

Do vertex shaderu se přidá výpočet světové polohy a normály:

```glsl
vec4 lampWorld = vec4(transformed, 1.0);
vec3 lampNormal = objectNormal;
#ifdef USE_BATCHING
lampWorld = batchingMatrix * lampWorld;
lampNormal = mat3(batchingMatrix) * lampNormal;
#endif
#ifdef USE_INSTANCING
lampWorld = instanceMatrix * lampWorld;
lampNormal = mat3(instanceMatrix) * lampNormal;
#endif
vLampWorld = (modelMatrix * lampWorld).xyz;
vLampNormal = mat3(modelMatrix) * lampNormal;
```

Proč ty `#ifdef`? Budovy se kreslí přes `BatchedMesh` ([díl 06](06-instancing-a-draw-cally.md)),
stromy a vybavení přes `InstancedMesh`. Matici dávky/instance three.js násobí až uvnitř chunku
`project_vertex` do lokální proměnné, `transformed` ji neobsahuje. Musíme ji proto aplikovat sami,
jinak by všechny budovy četly světlo z místa, kde leží jejich model v počátku.

Ve fragment shaderu:

```glsl
vec3 lampLightIrradiance() {
  if (lampLightIntensity <= 0.0) return vec3(0.0);
  vec3 n = normalize(vLampNormal);
  vec2 at = (vLampWorld.xz + n.xz * 0.35) * lampLightScale;
  float fade = 1.0 - smoothstep(0.1, 0.75, vLampWorld.y);
  // Střechy dostanou méně, zem pod nimi (povrch areálu) plné světlo
  float facing = 1.0 - max(n.y, 0.0) * 0.6 * smoothstep(0.03, 0.12, vLampWorld.y);
  return texture2D(lampLightMap, at).rgb * lampLightIntensity * fade * facing;
}
```

Tři triky:

```
            stěna domu
               │
     ulice     │  ← pixel stěny ve výšce y
   ●lampa      │
   ░░░░░▓▓▓▓▓▓▓│      vzorek se čte o 0,35 dlaždice
   ░░skvrna▓▓▓▓│←──   PŘED stěnou ve směru normály
 ─────────────────
```

1. **Vzorek před stěnou.** `vLampWorld.xz + n.xz * 0.35` – stěna čelem k ulici čte světlo
   z chodníku před sebou, kde leží skvrna lampy. Zadní stěna čte z dvorku, kde lampa není.
2. **Útlum s výškou.** `fade` – přízemí je osvětlené naplno, nad výškou 0,75 už nic. Lampa je
   vysoká 0,35, mrakodrap se tak nerozsvítí do posledního patra.
3. **Střechy dostanou méně.** Plochy s normálou nahoru nad úrovní země (`facing`) mají světlo
   tlumené; vodorovné plochy u země (betonový povrch průmyslového areálu) plné.

Napojení do vestavěného shaderu – za chunk, který přičítá light mapu:

```ts
shader.fragmentShader =
  LAMP_FRAGMENT +
  shader.fragmentShader.replace(
    '#include <lights_fragment_maps>',
    '#include <lights_fragment_maps>\nirradiance += lampLightIrradiance();',
  );
```

Přidáním do `irradiance` se světlo lampy chová přesně jako light mapa na zemi: násobí se albedem
a funguje v Lambertu i ve `MeshStandardMaterial` budov (oba chunk `lights_fragment_maps` mají).

`withLampLight` musí počítat s tím, že materiál už může mít vlastní `onBeforeCompile` (okna na
fasádách, [díl 13](13-shadery-okna-a-vitr.md)). Původní funkci proto zavolá a klíč programu
rozšíří:

```ts
const previous = material.onBeforeCompile.bind(material);
const previousKey = material.customProgramCacheKey.bind(material);
material.onBeforeCompile = (shader, renderer) => {
  previous(shader, renderer);
  Object.assign(shader.uniforms, LAMP_UNIFORMS);
  // … vložení kódu
};
material.customProgramCacheKey = () => `${previousKey()}|lamp-light`;
```

Uniformy (`LAMP_UNIFORMS`) jsou jeden sdílený objekt pro všechny materiály – nastavení intenzity
za soumraku je jedno přiřazení `LAMP_UNIFORMS.lampLightIntensity.value = …`, které se projeví všude.

Reflektory průmyslových areálů používají stejnou light mapu: jejich skvrny (`FLOODLIGHT_POOLS`,
čtyři na areál) se zapečou spolu s pouličními lampami. `NightLightsView.update` dostává skupiny
lamp `[this.roads.streetLamps, this.industries.lamps]` a přepeče, když některá skupina dostane nové
pole.

### 5. Svítící zdroje: emissive

Skvrna na zemi bez svítící lampy by působila divně. Hlavy lamp a reflektorů proto dostanou
emissive úměrné soumraku (`roads.ts`):

```ts
// Jas lamp 0 (den) až 1 (noc)
setNightMode(amount: number): void {
  STREETLIGHT_HEAD_MATERIAL.color.lerpColors(STREETLIGHT_HEAD_DAY, STREETLIGHT_HEAD_NIGHT, amount);
  STREETLIGHT_HEAD_MATERIAL.emissive.setHex(0xffb74d);
  STREETLIGHT_HEAD_MATERIAL.emissiveIntensity = 1.8 * amount;
}
```

Reflektory (`industryYard.ts`) totéž s `emissiveIntensity = 2 * amount`. Všechny hlavy lamp sdílejí
jeden materiál a kreslí se jedním `InstancedMesh`, takže rozsvícení celého města je změna jednoho
uniformu.

### 6. Záře nad městy

Z dálky jsou lampy menší než pixel, ale město by v noci mělo být vidět. Nad každým městem leží
kruh s radiální texturou, kreslený **aditivně**:

```ts
const TOWN_GLOW_MATERIAL = new THREE.MeshBasicMaterial({
  map: createTownGlowTexture(),
  color: 0xffd08a,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
```

Aditivní míchání světlo přičítá k tomu, co je pod ním ([díl 15](15-casticove-efekty.md)), takže
nezáleží na pořadí a záře „rozsvítí“ terén i budovy pod sebou. Alfa textury klesá jako
`(1 − d)^2.2`, aby kruh neměl hranu. Všechny záře jsou instance jednoho meshe; do instancí se
zapíšou jen města v záběru a poloměr podle velikosti města:

```ts
const radius = Math.max(4, Math.min(16, town.radius * 0.75));
VIEW_SPHERE.center.set(town.x + 0.5, 0.04, town.y + 0.5);
VIEW_SPHERE.radius = radius;
if (!frustum.intersectsSphere(VIEW_SPHERE)) continue;
this.matrix.makeScale(radius, 1, radius).setPosition(town.x + 0.5, 0.035, town.y + 0.5);
this.townGlows.setMatrixAt(glows++, this.matrix);
```

Opacity materiálu sleduje soumrak (`TOWN_GLOW_MATERIAL.opacity = night`).

### 7. Světla vozidel

Přední a zadní světla vlaků a aut jsou malé kvádry s barvou ve vrcholech, sloučené do jedné
geometrie a kreslené `MeshBasicMaterial` – neosvětlený materiál v noci „svítí“ plnou barvou:

```ts
// Světla vozidla jako jedna geometrie s barvami vrcholů: jeden draw call na vozidlo
export function lightMarkerGeometry(boxes: readonly LightBox[]): THREE.BufferGeometry {
  // … BoxGeometry pro každé světlo, barva do atributu color
  return mergeGeometries(parts)!;
}

export const LIGHT_MARKER_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });
```

U vlaku jsou přední světla na lokomotivě (bílá `0xffedbb`) a zadní červená (`0xef4037`) na
posledním voze. Zobrazují se jen v plné noci a při dostatečném přiblížení:

```ts
// Světla vozidel jsou při oddálení menší než pixel, jen by přidávala draw cally
const vehicleLights = this.lightsAmount > 0.5 && this.camera.camera.zoom >= NIGHT_DETAIL_ZOOM;
```

### 8. Šetrná aktualizace

Záře měst se přepočítávají podle záběru kamery. Aby se to nedělalo každý snímek, `NightLightsView`
si pamatuje roviny frusta z poslední aktualizace a porovnává je s tolerancí:

```ts
if (
  Math.abs(normal.x - this.frustumSnapshot[offset]) > FRUSTUM_NORMAL_EPSILON ||
  // …
  Math.abs(plane.constant - this.frustumSnapshot[offset + 3]) > FRUSTUM_DISTANCE_EPSILON
) {
  return true;
}
```

a při pouhém pohybu kamery aktualizuje nejvýš jednou za `MIN_VIEW_UPDATE_MS = 80` ms. Změna
soumraku nebo lamp aktualizaci vynutí hned. Víc o podobném „dělej jen to, co se změnilo“
v [dílu 17](17-optimalizace-a-lod.md).

## Úskalí

- **Rekompilace shaderů při změně počtu světel** (`b612ace` → `cdf0c14`). Typický zásek, který
  se v profileru projeví jako jeden velmi dlouhý snímek s kompilací shaderů. Dočasné řešení:
  pevný počet světel s nulovou intenzitou. Trvalé řešení: žádná bodová světla (`95adfb8`).
- **Matice instancí a dávek ve vlastním shaderu** (na co si dát pozor). Bez větví
  `#ifdef USE_BATCHING / USE_INSTANCING` by fasády četly světlo z polohy modelu v počátku, ne
  z místa, kde budova stojí. Řetězení `onBeforeCompile` hlídá test „nasvítí fasády zapečeným
  světlem lamp a zachová původní úpravy shaderu“ – okna z dílu 13 se nesmí ztratit.
- **Kouř a `MeshBasicMaterial`** (`3349613`). `withLampLight` se aplikovalo na všechny materiály
  areálu, i na kouř. Basic materiál nemá `irradiance` ani normálu a shader se nezkompiloval.
  Oprava: Basic materiály se vynechají ([díl 15](15-casticove-efekty.md)).
- **Postavy svítily ve tmě.** Modely *blocky characters* mají v GLB rozšíření
  `KHR_materials_unlit`, které GLTFLoader načte jako `MeshBasicMaterial`. Ve dne to nevadí, v noci
  ale chodci zářili plnou barvou. `pedestrians.ts` je proto převádí na Lambert:

  ```ts
  // Postavy mají v GLB neosvětlený materiál (KHR_materials_unlit), v noci by svítily; stínují se jako auta
  function litMaterial(material: THREE.Material, cache: Map<THREE.Material, THREE.Material>): THREE.Material {
    if (!(material instanceof THREE.MeshBasicMaterial)) return material;
    // … new THREE.MeshLambertMaterial({ map: material.map, color: material.color, side: material.side })
  }
  ```

- **Přepalování překryvů.** Bez rezervy `LAMP_PEAK = 200` by se dvě sousední lampy sečetly přes
  255 a uprostřed mezi nimi by vznikl plochý přepálený pruh.

## Scénář videa

1. **Hook:** soumrak nad městem v reálném čase – postupné ztmavnutí, rozsvícení lamp, záře.
2. **Lambert:** nákres N·L, ukázat dům ze dvou stran (osvětlená a stinná stěna).
3. **Hemisféra + slunce:** vypnout postupně každé světlo (`visible = false`) a ukázat rozdíl.
4. **Emissive vs. světlo:** hlava lampy svítí, chodník ne.
5. **sRGB:** ukázat gradient lineárně vs. v sRGB, vysvětlit, proč three.js chce `colorSpace`.
6. **Den/noc:** projít `updateNight`, graf `smoothstep` a `lightsAmount`.
7. **Pokus s PointLighty:** checkout `cdf0c14`, ukázat přeskakující světla při posunu kamery
   a zásek při změně počtu (před `cdf0c14`). Vysvětlit `NUM_POINT_LIGHTS` a forward rendering.
8. **Light mapa:** vykreslit samotnou texturu lamp (např. na plochu přes celou mapu), vysvětlit
   `texelsPerTile`, útlum `(1 − d²)²`, LUT a sRGB, `uv1` a `channel`.
9. **Fasády:** projít vložený GLSL, nákres „vzorek před stěnou“, vypnout `n.xz * 0.35` a ukázat,
   že stěny zhasnou.
10. **Záře, lampy, vozidla:** aditivní kruhy, emissive hlavy, světla vlaků.
11. **Shrnutí:** tři verze, jedna myšlenka – co se nehýbe, to se dá spočítat předem.

## Cvičení

- Zapněte `renderer.toneMapping = THREE.ACESFilmicToneMapping` a porovnejte den i noc. Které
  intenzity by bylo potřeba upravit?
- Přidejte světla do oken domů v noci: v `applyFacade` (díl 13) obarvěte část oken teplou barvou
  podle hashe okna a `lampLightIntensity`. Nápověda: uniform už je v shaderu dostupný.
- Změňte útlum lampy na `(1 − d)` a na `1 − d²`. Kde je vidět hrana a proč?
- Spočítejte, kolik paměti zabere light mapa pro mapu 128×128 a 256×256 (nápověda:
  `LIGHT_MAP_MAX_TEXELS_PER_TILE` a 4 bajty na texel, plus asi třetina na mipmapy).
- Vyzkoušejte reálně bodová světla: přidejte do scény 50 `PointLight` a sledujte FPS a
  `renderer.info.programs.length` při přidání 51. světla.
