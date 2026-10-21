# NTH (nice to have)

Volitelná rozšíření mimo hlavní fáze ze [ttd.md](ttd.md).

## Hotovo
- **Vlaky se navzájem hlídají** – rezervace úseků a návěstidla (fáze 16)
- **Náklad ve vlaku poslaném do depa** – zůstane ve vlaku a vyloží se na další zastávce
- **Náhled dosahu nástupiště** – při stavbě se ukáže dosah a u kurzoru díl měst, náklad a výkup
- **Název nástupiště podle dosahu** – podle města v dosahu, jinak podle závodu, až pak nejbližšího města
- **Pozice kamery v uložení** – po načtení se obnoví pohled
- **Rozpracovaná výstavba v uložení** – po načtení se stavba dokončí
- **Umístění oken** – nová okna u levého okraje, přetažené si pamatují polohu

## Zbývá
- **Auta do měst** – modely jsou v `assets/car kit`; samostatný větší krok (jízda po silnicích měst, bez vlivu na hru)
- **Výška terénu** – teď nedává smysl: koleje, mosty, stavba i generátor počítají s rovinou, šlo by o přestavbu celé mapy

## Návrhy převzetí z OpenTTD
Jednoduché (stačí stávající systémy):
- **Pošta** – další druh nákladu mezi městy (krytý vagon), malé množství, vysoká sazba
- **Reklamní kampaň a financování výstavby** – akce v okně města: na pár měsíců vyšší hodnocení stanic, rychlejší růst
- **Klik na zprávu ukáže místo** – zprávy o vlacích, stanicích a závodech s polohou
- **Automatická obnova vlaků** – volba v nastavení: starý vlak se při průjezdu depem sám obnoví
- **Postupné nakládání** – doba stání podle množství nákladu místo pevných 2 dnů

Středně náročné:
- **Okno stanice** – čekající náklad podle druhu, hodnocení a vlaky, které ji obsluhují
- **Hodnocení stanice podle druhu nákladu** – jako v OpenTTD každý náklad zvlášť
- **Hodnota a hodnocení společnosti** – roční přehled výkonu firmy
- **Sdílené jízdní řády a skupiny vlaků**
