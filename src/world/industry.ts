import { GameMap, TileType } from './map';
import type { Rng } from './rng';
import { KIND_RULES, type Town } from './town';

export type IndustryKind = 'coal-mine' | 'power-station';

export interface Industry {
  id: number;
  kind: IndustryKind;
  name: string;
  // Levý horní roh čtvercového areálu
  x: number;
  y: number;
  // Natočení areálu po 90°
  rotation: number;
}

export const INDUSTRY_SIZE = 3;

export const INDUSTRY_NAMES: Record<IndustryKind, string> = {
  'coal-mine': 'Uhelný důl',
  'power-station': 'Elektrárna',
};

// Kolik dlaždic mapy připadá na jeden průmysl daného druhu
const TILES_PER_INDUSTRY: Record<IndustryKind, number> = { 'coal-mine': 11_000, 'power-station': 16_000 };
const MIN_INDUSTRY_DISTANCE = 12;
// Odstup od středu města, aby areál nebránil jeho růstu
const TOWN_CLEARANCE = 4;
const EDGE_MARGIN = 4;

export function industryTiles(industry: Industry): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < INDUSTRY_SIZE; dy++) {
    for (let dx = 0; dx < INDUSTRY_SIZE; dx++) tiles.push({ x: industry.x + dx, y: industry.y + dy });
  }
  return tiles;
}

export function industryAt(industries: readonly Industry[], x: number, y: number): Industry | undefined {
  return industries.find((i) => x >= i.x && x < i.x + INDUSTRY_SIZE && y >= i.y && y < i.y + INDUSTRY_SIZE);
}

// Rozmístí doly a elektrárny na volnou zem mimo města; les na místě areálu se vykácí
export function placeIndustries(map: GameMap, towns: readonly Town[], rng: Rng): Industry[] {
  const industries: Industry[] = [];
  const area = map.width * map.height;
  for (const kind of Object.keys(TILES_PER_INDUSTRY) as IndustryKind[]) {
    const count = Math.max(1, Math.round(area / TILES_PER_INDUSTRY[kind]));
    let placed = 0;
    for (let attempt = 0; attempt < count * 80 && placed < count; attempt++) {
      const x = rng.int(EDGE_MARGIN, map.width - EDGE_MARGIN - INDUSTRY_SIZE);
      const y = rng.int(EDGE_MARGIN, map.height - EDGE_MARGIN - INDUSTRY_SIZE);
      const candidate: Industry = { id: industries.length, kind, name: '', x, y, rotation: rng.int(0, 3) };
      const tiles = industryTiles(candidate);
      if (!tiles.every((t) => map.isFree(t.x, t.y))) continue;
      const cx = x + INDUSTRY_SIZE / 2;
      const cy = y + INDUSTRY_SIZE / 2;
      const nearTown = towns.some(
        (t) => Math.hypot(t.x - cx, t.y - cy) < KIND_RULES[t.kind].maxRadius + TOWN_CLEARANCE,
      );
      const nearIndustry = industries.some((i) => Math.hypot(i.x - x, i.y - y) < MIN_INDUSTRY_DISTANCE);
      if (nearTown || nearIndustry) continue;

      candidate.name = industryName(kind, towns, industries, cx, cy);
      for (const t of tiles) map.set(t.x, t.y, TileType.Industry);
      industries.push(candidate);
      placed++;
    }
  }
  return industries;
}

// Podle nejbližšího města, další stejného druhu u téhož města dostane číslo
function industryName(
  kind: IndustryKind,
  towns: readonly Town[],
  industries: readonly Industry[],
  x: number,
  y: number,
): string {
  const town = [...towns].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  const base = town ? `${INDUSTRY_NAMES[kind]} ${town.name}` : INDUSTRY_NAMES[kind];
  const same = industries.filter((i) => i.name === base || i.name.startsWith(`${base} `)).length;
  return same === 0 ? base : `${base} ${same + 1}`;
}
