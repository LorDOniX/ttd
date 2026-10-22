import { BRIDGE_PIECE_COST, TRACK_PIECE_COST } from '../game/balance';
import { MinHeap } from './heap';
import { TileType, type TilePos } from './map';
import {
  EDGE_DELTA,
  Edge,
  PIECES,
  RailNetwork,
  axisPiece,
  heading,
  isCorner,
  opposite,
  pieceLength,
  turnAllowed,
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
// Most je dražší, trasa vede přes vodu jen když se objíždění nevyplatí
const BRIDGE_FACTOR = BRIDGE_PIECE_COST / TRACK_PIECE_COST;

interface Parent {
  prev: number;
  x: number;
  y: number;
  piece: number;
}

// Hranice od středu dlaždice, za kterou kurzor v rohu vybere zatáčku
const CORNER_ZONE = 0.25;

// Rohový kus (zatáčka) v té čtvrtině dlaždice, kam ukazuje bod (fx, fy v 0..1)
function cornerPiece(fx: number, fy: number): number {
  const vertical = fy < 0.5 ? Edge.N : Edge.S;
  const horizontal = fx < 0.5 ? Edge.W : Edge.E;
  return PIECES.findIndex(([a, b]) => (a === vertical || b === vertical) && (a === horizontal || b === horizontal));
}

// Kus koleje podle polohy kurzoru v dlaždici (fx, fy v 0..1): v rohu zatáčka k bližším hranám,
// jinak rovný kus ve směru, kterým je kurzor od středu dál
export function pieceAtCursor(fx: number, fy: number): number {
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  if (Math.abs(dx) > CORNER_ZONE && Math.abs(dy) > CORNER_ZONE) return cornerPiece(fx, fy);
  return Math.abs(dx) >= Math.abs(dy) ? axisPiece('x') : axisPiece('y');
}

// Nejdelší diagonála položená jedním tažením (v kusech)
const MAX_DIAGONAL = 256;

// Diagonála z rohových kusů jako v OpenTTD: tažení začaté v rohu dlaždice vede po přímce rohových kusů
// ve směru tažení k místu nejbližšímu kurzoru. Roh začátku vybere jednu ze dvou rovnoběžných přímek
// přes dlaždici. Vrací null, když tažení nezačalo v rohu nebo některý kus nejde položit.
export function diagonalPath(
  rail: RailNetwork,
  start: TilePos & { fx: number; fy: number },
  end: TilePos & { fx: number; fy: number },
): PathStep[] | null {
  if (!isCorner(pieceAtCursor(start.fx, start.fy))) return null;
  const [sx, sy] = [start.x + start.fx, start.y + start.fy];
  const [ex, ey] = [end.x + end.fx, end.y + end.fy];
  // Krok mezi středy sousedních kusů: půl dlaždice v obou osách, osa podle směru tažení
  const [vx, vy] = Math.abs(ex - sx + (ey - sy)) >= Math.abs(ex - sx - (ey - sy)) ? [0.5, 0.5] : [0.5, -0.5];
  // Středy dvou rohových kusů dlaždice, které leží na této ose
  const centers = (
    vy > 0
      ? [
          [0.75, 0.25],
          [0.25, 0.75],
        ]
      : [
          [0.25, 0.25],
          [0.75, 0.75],
        ]
  ).map(([cx, cy]) => [start.x + cx, start.y + cy] as const);
  // Vzdálenost bodu od přímky kusu se středem c (kolmo k ose)
  const offset = (c: readonly [number, number], px: number, py: number): number =>
    Math.abs((px - c[0]) * vy - (py - c[1]) * vx);
  const [px, py] = centers.reduce((best, c) => {
    const d = offset(c, sx, sy) - offset(best, sx, sy);
    // Kurzor v rohu je od obou přímek stejně daleko, rozhodne cíl tažení
    return d < -1e-9 || (Math.abs(d) <= 1e-9 && offset(c, ex, ey) < offset(best, ex, ey)) ? c : best;
  });
  const along = ((ex - px) * vx + (ey - py) * vy) / (vx * vx + vy * vy);
  const count = Math.min(Math.round(Math.abs(along)), MAX_DIAGONAL);
  const sign = along < 0 ? -1 : 1;

  const steps: PathStep[] = [];
  for (let i = 0; i <= count; i++) {
    const cx = px + sign * i * vx;
    const cy = py + sign * i * vy;
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    const piece = cornerPiece(cx - x, cy - y);
    if (!rail.canPlace(x, y, piece)) return null;
    steps.push({ x, y, piece, isNew: !rail.has(x, y, piece) });
  }
  return steps;
}

// Jediný kus koleje na dlaždici; když vybraný nejde položit (např. na silnici), zkusí rovný kus
export function singlePieceStep(rail: RailNetwork, tile: TilePos, fx: number, fy: number): PathStep | null {
  const chosen = pieceAtCursor(fx, fy);
  const piece = [chosen, axisPiece('x'), axisPiece('y')].find((p) => rail.canPlace(tile.x, tile.y, p));
  if (piece === undefined) return null;
  return { x: tile.x, y: tile.y, piece, isNew: !rail.has(tile.x, tile.y, piece) };
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
    pieceLength(piece) * (rail.has(x, y, piece) ? REUSE_FACTOR : map.get(x, y) === TileType.Water ? BRIDGE_FACTOR : 1);
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
