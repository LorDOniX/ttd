import { COAL_PRODUCTION, IRON_ORE_PRODUCTION, OIL_PRODUCTION, WOOD_PRODUCTION } from '../game/balance';
import type { FreightType } from '../game/cargo';
import { GameMap, TileType } from './map';
import type { Rng } from './rng';
import { KIND_RULES, type Town } from './town';

export type IndustryKind =
  | 'coal-mine'
  | 'power-station'
  | 'forest'
  | 'sawmill'
  | 'oil-wells'
  | 'refinery'
  | 'iron-mine'
  | 'steel-mill'
  | 'factory';

export interface Industry {
  id: number;
  kind: IndustryKind;
  name: string;
  // Levý horní roh čtvercového areálu
  x: number;
  y: number;
  // Natočení areálu po 90°
  rotation: number;
  // Výroba v tunách za měsíc a odvoz tento a minulý měsíc
  production: number;
  transported: number;
  lastTransported: number;
  // Dovezený náklad tento a minulý měsíc; zpracovatel z něj vyrábí
  received: number;
  lastReceived: number;
  // Den poslední dodávky nebo založení; zpracovatel bez dodávek časem zanikne
  lastDelivery: number;
}

export const INDUSTRY_SIZE = 3;

export interface IndustryType {
  name: string;
  produces: FreightType | null;
  // Rozsah těžby suroviny za měsíc; null = vyrábí z dovezeného nákladu
  production: { min: number; max: number } | null;
  accepts: readonly FreightType[];
  // Kolik dlaždic mapy připadá na jeden závod
  tilesPerIndustry: number;
}

// Řetězce jako v OpenTTD: uhlí → elektrárna, dřevo → pila, ropa → rafinerie, ruda → ocelárna → ocel → továrna;
// zboží vykupují města
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
    production: null,
    accepts: ['coal'],
    tilesPerIndustry: 16_000,
  },
  forest: {
    name: 'Les',
    produces: 'wood',
    production: WOOD_PRODUCTION,
    accepts: [],
    tilesPerIndustry: 12_000,
  },
  sawmill: {
    name: 'Pila',
    produces: 'goods',
    production: null,
    accepts: ['wood'],
    tilesPerIndustry: 22_000,
  },
  'oil-wells': {
    name: 'Ropné vrty',
    produces: 'oil',
    production: OIL_PRODUCTION,
    accepts: [],
    tilesPerIndustry: 14_000,
  },
  refinery: {
    name: 'Rafinerie',
    produces: 'goods',
    production: null,
    accepts: ['oil'],
    tilesPerIndustry: 26_000,
  },
  'iron-mine': {
    name: 'Železorudný důl',
    produces: 'iron-ore',
    production: IRON_ORE_PRODUCTION,
    accepts: [],
    tilesPerIndustry: 14_000,
  },
  'steel-mill': {
    name: 'Ocelárna',
    produces: 'steel',
    production: null,
    accepts: ['iron-ore'],
    tilesPerIndustry: 22_000,
  },
  factory: {
    name: 'Továrna',
    produces: 'goods',
    production: null,
    accepts: ['steel'],
    tilesPerIndustry: 22_000,
  },
};

export function isIndustryKind(value: unknown): value is IndustryKind {
  return typeof value === 'string' && value in INDUSTRY_TYPES;
}

// Střední těžba druhu závodu, např. pro starší uložení bez údaje; zpracovatelé začínají od nuly
export function averageProduction(kind: IndustryKind): number {
  const range = INDUSTRY_TYPES[kind].production;
  return range ? Math.round((range.min + range.max) / 2) : 0;
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

// Rozmístí závody na volnou zem mimo města; les na místě areálu se vykácí
export function placeIndustries(map: GameMap, towns: readonly Town[], rng: Rng): Industry[] {
  const industries: Industry[] = [];
  const area = map.width * map.height;
  for (const kind of Object.keys(INDUSTRY_TYPES) as IndustryKind[]) {
    const count = Math.max(1, Math.round(area / INDUSTRY_TYPES[kind].tilesPerIndustry));
    let placed = 0;
    for (let attempt = 0; attempt < count * 80 && placed < count; attempt++) {
      const industry = tryPlaceIndustry(map, towns, industries, kind, rng);
      if (!industry) continue;
      industries.push(industry);
      placed++;
    }
  }
  return industries;
}

// Jeden pokus o založení závodu na náhodném místě; při úspěchu zabere dlaždice, do seznamu ho nepřidá
export function tryPlaceIndustry(
  map: GameMap,
  towns: readonly Town[],
  industries: readonly Industry[],
  kind: IndustryKind,
  rng: Rng,
  day = 0,
): Industry | null {
  const type = INDUSTRY_TYPES[kind];
  const x = rng.int(EDGE_MARGIN, map.width - EDGE_MARGIN - INDUSTRY_SIZE);
  const y = rng.int(EDGE_MARGIN, map.height - EDGE_MARGIN - INDUSTRY_SIZE);
  const candidate: Industry = {
    id: industries.reduce((max, i) => Math.max(max, i.id + 1), 0),
    kind,
    name: '',
    x,
    y,
    rotation: rng.int(0, 3),
    production: 0,
    transported: 0,
    lastTransported: 0,
    received: 0,
    lastReceived: 0,
    lastDelivery: day,
  };
  const tiles = industryTiles(candidate);
  if (!tiles.every((t) => map.isFree(t.x, t.y))) return null;
  const cx = x + INDUSTRY_SIZE / 2;
  const cy = y + INDUSTRY_SIZE / 2;
  const nearTown = towns.some((t) => Math.hypot(t.x - cx, t.y - cy) < KIND_RULES[t.kind].maxRadius + TOWN_CLEARANCE);
  const nearIndustry = industries.some((i) => Math.hypot(i.x - x, i.y - y) < MIN_INDUSTRY_DISTANCE);
  if (nearTown || nearIndustry) return null;

  candidate.name = industryName(kind, towns, industries, cx, cy);
  if (type.production) candidate.production = rng.int(type.production.min, type.production.max);
  for (const t of tiles) map.set(t.x, t.y, TileType.Industry);
  return candidate;
}

// Podle nejbližšího města, další stejného druhu u téhož města dostane první volné číslo
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
  const taken = new Set(industries.map((i) => i.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
