import { TOWN_POPULATION } from '../game/balance';
import { placeIndustries, type Industry } from './industry';
import { GameMap, TileType } from './map';
import { CITY_NAMES, VILLAGE_NAMES } from './names';
import { fbm } from './noise';
import { RailNetwork } from './rail';
import { Rng } from './rng';
import { createTownShape, expandTown, type Town, type TownKind } from './town';

export interface World {
  seed: number;
  map: GameMap;
  towns: Town[];
  rail: RailNetwork;
  industries: Industry[];
}

export interface GenerateOptions {
  // Hranice šumu pro vodu: vyšší = víc vody
  waterLevel: number;
  // Násobek počtu měst a vesnic
  townDensity: number;
}

const DEFAULT_OPTIONS: GenerateOptions = { waterLevel: 0.34, townDensity: 1 };

const WATER_SCALE = 1 / 28;
const EDGE_MARGIN = 14;

const TILES_PER_TOWN: Record<TownKind, number> = { city: 9000, village: 4500 };

function generateWater(map: GameMap, seed: number, level: number): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (fbm(seed, x * WATER_SCALE, y * WATER_SCALE) < level) map.set(x, y, TileType.Water);
    }
  }
}

const FOREST_SCALE = 1 / 22;
const FOREST_LEVEL = 0.58;
const FOREST_DENSITY = 0.85;
const LONE_TREE_CHANCE = 0.03;

// Rovnoměrně rozdělená náhoda 0..1 pro dlaždici
function tileRandom(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Lesy podle šumu a občasné solitéry na volné trávě
function generateTrees(map: GameMap, seed: number): void {
  const forestSeed = seed ^ 0x9e3779b9;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.isType(x, y, TileType.Grass)) continue;
      const forest = fbm(forestSeed, x * FOREST_SCALE, y * FOREST_SCALE) > FOREST_LEVEL;
      const roll = tileRandom(forestSeed, x, y);
      if (roll < (forest ? FOREST_DENSITY : LONE_TREE_CHANCE)) map.set(x, y, TileType.Trees);
    }
  }
}

function landRatio(map: GameMap, cx: number, cy: number, r: number): number {
  let land = 0;
  let total = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      total++;
      if (map.isFree(x, y)) land++;
    }
  }
  return land / total;
}

function minDistance(kind: TownKind, other: TownKind): number {
  return kind === 'city' && other === 'city' ? 40 : 26;
}

function placeTowns(
  map: GameMap,
  rng: Rng,
  kind: TownKind,
  names: string[],
  towns: Town[],
  year: number,
  density: number,
): void {
  const population = TOWN_POPULATION[kind];
  const count = Math.max(1, Math.round(((map.width * map.height) / TILES_PER_TOWN[kind]) * density));
  let placed = 0;

  for (let attempt = 0; attempt < 600 * density && placed < count && names.length > 0; attempt++) {
    const x = rng.int(EDGE_MARGIN, map.width - 1 - EDGE_MARGIN);
    const y = rng.int(EDGE_MARGIN, map.height - 1 - EDGE_MARGIN);
    if (!map.isFree(x, y) || landRatio(map, x, y, 6) < 0.75) continue;
    if (towns.some((t) => Math.hypot(t.x - x, t.y - y) < minDistance(kind, t.kind))) continue;

    const town: Town = {
      id: towns.length,
      name: names.pop()!,
      kind,
      x,
      y,
      population: rng.int(population.min, population.max),
      radius: 2,
      shape: createTownShape(rng),
      buildings: [],
      served: false,
    };
    expandTown(map, town, year, rng);
    towns.push(town);
    placed++;
  }
}

export function generateWorld(
  seed: number,
  size: number,
  year: number,
  options: GenerateOptions = DEFAULT_OPTIONS,
): World {
  const rng = new Rng(seed);
  const map = new GameMap(size, size);
  generateWater(map, seed, options.waterLevel);

  const towns: Town[] = [];
  placeTowns(map, rng, 'city', rng.shuffle([...CITY_NAMES]), towns, year, options.townDensity);
  placeTowns(map, rng, 'village', rng.shuffle([...VILLAGE_NAMES]), towns, year, options.townDensity);
  generateTrees(map, seed);
  // Vlastní proud náhody, aby přidání průmyslu nezměnilo města na existujících seedech
  const industries = placeIndustries(map, towns, new Rng(seed ^ 0x1d872b41));

  return { seed, map, towns, rail: new RailNetwork(map), industries };
}
