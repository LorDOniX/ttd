import {
  BUILDING_CAPACITY,
  REDEVELOP_CHANCE,
  SKYSCRAPER_YEAR,
  TOWN_GROWTH_BASE,
  TOWN_GROWTH_SERVED,
} from '../game/balance';
import { GameMap, NO_OWNER, TileType } from './map';
import type { Rng } from './rng';

export type TownKind = 'city' | 'village';

export interface Building {
  x: number;
  y: number;
  model: string;
  rotation: number;
}

export interface Town {
  id: number;
  name: string;
  kind: TownKind;
  x: number;
  y: number;
  population: number;
  radius: number;
  // Násobky poloměru pro jednotlivé směry, dávají městu nepravidelný tvar
  shape: number[];
  buildings: Building[];
  // Obsluhové vlakem za poslední rok, zrychluje růst
  served: boolean;
}

interface KindRules {
  roadSpacing: number;
  maxRadius: number;
  // Podíl volných míst u silnice, která zůstanou jako zahrady
  gardenRatio: number;
}

export const KIND_RULES: Record<TownKind, KindRules> = {
  city: { roadSpacing: 3, maxRadius: 16, gardenRatio: 0 },
  village: { roadSpacing: 4, maxRadius: 12, gardenRatio: 0.3 },
};

const SHAPE_SECTORS = 12;

// Rozdělení podle výšky po normalizaci na dlaždici: věže nad ~2 jednotky jsou mrakodrapy
const SKYSCRAPERS = [
  ...['a', 'b', 'c', 'd', 'e'].map((s) => `building-skyscraper-${s}`),
  ...'abcdefghijklm'.split('').map((s) => `low-detail-building-${s}`),
  'building-m',
];
const OFFICES = 'abcdefghijkln'.split('').map((s) => `building-${s}`);
const LOW_OFFICES = ['low-detail-building-n', 'low-detail-building-wide-a', 'low-detail-building-wide-b'];
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((s) => `building-type-${s}`);

// Sousedé v pořadí S, V, J, Z a natočení budovy čelem k nim
const NEIGHBOURS = [
  { dx: 0, dy: 1, rotation: 0 },
  { dx: 1, dy: 0, rotation: Math.PI / 2 },
  { dx: 0, dy: -1, rotation: Math.PI },
  { dx: -1, dy: 0, rotation: -Math.PI / 2 },
];

export function createTownShape(rng: Rng): number[] {
  return Array.from({ length: SHAPE_SECTORS }, () => 0.7 + rng.next() * 0.6);
}

export function buildingCapacity(model: string): number {
  if (SKYSCRAPERS.includes(model)) return BUILDING_CAPACITY.skyscraper;
  if (LOW_OFFICES.includes(model)) return BUILDING_CAPACITY.low;
  if (HOUSES.includes(model)) return BUILDING_CAPACITY.house;
  return BUILDING_CAPACITY.office;
}

export function townCapacity(town: Town): number {
  return town.buildings.reduce((sum, b) => sum + buildingCapacity(b.model), 0);
}

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function insideShape(town: Town, x: number, y: number, radius: number): boolean {
  const dx = x - town.x;
  const dy = y - town.y;
  const angle = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
  const f = angle * SHAPE_SECTORS;
  const i = Math.floor(f);
  const t = f - i;
  const scale = town.shape[i % SHAPE_SECTORS] * (1 - t) + town.shape[(i + 1) % SHAPE_SECTORS] * t;
  return Math.hypot(dx, dy) <= radius * scale;
}

function isFreeFor(map: GameMap, town: Town, x: number, y: number): boolean {
  const owner = map.getOwner(x, y);
  return owner === NO_OWNER || owner === town.id;
}

// Čáry silniční sítě jsou vyhrazené pro silnice, aby je budovy nezablokovaly
function onRoadGrid(town: Town, x: number, y: number): boolean {
  const spacing = KIND_RULES[town.kind].roadSpacing;
  return (x - town.x) % spacing === 0 || (y - town.y) % spacing === 0;
}

// Rozšíří silniční síť v rámci tvaru města, jen o dlaždice napojené na střed
function growRoads(map: GameMap, town: Town, radius: number): void {
  const canBeRoad = (x: number, y: number): boolean =>
    map.inBounds(x, y) &&
    insideShape(town, x, y, radius) &&
    onRoadGrid(town, x, y) &&
    isFreeFor(map, town, x, y) &&
    (map.get(x, y) === TileType.Grass || map.isRoad(x, y));

  if (!canBeRoad(town.x, town.y)) return;
  const visited = new Set<number>([town.y * map.width + town.x]);
  const queue = [town.x, town.y];
  while (queue.length > 0) {
    const y = queue.pop()!;
    const x = queue.pop()!;
    if (map.get(x, y) === TileType.Grass) map.set(x, y, TileType.Road);
    map.setOwner(x, y, town.id);
    for (const n of NEIGHBOURS) {
      const nx = x + n.dx;
      const ny = y + n.dy;
      const key = ny * map.width + nx;
      if (visited.has(key) || !canBeRoad(nx, ny)) continue;
      visited.add(key);
      queue.push(nx, ny);
    }
  }
}

function roadFacing(map: GameMap, town: Town, x: number, y: number): number | null {
  for (const n of NEIGHBOURS) {
    const nx = x + n.dx;
    const ny = y + n.dy;
    if (map.isType(nx, ny, TileType.Road) && map.getOwner(nx, ny) === town.id) return n.rotation;
  }
  return null;
}

function pickModel(town: Town, distance: number, year: number, rng: Rng): string {
  if (town.kind === 'village') return rng.pick(HOUSES);
  const ratio = distance / Math.max(town.radius, 4);
  if (year >= SKYSCRAPER_YEAR && ratio < 0.35 && rng.chance(0.6)) return rng.pick(SKYSCRAPERS);
  if (ratio > 0.7 && rng.chance(0.5)) return rng.pick(LOW_OFFICES);
  return rng.pick(OFFICES);
}

// Doplní silnice a budovy, dokud kapacita budov nestačí na populaci; populaci pak omezí kapacitou
export function expandTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  const rules = KIND_RULES[town.kind];
  let capacity = townCapacity(town);

  while (capacity < town.population && town.radius <= rules.maxRadius) {
    growRoads(map, town, town.radius);

    const slots: { x: number; y: number; rotation: number; distance: number }[] = [];
    const r = Math.ceil(town.radius * 1.3) + 1;
    for (let y = town.y - r; y <= town.y + r; y++) {
      for (let x = town.x - r; x <= town.x + r; x++) {
        if (!map.isType(x, y, TileType.Grass) || !isFreeFor(map, town, x, y)) continue;
        if (onRoadGrid(town, x, y)) continue;
        if (!insideShape(town, x, y, town.radius + 1)) continue;
        if (tileHash(x, y, town.id) < rules.gardenRatio) continue;
        const rotation = roadFacing(map, town, x, y);
        if (rotation === null) continue;
        const distance = Math.hypot(x - town.x, y - town.y);
        slots.push({ x, y, rotation, distance: distance + rng.next() * 1.5 });
      }
    }
    slots.sort((a, b) => a.distance - b.distance);

    for (const slot of slots) {
      if (capacity >= town.population) break;
      map.set(slot.x, slot.y, TileType.Building);
      map.setOwner(slot.x, slot.y, town.id);
      const model = pickModel(town, slot.distance, year, rng);
      town.buildings.push({ x: slot.x, y: slot.y, rotation: slot.rotation, model });
      capacity += buildingCapacity(model);
    }

    if (capacity < town.population) town.radius++;
  }

  town.population = Math.min(town.population, capacity);
}

// Přestavba budov v centru města na mrakodrapy
function redevelopCentre(town: Town, year: number, rng: Rng): void {
  if (town.kind !== 'city' || year < SKYSCRAPER_YEAR) return;
  for (const b of town.buildings) {
    if (SKYSCRAPERS.includes(b.model)) continue;
    const ratio = Math.hypot(b.x - town.x, b.y - town.y) / Math.max(town.radius, 4);
    if (ratio < 0.35 && rng.chance(REDEVELOP_CHANCE)) b.model = rng.pick(SKYSCRAPERS);
  }
}

// Roční růst: přestavba centra, přírůstek obyvatel a nové budovy na okraji
export function growTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  redevelopCentre(town, year, rng);
  const rate = town.served ? TOWN_GROWTH_SERVED : TOWN_GROWTH_BASE;
  town.population = Math.round(town.population * (1 + rate));
  expandTown(map, town, year, rng);
}

export function buildingAt(town: Town, x: number, y: number): Building | undefined {
  return town.buildings.find((b) => b.x === x && b.y === y);
}

// Zbourá budovu; obyvatelé nad zbylou kapacitu z města odejdou
export function demolishBuilding(map: GameMap, town: Town, building: Building): void {
  town.buildings.splice(town.buildings.indexOf(building), 1);
  map.set(building.x, building.y, TileType.Grass);
  map.setOwner(building.x, building.y, NO_OWNER);
  town.population = Math.min(town.population, townCapacity(town));
}
