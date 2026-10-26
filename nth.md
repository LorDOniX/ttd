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
- **Pošta** – druh nákladu mezi městy, vzniká u stanic s poštovním vlakem
- **Reklamní kampaň a financování výstavby** – akce v okně města
- **Klik na zprávu ukáže místo** – zprávy s polohou v historii zpráv
- **Automatická obnova vlaků** – volba v Nastavení
- **Pobyt ve stanici podle množství nákladu** – den plus den na 150 přeložených jednotek
- **Okno stanice** – kliknutím na nástupiště
- **Hodnocení stanice podle druhu nákladu**
- **Hodnota a hodnocení společnosti** – záložka Společnost ve financích
- **Sdílené jízdní řády a linky** – v okně vlaku, filtr linek v seznamu vlaků
- **Silniční doprava** – zastávky a garáže, autobusy a nákladní auta z car kitu, ceny a kapacity podle OpenTTD
- **Provoz městských aut** – autonomní doprava s křižovatkami, semafory a interakcí s hráčskými vozidly
- **Zvířata v krajině** – dekorativní zvířata v lesích z cube pets kitu
- **Zemědělský řetězec** – farma produkuje obilí, potravinářský závod z něj vyrábí potraviny pro města

## Zbývá
- **Letecká doprava** – letiště a letadla z `assets/airplanes/` (pořadí generací v [airplanes.md](airplanes.md), autoři v `assets/credits.md`); chybí návrh letiště (velikost, ranveje, hangár, kapacita) a parametry letadel jako u vlaků. Modely mají různé měřítko (délka 8,6–1676 jednotek), takže je potřeba je při načtení sjednotit na délku; airplane-1 má předek na +X (otočit `rotation.y = -π/2`), ostatní na +Z; airplane-2 má kola pod y = 0; airplane-3 má 11 tis. trojúhelníků. Ve hře je zobrazit credits (CC BY)
- **Lodní doprava** – přístavy a lodě z `assets/watercraft kit/` (nákladní `ship-cargo-*`, osobní `ship-ocean-liner*`, remorkéry, kontejnery a bóje do přístavu); chybí hledání cesty po vodě a návrh přístavu
- **Výška terénu** – teď nedává smysl: koleje, mosty, stavba i generátor počítají s rovinou, šlo by o přestavbu celé mapy
