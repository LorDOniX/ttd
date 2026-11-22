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
- **Pohled z první osoby** – v okně vlaku, auta i městského auta „🎥 Z kabiny“ (kamera jede s vozidlem, tachometr, tlačítko Zpět); panáček vpravo dole přetažením na mapu spustí průzkum pěšky (WASD/šipky, Shift běh, po kliknutí zamčená myš otáčí pohledem bez držení tlačítka, Esc uvolní myš, další Esc zpět); v horní liště pohledu i hlavní liště přepínač den/noc a ročního období (klávesy N a R)
- **Letecká doprava** – okno „Stavba letišť“ (L): malé letiště 5×4 (2 stání, od 1950) a velké 7×5 (4 stání, od 1972) s ranvejí, pojezdovou dráhou, terminálem, věží a hangárem; kliknutím na letiště hangár s nákupem letadel. Letadla podle [airplanes.md](airplanes.md) (osobní i poštovní, velká jen na velká letiště) létají po letovém řádu: pojíždění, čekání na volnou ranvej, vzlet, let po křivce, kroužení při plném letišti, přistání a stání u terminálu. Seznam letadel (O), okno letadla, pohled z kokpitu, credits CC BY v hangáru a v Nastavení
- **Lodní doprava** – okno „Stavba přístavů“ (W): přístav za 180 000 Kč na dvě dlaždice volného břehu s nábřežím, jeřábem, skladištěm a molem, před ním dvě kotviště na vodě (přes kotviště nejde postavit most). Kliknutím na přístav loděnice s nákupem lodí z watercraft kitu: osobní parníky (1950, 1985) a nákladní lodě dvou generací pro každý náklad (sypký náklad, tanker, kontejnery). Lodě plují po souvislé vodě (A* po 8 směrech), pod nízkými mosty neproplují a most přes trasu objedou; u obsazeného kotviště počkají nebo zakotví u druhého. V zimě (zhruba od poloviny prosince do poloviny března) voda zamrzne a lodě stojí v ledu, v přístavu jen nakládají. Řád jen mezi přístavy na stejné vodní ploše, seznam lodí (T), okno lodi, pohled z můstku
- **Autorail jako v OpenTTD** – tažením rovný úsek nebo úhlopříčka podle směru, stavba se zastaví na překážce; Ctrl/Cmd odebírá, Shift jen odhad ceny; depo se samo napojí výhybkami na kolej vedoucí kolmo před vjezdem
- **Okna voleb stavby** – orientace depa a garáže (4 směry nebo automaticky), výběr nástupiště (orientace, počet kolejí a délka 1–7, Drag & Drop, dosah, přijímá/dodává)
- **Nové okno depa** – soupravy z boku (vagon přidat „+“, prodat „×“), sestavení nového vlaku s náhledem, klonování vlaku (Ctrl = sdílený řád)
- **Cestová návěstidla** – obousměrná i jednosměrná (proti šipce vlak nepojede), tažení po trati s hustotou, klik otáčí směr, Ctrl/Cmd odstraní; u obsazeného úseku si vlak hned najde volnou kolej
- **Příkazy jízdního řádu jako v OpenTTD (vlaky)** – u každého příkazu nakládání (běžně / do plna / nenakládat), vykládání (běžně / vyložit vše / překládka / nevykládat), „Projet“ bez zastavení a „Servis v depu“; překládka nechá náklad i s historií na stanici, první vozidlo dostane virtuální podíl 75 % a zbytek zaplatí konečné doručení
- **Spolehlivost, poruchy a servis vlaků** – každý model má nejvyšší spolehlivost (parní 78 %, rychlovlak 95 %), vlaku denně klesá (po životnosti dvakrát rychleji); nespolehlivý vlak se porouchá a pár dní stojí s kouřem; po intervalu (výchozí 150 dní, v detailu vlaku −/+) zajede při odjezdu ze stanice do nejbližšího depa na servis a pokračuje v řádu; nastavení „Poruchy vozidel“ žádné / snížené / běžné

## Zbývá
- **Poruchy a servis i pro auta, letadla a lodě** – zatím jen vlaky; logika je obecná v `src/game/reliability.ts`
- **Cargodist (distribuce nákladu)** – cestující a náklad mají konkrétní cílovou stanici, stanice tvoří síť linek a náklad se rozděluje podle kapacity spojení jako v OpenTTD; velký zásah do cestujících, nákladu, překládek a okna stanice
- **Výška terénu** – teď nedává smysl: koleje, mosty, stavba i generátor počítají s rovinou, šlo by o přestavbu celé mapy
