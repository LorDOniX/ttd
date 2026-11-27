import { GameMap, MAX_HEIGHT, TileType, type TilePos } from './map';

// Úprava terénu jako v OpenTTD: zvednout, snížit, nebo srovnat rohy na jednu úroveň
export type TerraformMode = 'raise' | 'lower' | 'level';

export interface TerraformPlan {
  // Nové úrovně změněných rohů (index cy * (width + 1) + cx)
  levels: Map<number, number>;
  problem: string | null;
}

// Sousední rohy (i úhlopříčně) se smí lišit nejvýš o 1
const NEIGHBOURS: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// Dlaždice, jejíž rohy smí úprava změnit: jen volná země (tráva, les) bez mostu nad ní
function canReshape(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return true;
  return (map.isType(x, y, TileType.Grass) || map.isType(x, y, TileType.Trees)) && !map.isBridged(x, y);
}

// Rohy obdélníku dlaždic [x0, x1] × [y0, y1] (v obou pořadích)
export function areaCorners(x0: number, y0: number, x1: number, y1: number): TilePos[] {
  const corners: TilePos[] = [];
  for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1) + 1; cy++) {
    for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1) + 1; cx++) corners.push({ x: cx, y: cy });
  }
  return corners;
}

// Nejbližší roh k bodu (fx, fy) dlaždice (x, y); fx, fy v 0..1
export function nearestCorner(x: number, y: number, fx: number, fy: number): TilePos {
  return { x: x + (fx >= 0.5 ? 1 : 0), y: y + (fy >= 0.5 ? 1 : 0) };
}

// Plán úpravy: zvolené rohy o úroveň nahoru / dolů (nebo na úroveň target) a okolí dorovnané tak,
// aby se sousední rohy lišily nejvýš o 1. Problém, pokud by se měnila stavba, voda nebo okraj výšky
export function planTerraform(
  map: GameMap,
  corners: readonly TilePos[],
  mode: TerraformMode,
  target = 0,
  // Dlaždice, pod kterými vede tunel: terén nad ním zůstane
  locked: (x: number, y: number) => boolean = () => false,
): TerraformPlan {
  const stride = map.width + 1;
  const levels = new Map<number, number>();
  const level = (cx: number, cy: number): number => levels.get(cy * stride + cx) ?? map.cornerLevel(cx, cy);
  const queue: TilePos[] = [];
  for (const c of corners) {
    if (c.x < 0 || c.y < 0 || c.x > map.width || c.y > map.height) continue;
    const now = map.cornerLevel(c.x, c.y);
    const next = mode === 'raise' ? now + 1 : mode === 'lower' ? now - 1 : target;
    if (next < 0) return { levels: new Map(), problem: 'Níž terén snížit nejde.' };
    if (next > MAX_HEIGHT) return { levels: new Map(), problem: `Výš než ${MAX_HEIGHT} úrovní terén zvednout nejde.` };
    if (next === now) continue;
    levels.set(c.y * stride + c.x, next);
    queue.push(c);
  }
  // Dorovnání okolí: příliš nízké sousedy zvedne, příliš vysoké sníží (šíří se jen tam, kde je potřeba)
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    const h = level(x, y);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx > map.width || ny > map.height) continue;
      const n = level(nx, ny);
      const fixed = n < h - 1 ? h - 1 : n > h + 1 ? h + 1 : n;
      if (fixed === n) continue;
      levels.set(ny * stride + nx, fixed);
      queue.push({ x: nx, y: ny });
    }
  }
  for (const [i, next] of levels) {
    const cx = i % stride;
    const cy = Math.floor(i / stride);
    if (next === map.cornerLevel(cx, cy)) {
      levels.delete(i);
      continue;
    }
    for (let y = cy - 1; y <= cy; y++) {
      for (let x = cx - 1; x <= cx; x++) {
        if (!map.inBounds(x, y)) continue;
        if (map.isType(x, y, TileType.Water)) return { levels, problem: 'Terén u vody zůstane na úrovni hladiny.' };
        if (!canReshape(map, x, y))
          return { levels, problem: 'Nejdřív je třeba odstranit stavbu, kolej nebo silnici.' };
        if (locked(x, y)) return { levels, problem: 'Nad tunelem terén měnit nejde.' };
      }
    }
  }
  return { levels, problem: null };
}

// Dlaždice, kterých se úprava dotkne (pro náhled)
export function planTiles(map: GameMap, plan: TerraformPlan): TilePos[] {
  const stride = map.width + 1;
  const tiles = new Map<number, TilePos>();
  for (const i of plan.levels.keys()) {
    const cx = i % stride;
    const cy = Math.floor(i / stride);
    for (let y = cy - 1; y <= cy; y++) {
      for (let x = cx - 1; x <= cx; x++) if (map.inBounds(x, y)) tiles.set(y * map.width + x, { x, y });
    }
  }
  return [...tiles.values()];
}

export function applyTerraform(map: GameMap, plan: TerraformPlan): void {
  const stride = map.width + 1;
  for (const [i, next] of plan.levels) map.setCornerLevel(i % stride, Math.floor(i / stride), next);
}
