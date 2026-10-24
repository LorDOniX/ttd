import type { RoadVehicle } from './roadVehicles';
import { TileType, type GameMap, type TilePos } from '../world/map';
import type { RailNetwork } from '../world/rail';
import { roadMoves } from '../world/roadRoute';
import { JUNCTION_STOP_GAP, junctionPriorities, reservesJunction } from './roadJunctions';
import type { Town } from '../world/town';
import { safeVehiclePosition, vehiclePoint } from './roadVehicles';
import { Rng } from '../world/rng';
import type { TrafficLights } from './trafficLights';

const CARS_PER_RESIDENT = 1 / 300;
// Městská auta z car kitu, která si hráč nemůže koupit: osobní vozy, taxi a městské služby;
// weight je relativní četnost, speed v dlaždicích za den jako u hráčových aut
const CITY_CAR_TYPES = [
  { model: 'sedan', weight: 6, speed: 2.8 },
  { model: 'hatchback-sports', weight: 4, speed: 3.1 },
  { model: 'suv', weight: 4, speed: 2.8 },
  { model: 'taxi', weight: 4, speed: 3.1 },
  { model: 'sedan-sports', weight: 2, speed: 3.4 },
  { model: 'suv-luxury', weight: 2, speed: 3.1 },
  { model: 'delivery-flat', weight: 1.5, speed: 2.4 },
  { model: 'police', weight: 1, speed: 3.4 },
  { model: 'ambulance', weight: 1, speed: 3.1 },
  { model: 'firetruck', weight: 0.5, speed: 2.6 },
] as const;
export const CITY_CAR_MODELS: readonly string[] = CITY_CAR_TYPES.map(({ model }) => model);
const CITY_CAR_WEIGHT = CITY_CAR_TYPES.reduce((sum, { weight }) => sum + weight, 0);
// Ekvivalent rychlostí v herních dnech při běžném tempu hodin (365,25 dne za 15 minut).
const toGameSpeed = (speed: number): number => (speed * 365.25) / (15 * 60);
const VEHICLE_GAP = 0.5;
const LANE_WIDTH = 0.3;
const STUCK_SECONDS_BEFORE_DETOUR = (1.5 * (15 * 60)) / 365.25;
const DETOUR_LOOKAHEAD = 4;

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
    const priorities = junctionPriorities(traffic, this.rail);
    for (const car of this.cars) this.move(car, seconds, crossings, playerObstacles, priorities);
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

  private createCar(townId: number, roads: TilePos[], playerVehicles: readonly RoadVehicle[]): CityCar | null {
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
      if (
        this.cars.some(
          (car) =>
            Math.hypot(
              vehiclePoint(car.path, car.pos).x - start.x - 0.5,
              vehiclePoint(car.path, car.pos).y - start.y - 0.5,
            ) < VEHICLE_GAP,
        ) ||
        playerVehicles.some((vehicle) => {
          if (vehicle.state === 'depot' || vehicle.path.length === 0) return false;
          const point = vehiclePoint(vehicle.path, vehicle.pos);
          return Math.hypot(point.x - start.x - 0.5, point.y - start.y - 0.5) < VEHICLE_GAP;
        })
      ) {
        continue;
      }
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
    return null;
  }

  private nextTile(townId: number, from: TilePos, previous: TilePos | null): TilePos | null {
    const options = roadMoves(this.rail, from.x, from.y).filter(
      (tile) =>
        this.map.getOwner(tile.x, tile.y) === townId && (!previous || tile.x !== previous.x || tile.y !== previous.y),
    );
    const candidates =
      options.length > 0
        ? options
        : roadMoves(this.rail, from.x, from.y).filter((tile) => this.map.getOwner(tile.x, tile.y) === townId);
    return candidates.length > 0 ? candidates[this.rng.int(0, candidates.length - 1)] : null;
  }

  private move(
    car: CityCar,
    seconds: number,
    crossings: ReadonlySet<number>,
    playerVehicles: readonly RoadTrafficObstacle[],
    priorities: ReadonlyMap<number, number>,
  ): void {
    if (seconds <= 0) return;
    const town = this.towns[car.townId];
    const end = car.path.length - 1;
    const crowdAhead = roomAhead(car.path, car.pos, [...this.cars.filter((other) => other !== car), ...playerVehicles]);
    let pos = Math.min(end, car.pos + car.speed * seconds, car.pos + crowdAhead);
    let blocked = false;
    let redSignalWaiting = false;
    for (let k = Math.floor(car.pos + 0.5) + 1; k <= end; k++) {
      const tile = car.path[k];
      const junction = roadMoves(this.rail, tile.x, tile.y).length >= 3;
      const occupied = junction && this.junctionOccupied(tile, car, playerVehicles);
      const tileIndex = tile.y * this.map.width + tile.x;
      const mustYield = junction && priorities.get(tileIndex) !== undefined && priorities.get(tileIndex) !== -car.id;
      const pedestrian = crossings.has(tile.y * this.map.width + tile.x);
      const redSignal =
        junction && this.trafficLights !== undefined && !this.trafficLights.allows(car.path[k - 1], tile);
      redSignalWaiting ||= redSignal;
      const junctionBlocked = occupied || mustYield || pedestrian || redSignal;
      const gap = junction && (occupied || mustYield || redSignal) ? JUNCTION_STOP_GAP : VEHICLE_GAP / 2;
      if (k - 0.5 - gap > pos) break;
      if (junctionBlocked && car.pos < k - 0.5) {
        const stopPos = k - 0.5 - gap;
        pos = Math.min(pos, redSignal ? Math.max(car.pos, stopPos) : stopPos);
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
      if (
        !redSignalWaiting &&
        car.stuckSeconds >= STUCK_SECONDS_BEFORE_DETOUR &&
        town &&
        !this.detour(car, crossings, playerVehicles)
      ) {
        this.backOutOfJunction(car, playerVehicles);
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

  private detour(
    car: CityCar,
    crossings: ReadonlySet<number>,
    playerVehicles: readonly RoadTrafficObstacle[],
  ): boolean {
    const current = car.path[Math.floor(car.pos)];
    const target = car.path[Math.min(car.path.length - 1, Math.floor(car.pos) + DETOUR_LOOKAHEAD)];
    if (!current || !target) return false;
    const blockedTiles = new Set(
      [
        ...this.cars
          .filter((other) => other !== car)
          .map((other) => {
            const tile = other.path[Math.round(other.pos)];
            return tile && tile.y * this.map.width + tile.x;
          }),
        ...playerVehicles.map((other) => {
          const tile = other.path[Math.round(other.pos)];
          return tile && tile.y * this.map.width + tile.x;
        }),
      ].filter((index): index is number => index !== undefined),
    );
    const start = current.y * this.map.width + current.x;
    const goal = target.y * this.map.width + target.x;
    const parents = new Map<number, number>([[start, -1]]);
    const queue = [start];
    for (let head = 0; head < queue.length && !parents.has(goal); head++) {
      const index = queue[head];
      const x = index % this.map.width;
      const y = Math.floor(index / this.map.width);
      for (const next of roadMoves(this.rail, x, y)) {
        const nextIndex = next.y * this.map.width + next.x;
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
    const route: TilePos[] = [];
    if (parents.has(goal)) {
      for (let index = goal; index !== -1; index = parents.get(index)!) {
        route.push({ x: index % this.map.width, y: Math.floor(index / this.map.width) });
      }
      route.reverse();
    }
    if (!route || route.length < 3) return false;
    car.path = route;
    car.pos = 0;
    car.stuckSeconds = 0;
    return true;
  }

  private backOutOfJunction(car: CityCar, playerVehicles: readonly RoadTrafficObstacle[]): void {
    const nextJunction = car.path.findIndex(
      (tile, index) => index > Math.floor(car.pos) && roadMoves(this.rail, tile.x, tile.y).length >= 3,
    );
    if (nextJunction < 1) return;
    const stopPos = nextJunction - 0.5 - JUNCTION_STOP_GAP;
    if (stopPos >= car.pos) return;
    const obstacles = [
      ...this.cars.filter((other) => other !== car).map(({ id, path, pos }) => ({ id: -id, path, pos })),
      ...playerVehicles,
    ];
    const position = safeVehiclePosition(car.path, car.pos, stopPos, obstacles, -car.id);
    if (position >= car.pos) return;
    car.pos = position;
    car.stuckSeconds = 0;
  }
}
