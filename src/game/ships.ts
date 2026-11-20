import {
  LOADING_PER_DAY,
  OLD_TRAIN_COST_FACTOR,
  SHIP_LIFETIME_YEARS,
  SHIP_MODELS,
  TRAIN_LOADING_DAYS,
  TRAIN_MIN_SELL,
  TRAIN_SELL_REFUND,
  type ShipModel,
} from './balance';
import { CARGOS, isFreight, type Cargo } from './cargo';
import { formatMoney, type Game } from './game';
import {
  BERTHS,
  berthTiles,
  findWaterRoute,
  moorDirection,
  moorPoint,
  navigable,
  polylineLength,
  polylinePoint,
  waterBodies,
  type Point,
  type PortShape,
} from '../world/port';
import type { Station } from '../world/rail';

const DAYS_PER_YEAR = 365.25;
const LOST_RETRY_DAYS = 5;
const FULL_LOAD_CHECK_DAYS = 1;
// Na tolik dlaždic před kotvištěm se loď zastaví, je-li kotviště obsazené
const BERTH_APPROACH = 1.2;

// depot – stojí v loděnici přístavu depotId; sailing – pluje k přístavu portId na kotviště berth;
// waiting – čeká před obsazeným kotvištěm; loading – kotví a nakládá; lost – nemá cestu po vodě
export type ShipState = 'depot' | 'sailing' | 'waiting' | 'loading' | 'lost';

export interface Ship {
  id: number;
  name: string;
  modelId: string;
  depotId: number;
  portId: number;
  berth: number;
  orders: number[] | null;
  fullLoad: number[];
  target: number;
  // Po nejbližším příjezdu do přístavu (v přístavu hned) do loděnice
  toDepot: boolean;
  state: ShipState;
  // Plavební trasa jako lomená čára od místa vyplutí po kotviště; pos je vzdálenost od začátku
  path: Point[];
  pos: number;
  waitDays: number;
  passengers: number;
  boardedStation: number;
  boardedAt: number;
  tiles: number;
  income: number;
  costs: number;
  lastIncome: number;
  lastCosts: number;
  builtDay: number;
  agingWarned: boolean;
}

export function shipModel(ship: Ship): ShipModel {
  return SHIP_MODELS.find((m) => m.id === ship.modelId)!;
}

export function shipKind(cargo: Cargo): string {
  return cargo === 'passengers' ? 'Parník' : 'Nákladní loď';
}

export function formatShipLoad(ship: Ship): string {
  const model = shipModel(ship);
  return `${ship.passengers} / ${model.capacity} ${CARGOS[model.cargo].unit}`;
}

export function shipAge(ship: Ship, today: number): number {
  return Math.max(0, today - ship.builtDay) / DAYS_PER_YEAR;
}

export function isOldShip(ship: Ship, today: number): boolean {
  return shipAge(ship, today) >= SHIP_LIFETIME_YEARS;
}

export function shipSellPrice(ship: Ship, today: number): number {
  const worn = Math.min(1, shipAge(ship, today) / SHIP_LIFETIME_YEARS);
  const factor = TRAIN_SELL_REFUND - (TRAIN_SELL_REFUND - TRAIN_MIN_SELL) * worn;
  return Math.round(shipModel(ship).price * factor);
}

export function shipRunningCost(ship: Ship, today: number): number {
  const base = shipModel(ship).runningCost;
  return isOldShip(ship, today) ? base * OLD_TRAIN_COST_FACTOR : base;
}

const lengthCache = new WeakMap<Point[], number>();

function pathLength(path: Point[]): number {
  let length = lengthCache.get(path);
  if (length === undefined) {
    length = polylineLength(path);
    lengthCache.set(path, length);
  }
  return length;
}

// Lodě společnosti: nákup v loděnici přístavu, plavební řád mezi přístavy a plavba po vodě
export class ShipFleet {
  readonly ships: Ship[] = [];
  nextId = 1;
  // Vodní plochy pro kontrolu, zda mezi přístavy vede cesta; přepočítají se po změně mostů
  private bodies: Int32Array | null = null;

  constructor(private readonly game: Game) {
    game.clock.events.on('month', () => this.chargeRunningCosts());
    game.clock.events.on('year', (ended) => {
      for (const m of SHIP_MODELS) {
        if (m.year === ended + 1) game.news(`Nová loď k dispozici: ${m.name}.`);
      }
      for (const ship of this.ships) {
        ship.lastIncome = ship.income;
        ship.lastCosts = ship.costs;
        ship.income = 0;
        ship.costs = 0;
      }
    });
    game.events.on('railChanged', () => this.revalidate());
    game.events.on('roadsChanged', () => this.revalidate());
  }

  available(): ShipModel[] {
    const year = this.game.clock.date.year;
    return SHIP_MODELS.filter((m) => m.year <= year);
  }

  inDepot(port: Station): Ship[] {
    return this.ships.filter((s) => s.state === 'depot' && s.depotId === port.id);
  }

  basedAt(port: Station): Ship[] {
    return this.ships.filter((s) => s.depotId === port.id || s.portId === port.id || s.orders?.includes(port.id));
  }

  buy(port: Station, model: ShipModel): string | null {
    if (port.kind !== 'water') return null;
    if (this.game.money < model.price) return `Nedostatek peněz (${formatMoney(model.price)}).`;
    this.game.spend(model.price, 'vehicles');
    const id = this.nextId++;
    this.ships.push({
      id,
      name: `${shipKind(model.cargo)} ${id}`,
      modelId: model.id,
      depotId: port.id,
      portId: port.id,
      berth: 0,
      orders: null,
      fullLoad: [],
      target: 0,
      toDepot: false,
      state: 'depot',
      path: [],
      pos: 0,
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
    });
    this.changed();
    return null;
  }

  sell(ship: Ship): void {
    if (ship.state !== 'depot') return;
    this.game.refund(shipSellPrice(ship, this.game.clock.day), 'vehicles');
    this.ships.splice(this.ships.indexOf(ship), 1);
    this.changed();
  }

  // Chyba řádu, nebo null: aspoň dva přístavy, sousední různé a na stejné vodní ploše
  ordersError(orders: number[]): string | null {
    if (orders.length < 2) return 'Plavební řád potřebuje aspoň dva přístavy.';
    if (orders.some((id) => this.port(id) === undefined)) return 'Lodě plují jen mezi přístavy.';
    if (orders.some((id, i) => id === orders[(i + 1) % orders.length])) {
      return 'Stejný přístav nesmí následovat po sobě.';
    }
    for (let i = 0; i < orders.length; i++) {
      const a = this.port(orders[i])!;
      const b = this.port(orders[(i + 1) % orders.length])!;
      if (!this.connected(a, b)) return `Z přístavu ${a.name} do přístavu ${b.name} se po vodě nedá doplout.`;
    }
    return null;
  }

  // Vypluje z loděnice: je-li její přístav v řádu, rovnou tam nakládá, jinak pluje na první přístav řádu
  start(ship: Ship, orders: number[]): string | null {
    const error = this.ordersError(orders);
    if (error) return error;
    const port = this.port(ship.depotId);
    if (ship.state !== 'depot' || !port) return null;
    ship.orders = [...orders];
    ship.fullLoad = ship.fullLoad.filter((id) => orders.includes(id));
    ship.toDepot = false;
    ship.portId = port.id;
    ship.berth = this.chooseBerth(port, ship);
    ship.path = [moorPoint(this.shape(port), ship.berth)];
    ship.pos = 0;
    ship.state = 'sailing';
    const home = orders.indexOf(port.id);
    if (home >= 0) {
      ship.target = home;
      this.arrive(ship);
    } else {
      ship.target = 0;
      this.sailTo(ship, orders[0]);
    }
    this.changed();
    return null;
  }

  setOrders(ship: Ship, orders: number[]): string | null {
    if (ship.state === 'depot' && orders.length < 2) {
      ship.orders = orders.length > 0 ? orders : null;
      this.changed();
      return null;
    }
    const error = this.ordersError(orders);
    if (error) return error;
    const current = ship.orders?.[ship.target];
    ship.orders = [...orders];
    ship.fullLoad = ship.fullLoad.filter((id) => orders.includes(id));
    ship.target = Math.max(0, current === undefined ? -1 : orders.indexOf(current));
    const underway = ship.state === 'sailing' || ship.state === 'waiting' || ship.state === 'lost';
    if (underway && !orders.includes(ship.portId) && !ship.toDepot) this.sailTo(ship, orders[ship.target]);
    this.changed();
    return null;
  }

  toggleFullLoad(ship: Ship, portId: number): void {
    const i = ship.fullLoad.indexOf(portId);
    if (i >= 0) ship.fullLoad.splice(i, 1);
    else ship.fullLoad.push(portId);
    this.changed();
  }

  // V přístavu rovnou do loděnice, na cestě po připlutí do cílového přístavu
  sendToDepot(ship: Ship): void {
    if (ship.state === 'depot' || ship.toDepot) return;
    ship.toDepot = true;
    if (ship.state === 'loading') this.dock(ship);
    this.changed();
  }

  update(days: number): void {
    if (days <= 0) return;
    for (const ship of this.ships) {
      switch (ship.state) {
        case 'sailing':
          this.sail(ship, days);
          break;
        case 'waiting':
          this.tryBerth(ship);
          break;
        case 'loading':
          ship.waitDays -= days;
          if (ship.waitDays <= 0 && !this.fillingUp(ship)) this.depart(ship);
          break;
        case 'lost':
          ship.waitDays -= days;
          if (ship.waitDays <= 0) this.sailTo(ship, ship.portId);
          break;
      }
    }
  }

  isFillingUp(ship: Ship): boolean {
    return (
      ship.state === 'loading' && ship.fullLoad.includes(ship.portId) && ship.passengers < shipModel(ship).capacity
    );
  }

  stationName(id: number): string {
    return this.game.world.rail.stations.find((s) => s.id === id)?.name ?? '?';
  }

  // Poloha a směr lodi; v loděnici u prvního kotviště jejího přístavu
  sample(ship: Ship): (Point & { dx: number; dy: number }) | null {
    const port = this.port(ship.state === 'depot' ? ship.depotId : ship.portId);
    if (ship.state === 'depot' || ship.state === 'loading' || ship.path.length === 0) {
      if (!port) return null;
      const shape = this.shape(port);
      const dir = moorDirection(shape);
      return { ...moorPoint(shape, ship.state === 'depot' ? 0 : ship.berth), dx: dir.x, dy: dir.y };
    }
    return polylinePoint(ship.path, ship.pos);
  }

  position(ship: Ship): Point | undefined {
    const s = this.sample(ship);
    return s ? { x: s.x, y: s.y } : undefined;
  }

  demolitionBlocker(port: Station): string | null {
    for (const ship of this.ships) {
      if (ship.state === 'depot') {
        if (ship.depotId === port.id) return `V loděnici přístavu ${port.name} stojí ${ship.name}.`;
        continue;
      }
      if (ship.portId === port.id) return `Do přístavu ${port.name} pluje ${ship.name}.`;
      if (ship.orders?.includes(port.id)) return `Přístav ${port.name} obsluhuje ${ship.name}.`;
    }
    return null;
  }

  port(id: number): Station | undefined {
    return this.game.world.rail.stations.find((s) => s.id === id && s.kind === 'water');
  }

  // Leží oba přístavy na stejné vodní ploše?
  connected(a: Station, b: Station): boolean {
    const { map } = this.game.world;
    this.bodies ??= waterBodies(map);
    const body = (port: Station): number => {
      const t = berthTiles(this.shape(port))[0];
      return this.bodies![t.y * map.width + t.x];
    };
    return body(a) >= 0 && body(a) === body(b);
  }

  private shape(port: Station): PortShape {
    return port as PortShape;
  }

  private remaining(ship: Ship): number {
    return pathLength(ship.path) - ship.pos;
  }

  private sail(ship: Ship, days: number): void {
    const step = shipModel(ship).speed * days;
    const port = this.port(ship.portId);
    if (port && this.remaining(ship) - step < BERTH_APPROACH && this.berthBusy(port, ship.berth, ship)) {
      // Před obsazeným kotvištěm loď zastaví, pokud jiné není volné
      ship.pos = Math.max(ship.pos, pathLength(ship.path) - BERTH_APPROACH);
      this.tryBerth(ship, true);
      return;
    }
    ship.pos += step;
    if (ship.pos >= pathLength(ship.path)) {
      ship.pos = pathLength(ship.path);
      ship.tiles += Math.round(pathLength(ship.path));
      this.arrive(ship);
    }
  }

  // Obsazené kotviště: jiná loď u něj kotví, nebo k němu dorazí dřív
  private berthBusy(port: Station, berth: number, ship: Ship): boolean {
    return this.ships.some((other) => {
      if (other === ship || other.portId !== port.id || other.berth !== berth) return false;
      if (other.state === 'loading') return true;
      if (other.state !== 'sailing' && other.state !== 'waiting') return false;
      const left = this.remaining(other);
      const mine = this.remaining(ship);
      return left < BERTH_APPROACH && (left < mine || (left === mine && other.id < ship.id));
    });
  }

  // Kotviště, ke kterému míří nejméně lodí
  private chooseBerth(port: Station, ship: Ship): number {
    let best = 0;
    let fewest = Infinity;
    for (let berth = 0; berth < BERTHS; berth++) {
      const count = this.ships.filter(
        (other) => other !== ship && other.state !== 'depot' && other.portId === port.id && other.berth === berth,
      ).length;
      if (count < fewest) {
        fewest = count;
        best = berth;
      }
    }
    return best;
  }

  // Čekající loď zkusí své nebo jiné volné kotviště
  private tryBerth(ship: Ship, arriving = false): void {
    const port = this.port(ship.portId);
    if (!port) return;
    if (!this.berthBusy(port, ship.berth, ship)) {
      if (!arriving) ship.state = 'sailing';
      return;
    }
    for (let berth = 0; berth < BERTHS; berth++) {
      if (berth === ship.berth || this.berthBusy(port, berth, ship)) continue;
      ship.berth = berth;
      this.route(ship, port);
      return;
    }
    if (ship.state !== 'waiting') {
      ship.state = 'waiting';
      this.changed();
    }
  }

  // Trasa z místa, kde loď je, ke kotvišti ship.berth přístavu port
  private route(ship: Ship, port: Station, from: Point | null = this.sample(ship)): boolean {
    const { map } = this.game.world;
    const here = from ?? moorPoint(this.shape(port), ship.berth);
    const shape = this.shape(port);
    const goal = berthTiles(shape)[ship.berth];
    let start = { x: Math.floor(here.x), y: Math.floor(here.y) };
    // Loď na hraně dlaždice (u nábřeží) začne na nejbližší vodě
    if (!navigable(map, start.x, start.y)) {
      const near = [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
        .map(([dx, dy]) => ({ x: Math.floor(here.x + dx * 0.5), y: Math.floor(here.y + dy * 0.5) }))
        .find((t) => navigable(map, t.x, t.y));
      if (!near) return false;
      start = near;
    }
    const tiles = findWaterRoute(map, start, goal);
    if (!tiles) return false;
    const centers = tiles.slice(1, -1).map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }));
    ship.path = [{ x: here.x, y: here.y }, ...centers, moorPoint(shape, ship.berth)];
    ship.pos = 0;
    ship.state = 'sailing';
    return true;
  }

  private sailTo(ship: Ship, portId: number): void {
    const port = this.port(portId);
    if (!port) return;
    // Poloha se zjistí ještě u původního přístavu (kotvící loď stojí u svého kotviště)
    const here = this.sample(ship);
    ship.portId = portId;
    ship.berth = this.chooseBerth(port, ship);
    if (!this.route(ship, port, here)) {
      if (ship.state !== 'lost') this.game.news(`${ship.name} nemůže najít cestu po vodě.`, this.position(ship));
      ship.state = 'lost';
      ship.waitDays = LOST_RETRY_DAYS;
    }
    this.changed();
  }

  private arrive(ship: Ship): void {
    if (ship.toDepot) {
      this.dock(ship);
      return;
    }
    ship.state = 'loading';
    ship.waitDays = TRAIN_LOADING_DAYS;
    const port = this.port(ship.portId);
    if (port) ship.waitDays += this.exchange(ship, port) / LOADING_PER_DAY;
    if (ship.orders && ship.orders[ship.target] === ship.portId) {
      ship.target = (ship.target + 1) % ship.orders.length;
    }
    this.changed();
  }

  private exchange(ship: Ship, port: Station, loadOnly = false): number {
    const model = shipModel(ship);
    const hold = { atPlatform: model.capacity, capacity: model.capacity, speed: model.speed };
    const { cargo } = model;
    if (isFreight(cargo)) return this.game.freight.exchange(ship, hold, port, cargo, loadOnly);
    return this.game.passengers.exchange(ship, hold, port, loadOnly);
  }

  private fillingUp(ship: Ship): boolean {
    const port = this.port(ship.portId);
    if (!port || !ship.fullLoad.includes(port.id)) return false;
    this.exchange(ship, port, true);
    if (ship.passengers >= shipModel(ship).capacity) return false;
    ship.waitDays = FULL_LOAD_CHECK_DAYS;
    this.changed();
    return true;
  }

  private depart(ship: Ship): void {
    const next = ship.orders?.[ship.target];
    if (ship.toDepot || next === undefined || !ship.orders || ship.orders.length < 2) {
      this.dock(ship);
      return;
    }
    this.sailTo(ship, next);
  }

  // Zajede do loděnice přístavu, u kterého je
  private dock(ship: Ship): void {
    ship.state = 'depot';
    ship.depotId = ship.portId;
    ship.path = [];
    ship.pos = 0;
    ship.toDepot = false;
    const load = ship.passengers > 0 ? ` s nákladem ${formatShipLoad(ship)}` : '';
    this.game.news(`${ship.name} je v loděnici přístavu ${this.stationName(ship.portId)}${load}.`, this.position(ship));
    this.changed();
  }

  // Po stavbě mostu přeplánuje lodě, kterým most zatarasil trasu; lodě v loděnici zapomenou zbořené přístavy
  private revalidate(): void {
    this.bodies = null;
    const { map } = this.game.world;
    for (const ship of this.ships) {
      if (ship.state === 'depot') {
        if (!ship.orders) continue;
        const kept = ship.orders.filter((id) => this.port(id));
        ship.orders = kept.length > 0 ? kept : null;
        continue;
      }
      if (ship.state !== 'sailing' && ship.state !== 'waiting') continue;
      const blocked = ship.path.slice(1, -1).some((p) => !navigable(map, Math.floor(p.x), Math.floor(p.y)));
      if (blocked) this.sailTo(ship, ship.portId);
    }
  }

  private chargeRunningCosts(): void {
    const today = this.game.clock.day;
    for (const ship of this.ships) {
      const monthly = shipRunningCost(ship, today) / 12;
      this.game.spend(monthly, 'running');
      ship.costs += monthly;
      if (isOldShip(ship, today) && !ship.agingWarned) {
        ship.agingWarned = true;
        this.game.news(
          `${ship.name} dosáhla konce životnosti – provoz je dražší, zvažte nákup nové.`,
          this.position(ship),
        );
      }
    }
  }

  private changed(): void {
    this.game.events.emit('shipsChanged');
  }
}
