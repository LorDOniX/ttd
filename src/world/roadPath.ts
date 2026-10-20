import { MinHeap } from './heap';
import { GameMap, TileType, type TilePos } from './map';
import { EDGE_DELTA, RailNetwork, axisPiece, opposite } from './rail';

export interface RoadStep {
  x: number;
  y: number;
  isNew: boolean;
}

const MAX_EXPANSIONS = 200_000;
const TURN_PENALTY = 0.2;
const REUSE_COST = 0.1;

function isRoadTile(map: GameMap, x: number, y: number): boolean {
  return map.isRoad(x, y);
}

// Přes kolej vede silnice jen rovně a kolmo na jedinou rovnou kolej (přejezd)
function passable(map: GameMap, rail: RailNetwork, x: number, y: number, dir: number): boolean {
  if (!map.inBounds(x, y)) return false;
  switch (map.get(x, y)) {
    case TileType.Grass:
    case TileType.Road:
      return true;
    case TileType.Rail:
    case TileType.Crossing:
      return rail.mask(x, y) === 1 << axisPiece(dir % 2 === 0 ? 'x' : 'y');
    default:
      return false;
  }
}

function straightOnly(map: GameMap, x: number, y: number): boolean {
  const type = map.get(x, y);
  return type === TileType.Rail || type === TileType.Crossing;
}

// A* po dlaždicích ve 4 směrech; stav = dlaždice a směr příjezdu
export function findRoadPath(rail: RailNetwork, from: TilePos, to: TilePos): RoadStep[] | null {
  const { map } = rail;
  const width = map.width;
  const key = (x: number, y: number, dir: number): number => (y * width + x) * 4 + dir;
  const tileCost = (x: number, y: number): number => (isRoadTile(map, x, y) ? REUSE_COST : 1);
  const estimate = (x: number, y: number): number => Math.abs(x - to.x) + Math.abs(y - to.y);

  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new MinHeap();

  for (let dir = 0; dir < 4; dir++) {
    if (!passable(map, rail, from.x, from.y, dir)) continue;
    const k = key(from.x, from.y, dir);
    g.set(k, tileCost(from.x, from.y));
    parent.set(k, -1);
    heap.push(k, g.get(k)! + estimate(from.x, from.y));
  }

  let found = -1;
  for (let expansions = 0; heap.size > 0 && expansions < MAX_EXPANSIONS; expansions++) {
    const current = heap.pop();
    const dir = current % 4;
    const tile = Math.floor(current / 4);
    const x = tile % width;
    const y = Math.floor(tile / width);
    if (x === to.x && y === to.y) {
      found = current;
      break;
    }
    const base = g.get(current)!;
    for (let next = 0; next < 4; next++) {
      if (next === opposite(dir) || (straightOnly(map, x, y) && next !== dir)) continue;
      const nx = x + EDGE_DELTA[next][0];
      const ny = y + EDGE_DELTA[next][1];
      if (!passable(map, rail, nx, ny, next)) continue;
      // Ze startu se smí vyjet libovolným směrem
      const turn = parent.get(current) !== -1 && next !== dir ? TURN_PENALTY : 0;
      const cost = base + tileCost(nx, ny) + turn;
      const nk = key(nx, ny, next);
      if (cost >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, cost);
      parent.set(nk, current);
      heap.push(nk, cost + estimate(nx, ny));
    }
  }

  if (found < 0) return null;
  const steps: RoadStep[] = [];
  for (let k = found; k !== -1; k = parent.get(k)!) {
    const tile = Math.floor(k / 4);
    const x = tile % width;
    const y = Math.floor(tile / width);
    steps.push({ x, y, isNew: !isRoadTile(map, x, y) });
  }
  return steps.reverse();
}
