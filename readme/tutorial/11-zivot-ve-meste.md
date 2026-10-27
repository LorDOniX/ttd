# Díl 11 – Život ve městě: auta, chodci, semafory

> **Soubory:** `src/game/roadVehicles.ts`, `src/render/roadVehicles.ts`, `src/game/cityTraffic.ts`,
> `src/world/sidewalks.ts`, `src/render/pedestrians.ts`, `src/game/trafficLights.ts`,
> `src/render/trafficLights.ts`, `src/render/crossings.ts`, `src/render/animals.ts`,
> `src/render/ambientProps.ts`, `src/render/trafficOverlay.ts`, `src/game/traffic.ts`
> **Commity:** `a24a82e` (silniční doprava), `779608f` (přejezdy se závorami), `b6619c5` (auta se řadí
> za sebe), `c03b945` (chodci), `ce6ceaa` (drobné detaily do mapy), `b6d9d1a` (auta ve městech,
> zatáčení), `c266685` (ladění aut, křižovatky), `7b24377` (funkční semafory), `390fb42` (zvířata),
> `7068112` (přehled vytíženosti silnic), `86d5ac0` (včely), `43f3f7a` (odstranění zaseknutých aut)

## O čem je tento díl

Město s domy a silnicemi je pořád jen maketa. Tenhle díl ho oživí. Divák na konci uvidí:

- autobusy a nákladní auta hráče, která jezdí vpravo, plynule zatáčejí a řadí se za sebe,
- městská auta, která jezdí náhodně po městě, dávají přednost a stojí na červenou,
- chodce na chodnících, kteří při chůzi kývají rukama a nohama, a přecházejí po zebrách,
- semafory, závory u přejezdů s blikajícími světly, zvířata a včely v lese,
- a hlavně pochopí, jak animovat stovky postaviček **bez kostry a bez AnimationMixeru** – jen
  maticemi v instancích.

## Teorie

### Poloha na trase místo fyziky

Žádné auto ve hře nemá rychlost jako vektor ani kolizní těleso. Každé vozidlo má **trasu**
(`path` – seznam dlaždic) a **vzdálenost na ní** (`pos` – kolik dlaždic už ujelo). Poloha ve světě
je funkce `vehiclePoint(path, pos)`:

```
path:  [A]────[B]────[C]
               │
              [D]
 pos = 0      1      2      3
 pos = 1.3 → kousek za středem B směrem k C
```

Pohyb = zvětšit `pos`. Zastavení před překážkou = nezvětšit ho tolik, kolik by mohl. To je
neuvěřitelně robustní: auto nemůže vyjet ze silnice, nemůže se zaseknout v rohu kvůli fyzice
a jeho stav jsou dvě čísla, která jdou uložit.

### Jízda vpravo: posun kolmo ke směru

Středy dlaždic jsou osa silnice. Auto ale jede v pruhu, tedy posunuté doprava od osy. Pro směr
`(dx, dy)` v rovině mapy (x doprava, y „dolů“ = osa Z scény) je kolmice doprava `(-dy, dx)`:

```
          y (sever = −y)
          ↑
  ────────┼────────►  směr jízdy (dx, dy) = (1, 0)
          │  ● auto       posun = (−dy, dx) · 0,16 = (0, +0,16) → jižně od osy
          ↓               = vpravo při pohledu ve směru jízdy
```

V kódu je to `ROAD_LANE_OFFSET = 0.16` a protijedoucí auta se tak minou bez jakékoli logiky –
prostě jsou v jiném pruhu.

### Zatáčka jako oblouk, obrat jako Bézierova křivka

Rovný úsek je lineární interpolace mezi středy dlaždic. V rohové dlaždici by to ale vypadalo jako
ostrý zlom. Kód proto půl dlaždice před a za středem rohu nahradí **čtvrtkružnicí** o poloměru
0,5. Střed oblouku leží v rohu dlaždice; úhel se interpoluje lineárně s `pos`, tečna k oblouku
dá směr jízdy:

```
        ┌──────────┐
        │    ╭──── │  ← výjezd
        │   ╱      │
  vjezd │──╯       │   oblouk r = 0,5 se středem v rohu dlaždice
        └──────────┘
```

Obrat o 180° (auto se otáčí ve slepé ulici) je speciální případ: tam se použije **kubická Bézierova
křivka** se dvěma řídicími body vystrčenými 0,35 dlaždice dopředu, aby auto opsalo „U“ z jednoho
pruhu do druhého.

### Animace bez kostry

Kenney „blocky characters“ jsou postavičky složené z oddělených meshů: trup, hlava, levá a pravá
ruka, levá a pravá noha. Počátek souřadnic každé končetiny leží v **kloubu** (rameno, kyčel).
To znamená, že rotace dílu kolem jeho vlastního počátku je přesně „zahýbání v kloubu“:

```
  matice dílu = tělo · klidová_poloha_dílu · rotaceX(úhel · swing)
                 │            │                    │
   kde je postava    kde je díl v postavě     kývnutí kolem kloubu
   a kam se dívá     (kloub v počátku dílu)   (levá noha +1, pravá −1)
```

Násobení matic se čte zprava doleva: vrchol končetiny se nejdřív otočí kolem kloubu, pak přesune
na místo v postavě, pak s celou postavou do světa. Úhel je `sin(phase) · 0,6 rad`, kde `phase`
roste s ušlou vzdáleností – nohy se tak hýbou v rytmu kroku a chodec, který stojí, nekývá.

Žádný skeleton, žádné váhy vrcholů, žádný `AnimationMixer`. A protože jsou všechny díly instance
(`InstancedMesh`, viz [díl 06](06-instancing-a-draw-cally.md)), stovky chodců stojí jen tolik draw
callů, kolik je druhů postav × dílů.

## Implementace

### 1. Vozidla hráče

`RoadFleet` (`src/game/roadVehicles.ts`) dělá pro auta totéž co `Fleet` pro vlaky: nákup, jízdní
řád, pohyb, výměnu nákladu. Commit `a24a82e` vtipně využil, že zastávka aut je technicky
**nádraží druhu `'road'`** – cestující, náklad, hodnocení i okno stanice tak fungují beze změny.

Klíčová je funkce `vehiclePoint()`. Rovný úsek:

```ts
const i = Math.max(0, Math.min(path.length - 2, Math.floor(pos)));
const t = Math.max(0, Math.min(1, pos - i));
const a = path[i];
const b = path[i + 1];
// Obrat na místě (A → B → A) má nulový směr; použije se směr k další dlaždici
const dx = b.x - a.x;
const dy = b.y - a.y;
return {
  x: a.x + 0.5 + dx * t - dy * ROAD_LANE_OFFSET,
  y: a.y + 0.5 + dy * t + dx * ROAD_LANE_OFFSET,
  dx,
  dy,
};
```

Zatáčka (`cross` je z-složka vektorového součinu vjezdu a výjezdu – její znaménko říká, jestli auto
zatáčí doleva, nebo doprava):

```ts
if (cross !== 0) {
  const radius = 0.5;
  const centerX = cornerCenter.x - incoming.x * radius + outgoing.x * radius;
  const centerY = cornerCenter.y - incoming.y * radius + outgoing.y * radius;
  // …
  const t = pos - (turn - 0.5);
  const angle = startAngle + angleDelta * t;
  const direction = Math.sign(angleDelta);
  const x = centerX + Math.cos(angle) * radius;
  const y = centerY + Math.sin(angle) * radius;
  const dx = -Math.sin(angle) * direction;
  const dy = Math.cos(angle) * direction;
  return { x: x - dy * ROAD_LANE_OFFSET, y: y + dx * ROAD_LANE_OFFSET, dx, dy };
}
```

Tečna ke kružnici v bodě `(cos α, sin α)` je `(−sin α, cos α)` – derivace polohy podle úhlu. Pruh
se pak přičte stejně jako na rovince, takže auto ve vnitřním pruhu opíše menší oblouk než
protijedoucí ve vnějším.

`vehiclePoint` se volá mnohokrát za snímek (každé auto se ptá na polohu všech ostatních), proto má
jednoprvkovou cache na trasu ve `WeakMap`.

### 2. Vykreslení auta

`RoadVehiclesView` (`src/render/roadVehicles.ts`) jen přečte bod a natočí model:

```ts
private place(path: RoadVehicle['path'], pos: number, view: VehicleView): void {
  const { x, y, dx, dy } = vehiclePoint(path, pos);
  const length = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / length, dy / length];
  // Pozice už zahrnuje jízdní pruh; na mostě auto jede po mostovce
  const lift = this.map.roadBridgeAxis(Math.floor(x), Math.floor(y)) ? BRIDGE_DECK : 0;
  view.group.position.set(x, ROAD_TOP + lift, y);
  view.group.rotation.y = Math.atan2(ux, uy);
  // …
}
```

`atan2(ux, uy)` (pozor, x je první) dává úhel kolem osy Y tak, aby lokální osa +Z modelu (car kit má
předek ve směru +Z) mířila ve směru jízdy. Mapa `y` je scéna `z`, proto `position.set(x, …, y)`.

Auta mimo záběr se schovají ručním testem koule proti frustu (`inView`) – `group.visible = false`
znamená, že je renderer vůbec neprochází. Náklad na korbě valníku (hromada uhlí, klády, plechy) je
poskládaný z jednoduchých těles v souřadnicích modelu a viditelný jen u naloženého auta.

### 3. Řazení za sebe

Commit `b6619c5` popisuje výchozí problém: auta jezdila skrz sebe. Řešení je čistě geometrické –
kolik místa mám před sebou ve **svém pruhu a směru**:

```ts
private roomTo(me: ReturnType<typeof vehiclePoint>, vehicle: RoadVehicle, other: RoadTrafficObstacle): number {
  const it = vehiclePoint(other.path, other.pos);
  if (me.dx * it.dx + me.dy * it.dy <= 0.5) return Infinity;
  const ox = it.x - me.x;
  const oy = it.y - me.y;
  const along = ox * me.dx + oy * me.dy;
  const lateral = Math.abs(ox * me.dy - oy * me.dx);
  // Na stejném místě (např. oba vyjíždejí z garáže) pouští dřív koupené auto
  const ahead = along > 0 || (along === 0 && (other.id === undefined || other.id < vehicle.id));
  return ahead && lateral < LANE_WIDTH ? Math.max(0, along - VEHICLE_GAP) : Infinity;
}
```

Tři skalární součiny, žádná fyzika:

- `me · it ≤ 0,5` – směry svírají víc než 60°, auto jede jinam (protisměr, příčná ulice) a neblokuje.
- `along` – průmět vektoru k druhému autu do mého směru: jak daleko je přede mnou.
- `lateral` – vzdálenost kolmo k mému směru (velikost 2D vektorového součinu): je v mém pruhu?

Auto pak popojede nejvýš o `along − VEHICLE_GAP` (půl dlaždice odstupu). Stejný mechanismus dává
fronty na zastávkách a před závorou.

### 4. Městská auta

`CityTraffic` (`src/game/cityTraffic.ts`) vypouští do měst auta podle počtu obyvatel
(`CARS_PER_RESIDENT = 1 / 300`) s váženě náhodným modelem – sedan je šestkrát častější než
sanitka. Na rozdíl od hráčových aut nemají cíl: trasu si prodlužují za jízdy (`extendPath`)
a staré dlaždice za sebou umazávají, takže `path` má pořád jen pár položek.

Nejvíc práce dala **pravidla na křižovatkách** (commity `c266685`, `3a9bb64`, `43f3f7a`). Při
pohledu dopředu po trase auto u každé křižovatky zjistí, jestli musí zastavit:

```ts
const junctionBlocked = occupied || mustYield || pedestrian || redSignal || exitBlocked;
```

- `occupied` – křižovatku už drží jiné vozidlo,
- `mustYield` – jiné auto má přednost,
- `pedestrian` – po zebře právě jde chodec (množinu dlaždic dodává `PedestriansView.crossingTiles`),
- `redSignal` – semafor ukazuje červenou pro směr příjezdu,
- `exitBlocked` – za křižovatkou není místo; auto by v ní uvízlo a zablokovalo příčný směr.

Poslední pravidlo má komentář, který stojí za citaci:

```ts
// Je hned za křižovatkou (na indexu k cesty) v pruhu auta jiné vozidlo, nebo kdokoli v krátké slepé
// odbočce, kam auto míří? V odbočce se obě auta otáčejí a navzájem by se zablokovala.
```

Slepá odbočka kratší než `SHORT_DEAD_END = 3` dlaždice je past: auto v ní se otočí a chce ven,
auto venku chce dovnitř, a obě na sebe čekají. Proto se do takové odbočky nevjíždí, když v ní
někdo je.

Když auto stojí dlouho a není to kvůli červené, zkusí **objížďku** (`detour`) jinou cestou
k dlaždici kousek před sebou. A kdyby se přece jen zaseklo, hráč může kliknout na auto a v jeho
okně ho odstranit – `relocate()` ho vypustí jinde v tomtéž městě, aspoň 4 dlaždice od původního
místa (commit `43f3f7a`). Upřímné řešení: dopravní simulace s deadlocky je těžká a pojistka pro
hráče je levnější než dokonalá pravidla.

Čas městských aut je odvozený od reálných sekund, ne od herního tempa – `trafficDays()` přepočítá
sekundy na „herní dny při normální rychlosti“. Proto může úvodní obrazovka zrychlit hru a auta
přitom jezdit přirozeně ([díl 10](10-ui-nad-3d.md)).

### 5. Chodníkový graf

Chodci nechodí po dlaždicích, ale po **uzlech na rozích dlaždic** (`src/world/sidewalks.ts`).
Každá silniční dlaždice města má 4 rohy ve vzdálenosti `WALK_INSET = 0.1` od okraje (střed chodníku
širokého 0,2):

```
  roh 0 (SZ)  ●───────● roh 1 (SV)        uzel = index dlaždice · 4 + roh
              │  ███  │                    kroky z rohu:
              │  ███  │  silnice            • podél chodníku k sousednímu rohu
              │  ███  │                     • přes hranu na roh sousední dlaždice
  roh 3 (JZ)  ●───────● roh 2 (JV)          • na křižovatce přes zebru (crossing)
```

Uzel je obyčejné číslo `tile * 4 + corner`, takže graf se nikde neukládá – sousedy spočítá funkce
`sidewalkSteps()` z mapy. Přechod přes hranu na sousední dlaždici roh zrcadlí:

```ts
// Přes severní a jižní hranu se roh zrcadlí svisle, přes východní a západní vodorovně
const mirrored = edge === Edge.N || edge === Edge.S ? 3 - corner : corner ^ 1;
```

Chodec (`src/render/pedestrians.ts`) jde z uzlu do uzlu a na konci kroku si náhodně vybere další,
nejlépe ne zpátky. Přechod po zebře má váhu jen `CROSSING_WEIGHT = 0.35`, takže lidé častěji
pokračují po chodníku. Počet chodců je 10 na 1000 obyvatel a mění se s městem. Chodci nejsou
součástí hry ani uložení – je to čistě vizuální vrstva v `render/`, proto používají `Math.random()`.

### 6. Animace postaviček

Načtení postavy si zapamatuje pro každý díl jeho klidovou matici a koeficient kývání podle jména
uzlu v GLB:

```ts
// Končetiny se kývají kolem kloubu, levá noha s pravou rukou
const LIMB_SWING: Partial<Record<string, number>> = {
  'leg-left': 1,
  'leg-right': -1,
  'arm-left': -1,
  'arm-right': 1,
};
```

```ts
parts.push({
  geometry: child.geometry,
  material: /* … */,
  rest: normalize.clone().multiply(child.matrixWorld),
  swing: LIMB_SWING[child.name] ?? 0,
});
```

`normalize` zmenší postavu na výšku `HEIGHT = 0.16` dlaždice a postaví ji nohama na zem.

Každý snímek pak `render()` spočítá matici těla a pro každý díl jednu matici instance:

```ts
const angle = Math.sin(p.phase) * SWING;
variant.parts.forEach((part, k) => {
  this.matrix.multiplyMatrices(this.body, part.rest);
  if (part.swing !== 0) this.matrix.multiply(this.limb.makeRotationX(angle * part.swing));
  variant.meshes[k].setMatrixAt(index, this.matrix);
});
```

Tělo navíc lehce poskakuje (`bob`) a na zebře sestoupí z chodníku na vozovku:

```ts
const onRoad = p.crossing && p.walked > curb && length - p.walked > curb;
const bob = Math.abs(Math.sin(p.phase)) * HEIGHT * 0.03;
this.position.set(a.x + (b.x - a.x) * t, (onRoad ? ROAD_TOP : SIDEWALK_HEIGHT) + bob, a.y + (b.y - a.y) * t);
this.rotation.setFromAxisAngle(this.up, Math.atan2(b.x - a.x, b.y - a.y));
```

`|sin|` má periodu poloviční oproti `sin` – tělo se zvedne při každém kroku, tedy dvakrát za
dvojkrok.

#### Unlit materiál a noc

Postavy mají v GLB materiál s rozšířením `KHR_materials_unlit`, které three.js načte jako
`MeshBasicMaterial` – ten osvětlení ignoruje. Ve dne to nevadí, v noci by ale postavy „svítily“
v plné barvě uprostřed tmavého města ([díl 16](16-osvetleni-den-noc.md)). Proto se převedou na
osvětlený Lambert se stejnou texturou:

```ts
// Postavy mají v GLB neosvětlený materiál (KHR_materials_unlit), v noci by svítily; stínují se jako auta
function litMaterial(material: THREE.Material, cache: Map<THREE.Material, THREE.Material>): THREE.Material {
  if (!(material instanceof THREE.MeshBasicMaterial)) return material;
  let lit = cache.get(material);
  if (!lit) {
    lit = new THREE.MeshLambertMaterial({ map: material.map, color: material.color, side: material.side });
    cache.set(material, lit);
  }
  return lit;
}
```

#### Proč `frustumCulled = false`

Three.js umí vyřadit mimo záběr celý mesh podle jeho bounding sphere. U `InstancedMesh` je to
koule obalující **všechny** instance – a ta by se musela přepočítat každý snímek, protože se
chodci hýbou. Navíc by stačil jeden chodec v záběru a kreslili by se všichni. Kód to dělá obráceně:
culling vypne a chodce mimo záběr do instancí vůbec nezapíše:

```ts
if (!inView(frustum, x, y + HEIGHT / 2, z, HEIGHT)) continue;
const index = filled[p.variant]++;
// …
mesh.count = filled[i];
```

```ts
const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
// Mimo záběr chodce vynechává už render(), hranice instancí by se musely počítat každý snímek
mesh.frustumCulled = false;
```

`count` říká GPU, kolik instancí z bufferu kreslit – instance jsou „namačkané“ na začátek pole.
`DynamicDrawUsage` je nápověda driveru, že buffer přepisujeme často. Kapacita roste zdvojnásobením
(`allocate`), takže se buffery nealokují každý snímek.

### 7. Semafory

Které křižovatky dostanou semafor, rozhoduje `selectTrafficLights()` (`src/game/trafficLights.ts`):
jen velká města (od 1200 obyvatel), jen čtyřramenné křižovatky, nejblíž centru, nejvýš 3 na město
a aspoň 10 dlaždic od sebe. Cyklus je jednoduchý stavový automat podle času:

```ts
greenAxis(x: number, y: number): 'x' | 'y' | null {
  const junction = this.junctions.get(y * this.map.width + x);
  if (!junction) return null;
  const phase = (this.elapsedSeconds + junction.phaseOffset) % CYCLE_SECONDS;
  if (phase < GREEN_SECONDS) return 'x';
  if (phase < PHASE_SECONDS) return null;
  if (phase < PHASE_SECONDS + GREEN_SECONDS) return 'y';
  return null;
}
```

```
 0s        8s  9s        17s 18s
 |-- zelená X --|R|-- zelená Y --|R|   R = všude červená (vyklizení křižovatky)
```

`phaseOffset` je hash polohy, takže sousední semafory neblikají synchronně. Stav se nikam neukládá,
je to čistá funkce času.

Vykreslení (`src/render/trafficLights.ts`) mění u žárovek **barvu i emissive**:

```ts
redMaterial.color.setHex(active ? DARK_RED : RED);
greenMaterial.color.setHex(active ? GREEN : DARK_GREEN);
redMaterial.emissive.setHex(active ? 0x000000 : 0x9e1710);
greenMaterial.emissive.setHex(active ? 0x146b2a : 0x000000);
```

`emissive` je barva, kterou materiál vyzařuje sám, bez ohledu na světla scény. Lambertův materiál
počítá zhruba `výsledek = barva · osvětlení + emissive`, takže rozsvícená žárovka svítí i v noci,
kdy je osvětlení slabé. Víc o tom v [dílu 16](16-osvetleni-den-noc.md). Statické části semaforu
jsou „zmrazené“ přes `freezeStatic` ([díl 17](17-optimalizace-a-lod.md)).

### 8. Přejezdy se závorami

Závora (`src/render/crossings.ts`) je hierarchie objektů: sloupek, skříňka se dvěma světly
a **čep** (`pivot`), na kterém visí ráhno z pěti červenobílých pruhů. Hierarchie scény tu dělá
práci za nás – ráhno se otáčí kolem čepu, protože je jeho potomkem:

```ts
// Ráhno se otáčí kolem čepu na sloupku; zavřené vede napříč vozovkou
const pivot = new THREE.Group();
pivot.position.set(x, PIVOT, z);
if (side === -1) pivot.rotation.y = Math.PI;
const arm = new THREE.Group();
for (let i = 0; i < 5; i++) {
  const stripe = new THREE.Mesh(stripeGeometry, i % 2 === 0 ? redMaterial : whiteMaterial);
  stripe.position.x = (i + 0.5) * (ARM_LENGTH / 5);
  arm.add(stripe);
}
pivot.add(arm);
```

Pruhy začínají na `x = 0` a jdou do kladného x, takže počátek ráhna je na jeho konci u čepu.
Každý snímek se úhel posune k cíli nejvýš o `ARM_SPEED · dt` (konstantní úhlová rychlost) a světla
blikají podle času:

```ts
const blink = Math.floor(now / BLINK_MS) % 2;
for (const [i, view] of this.views) {
  const closed = isClosed(i % this.map.width, Math.floor(i / this.map.width));
  const target = closed ? 0 : Math.PI / 2;
  const step = ARM_SPEED * dt;
  view.angle += Math.max(-step, Math.min(step, target - view.angle));
  for (const arm of view.arms) arm.rotation.z = view.angle;
  view.lamps[0].color.set(closed && blink === 0 ? LAMP_ON : LAMP_OFF);
  view.lamps[1].color.set(closed && blink === 1 ? LAMP_ON : LAMP_OFF);
}
```

Zavřeno je, když dlaždici přejezdu drží rezervace vlaku ([díl 08](08-vlaky.md)). Světla jsou
`MeshBasicMaterial`, tedy neosvětlená – „svítí“ přesně svou barvou. Každý přejezd má vlastní
dva materiály, aby blikal nezávisle; při zbourání se uvolní (`dispose`).

### 9. Zvířata a včely

`animalPlacements()` (`src/render/animals.ts`) rozmístí zvířata **hashem dlaždice** – jen v lese
s aspoň dvěma lesními sousedy, bobra jen u vody. Každé zvíře je stavový automat: čeká, vybere
sousední lesní dlaždici, lineárně k ní dojde, zase čeká. Včely navíc „kmitají“ součtem sinusů:

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

Rychlý sinus (`t * 5`) dělá bzučení, pomalý (`t * 1.3`) houpání a dva posunuté sinusy v x a z
dávají Lissajousovu křivku – let, který se neopakuje nápadně. V zimě se včely schovají maticí
s nulovým měřítkem (`HIDDEN`) – instance zůstane v bufferu, jen se zdegeneruje do bodu. Při
oddálení pod `ANIMALS_MIN_ZOOM` se celá vrstva skryje a nepočítá. Aktualizují se jen změněné
instance (`addUpdateRange`), ne celý buffer.

### 10. Drobné rekvizity

`AmbientPropsView` (`src/render/ambientProps.ts`, commit `ce6ceaa`) doplní do měst lavičky, koše,
značky, záhony, schránky, telefonní budky, hydranty a stromořadí, na venkov farmy, větrné mlýny,
elektrárny a vodojemy, a natáhne elektrické vedení. Všechno je složené z primitiv (kvádr, válec,
kužel, koule) a rozmístěné hashem dlaždice. Zajímavé je seskupení: díly se stejným tvarem
a barvou jdou do jednoho `InstancedMesh`:

```ts
const key = `${geoKey}:${part.color}`;
let batch = batches.get(key);
if (!batch) {
  batch = { geometry: geo, material: mat, matrices: [] };
  batches.set(key, batch);
}
batch.matrices.push(part.matrix);
```

Tisíce laviček a košů tak stojí desítky draw callů.

### 11. Přehled vytíženosti silnic

`collectTrafficHotspots()` (`src/game/traffic.ts`, commit `7068112`) spočítá na každé silniční
dlaždici vozidla a čekající a `TrafficOverlayView` je vykreslí jako barevné čtverce nad silnicí –
jeden `InstancedMesh` s barvou na instanci (`setColorAt`) od zelené po červenou. Průhledný,
bez zápisu do hloubky a s `renderOrder = 3`, aby ležel přes silnice (o průhlednosti víc
v [dílu 15](15-casticove-efekty.md)).

## Úskalí

- **Auta jezdila skrz sebe** – řazení za sebe podle průmětu do směru jízdy (`b6619c5`).
- **Auta čekala u přejezdu bez důvodu.** Před závorami stála na hraně dlaždice a hráč nevěděl
  proč (`779608f`). Vizuální zpětná vazba (závory, světla) je součást herní logiky.
- **Deadlocky na křižovatkách.** Několik commitů (`c266685`, `3a9bb64`, `43f3f7a`) postupně přidalo
  pravidla: místo za křižovatkou, krátké slepé odbočky, přednost auta, které už do křižovatky
  zasahuje, objížďky. Pojistkou je ruční odstranění zaseknutého auta.
- **Svítící postavy v noci** – unlit materiál z GLB převedený na Lambert.
- **Culling instancí** – `frustumCulled = false` + ruční výběr instancí v záběru.

## Scénář videa

1. **Hook:** přiblížit se k velkému městu – auta, chodci, semafor přepíná.
2. **Trasa a pos:** nakreslit trasu jako seznam dlaždic, auto jako číslo na ní.
3. **Pruh a zatáčka:** kolmice `(-dy, dx)`, oblouk, Bézier při obratu; ukázat auto zatáčející
   zpomaleně (rychlost ×1, velký zoom).
4. **Řazení:** tři skalární součiny v `roomTo`, demo fronty na zastávce.
5. **Městská auta:** pravidla křižovatky, slepá odbočka jako past, tlačítko „odstranit“.
6. **Chodníkový graf:** rohy dlaždic jako uzly, zrcadlení rohů.
7. **Animace bez kostry:** v Blenderu/galerii modelů ukázat oddělené končetiny s pivotem v kloubu,
   pak řádek `body · rest · rotX`.
8. **frustumCulled:** vysvětlit, proč ho vypínáme.
9. **Semafory a závory:** emissive vs. MeshBasic, hierarchie čep → ráhno.
10. **Zvířata a včely:** Lissajous, zimní schování maticí s nulovým měřítkem.

## Cvičení

- Změňte `ROAD_LANE_OFFSET` na záporné číslo. Co se stane? (Anglie.) Které další části kódu by
  bylo potřeba upravit (zastávky, závory na „pravé“ straně)?
- Přidejte chodcům kývání hlavou (díl `head`, malý úhel, dvojnásobná frekvence).
- Prodlužte zelenou na hlavní ose semaforu (ve směru k centru města) a zkraťte na vedlejší.
- Nechte závoru při zavírání zpomalovat ke konci (easing místo konstantní rychlosti).
- Zkuste dát chodcům `frustumCulled = true` a nechat bounding sphere spočítat jednou. Kdy začnou
  „mizet“ a proč?
