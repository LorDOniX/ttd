import { TileType, bridgeAlong, type TilePos } from './map';
import { EDGE_DELTA, RailNetwork, axisPiece, bridgeEnd, opposite, type Edge } from './rail';

// Dlaždice cesty auta; level 1 = na poli silničního mostu nad dlaždicí (pod mostem může vést jiná silnice)
export interface RoadTile extends TilePos {
  level?: 1;
  // Pole tunelu (level je pak 1, aby se auta v tunelu a na povrchu navzájem neviděla)
  tunnel?: 1;
}

// Smí auto opustit (nebo vjet na) dlaždici přes danou hranu? Zastávkou jen podél silnice,
// přejezdem kolmo na kolej, mostem jen podél něj, garáží jen vjezdem.
function opensTo(rail: RailNetwork, x: number, y: number, edge: Edge): boolean {
  const { map } = rail;
  if (!map.inBounds(x, y) || !map.edgeOpen(x, y, edge)) return false;
  switch (map.get(x, y)) {
    case TileType.Road: {
      // Nájezd silničního mostu jen zezadu; dopředu se jede po mostě (roadSteps), ne po zemi
      const exit = rail.roadBridges.length > 0 ? rail.roadBridgeExit(x, y) : null;
      return exit === null || edge === opposite(exit);
    }
    case TileType.Crossing:
      return rail.mask(x, y) === 1 << axisPiece(edge % 2 === 0 ? 'x' : 'y');
    case TileType.RoadStop:
      return rail.stationAt(x, y)?.axis === (edge % 2 === 0 ? 'y' : 'x');
    case TileType.RoadBridgeX:
    case TileType.RoadBridgeY:
      return bridgeAlong(map.roadBridgeAxis(x, y)!, edge);
    case TileType.RoadDepot:
      return rail.roadDepotAt(x, y)?.entrance === edge;
    default:
      return false;
  }
}

// Sousední dlaždice, kam auto z (x, y) může přejet; tramvaj jen po tramvajové koleji
export function roadMoves(rail: RailNetwork, x: number, y: number, tram = false): TilePos[] {
  const moves: TilePos[] = [];
  if (tram && !rail.hasTram(x, y)) return moves;
  for (let edge = 0; edge < 4; edge++) {
    const [dx, dy] = EDGE_DELTA[edge];
    if (tram && !rail.hasTram(x + dx, y + dy)) continue;
    if (opensTo(rail, x, y, edge) && opensTo(rail, x + dx, y + dy, opposite(edge))) {
      moves.push({ x: x + dx, y: y + dy });
    }
  }
  return moves;
}

// Kam auto z dlaždice cesty může přejet, včetně jízdy po silničních mostech a tunelech;
// tramvaj přes most či tunel jen s kolejí na obou nájezdech
export function roadSteps(rail: RailNetwork, tile: RoadTile, tram = false): RoadTile[] {
  const { x, y } = tile;
  if (tile.level) {
    const bridge = rail.roadBridgeOver(x, y);
    if (!bridge) return [];
    if (tram && !tramBridge(rail, bridge)) return [];
    const [dx, dy] = EDGE_DELTA[bridge.dir];
    const end = bridgeEnd(bridge);
    return [-1, 1].map((sign) => {
      const nx = x + sign * dx;
      const ny = y + sign * dy;
      const head = (nx === bridge.x && ny === bridge.y) || (nx === end.x && ny === end.y);
      if (head) return { x: nx, y: ny };
      return bridge.tunnel
        ? { x: nx, y: ny, level: 1 as const, tunnel: 1 as const }
        : { x: nx, y: ny, level: 1 as const };
    });
  }
  const moves: RoadTile[] = roadMoves(rail, x, y, tram);
  const exit = rail.roadBridges.length > 0 && rail.map.isType(x, y, TileType.Road) ? rail.roadBridgeExit(x, y) : null;
  const head = exit !== null ? rail.roadBridgeAtHead(x, y) : undefined;
  if (exit !== null && (!tram || (head && tramBridge(rail, head)))) {
    const [dx, dy] = EDGE_DELTA[exit];
    const tunnel = rail.roadBridgeAtHead(x, y)?.tunnel;
    moves.push(tunnel ? { x: x + dx, y: y + dy, level: 1, tunnel: 1 } : { x: x + dx, y: y + dy, level: 1 });
  }
  return moves;
}

// Má silniční most (tunel) tramvajovou kolej na obou nájezdech?
function tramBridge(rail: RailNetwork, bridge: { x: number; y: number; dir: Edge; span: number }): boolean {
  const end = bridgeEnd(bridge as Parameters<typeof bridgeEnd>[0]);
  return rail.hasTram(bridge.x, bridge.y) && rail.hasTram(end.x, end.y);
}

export function sameRoadTile(a: RoadTile, b: RoadTile): boolean {
  return a.x === b.x && a.y === b.y && (a.level ?? 0) === (b.level ?? 0);
}

// Výška auta na cestě v násobcích výšky mostu: na poli mostu 1, na nájezdu stoupá, jinde 0
export function roadElevation(path: readonly RoadTile[], pos: number): number {
  if (path.length === 0) return 0;
  const k = Math.max(0, Math.min(path.length - 1, Math.round(pos)));
  if (path[k].level) return 1;
  const u = pos - k;
  if (path[k + 1]?.level) return Math.max(0, Math.min(1, u + 0.5));
  if (path[k - 1]?.level) return Math.max(0, Math.min(1, 0.5 - u));
  return 0;
}

// Jsou dvě vozidla ve stejné výšce (na mostě, nebo obě pod ním)? Jinak se navzájem nevidí
export function sameRoadLevel(a: readonly RoadTile[], aPos: number, b: readonly RoadTile[], bPos: number): boolean {
  return Math.abs(roadElevation(a, aPos) - roadElevation(b, bPos)) < 0.5;
}

// Nejkratší cesta po silnicích a silničních mostech (BFS) včetně výchozí dlaždice, nebo null;
// tramvaj (tram) jen po tramvajové koleji
export function findRoadRoute(
  rail: RailNetwork,
  start: RoadTile,
  isGoal: (x: number, y: number) => boolean,
  tram = false,
): RoadTile[] | null {
  const width = rail.map.width;
  const size = width * rail.map.height;
  const keyOf = (t: RoadTile): number => t.y * width + t.x + (t.level ? size : 0);
  const tileOf = (key: number): RoadTile => {
    const index = key % size;
    const tile: RoadTile = { x: index % width, y: Math.floor(index / width) };
    if (key >= size) {
      tile.level = 1;
      if (rail.roadBridgeOver(tile.x, tile.y)?.tunnel) tile.tunnel = 1;
    }
    return tile;
  };
  const from = new Map<number, number>([[keyOf(start), -1]]);
  const queue = [keyOf(start)];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const tile = tileOf(key);
    if (!tile.level && isGoal(tile.x, tile.y)) {
      const path: RoadTile[] = [];
      for (let i = key; i !== -1; i = from.get(i)!) path.push(tileOf(i));
      return path.reverse();
    }
    for (const next of roadSteps(rail, tile, tram)) {
      const nextKey = keyOf(next);
      if (from.has(nextKey)) continue;
      from.set(nextKey, key);
      queue.push(nextKey);
    }
  }
  return null;
}
