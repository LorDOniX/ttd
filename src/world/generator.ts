import { TOWN_POPULATION } from '../game/balance';
import { GameMap, TileType } from './map';
import { CITY_NAMES, VILLAGE_NAMES } from './names';
import { fbm } from './noise';
import { Rng } from './rng';
import { createTownShape, expandTown, type Town, type TownKind } from './town';

export interface World {
  seed: number;
  map: GameMap;
  towns: Town[];
}

const WATER_LEVEL = 0.34;
const WATER_SCALE = 1 / 28;
const EDGE_MARGIN = 14;

const TILES_PER_TOWN: Record<TownKind, number> = { city: 9000, village: 4500 };

function generateWater(map: GameMap, seed: number): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (fbm(seed, x * WATER_SCALE, y * WATER_SCALE) < WATER_LEVEL) map.set(x, y, TileType.Water);
    }
  }
}

function landRatio(map: GameMap, cx: number, cy: number, r: number): number {
  let land = 0;
  let total = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      total++;
      if (map.isType(x, y, TileType.Grass)) land++;
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
): void {
  const population = TOWN_POPULATION[kind];
  const count = Math.max(1, Math.round((map.width * map.height) / TILES_PER_TOWN[kind]));
  let placed = 0;

  for (let attempt = 0; attempt < 600 && placed < count && names.length > 0; attempt++) {
    const x = rng.int(EDGE_MARGIN, map.width - 1 - EDGE_MARGIN);
    const y = rng.int(EDGE_MARGIN, map.height - 1 - EDGE_MARGIN);
    if (!map.isType(x, y, TileType.Grass) || landRatio(map, x, y, 6) < 0.75) continue;
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

export function generateWorld(seed: number, size: number, year: number): World {
  const rng = new Rng(seed);
  const map = new GameMap(size, size);
  generateWater(map, seed);

  const towns: Town[] = [];
  placeTowns(map, rng, 'city', rng.shuffle([...CITY_NAMES]), towns, year);
  placeTowns(map, rng, 'village', rng.shuffle([...VILLAGE_NAMES]), towns, year);

  return { seed, map, towns };
}
