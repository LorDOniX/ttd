# Další fáze – návrhy

Kandidáti na další práci. Každá fáze končí testy, kontrolou v prohlížeči a commitem.

## 1. Konkurenční společnost (AI)
- [ ] Vlastník u kolejí, silnic, stanic, dep a vozidel; pravidla pro cizí majetek (nejde stavět na cizí
      koleji, bourat cizí stanice, jezdit do cizích stanic)
- [ ] Soupeř si sám vybírá spojení (města, závody), staví tratě, stanice a depa, kupuje vozidla a sestavuje řády
- [ ] Soutěž o cestující a náklad (hodnocení stanic, dotace), přehled společností a hodnota firmy
- [ ] Jeho stavby a vozidla na mapě (barva společnosti), uložení, testy, commit

## 2. Rozdělení balíku hry
- [ ] Hlavní soubor má 1,3 MB (380 kB gzip): oddělit three.js, úvodní obrazovku a okna načítaná až při otevření
- [ ] Ověřit rychlejší načtení, build bez varování o velikosti, commit

## 3. Podmíněné příkazy i pro auta, letadla a lodě
- [ ] Volby příkazů (podmínka) v řádu silničních vozidel, letadel a lodí jako u vlaků
- [ ] Vyhodnocení při odjezdu, editor v okně řádu, uložení, testy, commit

## 4. Tramvajové depo a smyčky
- [ ] Tramvajové depo (vozovna) na koleji místo běžné garáže
- [ ] Otáčení tramvají ve smyčce nebo na konci koleje, vykreslení, testy, commit

## 5. Mapa toků v minimapě
- [ ] Toky nákladu zmenšeně v okně minimapy (barva podle vytížení), přepínač, commit

## 6. Úklid chyb lintu
- [ ] Tři starší chyby oxlint: `rail.ts` (setter vrací hodnotu), `subsidies.ts` (zbytečný spread),
      `trains.ts` (zbytečný prázdný fallback ve spreadu); lint bez chyb, commit
