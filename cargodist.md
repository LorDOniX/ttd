# Cargodist (distribuce nákladu) – plán

Jako v OpenTTD: cestující a náklad mají cílovou stanici, stanice tvoří síť spojení (graf linek) podle jízdních
řádů vozidel a náklad se mezi cíle rozdělí podle poptávky a kapacity spojení. Vozidlo nakládá jen náklad,
jehož další zastávka na cestě je jeho další zastávka; na přestupní stanici se náklad sám přeloží.

Nastavení „Distribuce nákladu“ zvlášť pro cestující, poštu a ostatní náklad: ručně (dosavadní chování),
asymetricky, symetricky (jen cestující a pošta). Nové hry: cestující a pošta symetricky, ostatní ručně.
Starší uložení: vše ručně, takže se nic nemění. Po každém kroku jde hrát a commitovat.

Uzly grafu jsou spojené stanice (hlavní části, `poolId`). Náklad bez cíle (ručně, starší uložení) se chová
jako dosud.

## 1. Graf linek a nastavení
- [x] `game.distribution` (cestující / pošta / ostatní), uložení, volba v Nastavení
- [x] Graf linek pro každý druh nákladu z řádů vlaků, aut, letadel a lodí: spojení mezi po sobě jdoucími
      zastávkami (bez průjezdů, dep a průjezdných bodů), kapacita za měsíc podle kapacity vozidla a délky kola
- [x] Graf se přepočítá po změně řádů, vozidel nebo stanic
- [x] Testy, commit

## 2. Poptávka a toky
- [x] Nabídka stanice za měsíc (cestující, pošta, výroba závodů v dosahu)
- [x] Poptávka: symetricky podle nabídky cíle (tam i zpět), asymetricky ke stanicím, které náklad vykupují;
      vzdálenost poptávku mírně snižuje; jen cíle dosažitelné po grafu
- [x] Toky: cesta po grafu (nejkratší, přetížená spojení se prodražují, poptávka se rozkládá po dávkách),
      výsledek pro stanici a cíl = podíly dalších zastávek
- [x] Přepočet měsíčně a po změně grafu, testy, commit

## 3. Náklad s cílem
- [ ] Čerstvý náklad na stanici rozdělený podle další zastávky a cíle (součet = `waiting` / `freight`),
      odchod nespokojených a hodnocení beze změny
- [ ] Nakládka: jen náklad pro další zastávku vozidla (nejdřív z překládky); na palubě množství podle cíle
- [ ] Vykládka: v cíli se doručí a zaplatí, kde cesta pokračuje jinou linkou se přeloží (s historií a podílem
      jako překládka), náklad pokračující dál zůstane na palubě; příkazy vykládky platí dál
- [ ] Vlaky (i smíšené soupravy), auta, letadla, lodě; testy (přestup A–B–C, zpáteční cesta), commit

## 4. Změny sítě a uložení
- [ ] Po přepočtu toků se čerstvý náklad přerozdělí; náklad k nedosažitelnému cíli ztratí cíl (doručí se
      jako dosud, kde se vykupuje)
- [ ] Uložení nákladu s cílem na stanicích a ve vozidlech, toky se po načtení přepočtou
- [ ] Testy, commit

## 5. Rozhraní
- [ ] Okno stanice: čekající náklad podle cíle a další zastávky („do B 12 přes C“), plánované toky
- [ ] Okno vozidla: náklad na palubě podle cíle
- [ ] Kontrola v prohlížeči, commit

## 6. Dokončení
- [ ] Zápis do nth.md (Hotovo), odstranění „Cargodist“ ze Zbývá
