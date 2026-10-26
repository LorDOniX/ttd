# zbase → GLB

Převod grafiky [zbase](https://github.com/gravitystorm/zbase) na GLB modely pro hru.

## Proč ne z obrázků

PNG v zbase jsou rendery z Blenderu: 8 (vozidla) nebo 4 (budovy) pohledy, 3 zoomy, 32bpp + 8bpp verze.
Zpětně z nich 3D model rozumně nevznikne (zakryté strany, žádná hloubka, AI „image-to-3D“ dává
nepřesné a rozteklé tvary). Repo ale obsahuje i zdrojové scény – 389 `.blend` souborů, ze kterých se
ty PNG renderovaly, a ke každé složce spritů existuje odpovídající `.blend`. Skript proto bere
**geometrii přímo z `.blend`**, obrázky slouží jen pro kontrolu.

## Postup

1. Blender 4.2 LTS (stačí rozbalit tarball z https://download.blender.org/release/Blender4.2/).
2. Checkout zbase vedle repa hry (celé repo má po rozbalení 2 GB, PNG jsou potřeba jen pro porovnání v náhledech):
   ```sh
   git clone https://github.com/gravitystorm/zbase ../zbase
   ```
3. Převod (z kořene repa):
   ```sh
   python3 scripts/zbase/convert.py --zbase ../zbase --out build-data/zbase \
     --blender ~/blender-4.2.3-linux-x64/blender --detail 3000 --tolerance 0.006 --max-triangles 8000
   ```
   `--only 'vehicles/rail/*'` převede jen část. Celé zbase trvá pár minut. Výsledek: `build-data/zbase/<cesta v zbase>/<model>.glb`
   a `manifest.json` (rozměry, počty trojúhelníků, zdrojové materiály, upozornění).
4. Náhledy – arch pro každý zdrojový `.blend` a `build-data/zbase/previews/index.html` s porovnáním proti
   původnímu spritu:
   ```sh
   python3 scripts/zbase/previews.py --zbase ../zbase --out build-data/zbase --blender ~/blender-4.2.3-linux-x64/blender
   ```
   Jednotlivé modely: `blender -b --factory-startup --python scripts/zbase/preview.py -- nahled.png a.glb b.glb`.
5. Vybrané modely zkopírovat do `assets/<kit>/` a přidat kit do `Kit` v `src/assets.ts`.

## Co skript dělá (`export_blend.py`)

- Jeden `.blend` = víc modelů vedle sebe, v každém framu je pod kamerou jiný. Model = sítě pod kamerou
  v daném framu (funguje pro oba typy rigů ve zbase – jezdící kamera i posouvané modely).
  Framy, které jen otáčejí pohledem, se přeskočí. Prochází se od framu 0 a i za `frame_end`, protože
  zbase renderovalo `-s 0 -a` a animace se za koncem prodlužuje (některé modely leží až tam).
- Vyhodí pomocné objekty pro render (`Special_*` pozadí a stíny, kamery, světla, odložené díly pod zemí).
- Aplikuje modifikátory, spojí model do jedné sítě, posune na střed dlaždice a zmenší na měřítko hry
  (dlaždice zbase = 2×2 jednotky, ve hře 1×1). Osa Y nahoru jako ostatní GLB ve hře.
- Zjednodušení (`--detail K`): trojúhelníky žerou hlavně malé, ale přehnaně detailní díly, které se opakují
  (kolo autobusu ~0,08 dlaždice má 1500 trojúhelníků, věžák má 216× stejný panel okna). Každý díl proto
  dostane rozpočet `K × (velikost dílu v dlaždicích)²` a zjednoduší se samostatně – kolo zůstane kolem
  a stejné panely dopadnou stejně. Zjednodušení je hlídané odchylkou (`--tolerance`, v dlaždicích):
  když se povrch dílu odchýlí víc, zkusí se mírnější poměr. Kolo tak klidně spadne na 5 %, tvarovaná
  maska autobusu zůstane. Nakonec se beztrátově sloučí rovinné plochy.
- `--max-triangles N`: model, který má i tak víc než N trojúhelníků, se převede znovu s polovičním `K`
  a dvojnásobnou tolerancí (nejvýš 3×). Globální decimace celého modelu se nepoužívá, rozpadala by stěny a žebříky nahodile.
- Barvy materiálů uloží do malé **palety** (textura v GLB, jako `colormap.png` u Kenney kitů) → celý model
  je 1 materiál / 1 draw call. Barvy společnosti (`CC_*`, `2CC_*`) zůstanou jako zvláštní materiály
  `company_colour` / `company_colour_2`, hra je může přebarvit.
- Jména: `1421-1425.blend` s pěti modely → `1421.glb` … `1425.glb` (čísla spritů z TTD), jinak `jmeno_00.glb` ….

Ruční opravy barev: `scripts/zbase/colors.json` ve tvaru `{ "BrickWall_red1": "#8a3b22" }`, convert.py ho použije, pokud existuje.

## Problémy a omezení

- **Textury materiálů se ztratí.** Soubory jsou z Blenderu 2.63 a materiály jsou procedurální textury
  starého rendereru Blender Internal (cihly, šum, …). Blender 2.8+ je neumí, zůstane jen základní barva
  materiálu → modely vypadají „low-poly plochě“ (podobně jako Kenney). Věrnější varianta: v Blenderu 2.79
  (poslední s Blender Internal) materiály „vypéct“ do textur a teprve pak exportovat ve 4.2 – výrazně
  pracnější, má smysl jen pro pár vybraných modelů.
- **Počet trojúhelníků.** Okna, zábradlí i kola jsou modelovaná geometrie: věžák má ~38 tis. trojúhelníků,
  lokomotiva ~9 tis., vagon ~6 tis. (Kenney budovy mají stovky). `--detail 3000 --tolerance 0.006
  --max-triangles 8000` dá autobus ~2 tis., vagon ~2 tis., lokomotivu ~4 tis. téměř beze ztráty vzhledu;
  věžáky ~6–8 tis. (okna ztratí bílé rámy). Bez tolerance se tvarované díly (maska autobusu) rozpadají. Výrazně méně u budov jen s okny
  vypečenými do textury; pro města s mnoha domy bude ve hře potřeba i instancing / LOD.
- **Velikost.** Bez decimace ~0,3 MB na model, celé zbase by mělo stovky MB (teď mají všechny kity
  dohromady ~31 MB). Převádět jen potřebné modely, případně Draco/meshopt komprese (vyžaduje dekodér ve hře).
- **Co je co.** Jména modelů jsou čísla spritů / pořadí v souboru, ne „dům typu X“ nebo „lokomotiva Y“.
  Přiřazení k typům domů a vozidlům je potřeba udělat ručně (nápověda: tabulky spritů v OpenTTD,
  `src/table/town_land.h`, a projekt zbasebuild). Vagony mají navíc varianty s nákladem / bez nákladu.
- **Animace se ztratí.** Animované části (kolo těžní věže, vrtné věže, …) se exportují v jedné poloze,
  kouř a jiskry se nepřevádí vůbec.
- **Orientace.** Vozidla leží podél osy Z jako train kit, ale směr „dopředu“ a natočení budov vůči
  dlaždici je potřeba ověřit ve hře (případně otočit při načtení).
- **Ploché díly.** Zemní dlaždice domů, koleje, silnice a terén se převedou taky, ale hra je kreslí po
  svém – většinou se nehodí. Použitelné hotové textury jsou jen `textures/terrain/terrain_grasses/1024_*.png`.
- **Toyland/arctic/tropic** varianty jsou samostatné soubory; konfigurace `SKIP` v `convert.py` vynechává
  materiály, šablony, GUI a efekty.
- **Licence.** zbase je GPL v2 (Kenney kity jsou CC0). Při zveřejnění hry s těmito modely je potřeba uvést
  autory (Zephris a další), přiložit licenci a zpřístupnit zdroje modelů (`.blend` + tyto skripty).
- **Bezpečnost.** `.blend` může obsahovat Python skripty; convert.py proto spouští Blender s `--disable-autoexec`.
