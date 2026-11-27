# Výška terénu a tunely – plán

Výšky jako v OpenTTD: celé úrovně v rozích dlaždic, sousední rohy se liší nejvýš o 1, voda na úrovni 0.
Jedna úroveň = `HEIGHT_STEP` (0,3) světových jednotek. Na rovné mapě (starší uložení) se nic nemění,
proto jde po každém kroku hrát a commitovat. Body se odškrtávají průběžně.

## 1. Data, uložení, vykreslení terénu, výběr myší
- [x] `GameMap.heights` – úrovně v rozích (`cornerLevel`, `setCornerLevel`, `tileCorners`, `tileLevel`)
- [x] Svah dlaždice: rovina / nakloněná rovina podél osy / jiný tvar (`slope`, `isFlat`), výška bodu `heightAt`
- [x] Uložení a načtení výšek (starší uložení = rovina)
- [x] Terén s kopci: rohy dlaždic ve výšce, normály podle sklonu, travní detaily, mřížka po terénu
- [x] Výběr dlaždice myší na kopcích (paprsek proti terénu, ne proti rovině y = 0)
- [x] Testy (svahy, `heightAt`, uložení), kontrola v prohlížeči, commit

## 2. Všechno ve správné výšce
- [x] Budovy, stromy, zvířata, doplňky, chodci, noční světla
- [x] Průmysl a jeho areál
- [x] Nástupiště, depa, zastávky, garáže, letiště, přístavy, průjezdné body, návěstidla, troleje
- [x] Koleje na rovině i ve svahu (nakloněný dílek), přejezdy
- [x] Silnice ve svahu, chodníky, lampy, semafory, přechody
- [x] Vlaky (výška podle trati, náklon ve svahu), auta, městská auta, lodě, letadla na letišti
- [x] Popisky měst a stanic, náhledy stavby, kurzor, pohled z kabiny a chůze
- [x] Svahy ve stínování terénu zřetelně světlejší / tmavší (zesílená normála)
- [x] Kontrola v prohlížeči na ručně vytvořeném kopci, commit

## 3. Pravidla stavby
- [x] Stavby (nástupiště, depa, zastávky, garáže, letiště, přístavy, průmysl, budovy měst) jen na rovině
- [x] Kolej: na rovině jakýkoli dílek, ve svahu jen rovně ve směru svahu; autorail podle toho plánuje
- [x] Silnice: totéž (napojení i jízda aut jen podél svahu); města zatím staví silnice i domy jen na rovině
- [x] Mosty: nájezdy na rovině ve stejné výšce, terén pod polem nesmí být výš
- [x] Vlak ve stoupání zpomalí, z kopce zrychlí (jako v OpenTTD)
- [x] Testy, commit

## 4. Generátor s kopci
- [x] Výšková mapa ze šumu (vyšší vnitrozemí, roviny u vody), voda na úrovni 0, sousední rohy ±1
- [x] Města na rovině (okolí středu se odkope na rovinu), průmysl při tvorbě mapy srovná své místo
- [x] Nastavení „Terén“ v nové hře (rovina / mírně zvlněný / kopcovitý)
- [x] Okraj mapy: boční stěna terénu tam, kde je okraj nad úrovní 0
- [x] Úvodní obrazovka s kopci, kontrola v prohlížeči, commit

## 5. Úpravy terénu
- [x] Nástroj Terén: zvednout / snížit roh nebo oblast tažením, srovnat oblast na jednu výšku
- [x] Sousední rohy se dorovnají (rozdíl nejvýš 1), cena podle změněných rohů
- [x] Po změně výšek se přestaví vše závislé (stromy, terén, doplňky; stavby na měněných dlaždicích být nemohou)
- [x] Nejde měnit pod stavbami, kolejemi, silnicemi a u vody (pobřeží zůstane na 0)
- [x] Testy, kontrola v prohlížeči, commit

## 6. Tunely
- [x] Železniční tunel: vjezd na nakloněné dlaždici, rovně skrz kopec k protějšímu svahu ve stejné výšce
- [x] Silniční tunel stejně
- [x] Vlaky a auta tunelem projedou (trasa jako přes most), uvnitř nejsou vidět
- [x] Portály tunelu ve vykreslení, náhled a cena podle délky, demolice portálu zboří tunel
- [x] Uložení, info o dlaždici, testy, kontrola v prohlížeči, commit

## 7. Dokončení
- [ ] Zápis do nth.md (Hotovo), odstranění položek „Tunely“ a „Výška terénu“ ze Zbývá
