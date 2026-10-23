import {
  LOADING_PER_DAY,
  OLD_TRAIN_COST_FACTOR,
  ROAD_VEHICLE_LIFETIME_YEARS,
  ROAD_VEHICLE_MODELS,
  TRAIN_LOADING_DAYS,
  TRAIN_MIN_SELL,
  TRAIN_SELL_REFUND,
  type RoadVehicleModel,
} from './balance';
import { CARGOS, isFreight, type Cargo } from './cargo';
import { formatMoney, type Game } from './game';
import { TileType, type TilePos } from '../world/map';
import type { Depot, Station } from '../world/rail';
import { findRoadRoute, roadMoves } from '../world/roadRoute';
import { JUNCTION_STOP_GAP, junctionPriorities, reservesJunction } from './roadJunctions';
import type { TrafficLights } from './trafficLights';
import type { RoadTrafficObstacle } from './cityTraffic';

const DAYS_PER_YEAR = 365.25;
const LOST_RETRY_DAYS = 5;
// Auto čekající na plné naložení zkouší doložit jednou denně
const FULL_LOAD_CHECK_DAYS = 1;
// Před zavřenou závorou auto zastaví tak, aby do ní nenarazilo (polovina délky auta)
const CROSSING_GAP = 0.2;
// Odstup aut za sebou (délka auta s mezerou) a šířka pruhu pro rozpoznání auta před sebou
const VEHICLE_GAP = 0.5;
const LANE_WIDTH = 0.3;
export const ROAD_LANE_OFFSET = 0.16;
const CAR_CLEARANCE = 0.42;
const MOVEMENT_STEP = 0.04;

export type RoadVehicleState = 'depot' | 'running' | 'loading' | 'lost';

// Autobus nebo nákladní auto; náklad určuje model. Jede po středech dlaždic cesty (path),
// pos je vzdálenost od první dlaždice v dlaždicích.
export interface RoadVehicle {
  id: number;
  name: string;
  modelId: string;
  depotId: number;
  orders: number[] | null;
  fullLoad: number[];
  // Index zastávky v řádu, −1 = jede do garáže
  target: number;
  state: RoadVehicleState;
  path: TilePos[];
  pos: number;
  waitDays: number;
  // Náklad na palubě (cestující nebo tuny)
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

export function roadVehicleModel(vehicle: RoadVehicle): RoadVehicleModel {
  return ROAD_VEHICLE_MODELS.find((m) => m.id === vehicle.modelId)!;
}

export function vehicleCargo(vehicle: RoadVehicle): Cargo {
  return roadVehicleModel(vehicle).cargo;
}

// Druh vozidla v mužském rodě, aby seděly zprávy „… přivezl …“
export function vehicleKind(cargo: Cargo): string {
  if (cargo === 'passengers') return 'Autobus';
  if (cargo === 'mail') return 'Poštovní vůz';
  return 'Nákladní vůz';
}

export function formatVehicleLoad(vehicle: RoadVehicle): string {
  const model = roadVehicleModel(vehicle);
  return `${vehicle.passengers} / ${model.capacity} ${CARGOS[model.cargo].unit}`;
}

export function vehicleAge(vehicle: RoadVehicle, today: number): number {
  return Math.max(0, today - vehicle.builtDay) / DAYS_PER_YEAR;
}

export function isOldVehicle(vehicle: RoadVehicle, today: number): boolean {
  return vehicleAge(vehicle, today) >= ROAD_VEHICLE_LIFETIME_YEARS;
}

export function vehicleSellPrice(vehicle: RoadVehicle, today: number): number {
  const worn = Math.min(1, vehicleAge(vehicle, today) / ROAD_VEHICLE_LIFETIME_YEARS);
  const factor = TRAIN_SELL_REFUND - (TRAIN_SELL_REFUND - TRAIN_MIN_SELL) * worn;
  return Math.round(roadVehicleModel(vehicle).price * factor);
}

export function vehicleRunningCost(vehicle: RoadVehicle, today: number): number {
  const base = roadVehicleModel(vehicle).runningCost;
  return isOldVehicle(vehicle, today) ? base * OLD_TRAIN_COST_FACTOR : base;
}

// Bod na cestě a směr jízdy (jednotkový vektor) ve vzdálenosti pos
export function vehiclePoint(path: TilePos[], pos: number): { x: number; y: number; dx: number; dy: number } {
  if (path.length === 0) return { x: 0, y: 0, dx: 1, dy: 0 };
  if (path.length === 1) return { x: path[0].x + 0.5, y: path[0].y + 0.5, dx: 1, dy: 0 };
  const turn = Math.round(pos);
  if (turn > 0 && turn < path.length - 1 && Math.abs(pos - turn) <= 0.5) {
    const previous = path[turn - 1];
    const corner = path[turn];
    const next = path[turn + 1];
    const incoming = { x: corner.x - previous.x, y: corner.y - previous.y };
    const outgoing = { x: next.x - corner.x, y: next.y - corner.y };
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const cornerCenter = { x: corner.x + 0.5, y: corner.y + 0.5 };
    const startCenter = {
      x: cornerCenter.x - incoming.x * 0.5,
      y: cornerCenter.y - incoming.y * 0.5,
    };
    if (incoming.x === -outgoing.x && incoming.y === -outgoing.y) {
      const t = pos - (turn - 0.5);
      const start = {
        x: startCenter.x - incoming.y * ROAD_LANE_OFFSET,
        y: startCenter.y + incoming.x * ROAD_LANE_OFFSET,
      };
      const end = {
        x: startCenter.x - outgoing.y * ROAD_LANE_OFFSET,
        y: startCenter.y + outgoing.x * ROAD_LANE_OFFSET,
      };
      const controlDistance = 0.35;
      const firstControl = {
        x: start.x + incoming.x * controlDistance,
        y: start.y + incoming.y * controlDistance,
      };
      const secondControl = {
        x: end.x - outgoing.x * controlDistance,
        y: end.y - outgoing.y * controlDistance,
      };
      const inverse = 1 - t;
      const x =
        inverse ** 3 * start.x +
        3 * inverse ** 2 * t * firstControl.x +
        3 * inverse * t ** 2 * secondControl.x +
        t ** 3 * end.x;
      const y =
        inverse ** 3 * start.y +
        3 * inverse ** 2 * t * firstControl.y +
        3 * inverse * t ** 2 * secondControl.y +
        t ** 3 * end.y;
      const tangentX =
        3 * inverse ** 2 * (firstControl.x - start.x) +
        6 * inverse * t * (secondControl.x - firstControl.x) +
        3 * t ** 2 * (end.x - secondControl.x);
      const tangentY =
        3 * inverse ** 2 * (firstControl.y - start.y) +
        6 * inverse * t * (secondControl.y - firstControl.y) +
        3 * t ** 2 * (end.y - secondControl.y);
      const length = Math.hypot(tangentX, tangentY) || 1;
      return { x, y, dx: tangentX / length, dy: tangentY / length };
    }
    if (cross !== 0) {
      const radius = 0.5;
      const centerX = cornerCenter.x - incoming.x * radius + outgoing.x * radius;
      const centerY = cornerCenter.y - incoming.y * radius + outgoing.y * radius;
      const startX = -outgoing.x * radius;
      const startY = -outgoing.y * radius;
      const endX = incoming.x * radius;
      const endY = incoming.y * radius;
      const startAngle = Math.atan2(startY, startX);
      let angleDelta = Math.atan2(endY, endX) - startAngle;
      if (cross > 0) {
        while (angleDelta <= 0) angleDelta += Math.PI * 2;
      } else {
        while (angleDelta >= 0) angleDelta -= Math.PI * 2;
      }
      const t = pos - (turn - 0.5);
      const angle = startAngle + angleDelta * t;
      const direction = Math.sign(angleDelta);
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const dx = -Math.sin(angle) * direction;
      const dy = Math.cos(angle) * direction;
      return { x: x - dy * ROAD_LANE_OFFSET, y: y + dx * ROAD_LANE_OFFSET, dx, dy };
    }
  }
  const i = Math.max(0, Math.min(path.length - 2, Math.floor(pos)));
  const t = Math.max(0, Math.min(1, pos - i));
  const a = path[i];
  const b = path[i + 1];
  // Obrat na místě (A → B → A) má nulový směr; použije se směr k další dlaždici
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x: a.x + 0.5 + dx * t - dy * ROAD_LANE_OFFSET,
    y: a.y + 0.5 + dy * t + dx * ROAD_LANE_OFFSET,
    dx,
    dy,
  };
}

export function safeVehiclePosition(
  path: TilePos[],
  pos: number,
  target: number,
  obstacles: readonly RoadTrafficObstacle[],
  vehicleId?: number,
): number {
  const start = vehiclePoint(path, pos);
  let safe = pos;
  const direction = Math.sign(target - pos);
  if (direction === 0) return pos;
  for (
    let candidate = pos + direction * Math.min(Math.abs(target - pos), MOVEMENT_STEP);
    direction > 0 ? candidate <= target : candidate >= target;
  ) {
    const point = vehiclePoint(path, candidate);
    const blocked = obstacles.some((other) => {
      if (other.path.length === 0) return false;
      const obstacle = vehiclePoint(other.path, other.pos);
      const direction = point.dx * obstacle.dx + point.dy * obstacle.dy;
      const ox = obstacle.x - point.x;
      const oy = obstacle.y - point.y;
      const along = ox * point.dx + oy * point.dy;
      if (direction > 0.5 && along < 0) return false;
      if (
        vehicleId !== undefined &&
        other.id !== undefined &&
        vehicleId < other.id &&
        Math.hypot(start.x - obstacle.x, start.y - obstacle.y) < 0.001
      ) {
        return false;
      }
      const distance = Math.hypot(ox, oy);
      const clearance = direction > 0.5 ? CAR_CLEARANCE : ROAD_LANE_OFFSET * 1.5;
      const startDistance = Math.hypot(start.x - obstacle.x, start.y - obstacle.y);
      return distance < clearance && !(startDistance < clearance && distance > startDistance);
    });
    if (blocked) break;
    safe = candidate;
    if (candidate === target) break;
    candidate += direction * Math.min(Math.abs(target - candidate), MOVEMENT_STEP);
  }
  return safe;
}

// Silniční vozidla společnosti: nákup, jízdní řád a jízda po silnicích
export class RoadFleet {
  readonly vehicles: RoadVehicle[] = [];
  nextId = 1;
  private pedestrianCrossings: ReadonlySet<number> = new Set();
  private trafficObstacles: readonly RoadTrafficObstacle[] = [];
  private trafficLights?: TrafficLights;

  constructor(private readonly game: Game) {
    game.clock.events.on('month', () => this.chargeRunningCosts());
    game.clock.events.on('year', (ended) => {
      for (const m of ROAD_VEHICLE_MODELS) {
        if (m.year === ended + 1) game.news(`Nové silniční vozidlo k dispozici: ${m.name}.`);
      }
      for (const v of this.vehicles) {
        v.lastIncome = v.income;
        v.lastCosts = v.costs;
        v.income = 0;
        v.costs = 0;
      }
    });
    game.events.on('railChanged', () => this.revalidate());
    game.events.on('roadsChanged', () => this.revalidate());
  }

  setPedestrianCrossings(tiles: ReadonlySet<number>): void {
    this.pedestrianCrossings = tiles;
  }

  setTrafficObstacles(vehicles: readonly RoadTrafficObstacle[]): void {
    this.trafficObstacles = vehicles;
  }

  setTrafficLights(trafficLights: TrafficLights): void {
    this.trafficLights = trafficLights;
  }

  // Od každého nákladu nejnovější model, který už se vyrábí
  available(): RoadVehicleModel[] {
    const year = this.game.clock.date.year;
    return ROAD_VEHICLE_MODELS.filter((m) => m.year <= year);
  }

  inDepot(depot: Depot): RoadVehicle[] {
    return this.vehicles.filter((v) => v.depotId === depot.id);
  }

  buy(depot: Depot, model: RoadVehicleModel): string | null {
    if (this.game.money < model.price) return `Nedostatek peněz (${formatMoney(model.price)}).`;
    this.game.spend(model.price, 'vehicles');
    const id = this.nextId++;
    this.vehicles.push({
      id,
      name: `${vehicleKind(model.cargo)} ${id}`,
      modelId: model.id,
      depotId: depot.id,
      orders: null,
      fullLoad: [],
      target: 0,
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

  sell(vehicle: RoadVehicle): void {
    if (vehicle.state !== 'depot') return;
    this.game.refund(vehicleSellPrice(vehicle, this.game.clock.day), 'vehicles');
    this.vehicles.splice(this.vehicles.indexOf(vehicle), 1);
    this.changed();
  }

  // Chyba řádu, nebo null: aspoň dvě zastávky aut, sousední různé
  ordersError(orders: number[]): string | null {
    if (orders.length < 2) return 'Jízdní řád potřebuje aspoň dvě zastávky.';
    if (orders.some((id) => this.stop(id) === undefined)) return 'Auta zastavují jen na zastávkách aut.';
    if (orders.some((id, i) => id === orders[(i + 1) % orders.length])) {
      return 'Stejná zastávka nesmí následovat po sobě.';
    }
    return null;
  }

  // Vypraví auto z garáže na první zastávku řádu
  start(vehicle: RoadVehicle, orders: number[]): string | null {
    const error = this.ordersError(orders);
    if (error) return error;
    const depot = this.depot(vehicle);
    if (vehicle.state !== 'depot' || !depot) return null;
    vehicle.orders = [...orders];
    vehicle.fullLoad = vehicle.fullLoad.filter((id) => orders.includes(id));
    vehicle.target = 0;
    const route = this.routeTo(depot, vehicle);
    if (!route) {
      this.changed();
      return `Z garáže nevede silnice k zastávce ${this.stationName(orders[0])}.`;
    }
    vehicle.path = route;
    vehicle.pos = 0;
    vehicle.state = 'running';
    this.changed();
    return null;
  }

  // Změna řádu za jízdy; cíl se zachová, pokud v novém řádu zůstal
  setOrders(vehicle: RoadVehicle, orders: number[]): string | null {
    if (vehicle.state === 'depot' && orders.length < 2) {
      vehicle.orders = orders.length > 0 ? orders : null;
      this.changed();
      return null;
    }
    const error = this.ordersError(orders);
    if (error) return error;
    const current = vehicle.orders && vehicle.target >= 0 ? vehicle.orders[vehicle.target] : undefined;
    vehicle.orders = [...orders];
    vehicle.fullLoad = vehicle.fullLoad.filter((id) => orders.includes(id));
    if (vehicle.target !== -1) {
      const kept = current === undefined ? -1 : orders.indexOf(current);
      if (kept >= 0) vehicle.target = kept;
      else {
        vehicle.target = 0;
        if (vehicle.state === 'running') this.replan(vehicle);
      }
    }
    this.changed();
    return null;
  }

  toggleFullLoad(vehicle: RoadVehicle, stationId: number): void {
    const i = vehicle.fullLoad.indexOf(stationId);
    if (i >= 0) vehicle.fullLoad.splice(i, 1);
    else vehicle.fullLoad.push(stationId);
    this.changed();
  }

  // Pošle auto do nejbližší garáže; tam zůstane stát
  sendToDepot(vehicle: RoadVehicle): void {
    if (vehicle.state === 'depot' || vehicle.target === -1) return;
    vehicle.target = -1;
    this.replan(vehicle);
  }

  update(days: number): void {
    if (days <= 0) return;
    const traffic = [
      ...this.vehicles
        .filter((vehicle) => vehicle.state !== 'depot' && vehicle.path.length > 0)
        .map(({ id, path, pos }) => ({ id, path, pos })),
      ...this.trafficObstacles,
    ];
    const priorities = junctionPriorities(traffic, this.game.world.rail);
    for (const vehicle of this.vehicles) {
      switch (vehicle.state) {
        case 'running':
          this.move(vehicle, days, priorities);
          break;
        case 'loading':
          vehicle.waitDays -= days;
          if (vehicle.waitDays <= 0 && !this.fillingUp(vehicle)) this.depart(vehicle);
          break;
        case 'lost':
          vehicle.waitDays -= days;
          if (vehicle.waitDays <= 0) this.replan(vehicle);
          break;
      }
    }
  }

  stationName(id: number): string {
    return this.game.world.rail.stations.find((s) => s.id === id)?.name ?? '?';
  }

  // Kde auto právě je (střed), v garáži poloha garáže
  position(vehicle: RoadVehicle): { x: number; y: number } | undefined {
    if (vehicle.state !== 'depot' && vehicle.path.length > 0) {
      const { x, y } = vehiclePoint(vehicle.path, vehicle.pos);
      return { x, y };
    }
    const depot = this.depot(vehicle);
    return depot && { x: depot.x + 0.5, y: depot.y + 0.5 };
  }

  // Dlaždice, na které auto stojí nebo jede
  tileOf(vehicle: RoadVehicle): TilePos | null {
    if (vehicle.state === 'depot' || vehicle.path.length === 0) return null;
    return vehicle.path[Math.min(vehicle.path.length - 1, Math.round(vehicle.pos))];
  }

  // Důvod, proč dlaždici nejde zbourat, nebo null
  demolitionBlocker(x: number, y: number): string | null {
    for (const vehicle of this.vehicles) {
      const tile = this.tileOf(vehicle);
      if (tile && tile.x === x && tile.y === y) return `Na silnici stojí ${vehicle.name}.`;
      const depot = this.depot(vehicle);
      if (depot && depot.x === x && depot.y === y) return `Garáž patří vozidlu ${vehicle.name}.`;
      if (vehicle.state === 'depot') continue;
      for (const id of vehicle.orders ?? []) {
        const stop = this.stop(id);
        if (stop && stop.x === x && stop.y === y) return `Zastávku ${stop.name} obsluhuje ${vehicle.name}.`;
      }
    }
    return null;
  }

  private move(vehicle: RoadVehicle, days: number, priorities: ReadonlyMap<number, number>): void {
    const { map } = this.game.world;
    const { reservations } = this.game.fleet;
    const end = vehicle.path.length - 1;
    const targetPos = Math.min(
      end,
      vehicle.pos + roadVehicleModel(vehicle).speed * days,
      vehicle.pos + this.roomAhead(vehicle),
    );
    const obstacles = [
      ...this.vehicles
        .filter((other) => other !== vehicle && other.state !== 'depot' && other.path.length > 0)
        .map(({ id, path, pos }) => ({ id, path, pos })),
      ...this.trafficObstacles,
    ];
    let pos = safeVehiclePosition(vehicle.path, vehicle.pos, targetPos, obstacles, vehicle.id);
    let backingOff = false;
    // Vyhodnocuj překážky před stopčárou, ne až při dosažení středu křižovatky.
    for (let k = Math.floor(vehicle.pos + 0.5) + 1; k <= end; k++) {
      const from = vehicle.path[k - 1];
      const to = vehicle.path[k];
      const crossingTile = to.y * map.width + to.x;
      const junction = roadMoves(this.game.world.rail, to.x, to.y).length >= 3;
      const junctionOccupied =
        junction &&
        (this.vehicles.some((other) => {
          if (other === vehicle || other.state === 'depot' || other.path.length === 0) return false;
          return reservesJunction(other.path, other.pos, to.x, to.y, this.game.world.rail);
        }) ||
          this.trafficObstacles.some((other) => {
            return reservesJunction(other.path, other.pos, to.x, to.y, this.game.world.rail);
          }));
      const mustYield =
        junction && priorities.get(crossingTile) !== undefined && priorities.get(crossingTile) !== vehicle.id;
      const redSignal = junction && this.trafficLights !== undefined && !this.trafficLights.allows(from, to);
      const blocked = this.pedestrianCrossings.has(crossingTile) || junctionOccupied || mustYield || redSignal;
      const gap = junction && (junctionOccupied || mustYield || redSignal) ? JUNCTION_STOP_GAP : CROSSING_GAP;
      if (k - 0.5 - gap > pos) break;
      if (blocked && vehicle.pos < k - 0.5) {
        const stopPos = k - 0.5 - gap;
        if (stopPos < vehicle.pos) {
          if (redSignal) {
            pos = vehicle.pos;
          } else {
            pos = safeVehiclePosition(vehicle.path, vehicle.pos, stopPos, obstacles, vehicle.id);
            backingOff = true;
          }
        } else {
          pos = Math.min(pos, stopPos);
        }
        break;
      }
      // Před zavřenou závorou auto stojí; kdo už k ní dojel před zavřením, projede
      const closed = map.get(to.x, to.y) === TileType.Crossing && reservations.ownerAt(to.x, to.y) !== undefined;
      if (closed && vehicle.pos <= k - 0.5 - CROSSING_GAP) {
        pos = k - 0.5 - CROSSING_GAP;
        break;
      }
      if (k - 0.5 > pos) break;
      if (!roadMoves(this.game.world.rail, from.x, from.y).some((t) => t.x === to.x && t.y === to.y)) {
        this.replan(vehicle);
        return;
      }
      vehicle.tiles++;
    }
    vehicle.pos = backingOff ? pos : Math.max(vehicle.pos, pos);
    if (vehicle.pos >= end) this.arrive(vehicle);
  }

  // Kolik smí auto popojet, než dojede auto před sebou ve stejném pruhu (jedoucí stejným směrem)
  private roomAhead(vehicle: RoadVehicle): number {
    const me = vehiclePoint(vehicle.path, vehicle.pos);
    let room = Infinity;
    for (const other of this.vehicles) {
      if (other === vehicle || other.state === 'depot' || other.path.length === 0) continue;
      room = Math.min(room, this.roomTo(me, vehicle, other));
    }
    for (const other of this.trafficObstacles) {
      if (other.path.length === 0) continue;
      room = Math.min(room, this.roomTo(me, vehicle, other));
    }
    return room;
  }

  private roomTo(me: ReturnType<typeof vehiclePoint>, vehicle: RoadVehicle, other: RoadTrafficObstacle): number {
    const it = vehiclePoint(other.path, other.pos);
    if (me.dx * it.dx + me.dy * it.dy <= 0.5) return Infinity;
    const ox = it.x - me.x;
    const oy = it.y - me.y;
    const along = ox * me.dx + oy * me.dy;
    const lateral = Math.abs(ox * me.dy - oy * me.dx);
    // Na stejném místě (např. oba vyjíždejí z garáže) pouští dřív koupené auto
    const ahead = along > 0 || (along === 0 && (other.id === undefined || other.id < vehicle.id));
    return ahead && lateral < LANE_WIDTH ? Math.max(0, along - VEHICLE_GAP) : Infinity;
  }

  private arrive(vehicle: RoadVehicle): void {
    const last = vehicle.path[vehicle.path.length - 1];
    if (vehicle.target === -1) {
      const depot = this.game.world.rail.roadDepotAt(last.x, last.y);
      if (depot) vehicle.depotId = depot.id;
      vehicle.state = 'depot';
      vehicle.path = [];
      vehicle.pos = 0;
      const load = vehicle.passengers > 0 ? ` s nákladem ${formatVehicleLoad(vehicle)}` : '';
      this.game.news(`${vehicle.name} dorazil do garáže${load}.`, this.position(vehicle));
      this.changed();
      return;
    }
    vehicle.state = 'loading';
    vehicle.waitDays = TRAIN_LOADING_DAYS;
    const station = this.goal(vehicle);
    if (station) vehicle.waitDays += this.exchange(vehicle, station) / LOADING_PER_DAY;
    this.changed();
  }

  private exchange(vehicle: RoadVehicle, station: Station, loadOnly = false): number {
    const model = roadVehicleModel(vehicle);
    const hold = { atPlatform: model.capacity, capacity: model.capacity, speed: model.speed };
    const { cargo } = model;
    if (isFreight(cargo)) return this.game.freight.exchange(vehicle, hold, station, cargo, loadOnly);
    return this.game.passengers.exchange(vehicle, hold, station, loadOnly);
  }

  // Na zastávce s „Do plna“ doloží náklad; vrací true, když má auto dál čekat
  private fillingUp(vehicle: RoadVehicle): boolean {
    const station = this.goal(vehicle);
    if (!station || !vehicle.fullLoad.includes(station.id)) return false;
    this.exchange(vehicle, station, true);
    if (vehicle.passengers >= roadVehicleModel(vehicle).capacity) return false;
    vehicle.waitDays = FULL_LOAD_CHECK_DAYS;
    this.changed();
    return true;
  }

  isFillingUp(vehicle: RoadVehicle): boolean {
    const station = vehicle.state === 'loading' ? this.goal(vehicle) : null;
    return (
      station !== null &&
      vehicle.fullLoad.includes(station.id) &&
      vehicle.passengers < roadVehicleModel(vehicle).capacity
    );
  }

  private depart(vehicle: RoadVehicle): void {
    if (vehicle.orders && vehicle.target !== -1) vehicle.target = (vehicle.target + 1) % vehicle.orders.length;
    this.replan(vehicle);
  }

  // Naplánuje cestu k cíli z místa, kde auto je; jedoucí auto dojede rozjetý úsek
  private replan(vehicle: RoadVehicle): void {
    const { path } = vehicle;
    const i = Math.max(0, Math.min(path.length - 1, Math.floor(vehicle.pos)));
    const here = path[i] ?? this.depot(vehicle);
    if (!here) {
      this.lose(vehicle);
      return;
    }
    const next = vehicle.state === 'running' && i + 1 < path.length ? path[i + 1] : null;
    const fromNext =
      next && roadMoves(this.game.world.rail, here.x, here.y).some((t) => t.x === next.x && t.y === next.y)
        ? this.routeTo(next, vehicle)
        : null;
    if (fromNext && next) {
      vehicle.path = [here, ...fromNext];
      vehicle.pos -= i;
    } else {
      const route = this.routeTo(here, vehicle);
      if (!route) {
        this.lose(vehicle);
        return;
      }
      vehicle.path = route;
      vehicle.pos = 0;
    }
    vehicle.state = 'running';
    if (vehicle.path.length === 1) this.arrive(vehicle);
    this.changed();
  }

  private lose(vehicle: RoadVehicle): void {
    if (vehicle.state !== 'lost') this.game.news(`${vehicle.name} nemůže najít cestu.`, this.position(vehicle));
    vehicle.state = 'lost';
    vehicle.waitDays = LOST_RETRY_DAYS;
    this.changed();
  }

  // Do garáže kterékoli (nejbližší), jinak na cílovou zastávku
  private routeTo(start: TilePos, vehicle: RoadVehicle): TilePos[] | null {
    const { rail } = this.game.world;
    if (vehicle.target === -1) {
      return findRoadRoute(rail, start, (x, y) => rail.roadDepotAt(x, y) !== undefined);
    }
    const goal = this.goal(vehicle);
    if (!goal) return null;
    return findRoadRoute(rail, start, (x, y) => x === goal.x && y === goal.y);
  }

  private goal(vehicle: RoadVehicle): Station | null {
    if (vehicle.target === -1 || !vehicle.orders) return null;
    return this.stop(vehicle.orders[vehicle.target]) ?? null;
  }

  // Po změně silnic přeplánuje jedoucí auta s neplatnou cestou; auta v garáži zapomenou zbořené zastávky
  private revalidate(): void {
    const { rail } = this.game.world;
    for (const vehicle of this.vehicles) {
      if (vehicle.state === 'depot' && vehicle.orders) {
        const kept = vehicle.orders.filter((id) => this.stop(id));
        vehicle.orders = kept.length > 0 ? kept : null;
      }
      if (vehicle.state !== 'running') continue;
      const from = Math.max(0, Math.floor(vehicle.pos));
      const valid = vehicle.path
        .slice(from + 1)
        .every((t, k) =>
          roadMoves(rail, vehicle.path[from + k].x, vehicle.path[from + k].y).some((m) => m.x === t.x && m.y === t.y),
        );
      if (!valid || (vehicle.target !== -1 && !this.goal(vehicle))) this.replan(vehicle);
    }
  }

  private chargeRunningCosts(): void {
    const today = this.game.clock.day;
    for (const vehicle of this.vehicles) {
      const monthly = vehicleRunningCost(vehicle, today) / 12;
      this.game.spend(monthly, 'running');
      vehicle.costs += monthly;
      if (isOldVehicle(vehicle, today) && !vehicle.agingWarned) {
        vehicle.agingWarned = true;
        this.game.news(
          `${vehicle.name} dosáhl konce životnosti – provoz je dražší, zvažte nákup nového.`,
          this.position(vehicle),
        );
      }
    }
  }

  depot(vehicle: RoadVehicle): Depot | undefined {
    return this.game.world.rail.roadDepots.find((d) => d.id === vehicle.depotId);
  }

  private stop(id: number): Station | undefined {
    return this.game.world.rail.stations.find((s) => s.id === id && s.kind === 'road');
  }

  private changed(): void {
    this.game.events.emit('vehiclesChanged');
  }
}
