import type { TilePos } from '../world/map';
import type { RailNetwork } from '../world/rail';
import { roadMoves } from '../world/roadRoute';

export const JUNCTION_CLEARANCE = 0.2;
export const JUNCTION_STOP_GAP = 0.8;
// Na červenou auto stojí středem tak daleko před křižovatkou, předkem těsně před jejím okrajem
export const RED_SIGNAL_STOP_GAP = 0.3;

export interface JunctionTraffic {
  id?: number;
  path: readonly TilePos[];
  pos: number;
}

export function reservesJunction(
  path: readonly TilePos[],
  pos: number,
  x: number,
  y: number,
  rail: RailNetwork,
): boolean {
  for (let i = 1; i < path.length - 1; i++) {
    const tile = path[i];
    if (tile.x !== x || tile.y !== y || roadMoves(rail, x, y).length < 3) continue;
    if (pos >= i - 0.5 - JUNCTION_CLEARANCE && pos <= i + 0.5 + JUNCTION_CLEARANCE) return true;
  }
  return false;
}

// allows: smí vozidlo z from vjet do to (semafor); kdo má červenou, přednost nezíská
export function junctionPriorities(
  traffic: readonly JunctionTraffic[],
  rail: RailNetwork,
  allows: (from: TilePos, to: TilePos) => boolean = () => true,
): Map<number, number> {
  const winners = new Map<number, { id: number; distance: number }>();
  const width = rail.map.width;
  for (const vehicle of traffic) {
    if (vehicle.path.length === 0 || vehicle.id === undefined) continue;
    for (let i = 1; i < vehicle.path.length - 1; i++) {
      const tile = vehicle.path[i];
      if (roadMoves(rail, tile.x, tile.y).length < 3) continue;
      const distance = i - 0.5 - vehicle.pos;
      if (distance < 0 || !allows(vehicle.path[i - 1], tile)) continue;
      const key = tile.y * width + tile.x;
      const winner = winners.get(key);
      if (!winner || distance < winner.distance || (distance === winner.distance && vehicle.id < winner.id)) {
        winners.set(key, { id: vehicle.id, distance });
      }
    }
  }
  return new Map([...winners].map(([tile, winner]) => [tile, winner.id]));
}
