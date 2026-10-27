# Jak vznikal vlastní Transport Tycoon – série tutoriálů

Série Markdown dílů, které krok za krokem popisují, jak tahle hra vznikala: od prázdného projektu
(Vite + TypeScript + three.js) po živý izometrický svět s vlaky, městy, ročními obdobími, nočním
osvětlením a úrovněmi detailu. Každý díl odpovídá jednomu videu a je psaný pro programátory, kteří
znají TypeScript, ale ve 3D grafice tolik doma nejsou. Proto se díly víc zdržují u věcí kolem 3D:
geometrie, kamery, shaderů, osvětlení a výkonu.

Díly jdou po sobě, ale dají se číst i samostatně. Úryvky kódu jsou ze skutečného repozitáře
(místy zkrácené, vynechaná místa značí `// …`), u každého dílu jsou uvedené soubory a commity,
ve kterých se dá dohledat celá podoba.

## Obsah

| Díl | Téma | Hlavní 3D témata |
| --- | --- | --- |
| [00](00-uvod.md) | Úvod, cíl hry, technologie, mapa série | souřadnice, scéna, renderovací smyčka |
| [01](01-skelet-projektu.md) | Skelet projektu: Vite, TypeScript, three.js | Scene / Camera / Renderer, Mesh = Geometry + Material |
| [02](02-izometricka-kamera.md) | Izometrická kamera jako v OpenTTD | ortografická projekce, dimetrie 2:1, raycasting, zoom ke kurzoru |
| [03](03-teren.md) | Terén z jediné geometrie | BufferGeometry, barvy vrcholů, indexy, procedurální textura, břehy |
| [04](04-generovani-sveta.md) | Generování světa ze seedu | deterministická náhoda, value noise, fBm, hash dlaždice |
| [05](05-modely-glb.md) | Modely z Kenney kitů | glTF/GLB, normalizace modelu, paleta barev, přebarvení přes UV |
| [06](06-instancing-a-draw-cally.md) | Tisíce objektů: instancing a batching | draw cally, InstancedMesh, BatchedMesh, slučování geometrií |
| [07](07-stavba-koleji.md) | Stavba kolejí a silnic | texturový atlas z canvasu, picking, náhled stavby, A* |
| [08](08-vlaky.md) | Vlaky na kolejích | pohyb po trase, natočení vagonů, brzdná dráha, rezervace bloků |
| [09](09-cas-ekonomika-ukladani.md) | Herní čas, ekonomika a ukládání | herní smyčka a čas, události, verze uložení |
| [10](10-ui-nad-3d.md) | Uživatelské rozhraní nad 3D scénou | HTML okna, CSS2DRenderer, 3D ikony renderované do obrázku |
| [11](11-zivot-ve-meste.md) | Život ve městě: auta, chodci, semafory | animace dílů přes matice instancí, závory a blikání |
| [12](12-shadery-voda.md) | Shadery I: voda a led | vertex/fragment shader, `onBeforeCompile`, fwidth, Voronoi |
| [13](13-shadery-okna-a-vitr.md) | Shadery II: okna na fasádách a vítr ve stromech | vlastní atributy, procedurální vzor, vertex animace |
| [14](14-rocni-obdobi.md) | Roční období a sníh | prolínání palet, sníh ze sklonu normál, polygon offset |
| [15](15-casticove-efekty.md) | Částicové efekty: kouř, listí, mlha, včely | průhlednost a řazení, bezstavové částice, výřez kamery |
| [16](16-osvetleni-den-noc.md) | Osvětlení, den a noc | Lambert, hemisférické a směrové světlo, emissive, zapečená light mapa |
| [17](17-optimalizace-a-lod.md) | Optimalizace a úrovně detailu (LOD) | měření, log změn, frustum culling, LOD budov a stromů |
| [18](18-testy-build-nasazeni.md) | Testy, build a nasazení | Vitest, base URL, inkrementální FTP upload |

## Jak s dílem pracovat při natáčení

Každý díl má stejnou kostru:

1. **O čem díl je** – cíl a co divák uvidí na konci.
2. **Teorie** – vysvětlení 3D konceptů, často s nákresem nebo vzorcem.
3. **Implementace** – postup s úryvky kódu v pořadí, jak vznikal.
4. **Úskalí** – na co se narazilo a jak se to vyřešilo (z historie commitů).
5. **Scénář videa** – body pro natáčení: co ukázat ve hře, co v kódu, kde udělat střih.
6. **Cvičení** – nápady, co si divák může zkusit sám.

Starší stav kódu k libovolnému dílu ukáže `git checkout <commit>` (commity jsou uvedené v hlavičce
každého dílu), hru pak spustí `npm install && npm run dev`.
