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
  // Násobek počtu závodů při tvorbě mapy i četnosti nových závodů; starší uložení ho nemají (= 1)
  industryDensity?: number;
}

export interface GenerateOptions {
  // Hranice šumu pro vodu: vyšší = víc vody
  waterLevel: number;
  // Násobek počtu měst a vesnic
  townDensity: number;
  // Násobek počtu průmyslových závodů
  industryDensity?: number;
}

const DEFAULT_OPTIONS: GenerateOptions = { waterLevel: 0.34, townDensity: 1 };

const WATER_SCALE = 1 / 28;
const EDGE_MARGIN = 14;

const TILES_PER_TOWN: Record<TownKind, number> = { city: 11_000, town: 8_000, village: 5_500 };

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
  requiredFirstName?: string,
): void {
  const population = TOWN_POPULATION[kind];
  const count = Math.max(1, Math.round(((map.width * map.height) / TILES_PER_TOWN[kind]) * density));
  let placed = 0;

  for (
    let attempt = 0;
    attempt < 600 * density && placed < count && (names.length > 0 || (placed === 0 && requiredFirstName));
    attempt++
  ) {
    const x = rng.int(EDGE_MARGIN, map.width - 1 - EDGE_MARGIN);
    const y = rng.int(EDGE_MARGIN, map.height - 1 - EDGE_MARGIN);
    if (!map.isFree(x, y) || landRatio(map, x, y, 6) < 0.75) continue;
    if (towns.some((t) => Math.hypot(t.x - x, t.y - y) < minDistance(kind, t.kind))) continue;

    const town: Town = {
      id: towns.length,
      name: placed === 0 && requiredFirstName ? requiredFirstName : names.pop()!,
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

  if (placed === 0 && requiredFirstName) {
    let location: { x: number; y: number } | undefined;
    for (let y = EDGE_MARGIN; y < map.height - EDGE_MARGIN && !location; y++) {
      for (let x = EDGE_MARGIN; x < map.width - EDGE_MARGIN; x++) {
        if (map.isFree(x, y)) {
          location = { x, y };
          break;
        }
      }
    }
    if (!location) {
      location = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
      map.set(location.x, location.y, TileType.Grass);
    }
    const town: Town = {
      id: towns.length,
      name: requiredFirstName,
      kind,
      ...location,
      population: rng.int(population.min, population.max),
      radius: 2,
      shape: createTownShape(rng),
      buildings: [],
      served: false,
    };
    expandTown(map, town, year, rng);
    towns.push(town);
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
  // Města a městečka berou jména ze společného seznamu, aby se neopakovala
  const townNames = rng.shuffle(CITY_NAMES.filter((name) => name !== 'Brno'));
  placeTowns(map, rng, 'city', townNames, towns, year, options.townDensity, 'Brno');
  placeTowns(map, rng, 'town', townNames, towns, year, options.townDensity);
  placeTowns(map, rng, 'village', rng.shuffle([...VILLAGE_NAMES]), towns, year, options.townDensity);
  generateTrees(map, seed);
  // Vlastní proud náhody, aby přidání průmyslu nezměnilo města na existujících seedech
  const industryDensity = options.industryDensity ?? 1;
  const industries = placeIndustries(map, towns, new Rng(seed ^ 0x1d872b41), industryDensity);

  return { seed, map, towns, rail: new RailNetwork(map), industries, industryDensity };
}
