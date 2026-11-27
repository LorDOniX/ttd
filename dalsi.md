# Další fáze – plán

Pořadí podle zadání: mapa toků, místní úřad, růst měst podle obsluhy, tramvaje, kanály a zdymadla,
podmíněné příkazy, nasazení. Každá fáze končí testy, kontrolou v prohlížeči a commitem; starší uložení
se převedou (nové údaje mají rozumný výchozí stav). Konkurenční společnost (AI) je v nth.md.

## 1. Mapa toků (cargodist)
- [x] Vytížení spojení: převezený náklad proti kapacitě vozidel, které po spojení jela (měsíčně, i při ruční distribuci); bez jízd odhad z řádů
- [x] Překryv mapy: spojení mezi stanicemi jako oblouky, barva podle vytížení (zelená → červená), tloušťka podle kapacity
- [x] Okno „Toky nákladu“: zapnutí překryvu, výběr druhu nákladu, legenda, seznam nejvytíženějších spojení
- [x] Testy, kontrola v prohlížeči, commit

## 2. Místní úřad
- [x] Hodnocení společnosti v každém městě (−1000 až 1000 jako v OpenTTD, stupně Hrozné … Vynikající)
- [x] Kácení stromů a demolice v obvodu města hodnocení snižují, obsluha stanicemi a výsadba stromů zvyšují
- [x] Při špatném hodnocení město nepovolí stavbu stanic a demolici svého majetku
- [x] Akce v okně města: malá / střední / velká reklama, socha na mapě (trvale lepší hodnocení stanic), stávající akce; hodnocení v okně města
- [x] Nástroj Sázet stromy v okně Úpravy terénu
- [x] Uložení, testy, kontrola v prohlížeči, commit

## 3. Růst měst podle obsluhy
- [x] Měsíčně dovezení cestující, pošta a potraviny do města (stanice v dosahu)
- [x] Rychlost růstu podle počtu obsluhujících stanic a dovozu (jako v OpenTTD), bez obsluhy jen pomalu
- [x] Okno města: dovoz za minulý měsíc, rychlost růstu
- [x] Uložení, testy, commit

## 4. Tramvaje
- [x] Tramvajová kolej na silnici (stavba tažením po silnicích, cena, demolice, uložení)
- [x] Vykreslení kolejí a trolejí na silnici
- [x] Tramvaje jako silniční vozidla jezdící jen po tramvajové koleji (modely, nákup v garáži, zastávky)
- [x] Testy, kontrola v prohlížeči, commit

## 5. Kanály a zdymadla
- [x] Kanál: stavba vody na rovné souši (cena), lodě po něm plují
- [x] Zdymadlo na svahu: loď přejede mezi úrovněmi, vykreslení
- [x] Hledání cesty lodí přes kanály a zdymadla, testy, kontrola v prohlížeči, commit

## 6. Podmíněné příkazy
- [x] Příkaz „Podmínka“: když (naložení %, spolehlivost, stáří, potřeba servisu, vždy) splňuje porovnání, skoč na příkaz N
- [x] Vyhodnocení při odjezdu ze zastávky, editor v okně řádu vlaku, uložení
- [x] Testy, commit

## 7. Nasazení
- [ ] Build, `npm run upload`, ověření na https://app.makuderovi.cz/ttd/
