import {
  DEMOLISH_COST_PER_RESIDENT,
  DEMOLISH_REFUND,
  DEMOLISH_TOWN_ROAD_COST,
  DEPOT_COST,
  PLATFORM_TILE_COST,
  ROAD_TILE_COST,
  STATION_LENGTH,
  TRACK_PIECE_COST,
} from './balance';
import { formatMoney, type Game } from './game';
import { NO_OWNER, TileType, type TilePos } from '../world/map';
import { stationTiles, type Axis, type Edge } from '../world/rail';
import type { PathStep } from '../world/railPath';
import type { RoadStep } from '../world/roadPath';
import { buildingAt, buildingCapacity, demolishBuilding } from '../world/town';

// Rychlost postupné výstavby kolejí a silnic
const PIECES_PER_SECOND = 25;
export const STATION_COST = PLATFORM_TILE_COST * STATION_LENGTH;

type Job = { kind: 'track'; step: PathStep } | { kind: 'road'; step: RoadStep };

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

  buildTrack(steps: PathStep[]): void {
    this.queue.push(...steps.map((step) => ({ kind: 'track' as const, step })));
  }

  buildRoad(steps: RoadStep[]): void {
    this.queue.push(...steps.map((step) => ({ kind: 'road' as const, step })));
  }

  // Vrací chybovou hlášku, nebo null při úspěchu
  buildStation(x: number, y: number, axis: Axis): string | null {
    const { rail, towns } = this.game.world;
    if (!rail.canPlaceStation(x, y, axis)) return 'Sem nástupiště postavit nelze.';
    if (this.game.money < STATION_COST) return `Nedostatek peněz (${formatMoney(STATION_COST)}).`;

    const nearest = [...towns].sort(
      (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
    )[0];
    const sameTown = rail.stations.filter((s) => s.townId === nearest.id).length;
    const name = sameTown === 0 ? nearest.name : `${nearest.name} ${sameTown + 1}`;

    this.game.spend(STATION_COST);
    rail.addStation({ name, x, y, axis, townId: nearest.id });
    this.game.news(`Postaveno nástupiště ${name}.`);
    this.game.events.emit('railChanged');
    return null;
  }

  buildDepot(x: number, y: number, entrance: Edge): string | null {
    const { rail } = this.game.world;
    if (!rail.canPlaceDepot(x, y)) return 'Sem depo postavit nelze.';
    if (this.game.money < DEPOT_COST) return `Nedostatek peněz (${formatMoney(DEPOT_COST)}).`;
    this.game.spend(DEPOT_COST);
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
      const railway = [TileType.Rail, TileType.Crossing, TileType.Station, TileType.Depot].includes(type);
      const blocker = railway ? this.game.fleet.demolitionBlocker(x, y) : null;
      if (blocker) {
        blocked ??= blocker;
        continue;
      }
      switch (type) {
        case TileType.Rail:
        case TileType.Crossing:
          cost -= rail.pieceCount(x, y) * TRACK_PIECE_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.Station: {
          const station = rail.stationAt(x, y);
          if (!station || stations.has(station.id)) break;
          stations.add(station.id);
          cost -= STATION_COST * DEMOLISH_REFUND;
          tiles.push(...stationTiles(station.x, station.y, station.axis));
          break;
        }
        case TileType.Depot:
          cost -= DEPOT_COST * DEMOLISH_REFUND;
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

    if (plan.cost > 0) this.game.spend(plan.cost);
    else this.game.refund(-plan.cost);
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
      const cost = job.kind === 'track' ? TRACK_PIECE_COST : ROAD_TILE_COST;
      if (this.game.money < cost) {
        this.queue = [];
        this.game.events.emit('outOfMoney');
        break;
      }
      this.queue.shift();
      this.elapsed -= interval;
      this.game.spend(cost);
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
