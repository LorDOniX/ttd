# Díl 00 – Úvod: co stavíme a jak o 3D přemýšlet

> **Soubory:** `ttd.md` (zadání), `src/main.ts`, `src/render/gameView.ts`, `src/screens/game.ts`
> **Commity:** `7de4696` (first commit) … `b20c153` (LOD, letadla)

## O čem je tento díl

Než otevřeme editor, ukážeme si hotovou hru a rozebereme, z čeho se skládá. Divák by měl na konci
vědět:

- co hra umí a čím se inspiruje (OpenTTD / Transport Tycoon Deluxe),
- proč je postavená na three.js a ne v herním enginu,
- jak je rozdělený kód (data světa × herní logika × vykreslování × UI),
- jaký souřadnicový systém používáme a jak vypadá jeden snímek hry,
- základní slovník 3D grafiky, který budeme v dalších dílech používat.

## Co stavíme

Budovatelskou dopravní hru ve stylu Transport Tycoonu, která běží v prohlížeči:

- **Mapa z dlaždic** (128×128 až 512×512), generovaná ze seedu: tráva, voda, lesy, města a vesnice
  s českými jmény, průmyslové závody (doly, elektrárny, pily, rafinerie, farmy…).
- **Hráč staví** koleje, nástupiště, depa, návěstidla, silnice, zastávky a garáže. Kupuje vlaky
  a auta, nastavuje jim jízdní řády a vydělává na přepravě cestujících, pošty a nákladu.
- **Svět žije**: města rostou, po silnicích jezdí městská auta, po chodnících chodí lidé, na
  křižovatkách svítí semafory, u přejezdů padají závory, v lesích pobíhají zvířata a létají včely.
- **Čas plyne**: hra začíná v roce 1950 a končí 2050, jeden rok trvá 15 minut. Střídají se roční
  období (jarní zeleň, podzimní listí, sníh na střechách, zamrzlá voda) a den s nocí (pouliční
  lampy, rozsvícené fasády, světla vozidel).
- **Grafika** je izometrická jako v OpenTTD, ale renderovaná ve 3D: dá se plynule zoomovat
  a otáčet po 90°.

Celé zadání, ze kterého vývoj vycházel, je v `ttd.md` v kořeni repozitáře. Za zmínku stojí, že je
psané jako seznam přání („chtěl bych…“), ne jako technická specifikace. Technická rozhodnutí
(jak kreslit terén, jak dělat noc) vznikala až za pochodu a historie commitů je i historií chyb
a jejich oprav. Právě ty jsou pro video nejzajímavější.

## Proč three.js a ne Unity/Godot

- **Běží v prohlížeči bez instalace.** Build je statická složka, kterou stačí nahrát na FTP
  (díl 18).
- **Plná kontrola nad vykreslováním.** Engine by nám schoval to, co chceme v sérii vysvětlit:
  jak vzniká geometrie, co dělá shader, proč je draw call drahý.
- **TypeScript všude.** Herní logika, generátor světa i testy jsou obyčejný TypeScript, který se
  testuje ve Vitestu bez prohlížeče.
- **Hotové modely.** Kenney kity (CC0) jsou ve formátu GLB, který three.js načte jedním řádkem.

Cena za to: všechno, co engine dává zadarmo (LOD, culling, světla, částice), si musíme napsat nebo
aspoň pochopit. To je ale přesně obsah série.

## Technologie

| Co | Proč |
| --- | --- |
| [three.js](https://threejs.org) 0.186 | WebGL renderer, scéna, kamery, materiály, loader GLB |
| TypeScript | typy pro herní data i three.js (`@types/three`) |
| Vite | dev server s okamžitým reloadem, build, servírování assetů |
| Vitest | testy herní logiky i výpočtů geometrie (bez GPU) |
| oxlint, Prettier | lint a formátování |
| Kenney kity | modely budov, vlaků, aut, postav, zvířat, přírody (GLB + paleta) |
| basic-ftp | nasazení buildu na hosting |

## Jak je rozdělený kód

```
src/
  world/    data světa: mapa dlaždic, generátor, města, koleje, hledání cest   (bez three.js)
  game/     herní logika: čas, ekonomika, vlaky, auta, náklad, ukládání        (bez three.js)
  render/   vykreslování: kamera, terén, budovy, vozidla, shadery, efekty      (three.js)
  ui/       HTML rozhraní: horní lišta, okna, dialogy                          (DOM)
  screens/  obrazovky: úvodní, hra, galerie modelů
```

Nejdůležitější pravidlo celé architektury: **`world/` a `game/` o three.js nic nevědí.** Mapa je
`Uint8Array` s typem dlaždice, vlak je obyčejný objekt s trasou a polohou. Díky tomu:

- herní logiku jde testovat bez prohlížeče a GPU,
- uložení hry je obyčejný JSON z herních dat,
- vykreslování se dá přepsat (a taky se několikrát přepisovalo), aniž by se rozbila hra.

Vrstva `render/` stav hry jen **čte**. Každá část scény (terén, silnice, stromy, budovy…) má
vlastní třídu `…View` s metodou, která se volá jednou za snímek a dorovná 3D objekty podle dat.

## Souřadnice: dlaždice a svět

Mapa je 2D mřížka dlaždic `(x, y)`. Ve 3D světě three.js je osa **Y nahoru**, takže dlaždice leží
v rovině **XZ**:

```
             Y (nahoru)
             |
             |
             +-------- X   (x dlaždice)
            /
           /
          Z               (y dlaždice)

Dlaždice (x, y) zabírá ve světě čtverec [x, x+1] × [y, y+1] v rovině XZ.
Jedna dlaždice = jedna jednotka světa. Střed dlaždice je (x + 0.5, 0, y + 0.5).
```

V kódu je to zapsané přímo u mapy (`src/world/map.ts`):

```ts
// Dlaždice (x, y) zabírá ve světě čtverec [x, x+1] × [y, y+1] v rovině XZ
export class GameMap {
  readonly tiles: Uint8Array;
  // Id města, kterému dlaždice patří, jinak NO_OWNER
  readonly owner: Int16Array;
  // …
}
```

Všechny rozměry ve hře jsou proto v „dlaždicích“: auto je dlouhé asi 0,4, postava vysoká 0,16,
voda leží 0,06 pod terénem. Když budeme v dalších dílech mluvit o „světových souřadnicích“
v shaderu, znamená to právě tohle: `x` a `z` jsou souřadnice na mapě v dlaždicích.

## Jeden snímek hry

Hra nemá vlastní `while (true)`. O snímky se stará prohlížeč přes `requestAnimationFrame`, který
three.js obaluje metodou `renderer.setAnimationLoop` (`src/screens/game.ts`):

```ts
let lastFrame = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = now - lastFrame;
  // … posun kamery šipkami
  view.frame(now, dt);
  hud.countFrame(now);
  lastFrame = now;
});
```

`GameView.frame()` (`src/render/gameView.ts`) je srdce celé hry. Zjednodušeně dělá tohle:

```
1. updateNight()        plynulý přechod den ↔ noc (barvy oblohy a světel)
2. syncMap()            vrstvy si přečtou změněné dlaždice a dorovnají geometrii
3. game.update(dt)      posun herního času: vlaky, auta, ekonomika, růst měst
4. animace scény        voda, vítr ve stromech, kouř, listí, mlha, zvířata, chodci
5. LOD podle zoomu      plné / zjednodušené budovy a stromy
6. renderer.render()    vykreslení 3D scény
7. labels.render()      HTML popisky měst a stanic nad scénou
```

Všimněte si, že herní logika (krok 3) a vykreslování (kroky 2, 4–7) jsou oddělené. Při pauze
logika stojí, ale scéna se dál kreslí, takže jde posouvat kamerou. Animace efektů mají vlastní
čas `effectsSeconds`, který při pauze stojí taky (díl 15).

## Slovník 3D pojmů pro celou sérii

| Pojem | Co to je |
| --- | --- |
| **Vrchol (vertex)** | bod geometrie; nese polohu a další atributy (normálu, UV, barvu) |
| **Trojúhelník** | jediný tvar, který GPU umí kreslit; vše ostatní se z nich skládá |
| **Normála** | jednotkový vektor kolmý k povrchu; podle něj se počítá osvětlení |
| **UV** | 2D souřadnice do textury (0..1); říká, který kousek obrázku patří ke kterému vrcholu |
| **BufferGeometry** | geometrie v three.js: pole atributů (Float32Array) + volitelně indexy |
| **Material** | jak se povrch obarví a osvětlí; three.js z něj sestaví shader |
| **Mesh** | geometrie + materiál + poloha ve scéně = jeden objekt k vykreslení |
| **Draw call** | jeden příkaz CPU → GPU „nakresli tuhle geometrii tímhle shaderem“; drahé jsou hlavně jejich počty |
| **Shader** | program běžící na GPU; vertex shader pro každý vrchol, fragment shader pro každý pixel |
| **Uniform** | hodnota společná pro celé vykreslení (čas, barva, matice kamery) |
| **Instancing** | vykreslení stejné geometrie mnohokrát jedním draw callem, každá kopie má vlastní matici |
| **Frustum** | jehlan (u ortografické kamery kvádr), který kamera vidí; co je mimo, nemusí se kreslit |
| **LOD** | level of detail – zjednodušená verze objektu pro pohled z dálky |
| **sRGB / lineární barvy** | barvy v textuře jsou „gama“ kódované, světlo se ale počítá lineárně; three.js převádí, když mu řekneme `colorSpace` |

## Časová osa vývoje a díly série

Hra vznikla zhruba za týden (19.–26. října 2026). Vývoj šel po fázích, které byly sepsané
v zadání, a pak pokračoval vylepšováním grafiky.

| Commity | Co vzniklo | Díl |
| --- | --- | --- |
| `ac8cc93` Fáze 0 | skelet projektu | 01 |
| `7e98305` Fáze 1 | mapa a izometrická kamera | 02, 03 |
| `0c3ee3f` Fáze 2 | generování světa ze seedu | 04 |
| `498e706` Fáze 3 | herní čas, HUD, okna, růst měst | 09, 10 |
| `5d8dbee`, `65777fe` Fáze 4 | stavba železnice, silnic, přejezdy | 07 |
| `a92a4e6` Fáze 5 | vlaky | 08 |
| `ec03176`, `5fb8a43` Fáze 6–7 | ekonomika, ukládání | 09 |
| `3900774`, `c5729ee` Fáze 8–9 | testy, výkon (log změn mapy) | 17, 18 |
| `784ac20`, `7fb842e` | rezervace kolejí, návěstidla | 08 |
| `568e47d` … `f92bd13` | průmysl a nákladní doprava | 09 |
| `a24a82e` … `b6619c5` | silniční doprava | 11 |
| `64fe5b1` … `46f6e61` | barevná města, 3D ikony a miniatury | 05, 10 |
| `c03b945` … `7b24377` | chodci, okna, stromy, lampy, auta, semafory | 11, 13 |
| `73762c8` | stavba přes vodu, shadery vody | 12 |
| `3eba113`, `86d5ac0`, `5a478de` | kouř, včely, mlha | 15 |
| `cc36b46` … `6d1b1fe`, `0f7eed1` | roční období, sníh, listí | 14 |
| `33eb071` … `ea5b061` | den a noc, lampy, osvětlení fasád | 16 |
| `ce81cba`, `b20c153` | optimalizace, BatchedMesh, LOD | 06, 17 |
| `229e337` | FTP upload | 18 |

Pořadí dílů nekopíruje přesně pořadí commitů. Díly jsou seřazené tak, aby na sebe navazovala
vysvětlení: shadery až po základech geometrie, optimalizace až ve chvíli, kdy je co optimalizovat.

## Scénář videa

1. **Hook (30 s):** průlet hotovou hrou – zoom z celé mapy na město, otočení kamery, přepnutí
   na noc, zrychlení času do zimy.
2. **Co stavíme:** OpenTTD vedle naší hry (screenshoty v zadání), seznam funkcí.
3. **Proč three.js:** tři argumenty z textu výše, ukázat `package.json` (jediná runtime
   závislost je `three`).
4. **Struktura repa:** strom složek, pravidlo „world/game nevědí o three.js“, ukázat `GameMap`.
5. **Souřadnice:** nákres dlaždice v rovině XZ.
6. **Jeden snímek:** projít `GameView.frame()` shora dolů, jen názvy kroků.
7. **Mapa série:** tabulka dílů, co bude příště (skelet projektu).

## Cvičení

- Naklonujte repozitář, spusťte `npm install && npm run dev` a otevřete `http://localhost:5173/?seed=test`.
  Parametr `seed` spustí rovnou novou hru se zadaným seedem.
- Otevřete stránku `/all-models` – galerie všech modelů z kitů. Najděte modely, které ve hře
  nejsou použité.
- V `GameView.frame()` dočasně zakomentujte obě volání `this.syncMap()` a zkuste postavit silnici.
  Co se stane a proč? (Nápověda: data mapy se změní, ale nikdo je nepřekreslí.)
