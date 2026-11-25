import { GameMap, MAX_HEIGHT, TileType, type TilePos } from './map';
import { fbm } from './noise';

// Členitost terénu nové mapy jako „Terrain type“ v OpenTTD
export type TerrainKind = 'flat' | 'gentle' | 'hilly';
export const TERRAIN_KINDS: readonly TerrainKind[] = ['flat', 'gentle', 'hilly'];
export const TERRAIN_NAMES: Record<TerrainKind, string> = {
  flat: 'Rovina',
  gentle: 'Mírně zvlněný',
  hilly: 'Kopcovitý',
};

export function isTerrainKind(value: unknown): value is TerrainKind {
  return typeof value === 'string' && (TERRAIN_KINDS as readonly string[]).includes(value);
}

// Nejvyšší úroveň kopců pro daný druh terénu
const AMPLITUDE: Record<TerrainKind, number> = { flat: 0, gentle: 4, hilly: 9 };
const HILL_SCALE = 1 / 26;
// Jak rychle terén od břehu stoupá do vnitrozemí (v jednotkách šumu vody)
const INLAND_RISE = 2.4;

// Sousedé rohu v mřížce rohů (8 směrů): sousední rohy se smí lišit nejvýš o 1 (i úhlopříčně)
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

// Je některá dlaždice sdílející roh (cx, cy) voda? Takový roh musí zůstat na úrovni 0
function touchesWater(map: GameMap, cx: number, cy: number): boolean {
  for (let y = cy - 1; y <= cy; y++) {
    for (let x = cx - 1; x <= cx; x++) if (map.inBounds(x, y) && map.isType(x, y, TileType.Water)) return true;
  }
  return false;
}

// Výšková mapa ze šumu: vnitrozemí výš, roviny u vody, voda na úrovni 0, sousední rohy ±1.
// Zapisuje přímo do pole výšek (mapa se ještě nevykresluje)
export function generateHeights(
  map: GameMap,
  seed: number,
  waterScale: number,
  waterLevel: number,
  terrain: TerrainKind,
): void {
  const amplitude = AMPLITUDE[terrain];
  if (amplitude === 0) return;
  const stride = map.width + 1;
  const hillSeed = seed ^ 0x5bd1e995;
  for (let cy = 0; cy <= map.height; cy++) {
    for (let cx = 0; cx <= map.width; cx++) {
      if (touchesWater(map, cx, cy)) continue;
      const water = fbm(seed, cx * waterScale, cy * waterScale);
      const inland = Math.max(0, Math.min(1, ((water - waterLevel) / (1 - waterLevel)) * INLAND_RISE));
      const hill = fbm(hillSeed, cx * HILL_SCALE, cy * HILL_SCALE, 5);
      const level = Math.round(amplitude * inland * (0.25 + 1.5 * Math.max(0, hill - 0.3)));
      map.heights[cy * stride + cx] = Math.max(0, Math.min(MAX_HEIGHT, level));
    }
  }
  relaxAll(map);
  map.heightRevision++;
}

// Srovná všechny rohy, aby se sousední lišily nejvýš o 1: jen snižuje (dva průchody jako vzdálenostní transformace)
function relaxAll(map: GameMap): void {
  const w = map.width + 1;
  const h = map.height + 1;
  const heights = map.heights;
  const pass = (forward: boolean): void => {
    for (let k = 0; k < w * h; k++) {
      const i = forward ? k : w * h - 1 - k;
      const cx = i % w;
      const cy = Math.floor(i / w);
      let level = heights[i];
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        level = Math.min(level, heights[ny * w + nx] + 1);
      }
      heights[i] = level;
    }
  };
  pass(true);
  pass(false);
}

// Po snížení rohů sníží i okolí, kde by rozdíl sousedních rohů přesáhl 1 (šíří se jen tam, kde je potřeba)
export function relaxFrom(map: GameMap, corners: Iterable<TilePos>): void {
  const queue = [...corners];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    const level = map.cornerLevel(x, y);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx > map.width || ny > map.height) continue;
      if (map.cornerLevel(nx, ny) <= level + 1) continue;
      map.setCornerLevel(nx, ny, level + 1);
      queue.push({ x: nx, y: ny });
    }
  }
}

// Srovná obdélník dlaždic [x0, x1] × [y0, y1] na úroveň jeho nejnižšího rohu (terén se jen odkope)
// a okolí dorovná; vrací novou úroveň
export function flattenDown(map: GameMap, x0: number, y0: number, x1: number, y1: number): number {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(map.width, x1 + 1);
  const cy1 = Math.min(map.height, y1 + 1);
  let level = MAX_HEIGHT;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) level = Math.min(level, map.cornerLevel(cx, cy));
  const changed: TilePos[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (map.cornerLevel(cx, cy) === level) continue;
      map.setCornerLevel(cx, cy, level);
      changed.push({ x: cx, y: cy });
    }
  }
  relaxFrom(map, changed);
  return level;
}
