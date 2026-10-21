import { COAL_PRODUCTION } from '../game/balance';
import type { FreightType } from '../game/cargo';
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
  // Těžba v tunách za měsíc (jen závody, které něco vyrábějí) a odvoz tento a minulý měsíc
  production: number;
  transported: number;
  lastTransported: number;
}

export const INDUSTRY_SIZE = 3;

export interface IndustryType {
  name: string;
  produces: FreightType | null;
  // Rozsah těžby v tunách za měsíc pro závod, který vyrábí
  production: { min: number; max: number };
  accepts: readonly FreightType[];
  // Kolik dlaždic mapy připadá na jeden závod
  tilesPerIndustry: number;
}

export const INDUSTRY_TYPES: Record<IndustryKind, IndustryType> = {
  'coal-mine': {
    name: 'Uhelný důl',
    produces: 'coal',
    production: COAL_PRODUCTION,
    accepts: [],
    tilesPerIndustry: 11_000,
  },
  'power-station': {
    name: 'Elektrárna',
    produces: null,
    production: { min: 0, max: 0 },
    accepts: ['coal'],
    tilesPerIndustry: 16_000,
  },
};

export function isIndustryKind(value: unknown): value is IndustryKind {
  return typeof value === 'string' && value in INDUSTRY_TYPES;
}

// Střední těžba druhu závodu, např. pro starší uložení bez údaje
export function averageProduction(kind: IndustryKind): number {
  const { min, max } = INDUSTRY_TYPES[kind].production;
  return Math.round((min + max) / 2);
}

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
  for (const kind of Object.keys(INDUSTRY_TYPES) as IndustryKind[]) {
    const type = INDUSTRY_TYPES[kind];
    const count = Math.max(1, Math.round(area / type.tilesPerIndustry));
    let placed = 0;
    for (let attempt = 0; attempt < count * 80 && placed < count; attempt++) {
      const x = rng.int(EDGE_MARGIN, map.width - EDGE_MARGIN - INDUSTRY_SIZE);
      const y = rng.int(EDGE_MARGIN, map.height - EDGE_MARGIN - INDUSTRY_SIZE);
      const candidate: Industry = {
        id: industries.length,
        kind,
        name: '',
        x,
        y,
        rotation: rng.int(0, 3),
        production: 0,
        transported: 0,
        lastTransported: 0,
      };
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
      if (type.produces) candidate.production = rng.int(type.production.min, type.production.max);
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
  const name = INDUSTRY_TYPES[kind].name;
  const base = town ? `${name} ${town.name}` : name;
  const same = industries.filter((i) => i.name === base || i.name.startsWith(`${base} `)).length;
  return same === 0 ? base : `${base} ${same + 1}`;
}
