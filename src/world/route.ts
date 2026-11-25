import { MinHeap } from './heap';
import { TileType, type TilePos } from './map';
import {
  EDGE_DELTA,
  EDGE_MID,
  PIECES,
  RailNetwork,
  axisPiece,
  bridgeAxis,
  heading,
  opposite,
  pieceLength,
  turnAllowed,
  type Edge,
  type Station,
} from './rail';

// Průjezd jedním kusem koleje od vstupní k výstupní hraně. S `span` je to průjezd polem mostu nad `span`
// dlaždicemi: (x, y) je první z nich ve směru jízdy, kus je rovný podél mostu.
export interface Segment {
  x: number;
  y: number;
  piece: number;
  entry: Edge;
  exit: Edge;
  span?: number;
}

// Výška mostovky nad zemí (v jednotkách dlaždice)
export const BRIDGE_HEIGHT = 0.42;

// Místo, odkud vlak pokračuje: výjezd z dlaždice hranou `exit` ve směru `heading`
export interface RouteStart {
  x: number;
  y: number;
  exit: Edge;
  heading: number;
}

const MAX_EXPANSIONS = 200_000;

export function segmentLength(s: Segment): number {
  return s.span ?? pieceLength(s.piece);
}

// Kolik dlaždic vlak projede kusem trasy (pole mostu jich má víc)
export function segmentTiles(s: Segment): number {
  return s.span ?? 1;
}

// Poslední dlaždice pole mostu ve směru jízdy
function spanEnd(s: Segment): [number, number] {
  const [dx, dy] = EDGE_DELTA[s.exit];
  const n = (s.span ?? 1) - 1;
  return [s.x + n * dx, s.y + n * dy];
}

export function pathLength(path: readonly Segment[]): number {
  return path.reduce((sum, s) => sum + segmentLength(s), 0);
}

export function reverseSegment(s: Segment): Segment {
  if (!s.span) return { ...s, entry: s.exit, exit: s.entry };
  const [x, y] = spanEnd(s);
  return { ...s, x, y, entry: s.exit, exit: s.entry };
}

export function segmentStart(s: Segment): RouteStart {
  const [x, y] = s.span ? spanEnd(s) : [s.x, s.y];
  return { x, y, exit: s.exit, heading: heading(s.entry, s.exit) };
}

export function segmentPoint(s: Segment, t: number): [number, number] {
  const [ax, ay] = EDGE_MID[s.entry];
  const [bx, by] = EDGE_MID[s.exit];
  const [ex, ey] = s.span ? spanEnd(s) : [s.x, s.y];
  const [sx, sy] = [s.x + ax, s.y + ay];
  const [tx, ty] = [ex + bx, ey + by];
  return [sx + (tx - sx) * t, sy + (ty - sy) * t];
}

// Výška koleje nad zemí v bodě t (0–1) kusu trasy: pole mostu nahoře, nájezdy stoupají a klesají
export function segmentHeight(rail: RailNetwork, s: Segment, t: number): number {
  if (s.span) return BRIDGE_HEIGHT;
  if (rail.bridgeFrom(s.x, s.y, s.exit)) return BRIDGE_HEIGHT * t;
  if (rail.bridgeFrom(s.x, s.y, s.entry)) return BRIDGE_HEIGHT * (1 - t);
  return 0;
}

// Výška koleje nad zemí ve vzdálenosti d od začátku trasy
export function heightAt(rail: RailNetwork, path: readonly Segment[], d: number): number {
  let rest = Math.max(0, d);
  for (const s of path) {
    const len = segmentLength(s);
    if (rest <= len) return segmentHeight(rail, s, rest / len);
    rest -= len;
  }
  const last = path[path.length - 1];
  return last ? segmentHeight(rail, last, 1) : 0;
}

// Index kusu koleje, na kterém leží bod ve vzdálenosti d
export function segmentIndexAt(path: readonly Segment[], d: number): number {
  let rest = d;
  for (let i = 0; i < path.length; i++) {
    rest -= segmentLength(path[i]);
    if (rest < 0) return i;
  }
  return path.length - 1;
}

// Bod ve vzdálenosti d od začátku trasy (ořezaný na rozsah trasy)
export function pointAt(path: readonly Segment[], d: number): [number, number] {
  let rest = Math.max(0, d);
  for (const s of path) {
    const len = segmentLength(s);
    if (rest <= len) return segmentPoint(s, rest / len);
    rest -= len;
  }
  const last = path[path.length - 1];
  return segmentPoint(last, 1);
}

export function segmentStillExists(rail: RailNetwork, s: Segment): boolean {
  if (s.span) {
    const [dx, dy] = EDGE_DELTA[s.entry];
    return rail.bridgeFrom(s.x + dx, s.y + dy, s.exit)?.span === s.span;
  }
  return rail.has(s.x, s.y, s.piece);
}

// Nejkratší trasa po existujících kolejích k dlaždici, pro kterou platí `isGoal`; dlaždice `avoid` objede
export function findRoute(
  rail: RailNetwork,
  start: RouteStart,
  isGoal: (x: number, y: number) => boolean,
  target: { x: number; y: number },
  avoid?: (x: number, y: number) => boolean,
): Segment[] | null {
  const { map } = rail;
  const width = map.width;
  const key = (x: number, y: number, entry: Edge, h: number): number => ((y * width + x) * 4 + entry) * 8 + h;
  const estimate = (x: number, y: number): number => Math.hypot(x - target.x, y - target.y) * 0.7;

  const g = new Map<number, number>();
  // Kus koleje projetý před přesunem na stav; přes most k němu patří i pole mostu (span)
  const parents = new Map<number, { prev: number; segment: Segment | null; span: Segment | null }>();
  const heap = new MinHeap();
  const GOAL = -1;
  let goal: { cost: number; prev: number; segment: Segment } | null = null;

  const push = (from: RouteStart, cost: number, prev: number, segment: Segment | null): void => {
    const [dx, dy] = EDGE_DELTA[from.exit];
    let nx = from.x + dx;
    let ny = from.y + dy;
    // Z nájezdu mostu se jede rovnou přes celé pole na druhý nájezd
    const bridge = rail.bridgeFrom(from.x, from.y, from.exit);
    let span: Segment | null = null;
    if (bridge) {
      span = {
        x: nx,
        y: ny,
        piece: axisPiece(bridgeAxis(bridge)),
        entry: opposite(from.exit),
        exit: from.exit,
        span: bridge.span,
      };
      nx = from.x + (bridge.span + 1) * dx;
      ny = from.y + (bridge.span + 1) * dy;
      cost += bridge.span;
    }
    if (!map.inBounds(nx, ny) || avoid?.(nx, ny)) return;
    // Jednokolejka, maglev a železnice jsou oddělené sítě
    if (rail.railTypeAt(nx, ny) !== rail.railTypeAt(from.x, from.y)) return;
    const k = key(nx, ny, opposite(from.exit), from.heading);
    if (cost >= (g.get(k) ?? Infinity)) return;
    g.set(k, cost);
    if (segment || span) parents.set(k, { prev, segment, span });
    heap.push(k, cost + estimate(nx, ny));
  };

  push(start, 0, GOAL, null);

  for (let n = 0; heap.size > 0 && n < MAX_EXPANSIONS; n++) {
    const current = heap.pop();
    if (current === GOAL) break;
    const h = current % 8;
    const entry = (Math.floor(current / 8) % 4) as Edge;
    const tile = Math.floor(current / 32);
    const x = tile % width;
    const y = Math.floor(tile / width);
    const base = g.get(current)!;
    const goalTile = isGoal(x, y);
    // Do depa se vjíždí jen, když je cílem, a jen vjezdem
    if (map.get(x, y) === TileType.Depot) {
      const depot = rail.depotAt(x, y);
      if (!goalTile || !depot || depot.entrance !== entry) continue;
    }

    for (let piece = 0; piece < PIECES.length; piece++) {
      const [a, b] = PIECES[piece];
      if ((a !== entry && b !== entry) || !rail.has(x, y, piece)) continue;
      const exit = a === entry ? b : a;
      // Proti jednosměrnému návěstidlu se nejede
      if (!rail.allowsExit(x, y, piece, exit)) continue;
      const h2 = heading(entry, exit);
      if (!turnAllowed(h, h2)) continue;
      const segment: Segment = { x, y, piece, entry, exit };
      const cost = base + pieceLength(piece);
      if (goalTile) {
        if (!goal || cost < goal.cost) {
          goal = { cost, prev: current, segment };
          heap.push(GOAL, cost);
        }
        continue;
      }
      push({ x, y, exit, heading: h2 }, cost, current, segment);
    }
  }

  const found = goal as { cost: number; prev: number; segment: Segment } | null;
  if (!found) return null;
  const path = [found.segment];
  for (let k = found.prev; parents.has(k); k = parents.get(k)!.prev) {
    const parent = parents.get(k)!;
    if (parent.span) path.push(parent.span);
    if (parent.segment) path.push(parent.segment);
  }
  return path.reverse();
}

// Prodlouží trasu přes celé nástupiště, aby vlak zastavil až na jeho konci
export function extendThroughStation(rail: RailNetwork, path: Segment[], station: Station): Segment[] {
  const piece = axisPiece(station.axis);
  const result = [...path];
  for (;;) {
    const last = result[result.length - 1];
    const [dx, dy] = EDGE_DELTA[last.exit];
    const nx = last.x + dx;
    const ny = last.y + dy;
    if (rail.stationAt(nx, ny)?.id !== station.id) return result;
    result.push({ x: nx, y: ny, piece, entry: opposite(last.exit), exit: last.exit });
  }
}

// Souvislé kolejové sítě: číslo sítě pro každou dlaždici s kolejí, jinak −1. Sousední dlaždice patří k sobě,
// když kus koleje jedné vede přes společnou hranu a druhá má kus z protější hrany (bez ohledu na úhel odbočení,
// stačí to na rozpoznání nepropojených nástupišť).
export function railNetworks(rail: RailNetwork): Int32Array {
  const { map } = rail;
  const { width, height } = map;
  const label = new Int32Array(width * height).fill(-1);
  const edges = (x: number, y: number): number => {
    let mask = 0;
    PIECES.forEach(([a, b], piece) => {
      if (rail.has(x, y, piece)) mask |= (1 << a) | (1 << b);
    });
    return mask;
  };
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < label.length; start++) {
    if (label[start] >= 0 || rail.pieces[start] === 0) continue;
    label[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      const mine = edges(x, y);
      for (let edge = 0; edge < 4; edge++) {
        if (!(mine & (1 << edge))) continue;
        const [dx, dy] = EDGE_DELTA[edge];
        // Most spojuje nájezd přímo s druhým nájezdem
        const jump = (rail.bridgeFrom(x, y, edge as Edge)?.span ?? 0) + 1;
        const nx = x + jump * dx;
        const ny = y + jump * dy;
        if (!map.inBounds(nx, ny)) continue;
        const j = ny * width + nx;
        if (label[j] >= 0 || !(edges(nx, ny) & (1 << opposite(edge)))) continue;
        // Různé druhy kolejí na sebe nenavazují
        if (rail.railType[j] !== rail.railType[i]) continue;
        label[j] = next;
        stack.push(j);
      }
    }
    next++;
  }
  return label;
}

// Dlaždice s kolejí po nejkratší cestě mezi dvěma dlaždicemi s kolejí (po kusech kolejí, přes mosty, jen jeden
// druh koleje), včetně obou konců; null, když spolu nesouvisí. Pro nástroje tažené podél trati (elektrizace).
export function trackTilesBetween(rail: RailNetwork, from: TilePos, to: TilePos): TilePos[] | null {
  const { map } = rail;
  const { width } = map;
  if (!rail.hasTrack(from.x, from.y) || !rail.hasTrack(to.x, to.y)) return null;
  const edges = (x: number, y: number): number => {
    let mask = 0;
    PIECES.forEach(([a, b], piece) => {
      if (rail.has(x, y, piece)) mask |= (1 << a) | (1 << b);
    });
    return mask;
  };
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const parent = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    if (i === goal) {
      const tiles: TilePos[] = [];
      for (let k = i; k !== -1; k = parent.get(k)!) tiles.push({ x: k % width, y: Math.floor(k / width) });
      return tiles.reverse();
    }
    const x = i % width;
    const y = Math.floor(i / width);
    const mine = edges(x, y);
    for (let edge = 0; edge < 4; edge++) {
      if (!(mine & (1 << edge))) continue;
      const [dx, dy] = EDGE_DELTA[edge];
      const jump = (rail.bridgeFrom(x, y, edge as Edge)?.span ?? 0) + 1;
      const nx = x + jump * dx;
      const ny = y + jump * dy;
      if (!map.inBounds(nx, ny)) continue;
      const j = ny * width + nx;
      if (parent.has(j) || !(edges(nx, ny) & (1 << opposite(edge)))) continue;
      if (rail.railType[j] !== rail.railType[i]) continue;
      parent.set(j, i);
      queue.push(j);
    }
  }
  return null;
}
