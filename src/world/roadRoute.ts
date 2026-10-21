import { TileType, type TilePos } from './map';
import { EDGE_DELTA, RailNetwork, axisPiece, opposite, type Edge } from './rail';

// Smí auto opustit (nebo vjet na) dlaždici přes danou hranu? Zastávkou jen podél silnice,
// přejezdem kolmo na kolej, garáží jen vjezdem.
function opensTo(rail: RailNetwork, x: number, y: number, edge: Edge): boolean {
  const { map } = rail;
  if (!map.inBounds(x, y)) return false;
  switch (map.get(x, y)) {
    case TileType.Road:
      return true;
    case TileType.Crossing:
      return rail.mask(x, y) === 1 << axisPiece(edge % 2 === 0 ? 'x' : 'y');
    case TileType.RoadStop:
      return rail.stationAt(x, y)?.axis === (edge % 2 === 0 ? 'y' : 'x');
    case TileType.RoadDepot:
      return rail.roadDepotAt(x, y)?.entrance === edge;
    default:
      return false;
  }
}

// Sousední dlaždice, kam auto z (x, y) může přejet
export function roadMoves(rail: RailNetwork, x: number, y: number): TilePos[] {
  const moves: TilePos[] = [];
  for (let edge = 0; edge < 4; edge++) {
    const [dx, dy] = EDGE_DELTA[edge];
    if (opensTo(rail, x, y, edge) && opensTo(rail, x + dx, y + dy, opposite(edge))) {
      moves.push({ x: x + dx, y: y + dy });
    }
  }
  return moves;
}

// Nejkratší cesta po silnicích (BFS) včetně výchozí dlaždice, nebo null
export function findRoadRoute(
  rail: RailNetwork,
  start: TilePos,
  isGoal: (x: number, y: number) => boolean,
): TilePos[] | null {
  const width = rail.map.width;
  const from = new Map<number, number>([[start.y * width + start.x, -1]]);
  const queue = [start.y * width + start.x];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);
    if (isGoal(x, y)) {
      const path: TilePos[] = [];
      for (let i = index; i !== -1; i = from.get(i)!) path.push({ x: i % width, y: Math.floor(i / width) });
      return path.reverse();
    }
    for (const next of roadMoves(rail, x, y)) {
      const key = next.y * width + next.x;
      if (from.has(key)) continue;
      from.set(key, index);
      queue.push(key);
    }
  }
  return null;
}
