import { MinHeap } from './heap';
import { TileType, type GameMap, type TilePos } from './map';
import { EDGE_DELTA, stationTiles, type Axis, type Edge, type StationShape } from './rail';

// Přístav: dvě dlaždice nábřeží podél břehu (tvar 2×1) a před nimi ve směru dock dvě kotviště na vodě
export interface PortShape extends StationShape {
  dock: Edge;
}

export const PORT_LENGTH = 2;
export const BERTHS = 2;
// Kotvící loď stojí kousek od středu kotviště blíž k nábřeží
const MOOR_OFFSET = 0.32;

export interface Point {
  x: number;
  y: number;
}

export function portShape(x: number, y: number, axis: Axis, dock: Edge): PortShape {
  return { x, y, axis, length: PORT_LENGTH, tracks: 1, dock };
}

export function berthTiles(port: PortShape): TilePos[] {
  const [dx, dy] = EDGE_DELTA[port.dock];
  return stationTiles(port).map((t) => ({ x: t.x + dx, y: t.y + dy }));
}

// Místní soustava přístavu: a podél nábřeží (0..2), c od vodní hrany do vnitrozemí (0..1, záporné nad vodou).
// Natočení je vždy otočení (ne zrcadlení), aby šlo přístav vykreslit rotací.
export function portFrame(port: PortShape): { origin: Point; u: Point; v: Point } {
  const [dx, dy] = EDGE_DELTA[port.dock];
  const v = { x: -dx, y: -dy };
  const u = { x: v.y, y: -v.x };
  const tiles = stationTiles(port);
  const cx = tiles.reduce((s, t) => s + t.x + 0.5, 0) / tiles.length;
  const cy = tiles.reduce((s, t) => s + t.y + 0.5, 0) / tiles.length;
  return { origin: { x: cx - u.x - v.x * 0.5, y: cy - u.y - v.y * 0.5 }, u, v };
}

export function portPoint(port: PortShape, a: number, c: number): Point {
  const { origin, u, v } = portFrame(port);
  return { x: origin.x + u.x * a + v.x * c, y: origin.y + u.y * a + v.y * c };
}

// Místo, kde loď u kotviště stojí, a směr její osy (podél nábřeží)
export function moorPoint(port: PortShape, berth: number): Point {
  return portPoint(port, berth + 0.5, -0.5 + MOOR_OFFSET);
}

export function moorDirection(port: PortShape): Point {
  return portFrame(port).u;
}

// Splavná je volná voda (pod nízkými mosty lodě neproplují), kanál a zdymadlo
export function navigable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const type = map.get(x, y);
  return type === TileType.Water || type === TileType.Canal || type === TileType.Lock;
}

// Hladina dlaždice ve výškových úrovních: moře 0, kanál v úrovni dlaždice; zdymadlo a souš žádnou nemají
export function waterLevel(map: GameMap, x: number, y: number): number | null {
  if (!map.inBounds(x, y)) return null;
  const type = map.get(x, y);
  if (type === TileType.Water) return 0;
  if (type === TileType.Canal) return map.tileLevel(x, y);
  return null;
}

// Zdymadlo: dolní hladina na straně ze svahu, horní o úroveň výš na straně do svahu, směr do svahu
export function lockEnds(map: GameMap, x: number, y: number): { low: number; high: number; up: Edge } | null {
  if (!map.isType(x, y, TileType.Lock)) return null;
  const slope = map.slope(x, y);
  if (slope.kind !== 'incline') return null;
  return { low: slope.level, high: slope.level + 1, up: slope.up as Edge };
}

// Navazuje sousední dlaždice (ox, oy) na zdymadlo (lx, ly)? Jen podél svahu, dole ve stejné hladině jako
// dolní konec, nahoře jako horní
function lockJoins(map: GameMap, lx: number, ly: number, ox: number, oy: number): boolean {
  const ends = lockEnds(map, lx, ly);
  if (!ends) return false;
  const [dx, dy] = EDGE_DELTA[ends.up];
  const level = waterLevel(map, ox, oy);
  if (ox === lx + dx && oy === ly + dy) return level === ends.high;
  if (ox === lx - dx && oy === ly - dy) return level === ends.low;
  return false;
}

// Smí loď přeplout ze sousední dlaždice na sousední? Mezi kanály a mořem jen ve stejné hladině, do zdymadla
// a z něj jen podél svahu a šikmo vůbec
export function canSail(map: GameMap, x: number, y: number, nx: number, ny: number): boolean {
  if (!navigable(map, x, y) || !navigable(map, nx, ny)) return false;
  const lockA = map.isType(x, y, TileType.Lock);
  const lockB = map.isType(nx, ny, TileType.Lock);
  if (lockA || lockB) {
    if (x !== nx && y !== ny) return false;
    if (lockA && lockB) return false;
    return lockA ? lockJoins(map, x, y, nx, ny) : lockJoins(map, nx, ny, x, y);
  }
  return waterLevel(map, x, y) === waterLevel(map, nx, ny);
}

// Kanál leží o kousek níž než okolní souš (světové jednotky pod úrovní dlaždice)
export const CANAL_DROP = 0.04;

// Výška hladiny (světové jednotky) v bodě (px, py): moře seaSurface, kanál pod úrovní dlaždice,
// ve zdymadle hladina uprostřed vystoupá k horní úrovni
export function waterSurface(map: GameMap, px: number, py: number, seaSurface: number, step: number): number {
  const x = Math.floor(px);
  const y = Math.floor(py);
  if (!map.inBounds(x, y)) return seaSurface;
  const type = map.get(x, y);
  if (type === TileType.Canal) return map.tileLevel(x, y) * step - CANAL_DROP;
  const ends = lockEnds(map, x, y);
  if (!ends) return seaSurface;
  const [dx, dy] = EDGE_DELTA[ends.up];
  // Poloha podél svahu: 0 na dolní hraně, 1 na horní
  const t = dx !== 0 ? (dx > 0 ? px - x : 1 - (px - x)) : dy > 0 ? py - y : 1 - (py - y);
  const rise = Math.min(1, Math.max(0, (t - 0.35) / 0.3));
  const low =
    ends.low === 0 && waterLevel(map, x - dx, y - dy) === 0 && map.isType(x - dx, y - dy, TileType.Water)
      ? seaSurface
      : ends.low * step - CANAL_DROP;
  return low + (ends.high * step - CANAL_DROP - low) * rise;
}

// Přístav pro kliknutou dlaždici: druhá dlaždice nábřeží vedle ní a voda před oběma; preferred = upřednostněná
// strana k vodě (otáčení klávesou R). Vrací null, když u dlaždice přístav postavit nelze.
export function portAt(
  map: GameMap,
  tile: TilePos,
  preferred: Edge,
  isBerth: (x: number, y: number) => boolean = () => false,
): PortShape | null {
  for (let k = 0; k < 4; k++) {
    const dock = ((preferred + k) % 4) as Edge;
    const axis: Axis = dock % 2 === 0 ? 'x' : 'y';
    for (const step of [1, -1]) {
      const other = axis === 'x' ? { x: tile.x + step, y: tile.y } : { x: tile.x, y: tile.y + step };
      const x = axis === 'x' ? Math.max(tile.x, other.x) : tile.x;
      const y = axis === 'y' ? Math.max(tile.y, other.y) : tile.y;
      const shape = portShape(x, y, axis, dock);
      if (canPlacePort(map, shape, isBerth)) return shape;
    }
  }
  return null;
}

export function canPlacePort(
  map: GameMap,
  shape: PortShape,
  isBerth: (x: number, y: number) => boolean = () => false,
): boolean {
  return (
    stationTiles(shape).every((t) => map.isFree(t.x, t.y)) &&
    map.allFlat(stationTiles(shape)) &&
    berthTiles(shape).every((t) => navigable(map, t.x, t.y) && !isBerth(t.x, t.y))
  );
}

// Souvislé vodní plochy (4-sousedství, stejné jako pohyb lodí bez řezání rohů): číslo plochy pro každou dlaždici, −1 souš
export function waterBodies(map: GameMap): Int32Array {
  const { width, height } = map;
  const label = new Int32Array(width * height).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start] >= 0 || !navigable(map, start % width, Math.floor(start / width))) continue;
    label[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of EDGE_DELTA) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * width + nx;
        if (map.inBounds(nx, ny) && label[j] < 0 && canSail(map, x, y, nx, ny)) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    next++;
  }
  return label;
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

// Plavební trasa z dlaždice from do dlaždice to po vodě (A*, 8 směrů, šikmo jen mezi dvěma vodními dlaždicemi);
// vrací středy dlaždic od startu po cíl, nebo null
export function findWaterRoute(map: GameMap, from: TilePos, to: TilePos): TilePos[] | null {
  if (!navigable(map, from.x, from.y) || !navigable(map, to.x, to.y)) return null;
  const { width } = map;
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const cost = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>();
  const heap = new MinHeap();
  const h = (x: number, y: number): number => {
    const dx = Math.abs(x - to.x);
    const dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  heap.push(start, h(from.x, from.y));
  const closed = new Set<number>();
  while (heap.size > 0) {
    const i = heap.pop();
    if (i === goal) break;
    if (closed.has(i)) continue;
    closed.add(i);
    const x = i % width;
    const y = Math.floor(i / width);
    const base = cost.get(i)!;
    for (const [dx, dy, step] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!canSail(map, x, y, nx, ny)) continue;
      // Šikmo jen tam, kde by loď mohla plout i kolem rohu (obě sousední dlaždice ve stejné hladině)
      if (dx !== 0 && dy !== 0 && (!canSail(map, x, y, x + dx, y) || !canSail(map, x, y, x, y + dy))) continue;
      const j = ny * width + nx;
      const next = base + step;
      if (next >= (cost.get(j) ?? Infinity)) continue;
      cost.set(j, next);
      parent.set(j, i);
      heap.push(j, next + h(nx, ny));
    }
  }
  if (!cost.has(goal)) return null;
  const route: TilePos[] = [];
  for (let i: number | undefined = goal; i !== undefined; i = parent.get(i)) {
    route.push({ x: i % width, y: Math.floor(i / width) });
    if (i === start) break;
  }
  return route.reverse();
}

// Délka lomené čáry a bod ve vzdálenosti pos se směrem pohybu
export function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

export function polylinePoint(points: readonly Point[], pos: number): Point & { dx: number; dy: number } {
  if (points.length === 0) return { x: 0, y: 0, dx: 1, dy: 0 };
  let rest = Math.max(0, pos);
  let dir = { x: 1, y: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    if (rest <= length) return { x: a.x + dir.x * rest, y: a.y + dir.y * rest, dx: dir.x, dy: dir.y };
    rest -= length;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, dx: dir.x, dy: dir.y };
}
