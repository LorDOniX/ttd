import {
  MAX_WAGONS,
  OLD_TRAIN_COST_FACTOR,
  TRAIN_LIFETIME_YEARS,
  TRAIN_LOADING_DAYS,
  LOADING_PER_DAY,
  TRAIN_MIN_SELL,
  TRAIN_MODELS,
  TRAIN_SELL_REFUND,
  VEHICLE_LENGTH,
  WAGON_PRICE,
  WAGON_RUNNING_COST,
  MAX_SERVICE_INTERVAL_DAYS,
  MIN_SERVICE_INTERVAL_DAYS,
  SERVICE_INTERVAL_DAYS,
  SERVICE_MAX_ROUTE,
  type TrainModel,
  REFIT_COST_PER_WAGON,
} from './balance';
import { needsService, newMaintenance, rollBreakdown, service, wearOut, type Maintained } from './reliability';
import { Rng } from '../world/rng';
import { HEIGHT_STEP } from '../world/map';
import { formatMoney, type Game } from './game';
import { CARGOS, isCargo, isFreight, type Cargo } from './cargo';
import {
  cargoCapacity,
  consistCargos,
  loadOf,
  loadState,
  setConsist,
  totalLoad,
  wagonCargos,
  type Consist,
} from './consist';
import { Reservations } from './reservations';
import {
  RAIL_TYPE_GENITIVE,
  RailType,
  axisPiece,
  opposite,
  stationTiles,
  type Depot,
  type RailNetwork,
  type Station,
  type StationShape,
  type Waypoint,
} from '../world/rail';
import {
  extendThroughStation,
  findRoute,
  groundAt,
  railNetworks,
  pathLength,
  pointAt,
  reverseSegment,
  segmentLength,
  segmentIndexAt,
  segmentStart,
  segmentStillExists,
  segmentTiles,
  type RouteStart,
  type Segment,
} from '../world/route';

// Zrychlení a brzdění v dlaždicích za den za den
const ACCELERATION = 2;
const DECELERATION = 2;
// Stoupání: na plném svahu (1 úroveň na dlaždici) lokomotiva sama zpomalí o HILL_BASE, každý vůz přidá
// HILL_PER_WAGON, nejvýš o MAX_HILL_SLOWDOWN; z kopce vlak zrychluje o polovinu rychleji (jako v OpenTTD)
const HILL_BASE = 0.2;
const HILL_PER_WAGON = 0.06;
const MAX_HILL_SLOWDOWN = 0.7;

// Průměrné stoupání soupravy v úrovních na dlaždici: kladné do kopce, záporné z kopce
export function trainClimb(train: Train, rail: RailNetwork): number {
  if (train.path.length === 0) return 0;
  const length = trainLength(train);
  const head = groundAt(rail, train.path, train.pos);
  const tail = groundAt(rail, train.path, train.pos - length);
  return (head - tail) / length / HEIGHT_STEP;
}

// Nejvyšší rychlost vlaku v aktuálním stoupání (z kopce i po rovině plná rychlost modelu)
export function hillSpeed(train: Train, rail: RailNetwork, top: number): number {
  const climb = trainClimb(train, rail);
  if (climb <= 0) return top;
  return top * (1 - Math.min(MAX_HILL_SLOWDOWN, climb * (HILL_BASE + HILL_PER_WAGON * train.wagons)));
}
// Vlak bez cesty to zkusí znovu po této době
const LOST_RETRY_DAYS = 5;
// Vlak čekající na obsazenou trať po této době hledá jinou cestu (třeba volnou kolej nástupiště)
const BLOCKED_REPLAN_DAYS = 3;
const BLOCKED_WARN_DAYS = 30;
// Jak často vlak před obsazeným úsekem hledá volnou objížďku (cestová návěstidla jako v OpenTTD)
const DETOUR_RETRY_DAYS = 0.5;
// Objížďka smí být nejvýš o tolik delší než původní zbytek cesty (poměr a dlaždice navíc)
const DETOUR_MAX_RATIO = 1.5;
const DETOUR_MAX_EXTRA = 12;
// Vlak čekající na plné naložení zkusí doplnit náklad jednou denně
const FULL_LOAD_CHECK_DAYS = 1;
// Servis v depu podle příkazu jízdního řádu
const SERVICE_DAYS = 1;

export type TrainState = 'depot' | 'running' | 'loading' | 'lost';

// Volby příkazu jízdního řádu jako v OpenTTD
export interface OrderFlags {
  // Nakládání: čekat do plna, nebo nenakládat (bez údaje běžně)
  load?: 'full' | 'none';
  // Vykládání: vyložit vše (i kde se náklad nevykupuje), překládka, nevykládat (bez údaje běžně)
  unload?: 'unload' | 'transfer' | 'none';
  // Projet stanicí bez zastavení
  via?: boolean;
  // Příkaz „Jet do depa“ na servis; číslo v orders je pak id depa
  depot?: boolean;
  // Příkaz „Jet přes průjezdný bod“ (bez zastavení); číslo v orders je pak id průjezdného bodu
  waypoint?: boolean;
  // Jízdní řád s časy jako v OpenTTD: plánovaná doba jízdy k příkazu a stání na stanici (herní dny)
  travel?: number;
  wait?: number;
  // Přestavět vagony na stanici na tento náklad (jako automatická přestavba v OpenTTD): po vyložení
  // prázdné vagony přestaví a naloží nový náklad
  refit?: Cargo;
}

// Volby bez prázdných hodnot (do uložení i pro porovnání)
export function cleanFlags(flags: OrderFlags): OrderFlags {
  const clean: OrderFlags = {};
  const travel = timetableDays(flags.travel);
  if (flags.depot) {
    clean.depot = true;
    if (travel !== undefined) clean.travel = travel;
    return clean;
  }
  if (flags.waypoint) {
    clean.waypoint = true;
    return clean;
  }
  if (flags.load === 'full' || flags.load === 'none') clean.load = flags.load;
  if (flags.unload === 'unload' || flags.unload === 'transfer' || flags.unload === 'none') clean.unload = flags.unload;
  if (flags.via) clean.via = true;
  if (isCargo(flags.refit)) clean.refit = flags.refit;
  if (travel !== undefined) clean.travel = travel;
  const wait = timetableDays(flags.wait);
  if (wait !== undefined && !clean.via) clean.wait = wait;
  return clean;
}

// Doba v jízdním řádu: kladné číslo zaokrouhlené na desetiny dne, jinak bez údaje
export const MAX_TIMETABLE_DAYS = 365;
export function timetableDays(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(MAX_TIMETABLE_DAYS, Math.round(value * 10) / 10);
}

export function orderFlags(train: Train, index: number): OrderFlags {
  return train.orderFlags[index] ?? {};
}

// Jezdí vlak podle řádu na toto nástupiště (příkazy do depa se nepočítají)?
export function servesStation(train: Train, stationId: number): boolean {
  return (train.orders ?? []).some((id, i) => id === stationId && !isSpecialOrder(orderFlags(train, i)));
}

// Příkaz, který nevede do stanice: servis v depu, nebo průjezdný bod
export function isSpecialOrder(flags: OrderFlags): boolean {
  return flags.depot === true || flags.waypoint === true;
}

function orderKind(flags: OrderFlags): 'depot' | 'waypoint' | 'station' {
  return flags.depot ? 'depot' : flags.waypoint ? 'waypoint' : 'station';
}

// Kam vlak podle příkazu jede
type Goal = Station | Depot | Waypoint;

function isStation(goal: Goal): goal is Station {
  return !('entrance' in goal) && !('waypoint' in goal);
}

// Nástupiště z řádu bez příkazů do depa a průjezdných bodů
export function stationOrders(train: Train): number[] {
  return (train.orders ?? []).filter((_, i) => !isSpecialOrder(orderFlags(train, i)));
}

// Zastávky, kde vlak s přestavbou v řádu veze náklad cargo: od příkazu přestavby na něj až po přestavbu
// na jiný náklad (řád se objíždí dokola)
export function refitLoadStops(train: Train, cargo: Cargo): number[] {
  const orders = train.orders ?? [];
  const n = orders.length;
  const start = orders.findIndex((_, i) => orderFlags(train, i).refit === cargo);
  if (start < 0) return [];
  const stops: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const flags = orderFlags(train, i);
    if (k > 0 && flags.refit && flags.refit !== cargo) break;
    if (!isSpecialOrder(flags)) stops.push(orders[i]);
  }
  return stops;
}

export interface Train extends Maintained, Consist {
  id: number;
  name: string;
  modelId: string;
  wagons: number;
  // Náklad prvního vagonu; u smíšené soupravy vezou další vagony i jiné druhy (wagonCargo, holds)
  cargo: Cargo;
  depotId: number;
  // Příkazy, které vlak objíždí dokola: id nástupiště, u příkazu do depa id depa; v depu si je pamatuje
  orders: number[] | null;
  // Volby příkazů po řadě (stejná délka jako orders)
  orderFlags: OrderFlags[];
  // Do kdy (herní den) trvá servis v depu podle řádu; pak vlak pokračuje dalším příkazem
  serviceUntil?: number;
  // Automatická zajížďka na servis: depo a příkaz řádu, ke kterému vlak po servisu pokračuje
  servicing?: { depotId: number; resume: number };
  // Linka se sdíleným jízdním řádem; změna řádu platí pro všechny její vlaky
  orderGroup: number | null;
  // Index cíle v orders, -1 = návrat do depa
  target: number;
  state: TrainState;
  // Kusy koleje pod vlakem a trasa před ním; hlava je ve vzdálenosti pos od začátku
  path: Segment[];
  pos: number;
  speed: number;
  waitDays: number;
  // Náklad na palubě (cestující nebo tuny nákladu): odkud a kdy naložen, kolik dlaždic ujel
  passengers: number;
  boardedStation: number;
  boardedAt: number;
  tiles: number;
  // Letos a loni: příjmy z jízdného a provozní náklady
  income: number;
  costs: number;
  lastIncome: number;
  lastCosts: number;
  // Skupina vozidel (jako v OpenTTD); bez údaje žádná
  group?: number;
  // Herní den nákupu nebo poslední obnovy
  builtDay: number;
  // Virtuální příjem z překládek, který náklad na palubě nese
  feeder?: number;
  // Hráč už dostal zprávu o konci životnosti
  agingWarned: boolean;
  // Časy v jízdním řádu: odjezd od posledního příkazu, naměřené doby jízdy k příkazům, zpoždění oproti plánu
  // (kladné = pozdě) a automatické vyplňování plánu z naměřených dob jako v OpenTTD
  departedAt?: number;
  lastTravel?: (number | null)[];
  lateness?: number;
  autofill?: boolean;
  // Po příjezdu do depa se obnoví a vyjede podle jízdního řádu
  renewing: boolean;
}

const DAYS_PER_YEAR = 365.25;

// Druh koleje, po kterém lokomotiva jezdí
export function modelRailType(model: TrainModel): RailType {
  return model.railType === 'monorail'
    ? RailType.Monorail
    : model.railType === 'maglev'
      ? RailType.Maglev
      : RailType.Rail;
}

export function trainModel(train: Train): TrainModel {
  return TRAIN_MODELS.find((m) => m.id === train.modelId)!;
}

export function trainLength(train: Train): number {
  return (train.wagons + 1) * VEHICLE_LENGTH;
}

// Náklad na palubě a kapacita, např. „12 / 60 cestujících“ nebo „60 / 60 t uhlí, 10 / 20 t pošty“
export function formatLoad(train: Train): string {
  const cargos = consistCargos(train);
  if (cargos.length === 0) return `0 / 0 ${CARGOS[train.cargo].unit}`;
  return cargos.map((c) => `${loadOf(train, c)} / ${cargoCapacity(train, c)} ${CARGOS[c].unit}`).join(', ');
}

// Kolik vagonů každého druhu nákladu stojí u nástupiště
export function wagonsAtStationByCargo(train: Train, station: StationShape): Map<Cargo, number> {
  const tiles = new Set(stationTiles(station).map((t) => `${t.x},${t.y}`));
  const cargos = wagonCargos(train);
  const result = new Map<Cargo, number>();
  for (let i = 1; i <= train.wagons; i++) {
    const [x, y] = pointAt(train.path, train.pos - (i + 0.5) * VEHICLE_LENGTH);
    if (tiles.has(`${Math.floor(x)},${Math.floor(y)}`)) result.set(cargos[i - 1], (result.get(cargos[i - 1]) ?? 0) + 1);
  }
  return result;
}

// Vagony stojící na nástupišti; jen ty nakládají a vykládají
export function wagonsAtStation(train: Train, station: StationShape): number {
  const tiles = new Set(stationTiles(station).map((t) => `${t.x},${t.y}`));
  let count = 0;
  // Lokomotiva jede v čele, vagony za ní
  for (let i = 1; i <= train.wagons; i++) {
    const [x, y] = pointAt(train.path, train.pos - (i + 0.5) * VEHICLE_LENGTH);
    if (tiles.has(`${Math.floor(x)},${Math.floor(y)}`)) count++;
  }
  return count;
}

// Stáří vlaku v letech
export function trainAge(train: Train, today: number): number {
  return Math.max(0, today - train.builtDay) / DAYS_PER_YEAR;
}

export function isOld(train: Train, today: number): boolean {
  return trainAge(train, today) >= TRAIN_LIFETIME_YEARS;
}

// Podíl kupní ceny, který vrátí prodej: nový vlak polovinu, na konci životnosti TRAIN_MIN_SELL
export function sellFactor(age: number): number {
  const worn = Math.min(1, age / TRAIN_LIFETIME_YEARS);
  return TRAIN_SELL_REFUND - (TRAIN_SELL_REFUND - TRAIN_MIN_SELL) * worn;
}

export function sellPrice(train: Train, today: number): number {
  const price = trainModel(train).price + train.wagons * WAGON_PRICE;
  return Math.round(price * sellFactor(trainAge(train, today)));
}

export function yearlyRunningCost(train: Train, today: number): number {
  const base = trainModel(train).runningCost + train.wagons * WAGON_RUNNING_COST;
  return isOld(train, today) ? base * OLD_TRAIN_COST_FACTOR : base;
}

// Kolik dlaždic vlak ujel mezi kusy trasy from a to (pole mostu se počítá po dlaždicích)
function tilesPassed(path: readonly Segment[], from: number, to: number): number {
  let tiles = 0;
  for (let i = from + 1; i <= to; i++) tiles += segmentTiles(path[i]);
  return tiles;
}

// Index zastávky, kam vlak pojede po té aktuální
// Další zastávka po té, u které vlak stojí (id stanice; bez dep, průjezdných bodů a průjezdů), nebo undefined
export function nextStationStop(train: Train, current: number): number | undefined {
  const orders = train.orders;
  if (!orders || orders.length === 0) return undefined;
  const n = orders.length;
  const at = orders[train.target] === current ? train.target : orders.indexOf(current);
  if (at < 0) return undefined;
  for (let k = 1; k <= n; k++) {
    const i = (at + k) % n;
    const flags = orderFlags(train, i);
    if (!isSpecialOrder(flags) && !flags.via) return orders[i];
  }
  return undefined;
}

export function nextStop(train: Train): number {
  return train.orders ? (train.target + 1) % train.orders.length : -1;
}

// Chyba jízdního řádu, nebo null; potřebuje aspoň dvě nástupiště a stejný příkaz nesmí následovat
// po sobě ani přes konec seznamu
export function ordersError(orders: number[], flags: readonly OrderFlags[] = []): string | null {
  const kind = (i: number): string => (flags[i]?.depot ? 'depot' : flags[i]?.waypoint ? 'waypoint' : 'station');
  if (orders.filter((_, i) => kind(i) === 'station').length < 2) return 'Jízdní řád potřebuje aspoň dvě zastávky.';
  const repeated = orders.findIndex((id, i) => {
    const j = (i + 1) % orders.length;
    return id === orders[j] && kind(i) === kind(j);
  });
  if (repeated >= 0) {
    return kind(repeated) === 'depot'
      ? 'Stejné depo nesmí následovat hned po sobě.'
      : kind(repeated) === 'waypoint'
        ? 'Stejný průjezdný bod nesmí následovat hned po sobě.'
        : 'Stejné nástupiště nesmí následovat hned po sobě.';
  }
  return null;
}

// Vlaky společnosti: nákup, jízdní řád a pohyb po kolejích
export class Fleet {
  readonly trains: Train[] = [];
  nextId = 1;
  // Číslo další linky; po načtení se dopočítá z vlaků
  nextGroupId = 1;
  readonly reservations: Reservations;
  // Jak dlouho vlak stojí před obsazenou tratí: celkem a od posledního hledání jiné cesty
  private readonly blocked = new Map<number, { total: number; sinceReplan: number; deadlockWarned: boolean }>();
  // Herní čas posledního hledání objížďky podle vlaku
  private readonly detourTried = new Map<number, number>();
  // Náhoda pro poruchy zvlášť, aby neměnila růst měst a další náhodné jevy
  private readonly breakdownRng: Rng;
  // Vlaky, kterým se nepodařilo navázat cestu za stanicí „projet“ (cíl, u kterého to zkoušely)
  private readonly viaFailed = new Map<number, number>();

  constructor(private readonly game: Game) {
    this.breakdownRng = new Rng(game.world.seed ^ 0x2c1b3c6d);
    this.reservations = new Reservations(game.world.map.width, (x, y) => game.world.rail.hasSignal(x, y));
    game.clock.events.on('month', () => this.chargeRunningCosts());
    game.clock.events.on('year', (ended) => {
      for (const m of TRAIN_MODELS) if (m.year === ended + 1) game.news(`Nový vlak k dispozici: ${m.name}.`);
      for (const train of this.trains) {
        train.lastIncome = train.income;
        train.lastCosts = train.costs;
        train.income = 0;
        train.costs = 0;
      }
    });
    game.events.on('railChanged', () => this.revalidate());
  }

  // Souvislé kolejové sítě; přepočítají se po změně kolejí
  private networks: { revision: number; labels: Int32Array } | null = null;

  private networkAt(x: number, y: number): number {
    const { rail, map } = this.game.world;
    if (this.networks?.revision !== rail.revision) {
      this.networks = { revision: rail.revision, labels: railNetworks(rail) };
    }
    return this.networks.labels[y * map.width + x];
  }

  // Vede z depa kolej k nástupišti (případně oklikou přes jiné koleje)?
  connectedToDepot(depot: Depot, station: Station): boolean {
    const network = this.networkAt(depot.x, depot.y);
    return network >= 0 && network === this.networkAt(station.x, station.y);
  }

  // Chyba řádu, když mezi některými po sobě jdoucími příkazy (i přes konec řádu) nevede kolej
  routeError(orders: number[], flags: readonly OrderFlags[] = []): string | null {
    const place = (i: number): { x: number; y: number; name: string } | undefined => {
      if (flags[i]?.waypoint) return this.waypointById(orders[i]);
      if (!flags[i]?.depot) return this.station(orders[i]);
      const depot = this.depotById(orders[i]);
      return depot && { x: depot.x, y: depot.y, name: `depo ${depot.id + 1}` };
    };
    for (let i = 0; i < orders.length; i++) {
      const a = place(i);
      const b = place((i + 1) % orders.length);
      if (!a || !b) continue;
      const network = this.networkAt(a.x, a.y);
      if (network < 0 || network !== this.networkAt(b.x, b.y)) {
        return `Mezi ${a.name} a ${b.name} nevede kolej.`;
      }
    }
    return null;
  }

  available(): TrainModel[] {
    return TRAIN_MODELS.filter((m) => m.year <= this.game.clock.date.year);
  }

  inDepot(depot: Depot): Train[] {
    return this.trains.filter((t) => t.depotId === depot.id);
  }

  buy(depot: Depot, model: TrainModel): string | null {
    if (!this.fitsDepot(model, depot)) {
      const type = modelRailType(model);
      return type !== this.game.world.rail.railTypeAt(depot.x, depot.y)
        ? `${model.name} potřebuje depo na ${RAIL_TYPE_GENITIVE[type]}.`
        : `${model.name} potřebuje elektrizované depo (trolejové vedení).`;
    }
    if (this.game.money < model.price) return `Nedostatek peněz (${formatMoney(model.price)}).`;
    this.game.spend(model.price, 'vehicles');
    const id = this.nextId++;
    this.trains.push({
      id,
      name: `Vlak ${id}`,
      modelId: model.id,
      wagons: 0,
      cargo: 'passengers',
      depotId: depot.id,
      orders: null,
      orderFlags: [],
      orderGroup: null,
      target: 0,
      state: 'depot',
      path: [],
      pos: 0,
      speed: 0,
      waitDays: 0,
      passengers: 0,
      boardedStation: -1,
      boardedAt: 0,
      tiles: 0,
      income: 0,
      costs: 0,
      lastIncome: 0,
      lastCosts: 0,
      builtDay: this.game.clock.day,
      agingWarned: false,
      renewing: false,
      ...newMaintenance(model.reliability, this.game.clock.now, SERVICE_INTERVAL_DAYS),
    });
    this.changed();
    return null;
  }

  // Přidá vagon na konec soupravy; bez druhu nákladu na stejný náklad jako poslední vagon
  addWagon(train: Train, cargo?: Cargo): string | null {
    if (train.state !== 'depot') return 'Vagony lze měnit jen v depu.';
    if (train.wagons >= MAX_WAGONS) return `Vlak může mít nejvýš ${MAX_WAGONS} vagonů.`;
    if (this.game.money < WAGON_PRICE) return `Nedostatek peněz (${formatMoney(WAGON_PRICE)}).`;
    this.game.spend(WAGON_PRICE, 'vehicles');
    const list = wagonCargos(train);
    setConsist(train, [...list, cargo ?? list[list.length - 1] ?? train.cargo]);
    this.changed();
    return null;
  }

  // Cena celé soupravy: lokomotiva a vagony
  trainPrice(model: TrainModel, wagons: number): number {
    return model.price + wagons * WAGON_PRICE;
  }

  // Koupí rovnou celou soupravu (lokomotivu, vagony a druh nákladu); vrací nový vlak, nebo chybu
  buyTrain(depot: Depot, model: TrainModel, cargo: Cargo, wagons: number): Train | string {
    const count = Math.max(0, Math.min(MAX_WAGONS, Math.round(wagons)));
    const price = this.trainPrice(model, count);
    if (this.game.money < price) return `Nedostatek peněz (${formatMoney(price)}).`;
    const error = this.buy(depot, model);
    if (error) return error;
    const train = this.trains[this.trains.length - 1];
    train.cargo = cargo;
    setConsist(
      train,
      Array.from({ length: count }, () => cargo),
    );
    this.game.spend(count * WAGON_PRICE, 'vehicles');
    this.changed();
    return train;
  }

  // Klon jako v OpenTTD: stejná lokomotiva (nebo nejnovější, když stará už není), vagony, náklad i jízdní řád;
  // se sdílením (Ctrl) se klon připojí k lince původního vlaku
  clone(train: Train, depot: Depot, share = false): Train | string {
    const models = this.available().filter((m) => this.fitsDepot(m, depot));
    const model = models.find((m) => m.id === train.modelId) ?? models[models.length - 1];
    const copy = this.buyTrain(depot, model, train.cargo, train.wagons);
    if (typeof copy === 'string') return copy;
    setConsist(copy, wagonCargos(train));
    if (train.group !== undefined) copy.group = train.group;
    if (share && train.orders) {
      this.shareOrders(copy, train);
    } else {
      copy.orders = train.orders ? [...train.orders] : null;
      copy.orderFlags = train.orderFlags.map((f) => ({ ...f }));
    }
    this.changed();
    return copy;
  }

  // Odpojí vagon (bez indexu poslední); náklad, který se do zbylých vagonů nevejde, propadne
  removeWagon(train: Train, index = train.wagons - 1): void {
    if (train.state !== 'depot' || train.wagons === 0 || index < 0 || index >= train.wagons) return;
    const list = wagonCargos(train);
    list.splice(index, 1);
    setConsist(train, list);
    this.game.refund(Math.round(WAGON_PRICE * sellFactor(trainAge(train, this.game.clock.day))), 'vehicles');
    this.changed();
  }

  sell(train: Train): void {
    if (train.state !== 'depot') return;
    this.game.refund(sellPrice(train, this.game.clock.day), 'vehicles');
    this.trains.splice(this.trains.indexOf(train), 1);
    this.changed();
  }

  // Nejnovější dostupný model a doplatek za něj po započtení staré lokomotivy
  // Lze lokomotivu koupit v tomto depu? Elektrická jen v elektrizovaném
  // Lokomotivu jen v depu jejího druhu koleje (jednokolejka, maglev, železnice)
  fitsDepot(model: TrainModel, depot: Depot): boolean {
    const { rail } = this.game.world;
    if (modelRailType(model) !== rail.railTypeAt(depot.x, depot.y)) return false;
    return !model.electric || rail.isElectrified(depot.x, depot.y);
  }

  renewalOffer(train: Train): { model: TrainModel; cost: number } {
    // Nejnovější lokomotiva stejného druhu koleje (jako autoreplace v OpenTTD): parní a motorová
    // za neelektrickou, elektrická za elektrickou
    const electric = trainModel(train).electric === true;
    const type = modelRailType(trainModel(train));
    const models = this.available().filter((m) => (m.electric === true) === electric && modelRailType(m) === type);
    const model = models[models.length - 1] ?? trainModel(train);
    const tradeIn = trainModel(train).price * sellFactor(trainAge(train, this.game.clock.day));
    return { model, cost: Math.round(model.price - tradeIn) };
  }

  // Obnova v depu: nová lokomotiva nejnovějšího modelu, vagony a jízdní řád zůstanou
  renew(train: Train): string | null {
    if (train.state !== 'depot') return 'Obnovit lze jen vlak v depu.';
    const { model, cost } = this.renewalOffer(train);
    if (this.game.money < cost) return `Nedostatek peněz na obnovu (${formatMoney(cost)}).`;
    this.game.spend(cost, 'vehicles');
    train.modelId = model.id;
    train.builtDay = this.game.clock.day;
    // Nová lokomotiva je jako po servisu
    service(train, model.reliability, this.game.clock.now);
    train.agingWarned = false;
    this.game.news(`${train.name} obnoven: ${model.name}.`);
    this.changed();
    return null;
  }

  // Obnoví hned v depu, jinak vlak pošle do depa a po obnově znovu vyjede
  requestRenewal(train: Train): string | null {
    if (train.state === 'depot') return this.renew(train);
    train.renewing = true;
    this.sendToDepot(train);
    return null;
  }

  // Vypraví vlak z depa; nejdřív jede k nejbližší zastávce jízdního řádu.
  // Bez voleb příkazů si vlak ponechá volby z dosavadního řádu u stejných zastávek.
  start(train: Train, orders: number[], flags?: OrderFlags[]): string | null {
    const nextFlags = flags ? flags.map(cleanFlags) : this.realign(train, orders);
    const error = ordersError(orders, nextFlags) ?? this.routeError(orders, nextFlags);
    if (error) return error;
    const depot = this.depot(train);
    const places = orders.map((_, i) => this.placeOf(orders, nextFlags, i));
    if (!depot || places.some((p) => !p)) return 'Nástupiště, depo nebo průjezdný bod neexistuje.';

    const exit = this.depotExit(depot);
    // Z depa vlak vyrazí k nejbližšímu nástupišti řádu
    const routes = places.map((place, i) =>
      isSpecialOrder(nextFlags[i] ?? {}) ? null : this.routeTo(segmentStart(exit), place!, train),
    );
    const options = routes
      .map((route, index) => ({ route, index }))
      .filter((o): o is { route: Segment[]; index: number } => o.route !== null)
      .sort((a, b) => pathLength(a.route) - pathLength(b.route));
    if (options.length === 0) return 'Z depa nevede kolej k vybraným nástupištím.';

    train.orders = [...orders];
    train.orderFlags = nextFlags;
    train.lastTravel = undefined;
    train.lateness = undefined;
    train.target = options[0].index;
    this.leaveDepot(train, depot, options[0].route);
    return null;
  }

  // Kus koleje v depu, kterým vlak vyjíždí
  private depotExit(depot: Depot): Segment {
    return {
      x: depot.x,
      y: depot.y,
      piece: axisPiece(depot.entrance % 2 === 0 ? 'y' : 'x'),
      entry: opposite(depot.entrance),
      exit: depot.entrance,
    };
  }

  private leaveDepot(train: Train, depot: Depot, route: Segment[]): void {
    train.serviceUntil = undefined;
    train.departedAt = this.game.clock.now;
    train.path = [this.depotExit(depot), ...route];
    // Hlava ve středu depa, zbytek soupravy je ještě uvnitř
    train.pos = 0.5;
    train.speed = 0;
    train.state = 'running';
    this.reservations.reset(train, this.tail(train));
    this.changed();
  }

  // Po servisu v depu pokračuje vlak dalším příkazem řádu
  private finishService(train: Train): void {
    const depot = this.depot(train);
    if (!train.orders || !depot) {
      train.serviceUntil = undefined;
      return;
    }
    // Po automatickém servisu pokračuje k příkazu, kam jel, po servisu z řádu k dalšímu
    const resume = train.servicing?.resume;
    train.servicing = undefined;
    train.target = resume !== undefined && resume < train.orders.length ? resume : nextStop(train);
    const goal = this.goal(train);
    const route = goal && this.routeTo(segmentStart(this.depotExit(depot)), goal, train);
    if (route) {
      this.leaveDepot(train, depot, route);
      return;
    }
    // Zkusí to znovu později; hráč se to dozví jen jednou
    if (train.state === 'depot' && train.serviceUntil !== undefined && !this.blocked.has(train.id)) {
      this.game.news(`${train.name} nemůže z depa najít cestu dál podle řádu.`, this.position(train));
    }
    train.target = (train.target - 1 + train.orders.length) % train.orders.length;
    train.serviceUntil = this.game.clock.now + LOST_RETRY_DAYS;
    this.blocked.set(train.id, { total: 0, sinceReplan: 0, deadlockWarned: true });
  }

  // Volby příkazů pro nový řád: u stejných příkazů z dosavadního řádu se zachovají
  private realign(train: Train, orders: number[]): OrderFlags[] {
    const old = train.orders ?? [];
    const used = new Set<number>();
    return orders.map((id) => {
      const j = old.findIndex((o, k) => o === id && !used.has(k));
      if (j < 0) return {};
      used.add(j);
      return { ...orderFlags(train, j) };
    });
  }

  // Cena přestavby všech vagonů na jiný náklad (platí se jen za vagony, které ho ještě nevezou)
  refitCost(train: Train, cargo: Cargo): number {
    return wagonCargos(train).filter((c) => c !== cargo).length * REFIT_COST_PER_WAGON;
  }

  // Přestavba v depu jako v OpenTTD: všechny vagony na jiný druh nákladu za poplatek; náklad přestavěných propadne
  setCargo(train: Train, cargo: Cargo): string | null {
    if (train.state !== 'depot') return 'Vagony lze přestavět jen v depu, nebo příkazem na stanici.';
    if (train.wagons === 0) {
      train.cargo = cargo;
      this.changed();
      return null;
    }
    const cost = this.refitCost(train, cargo);
    if (cost === 0) return null;
    if (this.game.money < cost) return `Na přestavbu chybí peníze (${formatMoney(cost)}).`;
    this.game.spend(cost, 'vehicles');
    train.costs += cost;
    setConsist(
      train,
      wagonCargos(train).map(() => cargo),
    );
    this.changed();
    return null;
  }

  // Přestavba jednoho vagonu v depu (jako v OpenTTD); jeho náklad propadne
  refitWagon(train: Train, index: number, cargo: Cargo): string | null {
    if (train.state !== 'depot') return 'Vagony lze přestavět jen v depu, nebo příkazem na stanici.';
    const list = wagonCargos(train);
    if (index < 0 || index >= list.length || list[index] === cargo) return null;
    if (this.game.money < REFIT_COST_PER_WAGON) {
      return `Na přestavbu chybí peníze (${formatMoney(REFIT_COST_PER_WAGON)}).`;
    }
    this.game.spend(REFIT_COST_PER_WAGON, 'vehicles');
    train.costs += REFIT_COST_PER_WAGON;
    list[index] = cargo;
    // Přestavěný vagon jde prázdný; náklad jeho původního druhu se vejde jen do zbylých vagonů
    setConsist(train, list);
    this.changed();
    return null;
  }

  // Přestavba podle příkazu na stanici: jen prázdné vagony a jen když je na ni
  private refitAtStation(train: Train, cargo: Cargo, station: Station): boolean {
    if (totalLoad(train) > 0) {
      this.game.news(
        `${train.name} se ve stanici ${station.name} nepřestavěl: ve vagonech zůstal náklad (${formatLoad(train)}).`,
        station,
      );
      return false;
    }
    const cost = this.refitCost(train, cargo);
    if (this.game.money < cost) {
      this.game.news(`${train.name} se ve stanici ${station.name} nepřestavěl: chybí ${formatMoney(cost)}.`, station);
      return false;
    }
    if (cost > 0) this.game.spend(cost, 'vehicles');
    train.costs += cost;
    setConsist(
      train,
      wagonCargos(train).map(() => cargo),
    );
    if (train.wagons === 0) train.cargo = cargo;
    return true;
  }

  // Zapne nebo vypne čekání na plné naložení na zastávce (u sdíleného řádu pro celou linku)
  toggleFullLoad(train: Train, stationId: number): void {
    const indices = (train.orders ?? []).flatMap((id, i) =>
      id === stationId && !orderFlags(train, i).depot ? [i] : [],
    );
    const waits = indices.length > 0 && indices.every((i) => orderFlags(train, i).load === 'full');
    for (const i of indices) this.setOrderFlags(train, i, { load: waits ? undefined : 'full' });
  }

  // Interval servisu ve dnech (u linky jen tomuto vlaku), v mezích jako v OpenTTD
  setServiceInterval(train: Train, days: number): void {
    train.serviceInterval = Math.max(MIN_SERVICE_INTERVAL_DAYS, Math.min(MAX_SERVICE_INTERVAL_DAYS, Math.round(days)));
    this.changed();
  }

  // Čeká vlak na zastávce stationId na plné naložení?
  waitsForFullLoad(train: Train, stationId: number): boolean {
    return (train.orders ?? []).some((id, i) => id === stationId && orderFlags(train, i).load === 'full');
  }

  // Změní volby jednoho příkazu (u sdíleného řádu pro celou linku); z příkazu do depa nejde udělat nástupiště
  setOrderFlags(train: Train, index: number, patch: Omit<OrderFlags, 'depot'>): void {
    if (!train.orders || index < 0 || index >= train.orders.length) return;
    for (const member of this.lineOf(train)) {
      const current = orderFlags(member, index);
      if (isSpecialOrder(current)) continue;
      const next = [...member.orderFlags];
      while (next.length < member.orders!.length) next.push({});
      next[index] = cleanFlags({ ...current, ...patch });
      member.orderFlags = next;
    }
    this.changed();
  }

  // Název příkazu pro okna: nástupiště, nebo „Depo 3“
  orderName(train: Train, index: number): string {
    const id = train.orders?.[index];
    if (id === undefined) return '?';
    if (orderFlags(train, index).depot) return `Depo ${id + 1}`;
    if (orderFlags(train, index).waypoint) return this.waypointById(id)?.name ?? '?';
    return this.stationName(id);
  }

  // Vlaky se stejným sdíleným řádem včetně tohoto; bez linky jen on sám
  lineOf(train: Train): Train[] {
    return train.orderGroup === null ? [train] : this.trains.filter((t) => t.orderGroup === train.orderGroup);
  }

  // Připojí vlak k jízdnímu řádu jiného vlaku; vznikne nebo se rozšíří linka
  shareOrders(train: Train, other: Train): string | null {
    if (train === other) return null;
    if (!other.orders) return `${other.name} nemá jízdní řád.`;
    const error = train.state === 'depot' ? null : ordersError(other.orders);
    if (error) return error;
    other.orderGroup ??= this.nextGroupId++;
    train.orderGroup = other.orderGroup;
    this.applyOrders(
      train,
      [...other.orders],
      other.orderFlags.map((f) => ({ ...f })),
    );
    this.changed();
    return null;
  }

  // Vlak si ponechá kopii řádu, ale dál ho upravuje samostatně
  unshareOrders(train: Train): void {
    const line = this.lineOf(train);
    train.orderGroup = null;
    // Z linky s jediným vlakem se stává obyčejný vlak
    if (line.length === 2) for (const t of line) t.orderGroup = null;
    this.changed();
  }

  // Změní jízdní řád i za jízdy, u sdíleného řádu všem vlakům linky.
  // V depu smí být řád rozpracovaný, ověří se až při výjezdu.
  // Bez voleb příkazů si vlak ponechá volby z dosavadního řádu u stejných zastávek.
  setOrders(train: Train, orders: number[], flags?: OrderFlags[]): string | null {
    const line = this.lineOf(train);
    const nextFlags = flags ? orders.map((_, i) => cleanFlags(flags[i] ?? {})) : this.realign(train, orders);
    // Nepropojené zastávky se za jízdy neblokují (řád se dá přestavět postupně), okno řádu je jen ukáže
    const moving = line.some((t) => t.state !== 'depot' || t.serviceUntil !== undefined);
    const error = moving ? ordersError(orders, nextFlags) : null;
    if (error) return error;
    const missing = orders.some((_, i) => !this.placeOf(orders, nextFlags, i));
    if (missing) return 'Nástupiště, depo nebo průjezdný bod neexistuje.';
    for (const member of line) this.applyOrders(member, orders, nextFlags);
    this.changed();
    return null;
  }

  // Vlak pokračuje k aktuálnímu cíli, pokud v řádu zůstal
  private applyOrders(train: Train, orders: number[], flags: OrderFlags[]): void {
    const current = train.orders && train.target >= 0 ? train.orders[train.target] : null;
    const currentKind = train.target >= 0 ? orderKind(orderFlags(train, train.target)) : 'station';
    const changedOrders =
      !train.orders || orders.length !== train.orders.length || orders.some((id, i) => id !== train.orders![i]);
    train.orders = orders.length > 0 ? [...orders] : null;
    train.orderFlags = orders.length > 0 ? flags.map((f) => ({ ...f })) : [];
    // Naměřené doby patří k pořadí příkazů; po změně řádu se měří znovu
    if (changedOrders) train.lastTravel = undefined;
    if (train.target !== -1 && train.state !== 'depot') {
      const kept =
        current === null
          ? -1
          : orders.findIndex((id, i) => id === current && orderKind(flags[i] ?? {}) === currentKind);
      // Ve stanici se po nástupu posune na další zastávku, tedy na začátek řádu
      train.target = kept >= 0 ? kept : train.state === 'loading' ? orders.length - 1 : 0;
      // Cestou na servis se vlak po něm vrátí k témuž cíli, pokud v řádu zůstal
      if (train.servicing) train.servicing = { ...train.servicing, resume: train.target };
      // Ztracený vlak zkusí novou trasu hned, ne až po další prodlevě
      if ((kept < 0 && train.state === 'running') || train.state === 'lost') this.replan(train);
    }
  }

  // Přeskočí na zastávku řádu jako „Přeskočit“ v OpenTTD; stojící ve stanici hned odjede
  skipTo(train: Train, index: number): void {
    const { orders } = train;
    if (!orders || index < 0 || index >= orders.length || train.state === 'depot' || train.renewing) return;
    if (train.state === 'loading') {
      if (train.target >= 0 && orders[train.target] === orders[index]) return;
      // Při odjezdu se cíl posune na následující zastávku
      train.target = (index - 1 + orders.length) % orders.length;
    } else train.target = index;
    train.servicing = undefined;
    this.replan(train);
    this.changed();
  }

  sendToDepot(train: Train): void {
    if (train.state === 'depot') return;
    train.servicing = undefined;
    train.target = -1;
    if (train.state === 'running' || train.state === 'lost') this.replan(train);
    this.changed();
  }

  update(days: number): void {
    if (days <= 0) return;
    for (const train of this.trains) {
      if (train.state === 'depot') {
        if (train.serviceUntil !== undefined && this.game.clock.now >= train.serviceUntil) this.finishService(train);
        continue;
      }
      // Po načtení hry rezervace neexistují, vlak si znovu vezme koleje pod sebou
      if (!this.reservations.has(train)) this.reservations.reset(train, this.tail(train));
      wearOut(train, days, isOld(train, this.game.clock.day));
      if (train.brokenDays > 0) {
        // Porouchaný vlak stojí, dokud se neopraví; koleje drží dál
        train.speed = 0;
        train.brokenDays = Math.max(0, train.brokenDays - days);
        if (train.brokenDays === 0) this.changed();
        continue;
      }
      if (train.state === 'running') {
        if (train.speed > 0.3 && rollBreakdown(train, days, this.game.breakdowns, this.breakdownRng.next())) {
          train.speed = 0;
          this.game.news(
            `${train.name} má poruchu – pár dní stojí. Pravidelný servis poruchám předchází.`,
            this.position(train),
          );
          this.changed();
          continue;
        }
        this.move(train, days);
      } else {
        train.waitDays -= days;
        if (train.waitDays > 0) continue;
        if (this.fillingUp(train)) train.waitDays = FULL_LOAD_CHECK_DAYS;
        else if (!this.planService(train)) this.replan(train);
      }
    }
  }

  // Vlak, který na zastávce čeká na plné naložení, ale ještě není plný
  isFillingUp(train: Train): boolean {
    const station = this.loadingStation(train);
    return station !== null && this.targetFlags(train).load === 'full' && !this.isFull(train, station);
  }

  // Doloží náklad; vrací true, když má vlak dál čekat
  private fillingUp(train: Train): boolean {
    const station = this.loadingStation(train);
    if (!station || this.targetFlags(train).load !== 'full') return false;
    this.exchange(train, station, true);
    this.changed();
    return !this.isFull(train, station);
  }

  private loadingStation(train: Train): Station | null {
    if (train.state !== 'loading' || train.target === -1 || !train.orders) return null;
    if (isSpecialOrder(this.targetFlags(train))) return null;
    const station = this.station(train.orders[train.target]);
    return station ? this.platformAt(train, station) : null;
  }

  // Volby příkazu, ke kterému vlak právě jede nebo u kterého stojí
  private targetFlags(train: Train): OrderFlags {
    // Cestou na automatický servis neplatí volby příkazu, ke kterému se vlak potom vrátí
    return train.target >= 0 && !train.servicing ? orderFlags(train, train.target) : {};
  }

  // Při odjezdu ze stanice: je-li čas na servis, pošle vlak do nejbližšího depa (do SERVICE_MAX_ROUTE dlaždic).
  // Vlaky se servisem v řádu jezdí podle řádu. Vrací true, když vlak na servis vyrazil.
  private planService(train: Train): boolean {
    if (train.state !== 'loading' || !train.orders || train.target === -1 || train.servicing) return false;
    if (!needsService(train, this.game.clock.now, this.game.breakdowns)) return false;
    if (train.orderFlags.some((f) => f.depot)) return false;
    const depot = this.nearestServiceDepot(train);
    if (!depot) return false;
    train.servicing = { depotId: depot.id, resume: nextStop(train) };
    this.replan(train);
    // replan stav změní; TypeScript o tom neví
    if ((train.state as TrainState) !== 'running') {
      // Cestu se nepodařilo naplánovat: servis se odloží a vlak jede dál podle řádu
      train.servicing = undefined;
      this.replan(train);
    }
    return true;
  }

  // Nejbližší depo, ke kterému vede z místa vlaku (jedním nebo druhým směrem) cesta do SERVICE_MAX_ROUTE dlaždic
  private nearestServiceDepot(train: Train): Depot | null {
    const body = this.body(train);
    const head = body[body.length - 1];
    const reversed = body.map(reverseSegment).reverse();
    const starts = [segmentStart(head), segmentStart(reversed[reversed.length - 1])];
    const candidates = [...this.game.world.rail.depots]
      .filter((d) => Math.hypot(d.x - head.x, d.y - head.y) <= SERVICE_MAX_ROUTE)
      .sort((a, b) => Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y))
      .slice(0, 4);
    let best: { depot: Depot; length: number } | null = null;
    for (const depot of candidates) {
      for (const start of starts) {
        const route = this.findGoal(start, depot, undefined, train);
        const length = route ? pathLength(route) : Infinity;
        if (length <= SERVICE_MAX_ROUTE && (!best || length < best.length)) best = { depot, length };
      }
    }
    return best?.depot ?? null;
  }

  // Plné jsou všechny vagony, které stojí u nástupiště – ostatní naložit nejdou
  private isFull(train: Train, station: Station): boolean {
    const at = wagonsAtStationByCargo(train, station);
    return consistCargos(train).every((c) => loadOf(train, c) >= (at.get(c) ?? 0) * CARGOS[c].wagonCapacity);
  }

  // Vlak stojí před tratí obsazenou jiným vlakem
  isBlocked(train: Train): boolean {
    return this.blocked.has(train.id);
  }

  // Nástupiště z jízdního řádu, která jsou kratší než souprava
  shortStations(train: Train): Station[] {
    const length = trainLength(train);
    // Ve spojené stanici stačí jedno dost dlouhé nástupiště (vlak si ho vybere)
    return stationOrders(train)
      .map((id) => this.station(id))
      .filter(
        (s, i, all): s is Station =>
          s !== undefined && all.indexOf(s) === i && this.platformsOf(s).every((part) => part.length < length),
      );
  }

  stationName(id: number): string {
    return this.station(id)?.name ?? '?';
  }

  // Důvod, proč z dlaždic nejde sundat trolejové vedení (stojí na nich elektrický vlak), nebo null
  electricBlocker(tiles: readonly { x: number; y: number }[]): string | null {
    const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
    for (const train of this.trains) {
      if (!trainModel(train).electric) continue;
      if (train.state === 'depot') {
        const depot = this.depot(train);
        if (depot && keys.has(`${depot.x},${depot.y}`)) return `V depu stojí elektrický vlak ${train.name}.`;
        continue;
      }
      if (this.body(train).some((s) => keys.has(`${s.x},${s.y}`)))
        return `Pod vedením stojí elektrický vlak ${train.name}.`;
    }
    return null;
  }

  // Důvod, proč dlaždici nejde zbourat, nebo null
  demolitionBlocker(x: number, y: number): string | null {
    for (const train of this.trains) {
      if (train.state !== 'depot' && this.body(train).some((s) => !s.span && s.x === x && s.y === y)) {
        return `Na koleji stojí ${train.name}.`;
      }
      const depot = this.depot(train);
      if (depot && depot.x === x && depot.y === y) return `Depo patří vlaku ${train.name}.`;
      // Řád vlaku v depu se po demolici jen zkrátí
      if (train.state === 'depot') continue;
      for (const [i, id] of (train.orders ?? []).entries()) {
        if (orderFlags(train, i).depot) {
          const d = this.depotById(id);
          if (d && d.x === x && d.y === y) return `Depo ${d.id + 1} je v jízdním řádu vlaku ${train.name}.`;
          continue;
        }
        if (orderFlags(train, i).waypoint) {
          const w = this.waypointById(id);
          if (w && w.x === x && w.y === y) return `Průjezdný bod ${w.name} je v jízdním řádu vlaku ${train.name}.`;
          continue;
        }
        const s = this.station(id);
        if (s && stationTiles(s).some((t) => t.x === x && t.y === y)) {
          return `Nástupiště ${s.name} obsluhuje ${train.name}.`;
        }
      }
    }
    return null;
  }

  private move(train: Train, days: number): void {
    const model = trainModel(train);
    const { reservations } = this;
    const pathEnd = pathLength(train.path);
    // Rezervace musí sahat aspoň na brzdnou dráhu a krok tohoto snímku před hlavu
    const needed = train.pos + (model.speed * model.speed) / (2 * DECELERATION) + model.speed * days + 1;
    // Stanicí „projet“ vlak nezastaví: cestu k dalšímu příkazu naváže včas před jejím koncem
    if (
      (this.targetFlags(train).via || this.targetFlags(train).waypoint) &&
      pathEnd - train.pos < needed - train.pos + 1
    )
      this.chainVia(train);
    const reserve = (): void => {
      while (!reservations.fullyReserved(train) && reservations.limit(train) < needed && reservations.extend(train));
    };
    reserve();
    // Další úsek drží jiný vlak: jako cestové návěstidlo zkusí hned volnou cestu (jinou kolej nástupiště, výhybnu)
    if (!reservations.fullyReserved(train) && reservations.limit(train) < needed && this.detour(train)) reserve();
    const limit = Math.min(pathEnd, reservations.limit(train));
    const remaining = Math.max(0, limit - train.pos);
    const brakeLimit = Math.sqrt(2 * DECELERATION * remaining);
    // Do kopce vlak postupně zpomalí na rychlost, kterou ve stoupání utáhne; z kopce rychleji zrychlí
    const climb = trainClimb(train, this.game.world.rail);
    const top = hillSpeed(train, this.game.world.rail, model.speed);
    const accel = ACCELERATION * (climb < 0 ? 1.5 : 1);
    train.speed =
      train.speed > top ? Math.max(top, train.speed - DECELERATION * days) : Math.min(train.speed + accel * days, top);
    train.speed = Math.min(train.speed, brakeLimit);
    // Minimální rychlost, aby brzdění vlak nezastavilo těsně před cílem
    train.speed = Math.max(train.speed, 0.15);
    const step = train.speed * days;
    const before = segmentIndexAt(train.path, train.pos);
    if (step < remaining) {
      train.pos += step;
      this.addTiles(train, tilesPassed(train.path, before, segmentIndexAt(train.path, train.pos)));
      this.blocked.delete(train.id);
      reservations.sync(train, this.tail(train));
      return;
    }
    train.pos += remaining;
    this.addTiles(train, tilesPassed(train.path, before, segmentIndexAt(train.path, Math.max(0, train.pos - 1e-6))));
    train.speed = 0;
    if (limit < pathEnd - 1e-6) {
      reservations.sync(train, this.tail(train));
      this.wait(train, days);
      return;
    }
    this.blocked.delete(train.id);
    this.arrive(train);
  }

  // Naváže cestu za stanicí „projet“ k dalšímu příkazu bez otáčení; když to nejde, vlak ve stanici jen zastaví
  private chainVia(train: Train): void {
    if (!train.orders || this.viaFailed.get(train.id) === train.target) return;
    const next = nextStop(train);
    const goal = this.orderGoal(train, next);
    const last = train.path[train.path.length - 1];
    const route = goal && last ? this.routeTo(segmentStart(last), goal, train) : null;
    if (!route) {
      this.viaFailed.set(train.id, train.target);
      return;
    }
    this.viaFailed.delete(train.id);
    train.path = [...train.path, ...route];
    train.target = next;
  }

  // Přesměruje zbytek cesty za koncem rezervace mimo koleje držené jinými vlaky; vrací true při změně
  private detour(train: Train): boolean {
    const now = this.game.clock.now;
    if (now - (this.detourTried.get(train.id) ?? -Infinity) < DETOUR_RETRY_DAYS) return false;
    this.detourTried.set(train.id, now);
    const reach = this.reservations.reached(train);
    const goal = this.goal(train);
    if (!goal || reach <= 0 || reach >= train.path.length) return false;
    const blocked = this.reservations.blockerOf(train);
    if (blocked === undefined) return false;
    const route = this.findGoal(segmentStart(train.path[reach - 1]), goal, this.avoidFor(train, goal), train);
    if (!route) return false;
    const current = pathLength(train.path.slice(reach));
    if (pathLength(route) > current * DETOUR_MAX_RATIO + DETOUR_MAX_EXTRA) return false;
    train.path = [...train.path.slice(0, reach), ...route];
    return true;
  }

  // Stojí před obsazenou tratí; občas zkusí jinou cestu a po delší době varuje hráče
  private wait(train: Train, days: number): void {
    const state = this.blocked.get(train.id) ?? { total: 0, sinceReplan: 0, deadlockWarned: false };
    const warned = state.total >= BLOCKED_WARN_DAYS;
    state.total += days;
    state.sinceReplan += days;
    this.blocked.set(train.id, state);
    if (!state.deadlockWarned && state.total >= BLOCKED_REPLAN_DAYS) {
      const cycle = this.deadlockCycle(train);
      if (cycle) {
        for (const t of cycle) this.blocked.get(t.id)!.deadlockWarned = true;
        this.game.news(
          `${cycle.map((t) => t.name).join(' a ')} se navzájem blokují – na jednokolejné trati se nemají kde minout. ` +
            'Postavte výhybnu (druhou kolej s návěstidly) nebo dvoukolejné nástupiště.',
          this.position(train),
        );
        return;
      }
    }
    if (!warned && !state.deadlockWarned && state.total >= BLOCKED_WARN_DAYS) {
      this.game.news(
        `${train.name} už měsíc čeká na volnou trať – jednokolejka potřebuje výhybny nebo víc kolejí.`,
        this.position(train),
      );
    }
    if (state.sinceReplan >= BLOCKED_REPLAN_DAYS) {
      state.sinceReplan = 0;
      this.replan(train);
    }
  }

  // Vlaky, které na sebe čekají v kruhu (A čeká na B, B na A…); bez pomoci hráče se nepohnou
  private deadlockCycle(train: Train): Train[] | null {
    const cycle: Train[] = [train];
    let current = train;
    for (let i = 0; i < this.trains.length; i++) {
      const id = this.reservations.blockerOf(current);
      const next = this.trains.find((t) => t.id === id);
      if (!next || !this.blocked.has(next.id)) return null;
      if (next === train) return cycle;
      if (cycle.includes(next)) return null;
      cycle.push(next);
      current = next;
    }
    return null;
  }

  private tail(train: Train): number {
    return train.pos - trainLength(train);
  }

  private arrive(train: Train): void {
    this.trimToBody(train);
    if (train.servicing && train.target !== -1) {
      // Automatický servis: vlak zajede do depa a po chvíli pokračuje v řádu
      const depot = this.depotById(train.servicing.depotId);
      train.state = 'depot';
      train.path = [];
      this.reservations.release(train);
      if (depot) train.depotId = depot.id;
      service(train, trainModel(train).reliability, this.game.clock.now);
      train.serviceUntil = this.game.clock.now + SERVICE_DAYS;
    } else if (train.target === -1) {
      service(train, trainModel(train).reliability, this.game.clock.now);
      train.state = 'depot';
      train.path = [];
      this.reservations.release(train);
      // Náklad zůstává ve vlaku a po výjezdu ho vlak vyloží na další zastávce
      const load = totalLoad(train) > 0 ? ` s nákladem ${formatLoad(train)}` : '';
      this.game.news(`${train.name} dorazil do depa${load}.`, this.position(train));
      if (train.renewing) this.finishRenewal(train);
    } else if (this.targetFlags(train).depot) {
      // Servis v depu podle řádu: vlak zajede dovnitř a po chvíli pokračuje dalším příkazem
      this.recordArrival(train);
      const depot = this.goal(train) as Depot | null;
      train.state = 'depot';
      train.path = [];
      this.reservations.release(train);
      if (depot) train.depotId = depot.id;
      service(train, trainModel(train).reliability, this.game.clock.now);
      train.serviceUntil = this.game.clock.now + SERVICE_DAYS;
    } else {
      train.state = 'loading';
      const flags = this.targetFlags(train);
      // Projetí stanicí nebo průjezdným bodem bez navázané cesty: jen krátké zastavení bez nakládky a vykládky
      const passing = flags.via === true || flags.waypoint === true;
      train.waitDays = passing ? 0 : TRAIN_LOADING_DAYS;
      this.reservations.reset(train, this.tail(train));
      const station = this.goal(train);
      // Pobyt se prodlouží podle množství vyloženého a naloženého nákladu
      if (station && isStation(station) && !passing) {
        train.waitDays += this.exchange(train, this.platformAt(train, station)) / LOADING_PER_DAY;
        // Jízdní řád s časy: stání aspoň podle plánu; kdo přijel dřív, počká, aby odjel včas
        const early = this.recordArrival(train);
        if (flags.wait !== undefined) train.waitDays = Math.max(train.waitDays, flags.wait);
        train.waitDays += early;
      }
    }
    this.changed();
  }

  // Příjezd k příkazu: zapíše naměřenou dobu jízdy, s automatickým vyplňováním i do plánu, a spočítá zpoždění.
  // Vrací, o kolik dní vlak přijel dřív než podle plánu (tolik počká)
  private recordArrival(train: Train): number {
    if (train.departedAt === undefined || !train.orders || train.target < 0) return 0;
    const index = train.target;
    const measured = Math.round((this.game.clock.now - train.departedAt) * 10) / 10;
    train.departedAt = undefined;
    const last = [...(train.lastTravel ?? [])];
    while (last.length < train.orders.length) last.push(null);
    last[index] = measured;
    train.lastTravel = last.slice(0, train.orders.length);
    if (train.autofill) this.setTimetable(train, index, { travel: measured });
    const planned = orderFlags(train, index).travel;
    if (planned === undefined) return 0;
    const lateness = Math.round((measured - planned) * 10) / 10;
    train.lateness = Math.max(0, lateness);
    return Math.max(0, -lateness);
  }

  // Plánovaná doba jízdy nebo stání u příkazu (u sdíleného řádu pro celou linku); null smaže
  setTimetable(train: Train, index: number, patch: { travel?: number | null; wait?: number | null }): void {
    if (!train.orders || index < 0 || index >= train.orders.length) return;
    for (const member of this.lineOf(train)) {
      const next = [...member.orderFlags];
      while (next.length < member.orders!.length) next.push({});
      const flags = { ...(next[index] ?? {}) };
      if (patch.travel !== undefined) flags.travel = patch.travel ?? undefined;
      if (patch.wait !== undefined) flags.wait = patch.wait ?? undefined;
      next[index] = cleanFlags(flags);
      member.orderFlags = next;
    }
    this.changed();
  }

  // Smaže všechny časy z řádu (u linky pro všechny její vlaky) i zpoždění
  clearTimetable(train: Train): void {
    for (const member of this.lineOf(train)) {
      member.orderFlags = member.orderFlags.map((f) => cleanFlags({ ...f, travel: undefined, wait: undefined }));
      member.lateness = undefined;
    }
    this.changed();
  }

  setAutofill(train: Train, on: boolean): void {
    train.autofill = on || undefined;
    this.changed();
  }

  private exchange(train: Train, station: Station, loadOnly = false): number {
    const flags = this.targetFlags(train);
    const options = { unload: flags.unload, load: flags.load === 'none' ? ('none' as const) : undefined };
    // Přestavba: nejdřív vyložit dosavadní náklad, pak přestavět prázdné vagony a naložit nový
    if (flags.refit && wagonCargos(train).some((c) => c !== flags.refit) && !loadOnly) {
      const unloaded = this.transfer(train, station, false, { ...options, load: 'none' });
      // Bez přestavby (zbylý náklad, chybí peníze) vlak doloží, co veze
      if (this.refitAtStation(train, flags.refit, station)) this.changed();
      return unloaded + this.transfer(train, station, true, options);
    }
    return this.transfer(train, station, loadOnly, options);
  }

  // Vyložení a naložení nákladu, který vlak právě veze
  private transfer(
    train: Train,
    station: Station,
    loadOnly: boolean,
    options: { unload?: OrderFlags['unload']; load?: 'none' },
  ): number {
    const at = wagonsAtStationByCargo(train, station);
    let moved = 0;
    // Každý druh nákladu soupravy zvlášť; vagony jiného druhu se chovají jako samostatné vozidlo
    for (const cargo of consistCargos(train)) {
      const state = loadState(train, cargo);
      if (!state) continue;
      const hold = {
        atPlatform: (at.get(cargo) ?? 0) * CARGOS[cargo].wagonCapacity,
        capacity: cargoCapacity(train, cargo),
        speed: trainModel(train).speed,
        next: nextStationStop(train, station.id),
      };
      const carrier = cargo === train.cargo ? train : { ...state, name: train.name, income: 0 };
      moved += isFreight(cargo)
        ? this.game.freight.exchange(carrier, hold, station, cargo, loadOnly, options)
        : this.game.passengers.exchange(carrier, hold, station, loadOnly, options);
      if (carrier !== train) {
        const { name: _name, income, ...rest } = carrier;
        Object.assign(state, rest);
        // Smazané cíle (vše vyloženo) Object.assign nepřenese
        if (!rest.dests) delete state.dests;
        train.income += income;
      }
    }
    return moved;
  }

  // Ujeté dlaždice pro jízdné všech druhů nákladu na palubě
  private addTiles(train: Train, tiles: number): void {
    train.tiles += tiles;
    for (const hold of train.holds ?? []) hold.tiles += tiles;
  }

  // Naplánuje cestu k dalšímu cíli; vlak může pokračovat vpřed, nebo se otočit
  private replan(train: Train): void {
    if (train.state === 'loading' && train.orders && train.target !== -1) {
      train.target = nextStop(train);
      train.departedAt = this.game.clock.now;
    }
    const goal = this.goal(train);
    if (!goal) {
      this.lose(train);
      return;
    }

    const body = this.body(train);
    const offset = train.pos - trainLength(train) - this.bodyStart(train);
    const forward = this.routeTo(segmentStart(body[body.length - 1]), goal, train);
    const reversed = body.map(reverseSegment).reverse();
    // Ve stanici nebo bez cesty vpřed se vlak může otočit
    const canReverse = train.state !== 'running' || !forward;
    const backward = canReverse ? this.routeTo(segmentStart(reversed[reversed.length - 1]), goal, train) : null;

    const useBackward = backward && (!forward || pathLength(backward) < pathLength(forward));
    if (useBackward) {
      train.path = [...reversed, ...backward];
      // Lokomotiva přejede na druhý konec soupravy a vlak vyjede jí napřed
      train.pos = pathLength(body) - Math.max(0, offset);
      train.speed = 0;
    } else if (forward) {
      const keep = pathLength(train.path.slice(0, train.path.indexOf(body[0])));
      train.path = [...body, ...forward];
      train.pos -= keep;
    } else if (train.state !== 'running' && this.standsAt(train, goal)) {
      // Ztracený vlak už stojí na nástupišti, kam má jet (např. po změně řádu)
      this.arrive(train);
      return;
    } else {
      this.lose(train);
      return;
    }
    train.state = 'running';
    this.reservations.reset(train, this.tail(train));
    this.changed();
  }

  private standsAt(train: Train, goal: Goal): boolean {
    if (!isStation(goal)) return false;
    const body = this.body(train);
    const head = body[body.length - 1];
    return this.game.world.rail.stationAt(head.x, head.y)?.id === goal.id;
  }

  private lose(train: Train): void {
    if (train.state !== 'lost') {
      const goal = this.goal(train);
      const where = !goal
        ? ''
        : 'entrance' in goal
          ? ' do depa'
          : 'waypoint' in goal
            ? ` přes průjezdný bod ${goal.name}`
            : ` do stanice ${goal.name}`;
      // Elektrická lokomotiva: koleje k cíli vedou (stejná kolejová síť), jen někde chybí trolejové vedení
      const body = this.body(train);
      const head = body[body.length - 1];
      const network = head ? this.networkAt(head.x, head.y) : -1;
      const wires =
        goal && trainModel(train).electric && network >= 0 && network === this.networkAt(goal.x, goal.y)
          ? ' – trať nemá všude trolejové vedení (nástroj Elektrizace)'
          : '';
      this.game.news(`${train.name} nemůže najít cestu${where}${wires}.`, this.position(train));
    }
    train.state = 'lost';
    train.speed = 0;
    train.waitDays = LOST_RETRY_DAYS;
    this.changed();
  }

  private goal(train: Train): Goal | null {
    if (train.target === -1) return this.depot(train) ?? null;
    if (train.servicing) return this.depotById(train.servicing.depotId) ?? null;
    return this.orderGoal(train, train.target);
  }

  // Cíl příkazu řádu: nástupiště, depo u příkazu na servis, nebo průjezdný bod
  private orderGoal(train: Train, index: number): Goal | null {
    if (!train.orders || index < 0 || index >= train.orders.length) return null;
    return this.placeOf(train.orders, train.orderFlags, index) ?? null;
  }

  private placeOf(orders: readonly number[], flags: readonly OrderFlags[], index: number): Goal | undefined {
    const id = orders[index];
    if (flags[index]?.depot) return this.depotById(id);
    if (flags[index]?.waypoint) return this.waypointById(id);
    return this.station(id);
  }

  waypointById(id: number): Waypoint | undefined {
    return this.game.world.rail.waypoints.find((w) => w.id === id);
  }

  // Přednostně trasa mimo koleje jiných vlaků (např. volná kolej nástupiště), jinak nejkratší a vlak počká
  private routeTo(start: RouteStart, goal: Goal, train?: Train): Segment[] | null {
    const avoid = train ? this.avoidFor(train, goal) : undefined;
    return (avoid && this.findGoal(start, goal, avoid, train)) || this.findGoal(start, goal, undefined, train);
  }

  // Cizí rezervace; u cílového nástupiště celá kolej, na které už stojí jiný vlak –
  // trasa končí až na konci nástupiště, takže by vlak volnou první dlaždici ke koleji nepomohla
  private avoidFor(train: Train, goal: Goal): (x: number, y: number) => boolean {
    const blocked = (x: number, y: number): boolean => this.reservations.blocks(train, x, y);
    if (!isStation(goal)) return blocked;
    const width = this.game.world.map.width;
    // Koleje všech nástupišť spojené stanice; obsazená kolej se vynechá celá, stejně jako nástupiště
    // kratší než souprava, je-li ve stanici dost dlouhé
    const parts = this.platformsOf(goal);
    const length = trainLength(train);
    const long = parts.filter((part) => part.length >= length);
    const short = new Set(long.length > 0 ? parts.filter((part) => part.length < length).map((part) => part.id) : []);
    const rows = new Map<string, { x: number; y: number }[]>();
    for (const part of parts) {
      for (const t of stationTiles(part)) {
        const row = `${part.id}:${part.axis === 'x' ? t.y : t.x}`;
        rows.set(row, [...(rows.get(row) ?? []), t]);
      }
    }
    const occupied = new Set<number>();
    for (const [key, row] of rows) {
      const part = Number(key.split(':')[0]);
      if (short.has(part) || row.some((t) => blocked(t.x, t.y))) for (const t of row) occupied.add(t.y * width + t.x);
    }
    return (x, y) => blocked(x, y) || occupied.has(y * width + x);
  }

  // Trasa k cíli; elektrická lokomotiva jen po elektrizované trati (jako druhy kolejí v OpenTTD)
  private findGoal(
    start: RouteStart,
    goal: Goal,
    soft?: (x: number, y: number) => boolean,
    train?: Train,
  ): Segment[] | null {
    const { rail } = this.game.world;
    const electric = train !== undefined && trainModel(train).electric === true;
    const avoid = electric ? (x: number, y: number) => soft?.(x, y) || !rail.isElectrified(x, y) : soft;
    if (!isStation(goal)) {
      return findRoute(rail, start, (x, y) => x === goal.x && y === goal.y, goal, avoid);
    }
    // Jako v OpenTTD jede vlak ke stanici: zastaví u kterékoli koleje kteréhokoli nástupiště spojené stanice
    const ids = new Set(this.platformsOf(goal).map((s) => s.id));
    const route = findRoute(rail, start, (x, y) => ids.has(rail.stationAt(x, y)?.id ?? -1), goal, avoid);
    if (!route) return null;
    const last = route[route.length - 1];
    return extendThroughStation(rail, route, rail.stationAt(last.x, last.y) ?? goal);
  }

  // Nástupiště spojené stanice, ke které patří část goal (u samostatné stanice jen ona)
  private platformsOf(goal: Station): Station[] {
    if (goal.kind !== undefined) return [goal];
    const { rail } = this.game.world;
    const type = rail.railTypeAt(goal.x, goal.y);
    const members = rail.membersOf(goal).filter((s) => s.kind === undefined && rail.railTypeAt(s.x, s.y) === type);
    return members.some((s) => s.id === goal.id) ? members : [goal];
  }

  // Nástupiště, u kterého vlak stojí (hlava soupravy), pokud patří ke stanici goal; jinak goal
  private platformAt(train: Train, goal: Station): Station {
    const head = train.path[segmentIndexAt(train.path, Math.max(0, train.pos - 1e-6))];
    const here = head && this.game.world.rail.stationAt(head.x, head.y);
    return here && this.platformsOf(goal).includes(here) ? here : goal;
  }

  // Kusy koleje, na kterých souprava právě stojí
  private body(train: Train): Segment[] {
    const tail = train.pos - trainLength(train);
    const body: Segment[] = [];
    let d = 0;
    for (const s of train.path) {
      const len = segmentLength(s);
      if (d + len > tail && d < train.pos) body.push(s);
      d += len;
      if (d >= train.pos) break;
    }
    return body.length > 0 ? body : train.path.slice(0, 1);
  }

  private bodyStart(train: Train): number {
    const first = this.body(train)[0];
    return pathLength(train.path.slice(0, train.path.indexOf(first)));
  }

  private trimToBody(train: Train): void {
    const start = this.bodyStart(train);
    train.path = train.path.slice(train.path.indexOf(this.body(train)[0]));
    train.pos -= start;
  }

  // Po změně kolejí ověří trasy jedoucích vlaků a případně je přeplánuje
  private revalidate(): void {
    const { rail } = this.game.world;
    for (const train of this.trains) {
      // Vlak v depu zapomene zbořená nástupiště
      if (train.state === 'depot' && train.orders) {
        const keep = train.orders.map((_, i) => this.orderGoal(train, i) !== null);
        const kept = train.orders.filter((_, i) => keep[i]);
        train.orderFlags = train.orderFlags.filter((_, i) => keep[i]);
        train.orders = kept.length > 0 ? kept : null;
        if (!train.orders) train.serviceUntil = undefined;
        else if (train.target >= train.orders.length) train.target = 0;
      }
      if (train.servicing && !this.depotById(train.servicing.depotId)) train.servicing = undefined;
      if (train.state !== 'running') continue;
      // Před hlavou vlaku nesmí nově stát jednosměrné návěstidlo proti směru jízdy
      const head = segmentIndexAt(train.path, Math.max(0, train.pos - 1e-6));
      const againstSignal = train.path.some(
        (s, i) => i > head && !s.span && !rail.allowsExit(s.x, s.y, s.piece, s.exit),
      );
      // Elektrický vlak musí přeplánovat, když mu na cestě zmizelo trolejové vedení
      const lostWires =
        trainModel(train).electric === true &&
        train.path.some((s, i) => i > head && !s.span && !rail.isElectrified(s.x, s.y));
      if (!this.goal(train) || againstSignal || lostWires || !train.path.every((s) => segmentStillExists(rail, s))) {
        this.replan(train);
      }
    }
  }

  private finishRenewal(train: Train): void {
    train.renewing = false;
    const error = this.renew(train) ?? (train.orders ? this.start(train, train.orders) : null);
    if (error) this.game.news(`${train.name}: ${error}`);
  }

  private chargeRunningCosts(): void {
    const today = this.game.clock.day;
    for (const train of this.trains) {
      const monthly = yearlyRunningCost(train, today) / 12;
      this.game.spend(monthly, 'running');
      train.costs += monthly;
      if (!isOld(train, today)) continue;
      const affordable = this.game.money >= this.renewalOffer(train).cost;
      if (this.game.autoRenew && affordable && train.state !== 'depot' && !train.renewing) {
        this.requestRenewal(train);
        this.game.news(`${train.name} jede do depa na automatickou obnovu.`, this.position(train));
      } else if (!train.agingWarned) {
        train.agingWarned = true;
        this.game.news(
          `${train.name} dosáhl konce životnosti – provoz je dražší, zvažte obnovu.`,
          this.position(train),
        );
      }
    }
  }

  // Kde vlak právě je: hlava soupravy, ve stojícím v depu depo
  private position(train: Train): { x: number; y: number } | undefined {
    if (train.state !== 'depot' && train.path.length > 0) {
      const [x, y] = pointAt(train.path, train.pos);
      return { x, y };
    }
    const depot = this.depot(train);
    return depot && { x: depot.x + 0.5, y: depot.y + 0.5 };
  }

  private depot(train: Train): Depot | undefined {
    return this.depotById(train.depotId);
  }

  depotById(id: number): Depot | undefined {
    return this.game.world.rail.depots.find((d) => d.id === id);
  }

  private station(id: number): Station | undefined {
    return this.game.world.rail.stations.find((s) => s.id === id && s.kind === undefined);
  }

  private changed(): void {
    this.game.events.emit('trainsChanged');
  }
}
