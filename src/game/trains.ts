import {
  MAX_WAGONS,
  OLD_TRAIN_COST_FACTOR,
  TRAIN_LIFETIME_YEARS,
  TRAIN_LOADING_DAYS,
  TRAIN_MIN_SELL,
  TRAIN_MODELS,
  TRAIN_SELL_REFUND,
  VEHICLE_LENGTH,
  WAGON_CAPACITY,
  WAGON_PRICE,
  WAGON_RUNNING_COST,
  type TrainModel,
} from './balance';
import { formatMoney, type Game } from './game';
import { CARGOS, isFreight, type Cargo } from './cargo';
import { Reservations } from './reservations';
import { axisPiece, opposite, stationTiles, type Depot, type Station, type StationShape } from '../world/rail';
import {
  extendThroughStation,
  findRoute,
  pathLength,
  pointAt,
  reverseSegment,
  segmentLength,
  segmentIndexAt,
  segmentStart,
  segmentStillExists,
  type RouteStart,
  type Segment,
} from '../world/route';

// Zrychlení a brzdění v dlaždicích za den za den
const ACCELERATION = 2;
const DECELERATION = 2;
// Vlak bez cesty to zkusí znovu po této době
const LOST_RETRY_DAYS = 5;
// Vlak čekající na obsazenou trať po této době hledá jinou cestu (třeba volnou kolej nástupiště)
const BLOCKED_REPLAN_DAYS = 3;
const BLOCKED_WARN_DAYS = 30;
// Vlak čekající na plné naložení zkusí doplnit náklad jednou denně
const FULL_LOAD_CHECK_DAYS = 1;

export type TrainState = 'depot' | 'running' | 'loading' | 'lost';

export interface Train {
  id: number;
  name: string;
  modelId: string;
  wagons: number;
  // Všechny vagony vlaku vezou stejný druh nákladu
  cargo: Cargo;
  depotId: number;
  // Zastávky, které vlak objíždí dokola; v depu si je pamatuje pro další výjezd
  orders: number[] | null;
  // Zastávky (id nástupišť), kde vlak čeká na plné naložení
  fullLoad: number[];
  // Index cíle v orders, -1 = návrat do depa
  target: number;
  state: TrainState;
  // Kusy koleje pod vlakem a trasa před ním; hlava je ve vzdálenosti pos od začátku
  path: Segment[];
  pos: number;
  speed: number;
  waitDays: number;
  // Lokomotiva je na konci soupravy (po otočení směru jízdy)
  flipped: boolean;
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
  // Herní den nákupu nebo poslední obnovy
  builtDay: number;
  // Hráč už dostal zprávu o konci životnosti
  agingWarned: boolean;
  // Po příjezdu do depa se obnoví a vyjede podle jízdního řádu
  renewing: boolean;
}

const DAYS_PER_YEAR = 365.25;

export function trainModel(train: Train): TrainModel {
  return TRAIN_MODELS.find((m) => m.id === train.modelId)!;
}

export function trainLength(train: Train): number {
  return (train.wagons + 1) * VEHICLE_LENGTH;
}

// Náklad na palubě a kapacita, např. „12 / 60 cestujících“ nebo „60 / 60 t uhlí“
export function formatLoad(train: Train): string {
  return `${train.passengers} / ${train.wagons * WAGON_CAPACITY} ${CARGOS[train.cargo].unit}`;
}

// Vagony stojící na nástupišti; jen ty nakládají a vykládají
export function wagonsAtStation(train: Train, station: StationShape): number {
  const tiles = new Set(stationTiles(station).map((t) => `${t.x},${t.y}`));
  const vehicles = train.wagons + 1;
  // Po otočení směru jízdy je lokomotiva na konci soupravy
  const locomotive = train.flipped ? vehicles - 1 : 0;
  let count = 0;
  for (let i = 0; i < vehicles; i++) {
    if (i === locomotive) continue;
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

// Index zastávky, kam vlak pojede po té aktuální
export function nextStop(train: Train): number {
  return train.orders ? (train.target + 1) % train.orders.length : -1;
}

// Chyba jízdního řádu, nebo null; stejná zastávka nesmí následovat po sobě ani přes konec seznamu
export function ordersError(orders: number[]): string | null {
  if (orders.length < 2) return 'Jízdní řád potřebuje aspoň dvě zastávky.';
  if (orders.some((id, i) => id === orders[(i + 1) % orders.length])) {
    return 'Stejné nástupiště nesmí následovat hned po sobě.';
  }
  return null;
}

// Vlaky společnosti: nákup, jízdní řád a pohyb po kolejích
export class Fleet {
  readonly trains: Train[] = [];
  nextId = 1;
  readonly reservations: Reservations;
  // Jak dlouho vlak stojí před obsazenou tratí: celkem a od posledního hledání jiné cesty
  private readonly blocked = new Map<number, { total: number; sinceReplan: number }>();

  constructor(private readonly game: Game) {
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

  available(): TrainModel[] {
    return TRAIN_MODELS.filter((m) => m.year <= this.game.clock.date.year);
  }

  inDepot(depot: Depot): Train[] {
    return this.trains.filter((t) => t.depotId === depot.id);
  }

  buy(depot: Depot, model: TrainModel): string | null {
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
      fullLoad: [],
      target: 0,
      state: 'depot',
      path: [],
      pos: 0,
      speed: 0,
      waitDays: 0,
      flipped: false,
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
    });
    this.changed();
    return null;
  }

  addWagon(train: Train): string | null {
    if (train.state !== 'depot') return 'Vagony lze měnit jen v depu.';
    if (train.wagons >= MAX_WAGONS) return `Vlak může mít nejvýš ${MAX_WAGONS} vagonů.`;
    if (this.game.money < WAGON_PRICE) return `Nedostatek peněz (${formatMoney(WAGON_PRICE)}).`;
    this.game.spend(WAGON_PRICE, 'vehicles');
    train.wagons++;
    this.changed();
    return null;
  }

  removeWagon(train: Train): void {
    if (train.state !== 'depot' || train.wagons === 0) return;
    train.wagons--;
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
  renewalOffer(train: Train): { model: TrainModel; cost: number } {
    const models = this.available();
    const model = models[models.length - 1];
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

  // Vypraví vlak z depa; nejdřív jede k nejbližší zastávce jízdního řádu
  start(train: Train, orders: number[]): string | null {
    const error = ordersError(orders);
    if (error) return error;
    const depot = this.depot(train);
    const stations = orders.map((id) => this.station(id));
    if (!depot || stations.some((s) => !s)) return 'Nástupiště nebo depo neexistuje.';

    const exitSegment: Segment = {
      x: depot.x,
      y: depot.y,
      piece: axisPiece(depot.entrance % 2 === 0 ? 'y' : 'x'),
      entry: opposite(depot.entrance),
      exit: depot.entrance,
    };
    const routes = stations.map((s) => this.routeTo(segmentStart(exitSegment), s!, train));
    const options = routes
      .map((route, index) => ({ route, index }))
      .filter((o): o is { route: Segment[]; index: number } => o.route !== null)
      .sort((a, b) => pathLength(a.route) - pathLength(b.route));
    if (options.length === 0) return 'Z depa nevede kolej k vybraným nástupištím.';

    train.orders = orders;
    train.target = options[0].index;
    train.path = [exitSegment, ...options[0].route];
    // Hlava ve středu depa, zbytek soupravy je ještě uvnitř
    train.pos = 0.5;
    train.speed = 0;
    train.flipped = false;
    train.state = 'running';
    this.reservations.reset(train, this.tail(train));
    this.changed();
    return null;
  }

  // Změna druhu nákladu jen v depu, kde je vlak prázdný
  setCargo(train: Train, cargo: Cargo): string | null {
    if (train.state !== 'depot') return 'Druh nákladu lze změnit jen v depu.';
    train.cargo = cargo;
    this.changed();
    return null;
  }

  // Zapne nebo vypne čekání na plné naložení na zastávce
  toggleFullLoad(train: Train, stationId: number): void {
    const waits = train.fullLoad.includes(stationId);
    train.fullLoad = waits ? train.fullLoad.filter((id) => id !== stationId) : [...train.fullLoad, stationId];
    this.changed();
  }

  // Změní jízdní řád i za jízdy; vlak pokračuje k aktuálnímu cíli, pokud v řádu zůstal.
  // V depu smí být řád rozpracovaný, ověří se až při výjezdu.
  setOrders(train: Train, orders: number[]): string | null {
    const error = train.state === 'depot' ? null : ordersError(orders);
    if (error) return error;
    if (orders.some((id) => !this.station(id))) return 'Nástupiště neexistuje.';
    const current = train.orders && train.target >= 0 ? train.orders[train.target] : null;
    train.orders = orders.length > 0 ? orders : null;
    train.fullLoad = train.fullLoad.filter((id) => orders.includes(id));
    if (train.target !== -1 && train.state !== 'depot') {
      const kept = current === null ? -1 : orders.indexOf(current);
      // Ve stanici se po nástupu posune na další zastávku, tedy na začátek řádu
      train.target = kept >= 0 ? kept : train.state === 'loading' ? orders.length - 1 : 0;
      if (kept < 0 && train.state === 'running') this.replan(train);
    }
    this.changed();
    return null;
  }

  sendToDepot(train: Train): void {
    if (train.state === 'depot') return;
    train.target = -1;
    if (train.state === 'running' || train.state === 'lost') this.replan(train);
    this.changed();
  }

  update(days: number): void {
    if (days <= 0) return;
    for (const train of this.trains) {
      if (train.state === 'depot') continue;
      // Po načtení hry rezervace neexistují, vlak si znovu vezme koleje pod sebou
      if (!this.reservations.has(train)) this.reservations.reset(train, this.tail(train));
      if (train.state === 'running') this.move(train, days);
      else {
        train.waitDays -= days;
        if (train.waitDays > 0) continue;
        if (this.fillingUp(train)) train.waitDays = FULL_LOAD_CHECK_DAYS;
        else this.replan(train);
      }
    }
  }

  // Vlak, který na zastávce čeká na plné naložení, ale ještě není plný
  isFillingUp(train: Train): boolean {
    const station = this.loadingStation(train);
    return station !== null && train.fullLoad.includes(station.id) && !this.isFull(train, station);
  }

  // Doloží náklad; vrací true, když má vlak dál čekat
  private fillingUp(train: Train): boolean {
    const station = this.loadingStation(train);
    if (!station || !train.fullLoad.includes(station.id)) return false;
    this.exchange(train, station, true);
    this.changed();
    return !this.isFull(train, station);
  }

  private loadingStation(train: Train): Station | null {
    if (train.state !== 'loading' || train.target === -1 || !train.orders) return null;
    return this.station(train.orders[train.target]) ?? null;
  }

  // Plné jsou všechny vagony, které stojí u nástupiště – ostatní naložit nejdou
  private isFull(train: Train, station: Station): boolean {
    const loadable = Math.min(train.wagons, wagonsAtStation(train, station)) * WAGON_CAPACITY;
    return train.passengers >= loadable;
  }

  // Vlak stojí před tratí obsazenou jiným vlakem
  isBlocked(train: Train): boolean {
    return this.blocked.has(train.id);
  }

  // Nástupiště z jízdního řádu, která jsou kratší než souprava
  shortStations(train: Train): Station[] {
    const length = trainLength(train);
    return (train.orders ?? [])
      .map((id) => this.station(id))
      .filter((s, i, all): s is Station => s !== undefined && s.length < length && all.indexOf(s) === i);
  }

  stationName(id: number): string {
    return this.station(id)?.name ?? '?';
  }

  // Důvod, proč dlaždici nejde zbourat, nebo null
  demolitionBlocker(x: number, y: number): string | null {
    for (const train of this.trains) {
      if (train.state !== 'depot' && this.body(train).some((s) => s.x === x && s.y === y)) {
        return `Na koleji stojí ${train.name}.`;
      }
      const depot = this.depot(train);
      if (depot && depot.x === x && depot.y === y) return `Depo patří vlaku ${train.name}.`;
      // Řád vlaku v depu se po demolici jen zkrátí
      if (train.state === 'depot') continue;
      for (const id of train.orders ?? []) {
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
    while (!reservations.fullyReserved(train) && reservations.limit(train) < needed && reservations.extend(train));
    const limit = Math.min(pathEnd, reservations.limit(train));
    const remaining = Math.max(0, limit - train.pos);
    const brakeLimit = Math.sqrt(2 * DECELERATION * remaining);
    train.speed = Math.min(train.speed + ACCELERATION * days, model.speed, brakeLimit);
    // Minimální rychlost, aby brzdění vlak nezastavilo těsně před cílem
    train.speed = Math.max(train.speed, 0.15);
    const step = train.speed * days;
    const before = segmentIndexAt(train.path, train.pos);
    if (step < remaining) {
      train.pos += step;
      train.tiles += segmentIndexAt(train.path, train.pos) - before;
      this.blocked.delete(train.id);
      reservations.sync(train, this.tail(train));
      return;
    }
    train.pos += remaining;
    train.tiles += segmentIndexAt(train.path, Math.max(0, train.pos - 1e-6)) - before;
    train.speed = 0;
    if (limit < pathEnd - 1e-6) {
      reservations.sync(train, this.tail(train));
      this.wait(train, days);
      return;
    }
    this.blocked.delete(train.id);
    this.arrive(train);
  }

  // Stojí před obsazenou tratí; občas zkusí jinou cestu a po delší době varuje hráče
  private wait(train: Train, days: number): void {
    const state = this.blocked.get(train.id) ?? { total: 0, sinceReplan: 0 };
    const warned = state.total >= BLOCKED_WARN_DAYS;
    state.total += days;
    state.sinceReplan += days;
    this.blocked.set(train.id, state);
    if (!warned && state.total >= BLOCKED_WARN_DAYS) {
      this.game.news(`${train.name} už měsíc čeká na volnou trať – jednokolejka potřebuje výhybny nebo víc kolejí.`);
    }
    if (state.sinceReplan >= BLOCKED_REPLAN_DAYS) {
      state.sinceReplan = 0;
      this.replan(train);
    }
  }

  private tail(train: Train): number {
    return train.pos - trainLength(train);
  }

  private arrive(train: Train): void {
    this.trimToBody(train);
    if (train.target === -1) {
      train.state = 'depot';
      train.path = [];
      this.reservations.release(train);
      // Cestující v depu vystoupí bez zaplacení
      train.passengers = 0;
      this.game.news(`${train.name} dorazil do depa.`);
      if (train.renewing) this.finishRenewal(train);
    } else {
      train.state = 'loading';
      train.waitDays = TRAIN_LOADING_DAYS;
      this.reservations.reset(train, this.tail(train));
      const station = this.goal(train);
      if (station && !('entrance' in station)) this.exchange(train, station);
    }
    this.changed();
  }

  private exchange(train: Train, station: Station, loadOnly = false): void {
    const { cargo } = train;
    if (isFreight(cargo)) this.game.freight.exchange(train, station, cargo, loadOnly);
    else this.game.passengers.exchange(train, station, loadOnly);
  }

  // Naplánuje cestu k dalšímu cíli; vlak může pokračovat vpřed, nebo se otočit
  private replan(train: Train): void {
    if (train.state === 'loading' && train.orders && train.target !== -1) train.target = nextStop(train);
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
      train.pos = pathLength(body) - Math.max(0, offset);
      train.flipped = !train.flipped;
      train.speed = 0;
    } else if (forward) {
      const keep = pathLength(train.path.slice(0, train.path.indexOf(body[0])));
      train.path = [...body, ...forward];
      train.pos -= keep;
    } else {
      this.lose(train);
      return;
    }
    train.state = 'running';
    this.reservations.reset(train, this.tail(train));
    this.changed();
  }

  private lose(train: Train): void {
    if (train.state !== 'lost') this.game.news(`${train.name} nemůže najít cestu.`);
    train.state = 'lost';
    train.speed = 0;
    train.waitDays = LOST_RETRY_DAYS;
    this.changed();
  }

  private goal(train: Train): Station | Depot | null {
    if (train.target === -1) return this.depot(train) ?? null;
    return train.orders ? (this.station(train.orders[train.target]) ?? null) : null;
  }

  // Přednostně trasa mimo koleje jiných vlaků (např. volná kolej nástupiště), jinak nejkratší a vlak počká
  private routeTo(start: RouteStart, goal: Station | Depot, train?: Train): Segment[] | null {
    const avoid = train ? (x: number, y: number) => this.reservations.blocks(train, x, y) : undefined;
    return (avoid && this.findGoal(start, goal, avoid)) || this.findGoal(start, goal);
  }

  private findGoal(
    start: RouteStart,
    goal: Station | Depot,
    avoid?: (x: number, y: number) => boolean,
  ): Segment[] | null {
    const { rail } = this.game.world;
    if ('entrance' in goal) {
      return findRoute(rail, start, (x, y) => x === goal.x && y === goal.y, goal, avoid);
    }
    const route = findRoute(rail, start, (x, y) => rail.stationAt(x, y)?.id === goal.id, goal, avoid);
    return route ? extendThroughStation(rail, route, goal) : null;
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
        const kept = train.orders.filter((id) => this.station(id));
        train.orders = kept.length > 0 ? kept : null;
      }
      if (train.state !== 'running') continue;
      if (!this.goal(train) || !train.path.every((s) => segmentStillExists(rail, s))) this.replan(train);
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
      if (!train.agingWarned && isOld(train, today)) {
        train.agingWarned = true;
        this.game.news(`${train.name} dosáhl konce životnosti – provoz je dražší, zvažte obnovu.`);
      }
    }
  }

  private depot(train: Train): Depot | undefined {
    return this.game.world.rail.depots.find((d) => d.id === train.depotId);
  }

  private station(id: number): Station | undefined {
    return this.game.world.rail.stations.find((s) => s.id === id);
  }

  private changed(): void {
    this.game.events.emit('trainsChanged');
  }
}
