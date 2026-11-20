import { MinHeap } from './heap';
import { TileType } from './map';
import {
  EDGE_DELTA,
  EDGE_MID,
  PIECES,
  RailNetwork,
  axisPiece,
  heading,
  opposite,
  pieceLength,
  turnAllowed,
  type Edge,
  type Station,
} from './rail';

// Průjezd jedním kusem koleje od vstupní k výstupní hraně
export interface Segment {
  x: number;
  y: number;
  piece: number;
  entry: Edge;
  exit: Edge;
}

// Místo, odkud vlak pokračuje: výjezd z dlaždice hranou `exit` ve směru `heading`
export interface RouteStart {
  x: number;
  y: number;
  exit: Edge;
  heading: number;
}

const MAX_EXPANSIONS = 200_000;

export function segmentLength(s: Segment): number {
  return pieceLength(s.piece);
}

export function pathLength(path: readonly Segment[]): number {
  return path.reduce((sum, s) => sum + segmentLength(s), 0);
}

export function reverseSegment(s: Segment): Segment {
  return { ...s, entry: s.exit, exit: s.entry };
}

export function segmentStart(s: Segment): RouteStart {
  return { x: s.x, y: s.y, exit: s.exit, heading: heading(s.entry, s.exit) };
}

export function segmentPoint(s: Segment, t: number): [number, number] {
  const [ax, ay] = EDGE_MID[s.entry];
  const [bx, by] = EDGE_MID[s.exit];
  return [s.x + ax + (bx - ax) * t, s.y + ay + (by - ay) * t];
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
  const parents = new Map<number, { prev: number; segment: Segment }>();
  const heap = new MinHeap();
  const GOAL = -1;
  let goal: { cost: number; prev: number; segment: Segment } | null = null;

  const push = (from: RouteStart, cost: number, prev: number, segment: Segment | null): void => {
    const [dx, dy] = EDGE_DELTA[from.exit];
    const nx = from.x + dx;
    const ny = from.y + dy;
    if (!map.inBounds(nx, ny) || avoid?.(nx, ny)) return;
    const k = key(nx, ny, opposite(from.exit), from.heading);
    if (cost >= (g.get(k) ?? Infinity)) return;
    g.set(k, cost);
    if (segment) parents.set(k, { prev, segment });
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
  for (let k = found.prev; parents.has(k); k = parents.get(k)!.prev) path.push(parents.get(k)!.segment);
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
        const nx = x + dx;
        const ny = y + dy;
        if (!map.inBounds(nx, ny)) continue;
        const j = ny * width + nx;
        if (label[j] >= 0 || !(edges(nx, ny) & (1 << opposite(edge)))) continue;
        label[j] = next;
        stack.push(j);
      }
    }
    next++;
  }
  return label;
}
