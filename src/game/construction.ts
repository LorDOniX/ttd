import { DEPOT_COST, PLATFORM_TILE_COST, STATION_LENGTH, TRACK_PIECE_COST } from './balance';
import { formatMoney, type Game } from './game';
import type { Axis, Edge } from '../world/rail';
import type { PathStep } from '../world/railPath';

// Rychlost postupné výstavby kolejí
const PIECES_PER_SECOND = 25;
export const STATION_COST = PLATFORM_TILE_COST * STATION_LENGTH;

// Stavba kolejí, nástupišť a dep za peníze společnosti
export class Construction {
  private queue: PathStep[] = [];
  private elapsed = 0;

  constructor(private readonly game: Game) {}

  get busy(): boolean {
    return this.queue.length > 0;
  }

  buildTrack(steps: PathStep[]): void {
    this.queue.push(...steps);
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

  update(dtMs: number): void {
    if (this.queue.length === 0 || this.game.clock.paused) return;
    this.elapsed += dtMs;
    const interval = 1000 / PIECES_PER_SECOND;
    const { rail } = this.game.world;
    let changed = false;

    while (this.elapsed >= interval && this.queue.length > 0) {
      const step = this.queue.shift()!;
      if (rail.has(step.x, step.y, step.piece)) continue;
      // Mezitím mohlo místo zabrat něco jiného (např. růst města)
      if (!rail.canPlace(step.x, step.y, step.piece)) continue;
      if (this.game.money < TRACK_PIECE_COST) {
        this.queue = [];
        this.game.events.emit('outOfMoney');
        break;
      }
      this.elapsed -= interval;
      this.game.spend(TRACK_PIECE_COST);
      rail.addPiece(step.x, step.y, step.piece);
      changed = true;
    }
    if (this.queue.length === 0) this.elapsed = 0;
    if (changed) this.game.events.emit('railChanged');
  }
}
