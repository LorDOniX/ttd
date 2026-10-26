import type { RoadVehicle } from './roadVehicles';
import { TileType, type GameMap, type TilePos } from '../world/map';
import type { RailNetwork } from '../world/rail';
import { roadMoves } from '../world/roadRoute';
import {
  JUNCTION_CLEARANCE,
  JUNCTION_STOP_GAP,
  RED_SIGNAL_STOP_GAP,
  junctionPriorities,
  reservesJunction,
} from './roadJunctions';
import type { Town } from '../world/town';
import { safeVehiclePosition, vehiclePoint } from './roadVehicles';
import { Rng } from '../world/rng';
import type { TrafficLights } from './trafficLights';

const CARS_PER_RESIDENT = 1 / 300;
// Městská auta z car kitu, která si hráč nemůže koupit: osobní vozy, taxi a městské služby;
// weight je relativní četnost, speed v dlaždicích za den jako u hráčových aut
const CITY_CAR_TYPES = [
  { model: 'sedan', name: 'Osobní auto', weight: 6, speed: 2.8 },
  { model: 'hatchback-sports', name: 'Hatchback', weight: 4, speed: 3.1 },
  { model: 'suv', name: 'SUV', weight: 4, speed: 2.8 },
  { model: 'taxi', name: 'Taxi', weight: 4, speed: 3.1 },
  { model: 'sedan-sports', name: 'Sportovní auto', weight: 2, speed: 3.4 },
  { model: 'suv-luxury', name: 'Luxusní SUV', weight: 2, speed: 3.1 },
  { model: 'delivery-flat', name: 'Dodávka', weight: 1.5, speed: 2.4 },
  { model: 'police', name: 'Policie', weight: 1, speed: 3.4 },
  { model: 'ambulance', name: 'Sanitka', weight: 1, speed: 3.1 },
  { model: 'firetruck', name: 'Hasiči', weight: 0.5, speed: 2.6 },
] as const;
export const CITY_CAR_MODELS: readonly string[] = CITY_CAR_TYPES.map(({ model }) => model);
export const cityCarName = (model: string): string =>
  CITY_CAR_TYPES.find((type) => type.model === model)?.name ?? 'Auto';
const CITY_CAR_WEIGHT = CITY_CAR_TYPES.reduce((sum, { weight }) => sum + weight, 0);
// Ekvivalent rychlostí v herních dnech při běžném tempu hodin (365,25 dne za 15 minut).
const toGameSpeed = (speed: number): number => (speed * 365.25) / (15 * 60);
const VEHICLE_GAP = 0.5;
const LANE_WIDTH = 0.3;
const STUCK_SECONDS_BEFORE_DETOUR = (1.5 * (15 * 60)) / 365.25;
const DETOUR_LOOKAHEAD = 4;
// Na křižovatce auto nevjede do slepé odbočky takto krátké (v dlaždicích), pokud vede jiná cesta dál
const SHORT_DEAD_END = 3;
// Na křižovatku auto vjede, jen když za ní je místo; jinak by v ní uvízlo a zablokovalo příčný směr
const EXIT_CLEARANCE = 0.45;
// Odstraněné auto se objeví aspoň takto daleko (v dlaždicích), pokud má město dost silnic
const RELOCATE_DISTANCE = 4;

// Doba v herních dnech odpovídající sekundám městského provozu
export const trafficDays = (seconds: number): number => (seconds * 365.25) / (15 * 60);

const sameTile = (a: TilePos | undefined, b: TilePos): boolean => a !== undefined && a.x === b.x && a.y === b.y;

export interface CityCar {
  id: number;
  townId: number;
  model: string;
  speed: number;
  path: TilePos[];
  pos: number;
  stuckSeconds: number;
}

export interface RoadTrafficObstacle {
  id?: number;
  path: TilePos[];
  pos: number;
}

function roomAhead(path: TilePos[], pos: number, others: readonly RoadTrafficObstacle[]): number {
  const me = vehiclePoint(path, pos);
  let room = Infinity;
  for (const other of others) {
    if (other.path.length === 0) continue;
    const it = vehiclePoint(other.path, other.pos);
    if (me.dx * it.dx + me.dy * it.dy <= 0.5) continue;
    const ox = it.x - me.x;
    const oy = it.y - me.y;
    const along = ox * me.dx + oy * me.dy;
    const lateral = Math.abs(ox * me.dy - oy * me.dx);
    if (along >= 0 && lateral < LANE_WIDTH) {
      room = Math.min(room, Math.max(0, along - VEHICLE_GAP));
    }
  }
  return room;
}

export class CityTraffic {
  readonly cars: CityCar[] = [];
  private readonly rng: Rng;
  private nextId = 1;
  private readonly townRoads = new Map<number, TilePos[]>();
  private roadsVersion = -1;
  private trafficLights?: TrafficLights;

  constructor(
    private readonly map: GameMap,
    private readonly rail: RailNetwork,
    private readonly towns: readonly Town[],
    seed: number,
    roadVersion: number,
    playerVehicles: readonly RoadVehicle[] = [],
  ) {
    this.rng = new Rng(seed ^ 0x6d2b79f5);
    this.reconcile(roadVersion, playerVehicles);
  }

  obstacles(): RoadTrafficObstacle[] {
    return this.cars.map(({ id, path, pos }) => ({ id: -id, path, pos }));
  }

  setTrafficLights(trafficLights: TrafficLights): void {
    this.trafficLights = trafficLights;
  }

  update(
    seconds: number,
    crossings: ReadonlySet<number>,
    playerVehicles: readonly RoadVehicle[],
    roadVersion: number,
  ): void {
    if (roadVersion !== this.roadsVersion) this.reconcile(roadVersion, playerVehicles);
    const playerObstacles = playerVehicles
      .filter((vehicle) => vehicle.state !== 'depot' && vehicle.path.length > 0)
      .map(({ id, path, pos }) => ({ id, path, pos }));
    const traffic = [...this.cars.map(({ id, path, pos }) => ({ id: -id, path, pos })), ...playerObstacles];
    const priorities = junctionPriorities(
      traffic,
      this.rail,
      this.trafficLights && ((from, to) => this.trafficLights!.allows(from, to)),
    );
    const byId = new Map(traffic.map((vehicle) => [vehicle.id, vehicle]));
    for (const car of this.cars) this.move(car, seconds, crossings, playerObstacles, priorities, byId);
  }

  reconcile(roadVersion: number, playerVehicles: readonly RoadVehicle[] = []): void {
    if (roadVersion !== this.roadsVersion) {
      this.refreshRoads();
      this.roadsVersion = roadVersion;
    }
    this.populate(playerVehicles);
  }

  private refreshRoads(): void {
    this.townRoads.clear();
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tileType = this.map.get(x, y);
        if (tileType !== TileType.Road && tileType !== TileType.RoadStop) continue;
        const townId = this.map.getOwner(x, y);
        if (townId < 0) continue;
        const tiles = this.townRoads.get(townId) ?? [];
        tiles.push({ x, y });
        this.townRoads.set(townId, tiles);
      }
    }
  }

  private populate(playerVehicles: readonly RoadVehicle[]): void {
    const byTown = new Map<number, CityCar[]>();
    for (const car of this.cars) {
      const roads = this.townRoads.get(car.townId);
      if (roads?.length && car.path.every((tile) => roads.some((road) => tile.x === road.x && tile.y === road.y))) {
        const cars = byTown.get(car.townId) ?? [];
        cars.push(car);
        byTown.set(car.townId, cars);
      }
    }
    this.cars.length = 0;
    for (const town of this.towns) {
      const roads = this.townRoads.get(town.id);
      if (!roads?.length) continue;
      const target = Math.max(1, Math.min(12, Math.round(town.population * CARS_PER_RESIDENT)));
      const cars = byTown.get(town.id) ?? [];
      this.cars.push(...cars.slice(0, target));
      for (let i = cars.length; i < target; i++) {
        const car = this.createCar(town.id, roads, playerVehicles);
        if (car) this.cars.push(car);
      }
    }
  }

  // Odstraní (zaseknuté) auto a stejné auto vypustí na jiném místě téhož města; false, když se nevejde jinam
  relocate(id: number, playerVehicles: readonly RoadVehicle[] = []): boolean {
    const car = this.cars.find((candidate) => candidate.id === id);
    const roads = car && this.townRoads.get(car.townId);
    if (!car || !roads?.length) return false;
    const old = vehiclePoint(car.path, car.pos);
    const far = roads.filter((tile) => Math.hypot(tile.x + 0.5 - old.x, tile.y + 0.5 - old.y) >= RELOCATE_DISTANCE);
    const others = playerVehicles.filter((vehicle) => vehicle.state !== 'depot');
    const path =
      this.startPath(car.townId, far, others, car) ??
      this.startPath(
        car.townId,
        roads.filter((tile) => Math.hypot(tile.x + 0.5 - old.x, tile.y + 0.5 - old.y) >= 1),
        others,
        car,
      );
    if (!path) return false;
    car.path = path;
    car.pos = 1;
    car.stuckSeconds = 0;
    return true;
  }

  private createCar(townId: number, roads: TilePos[], playerVehicles: readonly RoadVehicle[]): CityCar | null {
    const path = this.startPath(
      townId,
      roads,
      playerVehicles.filter((vehicle) => vehicle.state !== 'depot'),
    );
    if (!path) return null;
    let roll = this.rng.next() * CITY_CAR_WEIGHT;
    const type = CITY_CAR_TYPES.find(({ weight }) => (roll -= weight) < 0) ?? CITY_CAR_TYPES[0];
    return {
      id: this.nextId++,
      townId,
      model: type.model,
      speed: toGameSpeed(type.speed),
      path,
      pos: 1,
      stuckSeconds: 0,
    };
  }

  // Cesta pro auto vypuštěné na náhodné dlaždici z roads, kde nestojí jiné vozidlo (kromě ignored)
  private startPath(
    townId: number,
    roads: TilePos[],
    playerVehicles: readonly RoadTrafficObstacle[],
    ignored?: CityCar,
  ): TilePos[] | null {
    for (let attempt = 0; attempt < roads.length * 2; attempt++) {
      const start = roads[this.rng.int(0, roads.length - 1)];
      const next = this.nextTile(townId, start, null);
      if (!next) continue;
      const previous = this.nextTile(townId, start, next);
      if (!previous) continue;
      const nextNext = this.nextTile(townId, next, start);
      if (!nextNext) continue;
      const path = [previous, start, next, nextNext];
      while (path.length < DETOUR_LOOKAHEAD + 2) {
        const nextTile = this.nextTile(townId, path[path.length - 1], path[path.length - 2]);
        if (!nextTile) break;
        path.push(nextTile);
      }
      const occupied = [...this.cars.filter((car) => car !== ignored), ...playerVehicles].some((vehicle) => {
        if (vehicle.path.length === 0) return false;
        const point = vehiclePoint(vehicle.path, vehicle.pos);
        return Math.hypot(point.x - start.x - 0.5, point.y - start.y - 0.5) < VEHICLE_GAP;
      });
      if (!occupied) return path;
    }
    return null;
  }

  private nextTile(townId: number, from: TilePos, previous: TilePos | null): TilePos | null {
    const all = this.townMoves(townId, from);
    const options = all.filter((tile) => !previous || !sameTile(previous, tile));
    // Na křižovatce se krátké slepé odbočky vynechají, ve slepé ulici se auto na konci otočí
    const through = options.length > 1 ? options.filter((tile) => !this.shortDeadEnd(townId, from, tile)) : options;
    const candidates = through.length > 0 ? through : options.length > 0 ? options : all;
    return candidates.length > 0 ? candidates[this.rng.int(0, candidates.length - 1)] : null;
  }

  private townMoves(townId: number, from: TilePos): TilePos[] {
    return roadMoves(this.rail, from.x, from.y).filter((tile) => this.map.getOwner(tile.x, tile.y) === townId);
  }

  // Dlaždice slepé odbočky z from přes to, končí-li do SHORT_DEAD_END dlaždic bez další křižovatky; jinak null
  private shortDeadEnd(townId: number, from: TilePos, to: TilePos): TilePos[] | null {
    let previous = from;
    let current = to;
    const tiles = [to];
    for (let step = 0; step < SHORT_DEAD_END; step++) {
      const onward = this.townMoves(townId, current).filter((tile) => !sameTile(previous, tile));
      if (onward.length === 0) return tiles;
      if (onward.length > 1) return null;
      previous = current;
      current = onward[0];
      tiles.push(current);
    }
    return null;
  }

  // Je hned za křižovatkou (na indexu k cesty) v pruhu auta jiné vozidlo, nebo kdokoli v krátké slepé
  // odbočce, kam auto míří? V odbočce se obě auta otáčejí a navzájem by se zablokovala.
  private exitBlocked(car: CityCar, k: number, others: readonly RoadTrafficObstacle[]): boolean {
    if (k + 1 >= car.path.length) return false;
    const exit = vehiclePoint(car.path, k + 0.75);
    const stub = this.shortDeadEnd(car.townId, car.path[k], car.path[k + 1]);
    return others.some((other) => {
      if (other.path.length === 0) return false;
      const it = vehiclePoint(other.path, other.pos);
      if (stub?.some((tile) => tile.x === Math.floor(it.x) && tile.y === Math.floor(it.y))) return true;
      // Jinak jen vozidlo ve stejném směru; protisměr (třeba čekající na červenou naproti) výjezd neblokuje
      if (exit.dx * it.dx + exit.dy * it.dy <= 0.5) return false;
      return Math.hypot(it.x - exit.x, it.y - exit.y) < EXIT_CLEARANCE;
    });
  }

  // Míří vozidlo přes křižovatku junction do dlaždice into a ještě do ní nevjelo?
  private headsInto(vehicle: RoadTrafficObstacle | undefined, junction: TilePos, into: TilePos): boolean {
    if (!vehicle) return false;
    for (let i = 1; i < vehicle.path.length - 1; i++) {
      if (sameTile(vehicle.path[i], junction) && sameTile(vehicle.path[i + 1], into) && vehicle.pos < i - 0.5) {
        return true;
      }
    }
    return false;
  }

  private move(
    car: CityCar,
    seconds: number,
    crossings: ReadonlySet<number>,
    playerVehicles: readonly RoadTrafficObstacle[],
    priorities: ReadonlyMap<number, number>,
    byId: ReadonlyMap<number, RoadTrafficObstacle>,
  ): void {
    if (seconds <= 0) return;
    const town = this.towns[car.townId];
    const end = car.path.length - 1;
    const others = [...this.cars.filter((other) => other !== car), ...playerVehicles];
    const crowdAhead = roomAhead(car.path, car.pos, others);
    let pos = Math.min(end, car.pos + car.speed * seconds, car.pos + crowdAhead);
    let blocked = false;
    let redSignalWaiting = false;
    for (let k = Math.floor(car.pos + 0.5) + 1; k <= end; k++) {
      const tile = car.path[k];
      const junction = roadMoves(this.rail, tile.x, tile.y).length >= 3;
      const occupied = junction && this.junctionOccupied(tile, car, playerVehicles);
      const tileIndex = tile.y * this.map.width + tile.x;
      const winner = junction ? priorities.get(tileIndex) : undefined;
      // Auto vyjíždějící ze slepé odbočky nečeká na vozidlo, které do odbočky míří – to čeká na něj
      const leavingStub = junction && this.shortDeadEnd(car.townId, tile, car.path[k - 1]) !== null;
      const mustYield =
        winner !== undefined &&
        winner !== -car.id &&
        !(leavingStub && this.headsInto(byId.get(winner), tile, car.path[k - 1]));
      const pedestrian = crossings.has(tile.y * this.map.width + tile.x);
      const redSignal =
        junction && this.trafficLights !== undefined && !this.trafficLights.allows(car.path[k - 1], tile);
      redSignalWaiting ||= redSignal;
      const exitBlocked = junction && car.pos < k - 0.5 && this.exitBlocked(car, k, others);
      const junctionBlocked = occupied || mustYield || pedestrian || redSignal || exitBlocked;
      const gap =
        junction && redSignal
          ? RED_SIGNAL_STOP_GAP
          : junction && (occupied || mustYield || exitBlocked)
            ? JUNCTION_STOP_GAP
            : VEHICLE_GAP / 2;
      if (k - 0.5 - gap > pos) break;
      // Kdo už zasahuje do křižovatky, toho ostatní vidí jako obsazeného; přednost by vedla k zablokování
      const holdsJunction = car.pos >= k - 0.5 - JUNCTION_CLEARANCE;
      const onlyYield = mustYield && !occupied && !pedestrian && !redSignal && !exitBlocked;
      if (junctionBlocked && car.pos < k - 0.5 && !(holdsJunction && onlyYield)) {
        // Auto, které už je za stopčárou (třeba stálo blíž na červenou), počká na místě, necouvá
        pos = Math.min(pos, Math.max(car.pos, k - 0.5 - gap));
        blocked = true;
        break;
      }
    }
    const safePos = safeVehiclePosition(
      car.path,
      car.pos,
      pos,
      [
        ...this.cars.filter((other) => other !== car).map(({ id, path, pos }) => ({ id: -id, path, pos })),
        ...playerVehicles,
      ],
      -car.id,
    );
    if (safePos < pos) {
      pos = safePos;
      blocked = true;
    }
    if (pos === car.pos && crowdAhead < car.speed * seconds) blocked = true;
    if (blocked) {
      car.pos = pos;
      car.stuckSeconds = redSignalWaiting ? 0 : car.stuckSeconds + seconds;
      // Objížďku zkusí po každých STUCK_SECONDS_BEFORE_DETOUR čekání; bez jiné cesty počká
      const attempts = (stuck: number): number => Math.floor(stuck / STUCK_SECONDS_BEFORE_DETOUR);
      if (!redSignalWaiting && town && attempts(car.stuckSeconds) > attempts(car.stuckSeconds - seconds)) {
        this.detour(car, crossings, playerVehicles);
      }
      return;
    }
    car.stuckSeconds = 0;
    car.pos = pos;
    this.extendPath(car);
  }

  private junctionOccupied(tile: TilePos, car: CityCar, playerVehicles: readonly RoadTrafficObstacle[]): boolean {
    const cityCarOccupies = this.cars.some((other) => {
      if (other === car || other.path.length === 0) return false;
      return reservesJunction(other.path, other.pos, tile.x, tile.y, this.rail);
    });
    if (cityCarOccupies) return true;
    return playerVehicles.some((other) => {
      return reservesJunction(other.path, other.pos, tile.x, tile.y, this.rail);
    });
  }

  private extendPath(car: CityCar): void {
    while (car.pos >= car.path.length - 2) {
      const previous = car.path[car.path.length - 2];
      const current = car.path[car.path.length - 1];
      const next = this.nextTile(car.townId, current, previous);
      if (!next) return;
      car.path.push(next);
    }
    if (car.pos > 3) {
      const removed = Math.floor(car.pos) - 2;
      car.path.splice(0, removed);
      car.pos -= removed;
    }
  }

  // Objede překážku jinou cestou k dlaždici DETOUR_LOOKAHEAD před sebou; začátek cesty až po zatáčku,
  // kterou auto právě projíždí, zůstane stejný, aby auto neposkočilo ani necouvlo
  private detour(
    car: CityCar,
    crossings: ReadonlySet<number>,
    playerVehicles: readonly RoadTrafficObstacle[],
  ): boolean {
    const keep = Math.round(car.pos) + 2;
    const goalIndex = Math.floor(car.pos) + DETOUR_LOOKAHEAD;
    if (goalIndex < keep || goalIndex >= car.path.length) return false;
    const prefix = car.path.slice(0, keep);
    const width = this.map.width;
    const indexOf = (tile: TilePos): number => tile.y * width + tile.x;
    const blockedTiles = new Set(
      [...this.cars.filter((other) => other !== car), ...playerVehicles]
        .map((other) => other.path[Math.round(other.pos)])
        .filter((tile): tile is TilePos => tile !== undefined)
        .map(indexOf),
    );
    const start = indexOf(prefix[keep - 1]);
    const goal = indexOf(car.path[goalIndex]);
    // Předchozí dlaždice je předem „navštívená“, aby objížďka nezačínala otočkou
    const parents = new Map<number, number>([
      [start, -1],
      [indexOf(prefix[keep - 2]), -1],
    ]);
    const queue = [start];
    for (let head = 0; head < queue.length && !parents.has(goal); head++) {
      const index = queue[head];
      for (const next of roadMoves(this.rail, index % width, Math.floor(index / width))) {
        const nextIndex = indexOf(next);
        if (
          parents.has(nextIndex) ||
          this.map.getOwner(next.x, next.y) !== car.townId ||
          blockedTiles.has(nextIndex) ||
          crossings.has(nextIndex)
        ) {
          continue;
        }
        parents.set(nextIndex, index);
        queue.push(nextIndex);
      }
    }
    if (!parents.has(goal) || goal === start) return false;
    const route: TilePos[] = [];
    for (let index = goal; index !== start; index = parents.get(index)!) {
      route.push({ x: index % width, y: Math.floor(index / width) });
    }
    route.reverse();
    // Stejná cesta jako dosud by nic nevyřešila
    if (sameTile(car.path[keep], route[0])) return false;
    car.path = [...prefix, ...route];
    car.stuckSeconds = 0;
    return true;
  }
}
