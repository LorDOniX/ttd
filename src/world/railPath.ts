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

// Rohový kus (zatáčka) v té čtvrtině dlaždice, kam ukazuje bod (fx, fy v 0..1)
function cornerPiece(fx: number, fy: number): number {
  const vertical = fy < 0.5 ? Edge.N : Edge.S;
  const horizontal = fx < 0.5 ? Edge.W : Edge.E;
  return PIECES.findIndex(([a, b]) => (a === vertical || b === vertical) && (a === horizontal || b === horizontal));
}

// Kus koleje pod kurzorem jako v autorailu OpenTTD (fx, fy v 0..1): v trojúhelníku u rohu dlaždice
// zatáčka k oběma bližším hranám, jinak rovný kus ve směru, kterým je kurzor od středu dál
export function pieceAtCursor(fx: number, fy: number): number {
  const toCorner = Math.min(fx, 1 - fx) + Math.min(fy, 1 - fy);
  if (toCorner < 0.5) return cornerPiece(fx, fy);
  return Math.abs(fx - 0.5) >= Math.abs(fy - 0.5) ? axisPiece('x') : axisPiece('y');
}

// Poloha kurzoru: dlaždice a místo v ní (0..1)
export type CursorPos = TilePos & { fx: number; fy: number };

export interface LinePiece {
  x: number;
  y: number;
  piece: number;
}

// Nejdelší úsek položený jedním tažením (v kusech)
const MAX_LINE = 256;

// Přímka autorailu z OpenTTD: směr určí tažení (rovně v ose X nebo Y, jinak úhlopříčka 45°),
// u úhlopříčky vybere poloha kurzoru na začátku jednu ze dvou rovnoběžných řad rohových kusů.
// Vrací jen geometrii, bez ohledu na to, co na mapě stojí.
export function autorailLine(start: CursorPos, end: CursorPos): LinePiece[] {
  const tx = end.x - start.x;
  const ty = end.y - start.y;
  if (tx === 0 && ty === 0) return [{ x: start.x, y: start.y, piece: pieceAtCursor(start.fx, start.fy) }];
  const w = Math.abs(tx) + 1;
  const h = Math.abs(ty) + 1;
  const line: LinePiece[] = [];
  if (ty === 0 || (tx !== 0 && w > h * 2)) {
    const n = Math.min(Math.abs(tx), MAX_LINE - 1);
    for (let i = 0; i <= n; i++) line.push({ x: start.x + Math.sign(tx) * i, y: start.y, piece: axisPiece('x') });
    return line;
  }
  if (tx === 0 || h > w * 2) {
    const n = Math.min(Math.abs(ty), MAX_LINE - 1);
    for (let i = 0; i <= n; i++) line.push({ x: start.x, y: start.y + Math.sign(ty) * i, piece: axisPiece('y') });
    return line;
  }

  // Úhlopříčka: krok mezi středy sousedních kusů je půl dlaždice v obou osách
  const [vx, vy] = Math.sign(tx) === Math.sign(ty) ? [0.5, 0.5] : [0.5, -0.5];
  const [sx, sy] = [start.x + start.fx, start.y + start.fy];
  const [ex, ey] = [end.x + end.fx, end.y + end.fy];
  // Středy dvou rohových kusů výchozí dlaždice, které leží na této ose
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
    // Kurzor uprostřed je od obou řad stejně daleko, rozhodne cíl tažení
    return d < -1e-9 || (Math.abs(d) <= 1e-9 && offset(c, ex, ey) < offset(best, ex, ey)) ? c : best;
  });
  const along = ((ex - px) * vx + (ey - py) * vy) / (vx * vx + vy * vy);
  const count = Math.min(Math.round(Math.abs(along)), MAX_LINE - 1);
  const sign = along < 0 ? -1 : 1;
  for (let i = 0; i <= count; i++) {
    const cx = px + sign * i * vx;
    const cy = py + sign * i * vy;
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    line.push({ x, y, piece: cornerPiece(cx - x, cy - y) });
  }
  return line;
}

// Hrana kusu, kterou vede na sousední dlaždici (x2, y2), nebo null
function edgeToward(p: LinePiece, x2: number, y2: number): Edge | null {
  for (const e of PIECES[p.piece]) {
    if (p.x + EDGE_DELTA[e][0] === x2 && p.y + EDGE_DELTA[e][1] === y2) return e;
  }
  return null;
}

export interface AutorailPlan {
  // Kusy ke stavbě (i už postavené s isNew false), v režimu odebírání kusy k odstranění
  steps: PathStep[];
  // Zbytek přímky za první překážkou; staví se jen to před ní, jako v OpenTTD
  blocked: TilePos[];
}

// Z kolejí, přejezdů a mostů jde kus odebrat; nástupiště a depa jen demolicí
export function removableTile(rail: RailNetwork, x: number, y: number): boolean {
  if (!rail.map.inBounds(x, y)) return false;
  const type = rail.map.get(x, y);
  // Kolej na nájezdu mostu jde odstranit jen se mostem (demolicí)
  return (type === TileType.Rail || type === TileType.Crossing || type === TileType.Bridge) && !rail.bridgeAtHead(x, y);
}

// Plán tažení autorailu: stavba (zastaví se na první překážce) nebo odebírání (Ctrl)
export function autorailPlan(
  rail: RailNetwork,
  start: CursorPos,
  end: CursorPos,
  mode: 'build' | 'remove' = 'build',
): AutorailPlan {
  const line = autorailLine(start, end);
  if (mode === 'remove') {
    return {
      steps: line
        .filter((p) => removableTile(rail, p.x, p.y) && rail.has(p.x, p.y, p.piece))
        .map((p) => ({ ...p, isNew: false })),
      blocked: [],
    };
  }
  const steps: PathStep[] = [];
  const blocked: TilePos[] = [];
  line.forEach((p, i) => {
    if (blocked.length > 0) {
      blocked.push({ x: p.x, y: p.y });
      return;
    }
    // Kolej jiného druhu (jednokolejka, maglev) se nepřevezme
    const exists = rail.has(p.x, p.y, p.piece) && rail.railTypeAt(p.x, p.y) === rail.buildType;
    let ok = exists || rail.canPlace(p.x, p.y, p.piece);
    // Do depa se vjíždí jen vjezdem; přímka zadní stěnou neprojede
    const depot = ok ? rail.depotAt(p.x, p.y) : undefined;
    if (depot) {
      const prev = line[i - 1];
      const next = line[i + 1];
      if (prev && edgeToward(p, prev.x, prev.y) !== depot.entrance) ok = false;
      if (next && edgeToward(p, next.x, next.y) !== depot.entrance) ok = false;
    }
    if (ok) steps.push({ ...p, isNew: !exists });
    else blocked.push({ x: p.x, y: p.y });
  });
  return { steps: withDepotLinks(rail, steps), blocked };
}

// Spojky depa s kolejí vedoucí kolmo před jeho vjezdem: zatáčky z vjezdu do obou směrů, kam kolej pokračuje.
// Když už kolej k vjezdu vede, nic nepřidá. planned = kusy, které se teprve postaví.
export function depotLinks(
  rail: RailNetwork,
  x: number,
  y: number,
  entrance: Edge,
  planned?: (x: number, y: number, piece: number) => boolean,
): PathStep[] {
  const has = (tx: number, ty: number, piece: number): boolean =>
    rail.has(tx, ty, piece) || (planned?.(tx, ty, piece) ?? false);
  const touches = (tx: number, ty: number, edge: Edge): boolean =>
    PIECES.some(([a, b], piece) => (a === edge || b === edge) && has(tx, ty, piece));
  const fx = x + EDGE_DELTA[entrance][0];
  const fy = y + EDGE_DELTA[entrance][1];
  if (!rail.map.inBounds(fx, fy)) return [];
  const back = opposite(entrance);
  if (touches(fx, fy, back)) return [];

  const links: PathStep[] = [];
  for (const side of [(back + 1) % 4, (back + 3) % 4] as Edge[]) {
    // Před depem musí vést kolej, ke které se napojí
    if (!touches(fx, fy, side)) continue;
    const piece = PIECES.findIndex(([a, b]) => (a === back && b === side) || (a === side && b === back));
    if (!rail.canPlace(fx, fy, piece)) continue;
    // A za hranou musí pokračovat tak, aby vlak nezatáčel víc než o 45°
    const h = heading(back, side);
    const nx = fx + EDGE_DELTA[side][0];
    const ny = fy + EDGE_DELTA[side][1];
    const entry = opposite(side);
    const continues = PIECES.some(
      ([a, b], p) =>
        (a === entry || b === entry) && has(nx, ny, p) && turnAllowed(h, heading(entry, a === entry ? b : a)),
    );
    if (continues) links.push({ x: fx, y: fy, piece, isNew: true });
  }
  return links;
}

// Doplní spojky dep, před jejichž vjezdem nová kolej vede
export function withDepotLinks(rail: RailNetwork, steps: PathStep[]): PathStep[] {
  const fresh = steps.filter((s) => s.isNew);
  if (fresh.length === 0) return steps;
  const key = (x: number, y: number, piece: number): string => `${x},${y},${piece}`;
  const planned = new Set(steps.map((s) => key(s.x, s.y, s.piece)));
  const result = [...steps];
  for (const depot of rail.depots) {
    const fx = depot.x + EDGE_DELTA[depot.entrance][0];
    const fy = depot.y + EDGE_DELTA[depot.entrance][1];
    // Stačí dlaždice před vjezdem a její sousedé, kde mohla nová kolej navázat
    if (!fresh.some((s) => Math.abs(s.x - fx) + Math.abs(s.y - fy) <= 1)) continue;
    for (const link of depotLinks(rail, depot.x, depot.y, depot.entrance, (x, y, p) => planned.has(key(x, y, p)))) {
      if (planned.has(key(link.x, link.y, link.piece))) continue;
      planned.add(key(link.x, link.y, link.piece));
      result.push(link);
    }
  }
  return result;
}

// Kus k odebrání pod kurzorem: zvýrazněný, jinak jediný kus na dlaždici
export function removablePieceAt(rail: RailNetwork, tile: CursorPos): PathStep | null {
  if (!removableTile(rail, tile.x, tile.y)) return null;
  const chosen = pieceAtCursor(tile.fx, tile.fy);
  if (rail.has(tile.x, tile.y, chosen)) return { x: tile.x, y: tile.y, piece: chosen, isNew: false };
  const present = PIECES.map((_, p) => p).filter((p) => rail.has(tile.x, tile.y, p));
  return present.length === 1 ? { x: tile.x, y: tile.y, piece: present[0], isNew: false } : null;
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
