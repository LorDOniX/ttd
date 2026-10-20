import type { TilePos } from './map';
import {
  EDGE_DELTA,
  PIECES,
  RailNetwork,
  heading,
  isCorner,
  opposite,
  pieceLength,
  turnAllowed,
  type Edge,
} from './rail';

export interface PathStep {
  x: number;
  y: number;
  piece: number;
  isNew: boolean;
}

const MAX_EXPANSIONS = 200_000;
const TURN_PENALTY = 0.15;
// Existující koleje jsou levné, aby se nová trasa napojovala na stávající
const REUSE_FACTOR = 0.1;
// Rohový kus je kratší, bez penalizace by jimi začínala i rovná trasa
const END_CORNER_PENALTY = 0.5;

interface Parent {
  prev: number;
  x: number;
  y: number;
  piece: number;
}

class MinHeap {
  private readonly keys: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, score: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.scores.push(score);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[p] <= score) break;
      this.keys[i] = this.keys[p];
      this.scores[i] = this.scores[p];
      i = p;
    }
    this.keys[i] = key;
    this.scores[i] = score;
  }

  pop(): number {
    const top = this.keys[0];
    const lastKey = this.keys.pop()!;
    const lastScore = this.scores.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let ms = lastScore;
        if (l < n && this.scores[l] < ms) {
          m = l;
          ms = this.scores[l];
        }
        if (r < n && this.scores[r] < ms) m = r;
        if (m === i) break;
        this.keys[i] = this.keys[m];
        this.scores[i] = this.scores[m];
        i = m;
      }
      this.keys[i] = lastKey;
      this.scores[i] = lastScore;
    }
    return top;
  }
}

// A* po kusech kolejí; stav = dlaždice, hrana, kterou vlak vjel, a směr jízdy
export function findTrackPath(rail: RailNetwork, from: TilePos, to: TilePos): PathStep[] | null {
  if (from.x === to.x && from.y === to.y) return null;
  const { map } = rail;
  const width = map.width;
  const GOAL = -1;

  const key = (x: number, y: number, entry: Edge, h: number): number => ((y * width + x) * 4 + entry) * 8 + h;
  const decode = (k: number): [number, number, Edge, number] => {
    const h = k % 8;
    const entry = Math.floor(k / 8) % 4;
    const tile = Math.floor(k / 32);
    return [tile % width, Math.floor(tile / width), entry as Edge, h];
  };
  const estimate = (x: number, y: number): number => {
    const dx = Math.abs(x - to.x);
    const dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const stepCost = (x: number, y: number, piece: number): number =>
    pieceLength(piece) * (rail.has(x, y, piece) ? REUSE_FACTOR : 1);
  const endCost = (x: number, y: number, piece: number): number =>
    isCorner(piece) && !rail.has(x, y, piece) ? END_CORNER_PENALTY : 0;

  const g = new Map<number, number>();
  const parents = new Map<number, Parent>();
  const heap = new MinHeap();
  let goal: { cost: number; parent: Parent } | null = null;

  const relax = (x: number, y: number, piece: number, exit: Edge, h: number, cost: number, prev: number): void => {
    if (x === to.x && y === to.y) {
      cost += endCost(x, y, piece);
      if (!goal || cost < goal.cost) {
        goal = { cost, parent: { prev, x, y, piece } };
        heap.push(GOAL, cost);
      }
      return;
    }
    // Z depa se dá vyjet jen vjezdem, projet jím nelze
    const depot = rail.depotAt(x, y);
    if (depot && depot.entrance !== exit) return;
    const [dx, dy] = EDGE_DELTA[exit];
    const nk = key(x + dx, y + dy, opposite(exit), h);
    if (!map.inBounds(x + dx, y + dy) || cost >= (g.get(nk) ?? Infinity)) return;
    g.set(nk, cost);
    parents.set(nk, { prev, x, y, piece });
    heap.push(nk, cost + estimate(x + dx, y + dy));
  };

  for (let piece = 0; piece < PIECES.length; piece++) {
    if (!rail.canPlace(from.x, from.y, piece)) continue;
    for (const [a, b] of [PIECES[piece], [PIECES[piece][1], PIECES[piece][0]]]) {
      const cost = stepCost(from.x, from.y, piece) + endCost(from.x, from.y, piece);
      relax(from.x, from.y, piece, b, heading(a, b), cost, GOAL);
    }
  }

  for (let expansions = 0; heap.size > 0 && expansions < MAX_EXPANSIONS; expansions++) {
    const current = heap.pop();
    if (current === GOAL) break;
    const [x, y, entry, h] = decode(current);
    const base = g.get(current)!;
    const depot = rail.depotAt(x, y);
    if (depot && depot.entrance !== entry) continue;

    for (let piece = 0; piece < PIECES.length; piece++) {
      const [a, b] = PIECES[piece];
      if (a !== entry && b !== entry) continue;
      const exit = a === entry ? b : a;
      const h2 = heading(entry, exit);
      if (!turnAllowed(h, h2) || !rail.canPlace(x, y, piece)) continue;
      const cost = base + stepCost(x, y, piece) + (h2 !== h ? TURN_PENALTY : 0);
      relax(x, y, piece, exit, h2, cost, current);
    }
  }

  const found = goal as { cost: number; parent: Parent } | null;
  if (!found) return null;
  const steps: PathStep[] = [];
  let node: Parent | undefined = found.parent;
  while (node) {
    steps.push({ x: node.x, y: node.y, piece: node.piece, isNew: !rail.has(node.x, node.y, node.piece) });
    node = node.prev === GOAL ? undefined : parents.get(node.prev);
  }
  return steps.reverse();
}
