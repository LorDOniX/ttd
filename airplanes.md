# Letadla, jak půjdou po sobě
- airplane-1.glb – Airplane by jeremy (9Ev6pklkSYp)
- airplane-2.glb – Airplane by Poly by Google (8ciDd9k8wha)
- airplane-3.glb – Airplane by Poly by Google (a3XrQkLNna9)
- airplane-4.glb – Jet by Poly by Google (bgUY8zN2Bq9)

## Parametry ve hře
Rychlost v dlaždicích za den letu vzdušnou čarou, ceny v Kč, provoz za rok (`AIRCRAFT_MODELS` v `src/game/balance.ts`).

| Model | Letadlo | Rok | Cena | Rychlost | Provoz | Kapacita | Letiště |
|---|---|---|---|---|---|---|---|
| airplane-1 | Letoun L-50 Racek | 1950 | 420 000 | 6 | 48 000 | 30 cestujících | malé i velké |
| airplane-1 | Poštovní L-50 Racek | 1950 | 400 000 | 6 | 46 000 | 12 t pošty | malé i velké |
| airplane-2 | Letoun L-64 Čáp | 1964 | 620 000 | 8,5 | 72 000 | 55 cestujících | malé i velké |
| airplane-3 | Letoun L-80 Jeřáb | 1980 | 950 000 | 11 | 115 000 | 110 cestujících | jen velké |
| airplane-3 | Poštovní L-80 Jeřáb | 1980 | 900 000 | 11 | 110 000 | 40 t pošty | jen velké |
| airplane-4 | Tryskáč J-98 Sokol | 1998 | 1 150 000 | 15 | 140 000 | 75 cestujících | malé i velké |

Životnost 20 let. Pojíždění 2,5 dlaždice/den, rozjezd a dojezd na ranveji 60 % a kroužení 70 % cestovní rychlosti.

## Letiště
| Letiště | Rok | Cena | Rozměr | Stání |
|---|---|---|---|---|
| Malé letiště | 1950 | 400 000 | 5×4 | 2 |
| Velké letiště | 1972 | 950 000 | 7×5 | 4 |

Rozvržení (místní souřadnice v `src/world/airport.ts`): první řada ranvej, druhá pojezdová dráha, dál stání před terminálem, věž na začátku a hangár na konci. Ranvej má jedno letadlo naráz; bez volného stání letadlo krouží nad prodlouženou osou ranveje. Modely se při načtení sjednotí na délku 0,6–0,9 dlaždice (`src/render/aircraft.ts`).
