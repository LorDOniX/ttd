# Vlastní transport tycoon deluxe

## Popis
- chtěl bych 2d izometrickou hru, renderovaná ve 3d grafice, rozdělená na dílky (čtverečky)
- na mapě bude podle seedu generovaná tráva, voda, města, vesnice
- města budou generována pomocí spojených cest a modelů city kit commercial, velikost 1000-5000
- vesnice budou generována pomocí spojených cest a modelů city kit suburban, velikost 100-1000
- názvy měst převzít z českých vesnic a měst
- města se budou v průběhu let zvětšovat např. o 5% za 1 rok
- začíná se 1950, končí se 2050, jeden rok trvá 15m reálného času
- města jsou oddělené celky, nejsou spojena mezi sebou, uvnitř měst jsou náhodně generované baráčky spojené cestou pro auta
- existují 2 typy cest - pro auta a vlaky, cesty pro auta budou použita uvnitř měst
- hráč bude moct zadat svůj název společnosti
- hráč bude moct stavět koleje, které budou spojovat 2 nástupiště, které se dají vytvořit a je potřeba 1 depa, ze kterého vyjede vlak na koleje
- nástupiště dáme jako 1x3 políčka, když bude v blízkosti města, tak se na něm budou objevovat cestující, které budeme moct převážet
- počet cestujících se odvodí od velikosti města
- pokud spojíme 2 města, takže 1 nástupiště ve městě převeze lidi do druhého nástupiště v druhém městě, hráč dostane peníze podle tabulky ohodnocení
- vlak v každé stanici nejdříve vyloží náklad, může dostat za něj zaplaceno, převezme aktuální náklad a pojede na druhé nástupiště, furt dokola
- vzdálenost pro převoz se počítá jako počty ujetých čtverečků od nástupiště do nástupiště
- na začátek začíná uživatel s rozpočtem 1000000
- vlaky z train kitu rozdělíme tak, že bude dostupný 1 vlak z n vlaků a v průběhu let se objeví dostupný další vlak ke koupi, který bude lepší než ten předchozí
- vlaky budou mít parametry výdaje za 1 rok, co se budou postupně po měsící odečítat a cenu za koupě, rychlost
- vagonky pro cestující budou mít taky cenu za 1 vagonek např. 50000
- první vlak bude stát např. 250000, všechny další a drazší s lepšími parametry budou např. +20% navíc, bude mít větší provozní náklady, ale bude rychlejší
- vlak po příjezdu do nástupiště zpomaluje, než zastaví

## Ovládání
- stejné jako v openttd
- možnost zoomu na kolečko, levým interakce, pravým a držení přesun po mapě

## Jak se to bude hrát
- po načtení mapy se budou dát pokládat koleje a nástupiště, umísťovat depa, ze kterých bude jezdit vlak
- vlak bude jezdit na tu první zastávku, která bude blíže depu
- vlak neustále jezdí mezi 2 zastávkami/nástupištěmi a generuje zisk a odečítají se provozní náklady
- kdykoliv si můžu hru uložit a nahrát

## Tabulka ohodnocení
- jednotka 1 čtvereček za čas
- pro cestující bude 10 jednotek cestujícíh za 1 čtvereček vzdálenosti do 1 měsíce herní doby 5000
- pro cestující bude 10 jednotek cestujícíh za 1 čtvereček vzdálenosti do 2 měsíců herní doby 2500
- pro cestující bude 10 jednotek cestujícíh za 1 čtvereček vzdálenosti do 3 měsíců a více herní doby 1000

## Herní smyčka
- překreslení mapy, zobrazení aktuální pozice vlaků

## Modely
- pro textury cest - auta něco vygeneruj nebo doporuč
- pro textury cest - vlaky něco vygeneruj nebo doporuč
- nástupiště, depo - něco vygeneruj nebo doporuč
- textury vagónů pro pasažéry něco vygeneruj nebo doporuč
- pro vlaky train kit https://kenney.nl/assets/train-kit
- pro města city kit commercial https://kenney.nl/assets/city-kit-commercial
- pro vesnice city kit suburban https://kenney.nl/assets/city-kit-suburban
- složka /assets obsahuje glb modely + textury

## Notifikace
- do spodní lišty, např. začátek nového roku se shrnutím toho předchozího
- budeme rozšiřovat

## Příklady z openttd
- screenshots složka
- a.jpg - příklad hry a hud
- b.jpg - dialogy zobrazených vlaků a stavby kolejí, nástupišť
- c.jpg - příklady textur kolejí a jejich variant
- d.jpg - příklady textur silnice a jejich variant

## HUD
- ukázka v souboru hud.jpg z openttd

### Ikona diskety
- načíst stav hry jako json
- uložit stav hry jako json

### Ikona kolečka
- dialog s nastavením

### Ikona financí
- zobrazí seznam všech dopravním prostředků a kolik vydělávají, kolik mají spotřebu a přehled pro současný rok

### Ikona vlaku
- dialoové možnosti pro stavění kolejí, depa, nástupiště

### Nastavení
- zobrazení a skrytí mřížky
- změna názvu společnosti

### Spodní lišta
- zobrazuje název společnosti a události uprostřed
- vpravo je zobrazena cena v CZK

## Stavby

### Depo
- po kliknutí na depo je možné uvnitř vytvořit vlak a přidat mu vagónky
- pokud existuje vlak, je možné jej

### Vlaky
- cena za 1 dílek kolejí bude 10000, cena za 1 dílek nástupiště 25000, cena za 1 dílek s depem 50000
- bude možnost umístnit do mapy začátek kolejí a přes držení levého tlačítka vybrat cílový bod, pak se za cenu 1 kusu kolejí udělá výstavba, která v průběhu spotřebuje peníze a kdyžtak se zastaví s dialogem, že došly peníze
- když se ke kolejím s jakékoliv strany přidá depo, tak se může pak v depu zakoupený vlak poslat na trať
- můžu si vybrat nástupiště a to umístnit do mapy

## Dialogy
- veškeré interakce nad mapou - zobrazení oken nad 3d grafikou se bude řídit tak, že při stisku delete se všechny dialogy vymažou
- dialog bude nastavení, seznam dopravních prostředků, seznam věcí pro stavbu vlaku, atd.

## Fáze vývoje
Každá fáze končí samostatným commitem a spustitelnou hrou (Vite + TypeScript + three.js).

0. **Skelet projektu** – Vite, TypeScript, three.js, servírování `assets/`, prázdná scéna
1. **Mapa a kamera** – izometrická ortografická kamera, dlaždicová mřížka, zoom kolečkem, posun pravým tlačítkem, výběr dlaždice levým
2. **Generování světa** – PRNG ze seedu, tráva a voda, města (commercial, 1000–5000) a vesnice (suburban, 100–1000), silnice uvnitř sídel, české názvy, popisky
3. **Čas, HUD, dialogy** – kalendář 1950–2050 (15 min = 1 rok), peníze 1 000 000 CZK, horní a spodní lišta, notifikace, okna (Delete zavře vše), nastavení (mřížka, název společnosti), růst měst 5 %/rok
4. **Stavba železnice** – koleje tažením včetně diagonál (A* trasa, postupná výstavba, stop při nedostatku peněz), nástupiště 1×3, depo, procedurální textury, automatické navazování kolejí
5. **Vlaky** – katalog z train kitu odemykaný v čase (+20 % cena a náklady, vyšší rychlost), nákup v depu, vagony 50 000, jízda po grafu kolejí, zpomalení před stanicí, kyvadlový provoz
6. **Cestující a ekonomika** – cestující podle velikosti města v dosahu, vykládka a nakládka, tabulka ohodnocení, měsíční provozní náklady, okno financí, roční shrnutí
7. **Uložení a načtení** – stav hry do a z JSON

### Druhé kolo
Pořadí: nejdřív pojistka (testy) a výkon, pak rychlé výhry, přehledová okna a nakonec větší herní mechaniky. Fáze, které mění uložená data, zvednou verzi uložení a starší uložení převedou.

8. **Testy a nástroje** – Vitest a převod dosavadních ověřovacích skriptů na testy (hledání tras kolejí a silnic, ekonomika, pohyb vlaků, deterministické uložení a načtení); ESLint + Prettier, kód se přeformátuje postupně při úpravách
9. **Výkon** – překreslování jen změněných dlaždic (terén, stromy) místo celé mapy; dosah nástupišť a sdílení cestujících počítané jen při změně kolejí nebo měst
10. **Rychlost hry a ovládání** – zrychlení času ×1/×2/×4 vedle pauzy; posun mapy šipkami; klávesové zkratky pro nástroje a okna
11. **Finance** – úvěr v bance (max. 2 000 000 Kč po 100 000 Kč, úrok 8 % ročně placený měsíčně); údržba tratí (5 % ceny stavby ročně, placeno měsíčně); grafy příjmů, výdajů a přepravených cestujících po letech
12. **Přehledová okna** – okno vlaku po kliknutí na vlak (cíl, náklad, zisk, akce); seznam všech vlaků; historie zpráv; nástroj „?“ s informací o dlaždici včetně dosahu nástupiště
13. **Jízdní řád s více zastávkami** – seznam zastávek vlaku editovaný v okně vlaku, vlak je objíždí dokola, výměna cestujících na každé zastávce
14. **Hodnocení stanic** – hodnocení 0–100 % podle doby od posledního vlaku, rychlosti vlaku a počtu čekajících; ovlivňuje příliv cestujících a jejich odchod
15. **Stárnutí vlaků** – životnost 25 let, prodejní cena klesá lineárně na 10 %, po životnosti +50 % provozní náklady, upozornění a obnova za nejnovější model se zachováním vagonů a jízdního řádu
16. **Návěstidla** – (a) automatická rezervace úseku před vlakem, vlak čeká, dokud není volno, na vícekolejném nástupišti si vybere volnou kolej; (b) hráčem stavěná návěstidla, která dělí trať na úseky

### NTH (nice to have)
- volitelná rozšíření jsou v [nth.md](nth.md)

## Do budoucna
- uděláme možnosti převozu i jiných materiálů než lidí, je potřeba pak grafika např. pro elektrárnu a uhelný důl
