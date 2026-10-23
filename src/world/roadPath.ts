import { ROAD_BRIDGE_COST, ROAD_TILE_COST } from '../game/balance';
import { MinHeap } from './heap';
import { GameMap, TileType, bridgeAlong, type TilePos } from './map';
import { EDGE_DELTA, Edge, RailNetwork, axisPiece, opposite, type Axis } from './rail';

export interface RoadStep {
  x: number;
  y: number;
  isNew: boolean;
  // Směr mostu u nového dílku nad vodou
  axis?: Axis;
}

const MAX_EXPANSIONS = 200_000;
const TURN_PENALTY = 0.2;
const REUSE_COST = 0.1;
// Most stojí víc než silnice, trasa proto malou vodu objede a přes řeku se přemostí
const BRIDGE_COST = ROAD_BRIDGE_COST / ROAD_TILE_COST;

// Osa pohybu ve směru dir (hrana, přes kterou se jede)
const moveAxis = (dir: number): Axis => (dir % 2 === 1 ? 'x' : 'y');

function isRoadTile(map: GameMap, x: number, y: number): boolean {
  return map.isRoad(x, y);
}

// Přes kolej vede silnice jen rovně a kolmo na jedinou rovnou kolej (přejezd)
function passable(map: GameMap, rail: RailNetwork, x: number, y: number, dir: number): boolean {
  if (!map.inBounds(x, y)) return false;
  switch (map.get(x, y)) {
    case TileType.Grass:
    case TileType.Trees:
    case TileType.Road:
      return true;
    case TileType.Rail:
    case TileType.Crossing:
      return rail.mask(x, y) === 1 << axisPiece(dir % 2 === 0 ? 'x' : 'y');
    case TileType.RoadStop:
      return rail.stationAt(x, y)?.axis === (dir % 2 === 0 ? 'y' : 'x');
    // Přes vodu vede most, po existujícím mostě jen podél něj
    case TileType.Water:
      return true;
    case TileType.RoadBridgeX:
    case TileType.RoadBridgeY:
      return bridgeAlong(map.roadBridgeAxis(x, y)!, dir);
    default:
      return false;
  }
}

function straightOnly(map: GameMap, x: number, y: number): boolean {
  const type = map.get(x, y);
  return (
    type === TileType.Rail ||
    type === TileType.Crossing ||
    type === TileType.RoadStop ||
    type === TileType.Water ||
    type === TileType.RoadBridgeX ||
    type === TileType.RoadBridgeY
  );
}

// Nový dílek; nad vodou s osou mostu podle směru jízdy
function newStep(map: GameMap, x: number, y: number, dir: number): RoadStep {
  return map.isType(x, y, TileType.Water) ? { x, y, isNew: true, axis: moveAxis(dir) } : { x, y, isNew: true };
}

// Kurzor blíž než EDGE_ZONE od středu dlaždice nemíří k žádné hraně
const EDGE_ZONE = 0.25;

export function roadEdgeAtCursor(fx: number, fy: number): Edge | null {
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < EDGE_ZONE) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? Edge.W : Edge.E;
  return dy < 0 ? Edge.N : Edge.S;
}

// Kliknutí: silnice na dlaždici pod kurzorem; už postavenou prodlouží přes hranu, ke které kurzor míří.
// Most nad vodu jde jen prodloužením silnice, samotná dlaždice vody by neměla daný směr
export function singleRoadSteps(rail: RailNetwork, tile: TilePos, fx: number, fy: number): RoadStep[] | null {
  const { map } = rail;
  const { x, y } = tile;
  if (!isRoadTile(map, x, y)) {
    if (map.isType(x, y, TileType.Water)) return null;
    const buildable = [Edge.N, Edge.E, Edge.S, Edge.W].some((dir) => passable(map, rail, x, y, dir));
    return buildable ? [{ x, y, isNew: true }] : null;
  }
  const edge = roadEdgeAtCursor(fx, fy);
  if (edge === null) return null;
  const nx = x + EDGE_DELTA[edge][0];
  const ny = y + EDGE_DELTA[edge][1];
  if (isRoadTile(map, nx, ny) || !passable(map, rail, x, y, edge) || !passable(map, rail, nx, ny, edge)) return null;
  return [{ x, y, isNew: false }, newStep(map, nx, ny, edge)];
}

// A* po dlaždicích ve 4 směrech; stav = dlaždice a směr příjezdu
export function findRoadPath(rail: RailNetwork, from: TilePos, to: TilePos): RoadStep[] | null {
  const { map } = rail;
  const width = map.width;
  const key = (x: number, y: number, dir: number): number => (y * width + x) * 4 + dir;
  const tileCost = (x: number, y: number): number =>
    isRoadTile(map, x, y) ? REUSE_COST : map.isType(x, y, TileType.Water) ? BRIDGE_COST : 1;
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
    steps.push(isRoadTile(map, x, y) ? { x, y, isNew: false } : newStep(map, x, y, k % 4));
  }
  return steps.reverse();
}
