import {
  AIRCRAFT_LIFETIME_YEARS,
  AIRCRAFT_MODELS,
  AIRPORT_TYPES,
  HOLDING_SPEED_SHARE,
  LOADING_PER_DAY,
  OLD_TRAIN_COST_FACTOR,
  RUNWAY_SPEED_SHARE,
  SERVICE_INTERVAL_DAYS,
  TAXI_SPEED,
  TRAIN_LOADING_DAYS,
  TRAIN_MIN_SELL,
  TRAIN_SELL_REFUND,
  type AircraftModel,
  type AirportType,
} from './balance';
import { CARGOS, isFreight, type Cargo } from './cargo';
import { refitCapacity, refitOptions, vehicleRefitCost } from './vehicleRefit';
import { formatMoney, type Game } from './game';
import {
  approachPoint,
  flightRoute,
  hangarPoint,
  holdPoint,
  holdingRoute,
  landingRoute,
  routeLength,
  routePoint,
  runwayDirection,
  standPoint,
  takeoffRoute,
  taxiFromRunway,
  taxiToRunway,
  type AirPoint,
  type RouteSample,
} from '../world/airport';
import type { Station } from '../world/rail';
import {
  clampServiceInterval,
  needsService,
  newMaintenance,
  reliabilityForYear,
  rollBreakdown,
  service,
  wearOut,
  type Maintained,
} from './reliability';
import { Rng } from '../world/rng';

const DAYS_PER_YEAR = 365.25;
// Letadlo čekající na plné naložení zkouší doložit jednou denně
const FULL_LOAD_CHECK_DAYS = 1;
// Porouchané letadlo ve vzduchu doletí sníženou rychlostí, na zemi stojí
const BROKEN_FLIGHT_SPEED_SHARE = 0.5;

// hangar – stojí v hangáru letiště depotId; taxi – pojíždí (taxiTo říká kam); waiting – čeká před ranvejí;
// takeoff – vzlétá; flying – letí k letišti airportId; holding – krouží nad ním; landing – přistává; loading – na stání
export type AircraftState = 'hangar' | 'taxi' | 'waiting' | 'takeoff' | 'flying' | 'holding' | 'landing' | 'loading';

export interface Aircraft extends Maintained {
  id: number;
  name: string;
  modelId: string;
  // Letiště, v jehož hangáru letadlo stojí nebo naposledy stálo
  depotId: number;
  // Letiště, na kterém letadlo je, nebo ke kterému letí
  airportId: number;
  orders: number[] | null;
  fullLoad: number[];
  // Index cílového letiště v řádu
  target: number;
  // Po nejbližším přistání (na zemi hned) do hangáru
  toHangar: boolean;
  state: AircraftState;
  // Trasa aktuální fáze: lomená čára, nebo u letu (curve) Bézierova křivka; pos je vzdálenost od začátku
  route: AirPoint[];
  curve: boolean;
  pos: number;
  taxiTo: 'runway' | 'stand' | 'hangar';
  // Rezervované stání na letišti airportId, −1 = žádné
  stand: number;
  waitDays: number;
  passengers: number;
  boardedStation: number;
  boardedAt: number;
  tiles: number;
  income: number;
  costs: number;
  lastIncome: number;
  lastCosts: number;
  // Skupina vozidel (jako v OpenTTD); bez údaje žádná
  group?: number;
  builtDay: number;
  agingWarned: boolean;
  // Pojíždí do hangáru na servis; po něm pokračuje podle řádu
  servicing?: boolean;
  // Náklad po přestavbě; bez údaje podle modelu
  cargo?: Cargo;
}

// Nejvyšší spolehlivost letadla (po servisu)
export function aircraftReliability(plane: Aircraft): number {
  return reliabilityForYear(aircraftModel(plane).year);
}

export function aircraftModel(plane: Aircraft): AircraftModel {
  return AIRCRAFT_MODELS.find((m) => m.id === plane.modelId)!;
}

export function aircraftKind(cargo: AircraftModel['cargo']): string {
  return cargo === 'mail' ? 'Poštovní letoun' : 'Letoun';
}

// Náklad letadla: podle modelu, nebo podle přestavby (cestující ↔ pošta)
export function aircraftCargo(plane: Aircraft): Cargo {
  return plane.cargo ?? aircraftModel(plane).cargo;
}

export function aircraftCapacity(plane: Aircraft): number {
  const model = aircraftModel(plane);
  return refitCapacity(model.capacity, model.cargo, aircraftCargo(plane));
}

export function formatAircraftLoad(plane: Aircraft): string {
  return `${plane.passengers} / ${aircraftCapacity(plane)} ${CARGOS[aircraftCargo(plane)].unit}`;
}

export function aircraftAge(plane: Aircraft, today: number): number {
  return Math.max(0, today - plane.builtDay) / DAYS_PER_YEAR;
}

export function isOldAircraft(plane: Aircraft, today: number): boolean {
  return aircraftAge(plane, today) >= AIRCRAFT_LIFETIME_YEARS;
}

export function aircraftSellPrice(plane: Aircraft, today: number): number {
  const worn = Math.min(1, aircraftAge(plane, today) / AIRCRAFT_LIFETIME_YEARS);
  const factor = TRAIN_SELL_REFUND - (TRAIN_SELL_REFUND - TRAIN_MIN_SELL) * worn;
  return Math.round(aircraftModel(plane).price * factor);
}

export function aircraftRunningCost(plane: Aircraft, today: number): number {
  const base = aircraftModel(plane).runningCost;
  return isOldAircraft(plane, today) ? base * OLD_TRAIN_COST_FACTOR : base;
}

// Smí model přistávat na letišti? Velká letadla jen na velkém
export function canUseAirport(model: AircraftModel, type: AirportType | undefined): boolean {
  return !model.large || type === 'large';
}

// Letadla společnosti: nákup v hangáru, jízdní řád mezi letišti, vzlet, let, kroužení a přistání
export class AirFleet {
  readonly aircraft: Aircraft[] = [];
  nextId = 1;
  private readonly breakdownRng: Rng;

  constructor(private readonly game: Game) {
    this.breakdownRng = new Rng(game.world.seed ^ 0x3d4f7a21);
    game.clock.events.on('month', () => this.chargeRunningCosts());
    game.clock.events.on('year', (ended) => {
      for (const m of AIRCRAFT_MODELS) {
        if (m.year === ended + 1) game.news(`Nové letadlo k dispozici: ${m.name}.`);
      }
      for (const spec of Object.values(AIRPORT_TYPES)) {
        if (spec.year === ended + 1) game.news(`Nově lze stavět: ${spec.name}.`);
      }
      for (const plane of this.aircraft) {
        plane.lastIncome = plane.income;
        plane.lastCosts = plane.costs;
        plane.income = 0;
        plane.costs = 0;
      }
    });
    game.events.on('railChanged', () => this.revalidate());
  }

  available(): AircraftModel[] {
    const year = this.game.clock.date.year;
    return AIRCRAFT_MODELS.filter((m) => m.year <= year);
  }

  inHangar(airport: Station): Aircraft[] {
    return this.aircraft.filter((p) => p.state === 'hangar' && p.depotId === airport.id);
  }

  // Letadla, která na letišti mají domovský hangár nebo ho mají v řádu
  basedAt(airport: Station): Aircraft[] {
    return this.aircraft.filter(
      (p) => p.depotId === airport.id || p.airportId === airport.id || p.orders?.includes(airport.id),
    );
  }

  buy(airport: Station, model: AircraftModel): string | null {
    if (airport.kind !== 'air') return null;
    if (!canUseAirport(model, airport.airport)) return `${model.name} potřebuje velké letiště.`;
    if (this.game.money < model.price) return `Nedostatek peněz (${formatMoney(model.price)}).`;
    this.game.spend(model.price, 'vehicles');
    const id = this.nextId++;
    this.aircraft.push({
      id,
      name: `${aircraftKind(model.cargo)} ${id}`,
      modelId: model.id,
      depotId: airport.id,
      airportId: airport.id,
      orders: null,
      fullLoad: [],
      target: 0,
      toHangar: false,
      state: 'hangar',
      route: [],
      curve: false,
      pos: 0,
      taxiTo: 'hangar',
      stand: -1,
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
      ...newMaintenance(reliabilityForYear(model.year), this.game.clock.now, SERVICE_INTERVAL_DAYS),
    });
    this.changed();
    return null;
  }

  refitOptions(plane: Aircraft): Cargo[] {
    return refitOptions('air', aircraftModel(plane).cargo);
  }

  refitCost(plane: Aircraft): number {
    return vehicleRefitCost(aircraftModel(plane).price);
  }

  // Přestavba v hangáru jako v OpenTTD (cestující ↔ pošta); náklad na palubě propadne
  refit(plane: Aircraft, cargo: Cargo): string | null {
    if (cargo === aircraftCargo(plane)) return null;
    if (plane.state !== 'hangar') return 'Letadlo lze přestavět jen v hangáru.';
    if (!this.refitOptions(plane).includes(cargo)) return `${plane.name} na ${CARGOS[cargo].noun} přestavět nejde.`;
    const cost = this.refitCost(plane);
    if (this.game.money < cost) return `Na přestavbu chybí peníze (${formatMoney(cost)}).`;
    this.game.spend(cost, 'vehicles');
    plane.costs += cost;
    plane.cargo = cargo === aircraftModel(plane).cargo ? undefined : cargo;
    plane.passengers = 0;
    this.changed();
    return null;
  }

  setServiceInterval(plane: Aircraft, days: number): void {
    plane.serviceInterval = clampServiceInterval(days);
    this.changed();
  }

  sell(plane: Aircraft): void {
    if (plane.state !== 'hangar') return;
    this.game.refund(aircraftSellPrice(plane, this.game.clock.day), 'vehicles');
    this.aircraft.splice(this.aircraft.indexOf(plane), 1);
    this.changed();
  }

  // Chyba řádu, nebo null: aspoň dvě letiště, sousední různá, velké letadlo jen na velká letiště
  ordersError(plane: Aircraft, orders: number[]): string | null {
    if (orders.length < 2) return 'Letový řád potřebuje aspoň dvě letiště.';
    if (orders.some((id) => this.airport(id) === undefined)) return 'Letadla létají jen mezi letišti.';
    if (orders.some((id, i) => id === orders[(i + 1) % orders.length])) {
      return 'Stejné letiště nesmí následovat po sobě.';
    }
    const model = aircraftModel(plane);
    const small = orders.map((id) => this.airport(id)!).find((a) => !canUseAirport(model, a.airport));
    if (small) return `${model.name} nemůže přistát na malém letišti ${small.name}.`;
    return null;
  }

  // Vypraví letadlo z hangáru: je-li jeho letiště v řádu, nejdřív na stání naložit, jinak rovnou k ranveji
  start(plane: Aircraft, orders: number[]): string | null {
    const error = this.ordersError(plane, orders);
    if (error) return error;
    const airport = this.airport(plane.depotId);
    if (plane.state !== 'hangar' || !airport) return null;
    plane.orders = [...orders];
    plane.fullLoad = plane.fullLoad.filter((id) => orders.includes(id));
    const home = orders.indexOf(airport.id);
    const stand = home >= 0 ? this.freeStand(airport) : -1;
    plane.target = Math.max(0, home);
    plane.toHangar = false;
    plane.airportId = airport.id;
    if (stand >= 0) {
      plane.stand = stand;
      this.taxi(plane, this.taxiVia(airport, this.point(plane), standPoint(airport, airport.airport!, stand)), 'stand');
    } else {
      // Obsazená stání: náklad naloží až příště, teď se letí na další letiště
      if (home >= 0) plane.target = (home + 1) % orders.length;
      this.taxi(plane, taxiToRunway(airport, airport.airport!, null), 'runway');
    }
    this.changed();
    return null;
  }

  setOrders(plane: Aircraft, orders: number[]): string | null {
    if (plane.state === 'hangar' && orders.length < 2) {
      plane.orders = orders.length > 0 ? orders : null;
      this.changed();
      return null;
    }
    const error = this.ordersError(plane, orders);
    if (error) return error;
    const current = plane.orders?.[plane.target];
    plane.orders = [...orders];
    plane.fullLoad = plane.fullLoad.filter((id) => orders.includes(id));
    const kept = current === undefined ? -1 : orders.indexOf(current);
    plane.target = Math.max(0, kept);
    // Letící letadlo, jehož cíl z řádu zmizel, změní kurz
    const airborne = plane.state === 'flying' || plane.state === 'holding';
    if (airborne && !orders.includes(plane.airportId) && !plane.toHangar) this.flyFrom(plane, orders[plane.target]);
    this.changed();
    return null;
  }

  // Přeskočí na letiště řádu: na stání hned odjede, ve vzduchu změní kurz
  skipTo(plane: Aircraft, index: number): void {
    const { orders } = plane;
    if (!orders || index < 0 || index >= orders.length || plane.state === 'hangar' || plane.toHangar) return;
    plane.target = index;
    if (plane.state === 'loading') this.depart(plane);
    else if ((plane.state === 'flying' || plane.state === 'holding') && orders[index] !== plane.airportId) {
      this.flyFrom(plane, orders[index]);
    }
    this.changed();
  }

  toggleFullLoad(plane: Aircraft, airportId: number): void {
    const i = plane.fullLoad.indexOf(airportId);
    if (i >= 0) plane.fullLoad.splice(i, 1);
    else plane.fullLoad.push(airportId);
    this.changed();
  }

  // Na zemi rovnou do hangáru, ve vzduchu po přistání na cílovém letišti
  sendToHangar(plane: Aircraft): void {
    if (plane.state === 'hangar' || plane.toHangar) return;
    plane.toHangar = true;
    plane.servicing = undefined;
    const airport = this.airport(plane.airportId);
    if (airport && (plane.state === 'loading' || plane.state === 'waiting' || plane.state === 'taxi')) {
      this.taxiToHangar(plane, airport);
    }
    this.changed();
  }

  update(days: number): void {
    if (days <= 0) return;
    for (const plane of this.aircraft) {
      if (plane.state === 'hangar') continue;
      wearOut(plane, days, isOldAircraft(plane, this.game.clock.day));
      if (plane.brokenDays > 0) {
        plane.brokenDays = Math.max(0, plane.brokenDays - days);
        if (plane.brokenDays === 0) this.changed();
        // Na zemi porouchané letadlo stojí; ve vzduchu letí pomaleji (viz speed)
        if (plane.state === 'taxi' || plane.state === 'waiting') continue;
      } else if (
        plane.state === 'flying' &&
        rollBreakdown(plane, days, this.game.breakdowns, this.breakdownRng.next())
      ) {
        this.game.news(
          `${plane.name} má poruchu – letí pomaleji a po přistání zajede na servis do hangáru.`,
          this.position(plane),
        );
        this.changed();
      }
      switch (plane.state) {
        case 'taxi':
        case 'takeoff':
        case 'flying':
        case 'holding':
        case 'landing': {
          plane.pos += this.speed(plane) * days;
          if (plane.pos >= routeLength(plane.route, plane.curve)) this.routeEnd(plane);
          break;
        }
        case 'waiting':
          this.tryTakeoff(plane);
          break;
        case 'loading':
          plane.waitDays -= days;
          if (plane.waitDays <= 0 && !this.fillingUp(plane)) this.depart(plane);
          break;
      }
    }
  }

  isFillingUp(plane: Aircraft): boolean {
    return (
      plane.state === 'loading' &&
      plane.fullLoad.includes(plane.airportId) &&
      plane.passengers < aircraftCapacity(plane)
    );
  }

  stationName(id: number): string {
    return this.game.world.rail.stations.find((s) => s.id === id)?.name ?? '?';
  }

  // Poloha a směr letadla; v hangáru poloha hangáru
  sample(plane: Aircraft): RouteSample | null {
    if (plane.state === 'hangar' || plane.route.length === 0) {
      const airport = this.airport(plane.depotId);
      if (!airport) return null;
      const dir = runwayDirection(airport);
      return { ...hangarPoint(airport, airport.airport!), dx: dir.x, dy: dir.y, climb: 0 };
    }
    return routePoint(plane.route, plane.curve, plane.pos);
  }

  position(plane: Aircraft): AirPoint | undefined {
    const s = this.sample(plane);
    return s ? { x: s.x, y: s.y, z: s.z } : undefined;
  }

  // Důvod, proč letiště nejde zbourat, nebo null
  demolitionBlocker(airport: Station): string | null {
    for (const plane of this.aircraft) {
      if (plane.state === 'hangar') {
        if (plane.depotId === airport.id) return `V hangáru letiště ${airport.name} stojí ${plane.name}.`;
        continue;
      }
      if (plane.airportId === airport.id) return `Na letiště ${airport.name} míří ${plane.name}.`;
      if (plane.orders?.includes(airport.id)) return `Letiště ${airport.name} obsluhuje ${plane.name}.`;
    }
    return null;
  }

  airport(id: number): Station | undefined {
    return this.game.world.rail.stations.find((s) => s.id === id && s.kind === 'air');
  }

  private point(plane: Aircraft): AirPoint {
    const s = this.sample(plane);
    return s ? { x: s.x, y: s.y, z: s.z } : { x: 0, y: 0, z: 0 };
  }

  // Odkudkoli na zemi letiště napříč na pojezdovou dráhu, po ní a zase napříč k cíli
  private taxiVia(airport: Station, from: AirPoint, to: AirPoint): AirPoint[] {
    return [{ ...from, z: 0 }, this.onTaxiway(airport, from), this.onTaxiway(airport, to), to];
  }

  private taxiToHangar(plane: Aircraft, airport: Station): void {
    plane.stand = -1;
    this.taxi(plane, this.taxiVia(airport, this.point(plane), hangarPoint(airport, airport.airport!)), 'hangar');
  }

  // Bod na pojezdové dráze naproti místu here (napříč letištěm)
  private onTaxiway(airport: Station, here: AirPoint): AirPoint {
    const hold = holdPoint(airport);
    return airport.axis === 'x' ? { x: here.x, y: hold.y, z: 0 } : { x: hold.x, y: here.y, z: 0 };
  }

  private speed(plane: Aircraft): number {
    const { speed } = aircraftModel(plane);
    switch (plane.state) {
      case 'taxi':
        return TAXI_SPEED;
      case 'takeoff':
      case 'landing':
        return Math.max(TAXI_SPEED * 2, speed * RUNWAY_SPEED_SHARE);
      case 'holding':
        return speed * HOLDING_SPEED_SHARE * (plane.brokenDays > 0 ? BROKEN_FLIGHT_SPEED_SHARE : 1);
      default:
        return speed * (plane.brokenDays > 0 ? BROKEN_FLIGHT_SPEED_SHARE : 1);
    }
  }

  private setRoute(plane: Aircraft, state: AircraftState, route: AirPoint[], curve = false): void {
    plane.state = state;
    plane.route = route;
    plane.curve = curve;
    plane.pos = 0;
  }

  private taxi(plane: Aircraft, route: AirPoint[], to: Aircraft['taxiTo']): void {
    this.setRoute(plane, 'taxi', route);
    plane.taxiTo = to;
  }

  private routeEnd(plane: Aircraft): void {
    const airport = this.airport(plane.airportId);
    switch (plane.state) {
      case 'taxi':
        if (plane.taxiTo === 'runway') {
          plane.state = 'waiting';
          this.tryTakeoff(plane);
        } else if (plane.taxiTo === 'stand') this.arriveAtStand(plane);
        else this.parkInHangar(plane);
        break;
      case 'takeoff': {
        if (plane.orders && plane.orders[plane.target] === plane.airportId) {
          plane.target = (plane.target + 1) % plane.orders.length;
        }
        const next = plane.orders?.[plane.target];
        if (next === undefined || !this.airport(next)) {
          // Bez platného cíle se letadlo vrátí, odkud vzlétlo
          this.flyFrom(plane, plane.airportId, true);
        } else this.flyFrom(plane, next);
        break;
      }
      case 'flying':
        plane.tiles += Math.round(routeLength(plane.route, plane.curve));
        this.requestLanding(plane);
        break;
      case 'holding':
        this.requestLanding(plane);
        break;
      case 'landing':
        if (!airport) return;
        if (plane.toHangar || plane.stand < 0)
          this.taxi(plane, taxiFromRunway(airport, airport.airport!, null), 'hangar');
        else this.taxi(plane, taxiFromRunway(airport, airport.airport!, plane.stand), 'stand');
        this.changed();
        break;
    }
  }

  // Let z místa, kde letadlo je, k letišti destination
  private flyFrom(plane: Aircraft, destination: number, toHangar = false): void {
    const airport = this.airport(destination);
    if (!airport) return;
    const here = this.sample(plane)!;
    const target = approachPoint(airport);
    plane.airportId = destination;
    if (toHangar) plane.toHangar = true;
    this.setRoute(
      plane,
      'flying',
      flightRoute(here, { x: here.dx, y: here.dy }, target, runwayDirection(airport)),
      true,
    );
    this.changed();
  }

  private runwayBusy(airportId: number): boolean {
    return this.aircraft.some((p) => p.airportId === airportId && (p.state === 'takeoff' || p.state === 'landing'));
  }

  private freeStand(airport: Station): number {
    const taken = new Set(this.aircraft.filter((p) => p.airportId === airport.id && p.stand >= 0).map((p) => p.stand));
    for (let i = 0; i < AIRPORT_TYPES[airport.airport!].stands; i++) if (!taken.has(i)) return i;
    return -1;
  }

  // Přistane, je-li volná ranvej a stání (do hangáru stání netřeba); jinak krouží nad letištěm
  private requestLanding(plane: Aircraft): void {
    const airport = this.airport(plane.airportId);
    if (!airport) return;
    const stand = plane.toHangar ? -1 : this.freeStand(airport);
    if (!this.runwayBusy(airport.id) && (plane.toHangar || stand >= 0)) {
      plane.stand = stand;
      this.setRoute(plane, 'landing', landingRoute(airport));
    } else {
      if (plane.state !== 'holding') this.changed();
      this.setRoute(plane, 'holding', holdingRoute(airport));
    }
  }

  private tryTakeoff(plane: Aircraft): void {
    const airport = this.airport(plane.airportId);
    if (!airport || this.runwayBusy(airport.id)) return;
    this.setRoute(plane, 'takeoff', takeoffRoute(airport));
    this.changed();
  }

  private arriveAtStand(plane: Aircraft): void {
    plane.state = 'loading';
    plane.waitDays = TRAIN_LOADING_DAYS;
    const airport = this.airport(plane.airportId);
    if (airport) plane.waitDays += this.exchange(plane, airport) / LOADING_PER_DAY;
    // Cíl splněn: další v řádu je následující letiště
    if (plane.orders && plane.orders[plane.target] === plane.airportId) {
      plane.target = (plane.target + 1) % plane.orders.length;
    }
    this.changed();
  }

  private exchange(plane: Aircraft, airport: Station, loadOnly = false): number {
    const model = aircraftModel(plane);
    const capacity = aircraftCapacity(plane);
    const hold = { atPlatform: capacity, capacity, speed: model.speed };
    const cargo = aircraftCargo(plane);
    if (isFreight(cargo)) return this.game.freight.exchange(plane, hold, airport, cargo, loadOnly);
    return this.game.passengers.exchange(plane, hold, airport, loadOnly);
  }

  private fillingUp(plane: Aircraft): boolean {
    const airport = this.airport(plane.airportId);
    if (!airport || !plane.fullLoad.includes(airport.id)) return false;
    this.exchange(plane, airport, true);
    if (plane.passengers >= aircraftCapacity(plane)) return false;
    plane.waitDays = FULL_LOAD_CHECK_DAYS;
    this.changed();
    return true;
  }

  // Ze stání k ranveji, bez platného řádu do hangáru
  private depart(plane: Aircraft): void {
    const airport = this.airport(plane.airportId);
    if (!airport) return;
    const stand = plane.stand;
    plane.stand = -1;
    const valid = plane.orders && plane.orders.length >= 2;
    if (plane.toHangar || !valid) {
      plane.toHangar = true;
      this.taxiToHangar(plane, airport);
    } else if (
      this.game.breakdowns !== 'none' &&
      (plane.breakdowns > 0 || needsService(plane, this.game.clock.now, this.game.breakdowns))
    ) {
      // Po intervalu nebo po poruše zajede na servis do hangáru letiště, pak poletí dál
      plane.servicing = true;
      this.taxiToHangar(plane, airport);
    } else {
      this.taxi(plane, taxiToRunway(airport, airport.airport!, stand >= 0 ? stand : null), 'runway');
    }
    this.changed();
  }

  private parkInHangar(plane: Aircraft): void {
    service(plane, aircraftReliability(plane), this.game.clock.now);
    const airport = this.airport(plane.airportId);
    if (plane.servicing && airport) {
      // Servis cestou: z hangáru rovnou k ranveji
      plane.servicing = undefined;
      plane.stand = -1;
      this.taxi(plane, taxiToRunway(airport, airport.airport!, null), 'runway');
      this.changed();
      return;
    }
    plane.servicing = undefined;
    plane.state = 'hangar';
    plane.depotId = plane.airportId;
    plane.route = [];
    plane.curve = false;
    plane.pos = 0;
    plane.stand = -1;
    plane.toHangar = false;
    const load = plane.passengers > 0 ? ` s nákladem ${formatAircraftLoad(plane)}` : '';
    this.game.news(
      `${plane.name} je v hangáru${airport ? ` letiště ${airport.name}` : ''}${load}.`,
      this.position(plane),
    );
    this.changed();
  }

  // Letadla v hangáru zapomenou zbořená letiště
  private revalidate(): void {
    for (const plane of this.aircraft) {
      if (plane.state !== 'hangar' || !plane.orders) continue;
      const kept = plane.orders.filter((id) => this.airport(id));
      plane.orders = kept.length > 0 ? kept : null;
    }
  }

  private chargeRunningCosts(): void {
    const today = this.game.clock.day;
    for (const plane of this.aircraft) {
      const monthly = aircraftRunningCost(plane, today) / 12;
      this.game.spend(monthly, 'running');
      plane.costs += monthly;
      if (isOldAircraft(plane, today) && !plane.agingWarned) {
        plane.agingWarned = true;
        this.game.news(
          `${plane.name} dosáhl konce životnosti – provoz je dražší, zvažte nákup nového.`,
          this.position(plane),
        );
      }
    }
  }

  private changed(): void {
    this.game.events.emit('aircraftChanged');
  }
}
