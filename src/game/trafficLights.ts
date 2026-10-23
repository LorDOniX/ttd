import type { GameMap, TilePos } from '../world/map';
import { TileType } from '../world/map';
import type { RailNetwork } from '../world/rail';
import { roadMoves } from '../world/roadRoute';
import type { Town } from '../world/town';

const GREEN_SECONDS = 8;
const ALL_RED_SECONDS = 1;
const PHASE_SECONDS = GREEN_SECONDS + ALL_RED_SECONDS;
const CYCLE_SECONDS = PHASE_SECONDS * 2;
const MIN_SIGNAL_SPACING = 10;

export interface TrafficLightJunction extends TilePos {
  townId: number;
  phaseOffset: number;
}

function tileHash(x: number, y: number, townId: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(townId, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function selectTrafficLights(map: GameMap, rail: RailNetwork, towns: readonly Town[]): TrafficLightJunction[] {
  const lights: TrafficLightJunction[] = [];
  for (const town of towns) {
    if (town.kind !== 'city' || town.population < 1200) continue;
    const candidates: TilePos[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getOwner(x, y) === town.id && map.get(x, y) === TileType.Road && roadMoves(rail, x, y).length === 4) {
          candidates.push({ x, y });
        }
      }
    }
    candidates.sort((a, b) => {
      const distanceA = Math.hypot(a.x - town.x, a.y - town.y);
      const distanceB = Math.hypot(b.x - town.x, b.y - town.y);
      return distanceA - distanceB || tileHash(a.x, a.y, town.id) - tileHash(b.x, b.y, town.id);
    });
    const target = Math.min(3, Math.max(1, Math.floor(town.population / 2500)));
    let selected = 0;
    for (const candidate of candidates) {
      if (lights.some((light) => Math.hypot(light.x - candidate.x, light.y - candidate.y) < MIN_SIGNAL_SPACING)) {
        continue;
      }
      lights.push({
        ...candidate,
        townId: town.id,
        phaseOffset: tileHash(candidate.x, candidate.y, town.id) * CYCLE_SECONDS,
      });
      if (++selected >= target) break;
    }
  }
  return lights;
}

export class TrafficLights {
  private elapsedSeconds = 0;
  private readonly junctions = new Map<number, TrafficLightJunction>();
  private roadVersion = -1;

  constructor(
    private readonly map: GameMap,
    private readonly rail: RailNetwork,
    private readonly towns: readonly Town[],
  ) {
    this.refresh();
  }

  get all(): readonly TrafficLightJunction[] {
    return [...this.junctions.values()];
  }

  reconcile(roadVersion: number): void {
    if (roadVersion === this.roadVersion) return;
    this.roadVersion = roadVersion;
    this.refresh();
  }

  refresh(): void {
    this.junctions.clear();
    for (const junction of selectTrafficLights(this.map, this.rail, this.towns)) {
      this.junctions.set(junction.y * this.map.width + junction.x, junction);
    }
  }

  update(seconds: number): void {
    this.elapsedSeconds += Math.max(0, seconds);
  }

  greenAxis(x: number, y: number): 'x' | 'y' | null {
    const junction = this.junctions.get(y * this.map.width + x);
    if (!junction) return null;
    const phase = (this.elapsedSeconds + junction.phaseOffset) % CYCLE_SECONDS;
    if (phase < GREEN_SECONDS) return 'x';
    if (phase < PHASE_SECONDS) return null;
    if (phase < PHASE_SECONDS + GREEN_SECONDS) return 'y';
    return null;
  }

  allows(from: TilePos, to: TilePos): boolean {
    const junction = this.junctions.get(to.y * this.map.width + to.x);
    if (!junction) return true;
    const green = this.greenAxis(to.x, to.y);
    if (green === null) return false;
    const approach = from.x === to.x ? 'y' : 'x';
    return approach === green;
  }
}
