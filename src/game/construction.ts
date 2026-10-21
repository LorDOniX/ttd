import {
  BRIDGE_PIECE_COST,
  DEMOLISH_COST_PER_RESIDENT,
  DEMOLISH_REFUND,
  DEMOLISH_TOWN_ROAD_COST,
  DEPOT_COST,
  PLATFORM_TILE_COST,
  ROAD_DEPOT_COST,
  ROAD_STOP_COST,
  ROAD_TILE_COST,
  SIGNAL_COST,
  TRACK_PIECE_COST,
} from './balance';
import { formatMoney, type Game } from './game';
import type { World } from '../world/generator';
import { NO_OWNER, TileType, type GameMap, type TilePos } from '../world/map';
import { stationTiles, type Edge, type StationShape } from '../world/rail';
import type { PathStep } from '../world/railPath';
import type { RoadStep } from '../world/roadPath';
import { buildingAt, buildingCapacity, demolishBuilding } from '../world/town';

// Rychlost postupné výstavby kolejí a silnic
const PIECES_PER_SECOND = 25;

export function stationCost(shape: StationShape & { kind?: 'road' }): number {
  if (shape.kind === 'road') return ROAD_STOP_COST;
  return PLATFORM_TILE_COST * shape.length * shape.tracks;
}

// Cena nového dílku koleje: přes vodu se staví most
export function trackPieceCost(map: GameMap, x: number, y: number): number {
  const type = map.get(x, y);
  return type === TileType.Water || type === TileType.Bridge ? BRIDGE_PIECE_COST : TRACK_PIECE_COST;
}

// Cena všech kolejí, nástupišť a dep společnosti, ze které se počítá údržba
export function infrastructureValue(world: World): number {
  const { map, rail } = world;
  let value = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const type = map.get(x, y);
      if (type === TileType.Rail || type === TileType.Crossing || type === TileType.Bridge) {
        value += rail.pieceCount(x, y) * trackPieceCost(map, x, y);
      }
    }
  }
  for (const station of rail.stations) value += stationCost(station);
  return (
    value +
    rail.depots.length * DEPOT_COST +
    rail.roadDepots.length * ROAD_DEPOT_COST +
    rail.signals.size * SIGNAL_COST
  );
}

export type Job = { kind: 'track'; step: PathStep } | { kind: 'road'; step: RoadStep };

export interface DemolishPlan {
  tiles: TilePos[];
  // Kladná částka se platí, záporná se vrací
  cost: number;
  // Důvod, proč demolici nelze provést (např. na koleji stojí vlak)
  blocked: string | null;
}

// Stavba a demolice za peníze společnosti
export class Construction {
  private queue: Job[] = [];
  private elapsed = 0;

  constructor(private readonly game: Game) {}

  get busy(): boolean {
    return this.queue.length > 0;
  }

  // Dosud nepostavené dílky; ukládají se s hrou a platí se až při stavbě
  get pending(): readonly Job[] {
    return this.queue;
  }

  restore(jobs: Job[]): void {
    this.queue = jobs;
    this.elapsed = 0;
  }

  buildTrack(steps: PathStep[]): void {
    this.queue.push(...steps.map((step) => ({ kind: 'track' as const, step })));
  }

  buildRoad(steps: RoadStep[]): void {
    this.queue.push(...steps.map((step) => ({ kind: 'road' as const, step })));
  }

  // Vrací chybovou hlášku, nebo null při úspěchu
  buildStation(shape: StationShape): string | null {
    const { rail } = this.game.world;
    const cost = stationCost(shape);
    if (!rail.canPlaceStation(shape)) return 'Sem nástupiště postavit nelze.';
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    const { name, townId } = this.stationName(shape);
    this.game.spend(cost, 'construction');
    rail.addStation({ ...shape, name, townId });
    this.game.news(`Postaveno nástupiště ${name}.`, shape);
    this.game.events.emit('railChanged');
    return null;
  }

  // Průjezdná zastávka aut na rovné silnici; silnice zůstane městu, které ji vlastní
  buildRoadStop(x: number, y: number): string | null {
    const { rail } = this.game.world;
    const axis = rail.roadStopAxis(x, y);
    if (!axis) return 'Zastávka aut jde jen na rovnou silnici bez křižovatky.';
    if (this.game.money < ROAD_STOP_COST) return `Nedostatek peněz (${formatMoney(ROAD_STOP_COST)}).`;
    const { name, townId } = this.stationName({ x, y, axis, length: 1, tracks: 1 });
    this.game.spend(ROAD_STOP_COST, 'construction');
    rail.addRoadStop(x, y, axis, name, townId);
    this.game.news(`Postavena zastávka aut ${name}.`, { x, y });
    this.game.events.emit('railChanged');
    return null;
  }

  buildRoadDepot(x: number, y: number, entrance: Edge): string | null {
    const { map, rail } = this.game.world;
    if (!map.isFree(x, y)) return 'Garáž jde jen na volnou dlaždici vedle silnice.';
    if (this.game.money < ROAD_DEPOT_COST) return `Nedostatek peněz (${formatMoney(ROAD_DEPOT_COST)}).`;
    this.game.spend(ROAD_DEPOT_COST, 'construction');
    rail.addRoadDepot(x, y, entrance);
    this.game.events.emit('railChanged');
    return null;
  }

  // Jméno podle města s největším dílem v dosahu, jinak podle závodu v dosahu, nakonec nejbližšího města
  private stationName(shape: StationShape): { name: string; townId: number } {
    const { rail, towns } = this.game.world;
    const { x, y } = shape;
    const nearest = [...towns].sort(
      (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
    )[0];
    const covered = [...this.game.passengers.coverage(shape).shares].sort((a, b) => b[1] - a[1])[0]?.[0];
    const industry = this.game.freight.industriesInReach(shape)[0];
    const town = covered ?? nearest;
    const base = covered ? covered.name : (industry?.name ?? nearest.name);
    const taken = new Set(rail.stations.map((s) => s.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    return { name, townId: town.id };
  }

  // Návěstidlo postaví, nebo existující odstraní za polovinu ceny
  toggleSignal(x: number, y: number): string | null {
    const { rail } = this.game.world;
    if (rail.hasSignal(x, y)) {
      rail.removeSignal(x, y);
      this.game.refund(SIGNAL_COST * DEMOLISH_REFUND, 'construction');
    } else {
      if (!rail.canPlaceSignal(x, y)) return 'Návěstidlo jde jen na rovnou kolej bez výhybky.';
      if (this.game.money < SIGNAL_COST) return `Nedostatek peněz (${formatMoney(SIGNAL_COST)}).`;
      this.game.spend(SIGNAL_COST, 'construction');
      rail.addSignal(x, y);
    }
    this.game.events.emit('railChanged');
    return null;
  }

  buildDepot(x: number, y: number, entrance: Edge): string | null {
    const { rail } = this.game.world;
    if (!rail.canPlaceDepot(x, y)) return 'Sem depo postavit nelze.';
    if (this.game.money < DEPOT_COST) return `Nedostatek peněz (${formatMoney(DEPOT_COST)}).`;
    this.game.spend(DEPOT_COST, 'construction');
    rail.addDepot(x, y, entrance);
    this.game.events.emit('railChanged');
    return null;
  }

  demolishPlan(area: TilePos[]): DemolishPlan {
    const { map, rail, towns } = this.game.world;
    const tiles: TilePos[] = [];
    const stations = new Set<number>();
    let cost = 0;
    let blocked: string | null = null;

    for (const { x, y } of area) {
      if (!map.inBounds(x, y)) continue;
      const type = map.get(x, y);
      const railway = [TileType.Rail, TileType.Crossing, TileType.Bridge, TileType.Station, TileType.Depot].includes(type);
      const roadway = [TileType.Road, TileType.Crossing, TileType.RoadStop, TileType.RoadDepot].includes(type);
      const blocker =
        (railway ? this.game.fleet.demolitionBlocker(x, y) : null) ??
        (roadway ? this.game.roadFleet.demolitionBlocker(x, y) : null);
      if (blocker) {
        blocked ??= blocker;
        continue;
      }
      switch (type) {
        case TileType.Rail:
        case TileType.Crossing:
        case TileType.Bridge:
          cost -= rail.pieceCount(x, y) * trackPieceCost(map, x, y) * DEMOLISH_REFUND;
          if (rail.hasSignal(x, y)) cost -= SIGNAL_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.Station: {
          const station = rail.stationAt(x, y);
          if (!station || stations.has(station.id)) break;
          stations.add(station.id);
          cost -= stationCost(station) * DEMOLISH_REFUND;
          tiles.push(...stationTiles(station));
          break;
        }
        case TileType.Depot:
          cost -= DEPOT_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.RoadStop: {
          const stop = rail.stationAt(x, y);
          if (stop) cost -= ROAD_STOP_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        }
        case TileType.RoadDepot:
          cost -= ROAD_DEPOT_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.Road:
          cost += map.getOwner(x, y) === NO_OWNER ? -ROAD_TILE_COST * DEMOLISH_REFUND : DEMOLISH_TOWN_ROAD_COST;
          tiles.push({ x, y });
          break;
        case TileType.Building: {
          const building = buildingAt(towns[map.getOwner(x, y)], x, y);
          if (!building) break;
          cost += buildingCapacity(building.model) * DEMOLISH_COST_PER_RESIDENT;
          tiles.push({ x, y });
          break;
        }
        case TileType.Trees:
          tiles.push({ x, y });
          break;
      }
    }
    return { tiles, cost, blocked };
  }

  demolish(area: TilePos[]): string | null {
    const plan = this.demolishPlan(area);
    if (plan.blocked) return plan.blocked;
    if (plan.tiles.length === 0) return null;
    if (plan.cost > this.game.money) return `Nedostatek peněz na demolici (${formatMoney(plan.cost)}).`;

    const { map, rail, towns } = this.game.world;
    let railChanged = false;
    let roadsChanged = false;
    let townsChanged = false;
    let treesChanged = false;

    for (const { x, y } of plan.tiles) {
      switch (map.get(x, y)) {
        case TileType.Trees:
          map.set(x, y, TileType.Grass);
          treesChanged = true;
          break;
        case TileType.Rail:
        case TileType.Crossing:
        case TileType.Bridge:
          rail.removeTrack(x, y);
          railChanged = true;
          break;
        case TileType.Station: {
          const station = rail.stationAt(x, y);
          if (station) rail.removeStation(station);
          railChanged = true;
          break;
        }
        case TileType.Depot: {
          const depot = rail.depotAt(x, y);
          if (depot) rail.removeDepot(depot);
          railChanged = true;
          break;
        }
        // Zbouráním zastávky zůstane silnice
        case TileType.RoadStop: {
          const stop = rail.stationAt(x, y);
          if (stop) rail.removeStation(stop);
          railChanged = true;
          break;
        }
        case TileType.RoadDepot: {
          const depot = rail.roadDepotAt(x, y);
          if (depot) rail.removeRoadDepot(depot);
          railChanged = true;
          break;
        }
        case TileType.Road:
          map.set(x, y, TileType.Grass);
          map.setOwner(x, y, NO_OWNER);
          roadsChanged = true;
          break;
        case TileType.Building: {
          const town = towns[map.getOwner(x, y)];
          const building = buildingAt(town, x, y);
          if (building) demolishBuilding(map, town, building);
          townsChanged = true;
          break;
        }
      }
    }

    if (plan.cost > 0) this.game.spend(plan.cost, 'construction');
    else this.game.refund(-plan.cost, 'construction');
    if (plan.cost !== 0) {
      const cx = plan.tiles.reduce((sum, t) => sum + t.x, 0) / plan.tiles.length + 0.5;
      const cz = plan.tiles.reduce((sum, t) => sum + t.y, 0) / plan.tiles.length + 0.5;
      this.game.events.emit('demolished', -plan.cost, cx, cz);
    }
    if (railChanged) this.game.events.emit('railChanged');
    if (roadsChanged) this.game.events.emit('roadsChanged');
    if (townsChanged) this.game.events.emit('townsChanged');
    if (treesChanged) this.game.events.emit('treesChanged');
    return null;
  }

  update(dtMs: number): void {
    if (this.queue.length === 0 || this.game.clock.paused) return;
    this.elapsed += dtMs;
    const interval = 1000 / PIECES_PER_SECOND;
    let railChanged = false;
    let roadsChanged = false;

    while (this.elapsed >= interval && this.queue.length > 0) {
      const job = this.queue[0];
      // Hotové nebo mezitím zabrané místo (např. růstem města) se přeskočí
      if (!(job.kind === 'track' ? this.trackPlaceable(job.step) : this.roadPlaceable(job.step))) {
        this.queue.shift();
        continue;
      }
      const cost =
        job.kind === 'track' ? trackPieceCost(this.game.world.map, job.step.x, job.step.y) : ROAD_TILE_COST;
      if (this.game.money < cost) {
        this.queue = [];
        this.game.events.emit('outOfMoney');
        break;
      }
      this.queue.shift();
      this.elapsed -= interval;
      this.game.spend(cost, 'construction');
      if (job.kind === 'track') {
        this.game.world.rail.addPiece(job.step.x, job.step.y, job.step.piece);
        railChanged = true;
      } else {
        this.placeRoad(job.step);
        roadsChanged = true;
      }
    }
    if (this.queue.length === 0) this.elapsed = 0;
    if (railChanged) this.game.events.emit('railChanged');
    if (roadsChanged) this.game.events.emit('roadsChanged');
  }

  private trackPlaceable(step: PathStep): boolean {
    const { rail } = this.game.world;
    return !rail.has(step.x, step.y, step.piece) && rail.canPlace(step.x, step.y, step.piece);
  }

  private roadPlaceable(step: RoadStep): boolean {
    const { map, rail } = this.game.world;
    const type = map.get(step.x, step.y);
    if (map.isFree(step.x, step.y)) return true;
    // Přejezd jen přes samotnou rovnou kolej
    const mask = rail.mask(step.x, step.y);
    return type === TileType.Rail && (mask === 1 || mask === 2);
  }

  private placeRoad(step: RoadStep): void {
    const { map } = this.game.world;
    map.set(step.x, step.y, map.get(step.x, step.y) === TileType.Rail ? TileType.Crossing : TileType.Road);
  }
}
