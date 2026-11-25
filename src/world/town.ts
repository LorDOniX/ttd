import {
  BUILDING_CAPACITY,
  REDEVELOP_CHANCE,
  SKYSCRAPER_YEAR,
  TOWN_GROWTH_BASE,
  TOWN_GROWTH_SERVED,
} from '../game/balance';
import { GameMap, NO_OWNER, TileType } from './map';
import type { Rng } from './rng';

export type TownKind = 'city' | 'town' | 'village';

// Silniční síť města jako v OpenTTD: lepší silnice (organicky, bez bloků silnic 2×2 a souběžných ulic těsně
// vedle sebe), původní (organicky a hustěji), pravidelná mřížka s bloky 2×2 nebo 3×3 domy
export type TownLayout = 'better' | 'original' | 'grid2' | 'grid3';

export const TOWN_LAYOUTS: readonly TownLayout[] = ['better', 'original', 'grid2', 'grid3'];

export const TOWN_LAYOUT_LABELS: Record<TownLayout, string> = {
  better: 'Lepší silnice',
  original: 'Původní',
  grid2: 'Mřížka 2×2',
  grid3: 'Mřížka 3×3',
};

export function isTownLayout(value: unknown): value is TownLayout {
  return typeof value === 'string' && (TOWN_LAYOUTS as readonly string[]).includes(value);
}

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
  // Silniční síť; starší uložení ho nemají a rostou dál v mřížce podle druhu města
  layout?: TownLayout;
}

// Rozložení města; bez údaje mřížka jako dřív (velkoměsto 2×2, ostatní 3×3)
export function townLayout(town: Town): TownLayout {
  return town.layout ?? (KIND_RULES[town.kind].roadSpacing === 3 ? 'grid2' : 'grid3');
}

interface KindRules {
  roadSpacing: number;
  maxRadius: number;
  // Podíl volných míst u silnice, která zůstanou jako zahrady
  gardenRatio: number;
}

export const KIND_RULES: Record<TownKind, KindRules> = {
  city: { roadSpacing: 3, maxRadius: 16, gardenRatio: 0 },
  town: { roadSpacing: 4, maxRadius: 14, gardenRatio: 0.15 },
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
export const TOWN_BUILDING_MODELS = [...new Set([...SKYSCRAPERS, ...OFFICES, ...LOW_OFFICES, ...HOUSES])];

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

// Město staví silnice i domy jen na rovině (svahy zůstanou volné)
function isFreeFor(map: GameMap, town: Town, x: number, y: number): boolean {
  if (!map.inBounds(x, y) || !map.isFlat(x, y)) return false;
  const owner = map.getOwner(x, y);
  return owner === NO_OWNER || owner === town.id;
}

// Čáry silniční sítě jsou vyhrazené pro silnice, aby je budovy nezablokovaly (jen u mřížky)
function onRoadGrid(town: Town, x: number, y: number): boolean {
  const layout = townLayout(town);
  if (layout !== 'grid2' && layout !== 'grid3') return false;
  const spacing = layout === 'grid2' ? 3 : 4;
  return (x - town.x) % spacing === 0 || (y - town.y) % spacing === 0;
}

// Rozšíří silniční síť v rámci tvaru města, jen o dlaždice napojené na střed
function growRoads(map: GameMap, town: Town, radius: number): void {
  const canBeRoad = (x: number, y: number): boolean =>
    map.inBounds(x, y) &&
    insideShape(town, x, y, radius) &&
    onRoadGrid(town, x, y) &&
    isFreeFor(map, town, x, y) &&
    // Most hráče si město nepřivlastní
    (map.isFree(x, y) || (map.isRoad(x, y) && !map.roadBridgeAxis(x, y)));

  if (!canBeRoad(town.x, town.y)) return;
  const visited = new Set<number>([town.y * map.width + town.x]);
  const queue = [town.x, town.y];
  while (queue.length > 0) {
    const y = queue.pop()!;
    const x = queue.pop()!;
    if (map.isFree(x, y)) map.set(x, y, TileType.Road);
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
  // Městečko: kanceláře převážně v centru, jinak domky
  if (town.kind === 'town') {
    if (ratio >= 0.7 || !rng.chance(0.6)) return rng.pick(HOUSES);
    return rng.chance(0.5) ? rng.pick(LOW_OFFICES) : rng.pick(OFFICES);
  }
  if (year >= SKYSCRAPER_YEAR && ratio < 0.35 && rng.chance(0.6)) return rng.pick(SKYSCRAPERS);
  if (ratio > 0.7 && rng.chance(0.5)) return rng.pick(LOW_OFFICES);
  return rng.pick(OFFICES);
}

// Doplní silnice a budovy, dokud kapacita budov nestačí na populaci; populaci pak omezí kapacitou
export function expandTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  const layout = townLayout(town);
  if (layout === 'grid2' || layout === 'grid3') expandGridTown(map, town, year, rng);
  else expandOrganicTown(map, town, year, rng);
}

// Po kolika nezdařených pokusech náhodné procházky postaví město nejbližší možnou stavbu
const GROWTH_FAILS_BEFORE_FORCED = 12;
// Kolik volných míst pro domy u silnic si město drží, než začne stavět další ulice
const MIN_FREE_SPOTS = 4;
// Podíl míst u silnice s volnou zemí za nimi, která zůstanou volná pro budoucí odbočky
const EXIT_RESERVE = 0.35;

// Dlaždice silnice tohoto města (ne most hráče)
function isTownRoad(map: GameMap, town: Town, x: number, y: number): boolean {
  return map.isType(x, y, TileType.Road) && map.getOwner(x, y) === town.id;
}

function roadDirs(map: GameMap, town: Town, x: number, y: number): number[] {
  return [0, 1, 2, 3].filter((d) => isTownRoad(map, town, x + NEIGHBOURS[d].dx, y + NEIGHBOURS[d].dy));
}

// Organický růst jako v OpenTTD: náhodná procházka po silnicích od středu a na jejím konci
// prodloužení slepé ulice, odbočka do strany, nebo dům u silnice
function expandOrganicTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  const rules = KIND_RULES[town.kind];
  const better = townLayout(town) === 'better';
  let capacity = townCapacity(town);
  if (capacity >= town.population) return;

  // Může sem vést silnice města? Lepší silnice nesmí vytvořit blok 2×2 ani vést těsně vedle souběžné ulice
  const canRoad = (x: number, y: number, from: number, strict: boolean): boolean => {
    if (!map.inBounds(x, y) || !insideShape(town, x, y, town.radius) || !isFreeFor(map, town, x, y)) return false;
    if (isTownRoad(map, town, x, y)) return false;
    if (!map.isFree(x, y)) return false;
    const road = (dx: number, dy: number): boolean => isTownRoad(map, town, x + dx, y + dy);
    for (const [sx, sy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ]) {
      // Čtverec 2×2 s rohem (x + sx, y + sy): ostatní tři dlaždice nesmí být všechny silnice
      const others = [
        [sx, sy],
        [sx + 1, sy],
        [sx, sy + 1],
        [sx + 1, sy + 1],
      ].filter(([dx, dy]) => dx !== 0 || dy !== 0);
      if (others.every(([dx, dy]) => road(dx, dy))) return false;
    }
    if (better && strict) {
      // Po stranách pokračující ulice (kolmo ke směru stavby) nesmí vést jiná silnice
      const side = NEIGHBOURS[(from + 1) % 4];
      if (road(side.dx, side.dy) || road(-side.dx, -side.dy)) return false;
    }
    return true;
  };

  const placeRoad = (x: number, y: number): void => {
    map.set(x, y, TileType.Road);
    map.setOwner(x, y, town.id);
  };

  // Rovný úsek silnice z (x, y) směrem d; vrací počet postavených dlaždic. První dlaždice odbočky smí vést
  // podél jiné ulice (jinak by se husté centrum uzavřelo), další už ne
  const extend = (x: number, y: number, d: number, length: number, branch = false): number => {
    let built = 0;
    for (let i = 1; i <= length; i++) {
      const nx = x + NEIGHBOURS[d].dx * i;
      const ny = y + NEIGHBOURS[d].dy * i;
      if (!canRoad(nx, ny, d, !(branch && i === 1))) break;
      placeRoad(nx, ny);
      built++;
      // Napojení na silnici před sebou vytvoří křižovatku a úsek končí
      if (isTownRoad(map, town, nx + NEIGHBOURS[d].dx, ny + NEIGHBOURS[d].dy)) break;
    }
    return built;
  };

  // Smí stát dům vedle silnice (x, y) ve směru d? Konec slepé ulice a část míst, za kterými je volná země,
  // zůstanou volné pro budoucí ulice, aby se město domy samo neuzavřelo
  const houseSpot = (x: number, y: number, d: number, ahead: number): boolean => {
    if (d === ahead) return false;
    const hx = x + NEIGHBOURS[d].dx;
    const hy = y + NEIGHBOURS[d].dy;
    if (!map.isFree(hx, hy) || !isFreeFor(map, town, hx, hy) || !insideShape(town, hx, hy, town.radius + 1))
      return false;
    if (tileHash(hx, hy, town.id) < rules.gardenRatio) return false;
    const open = [1, 2].every((k) => map.isFree(hx + NEIGHBOURS[d].dx * k, hy + NEIGHBOURS[d].dy * k));
    return !(open && tileHash(hx, hy, town.id + 977) < EXIT_RESERVE);
  };

  // Dům na volné dlaždici vedle silnice (x, y), čelem k ní
  const house = (x: number, y: number): boolean => {
    const dirs = roadDirs(map, town, x, y);
    const ahead = dirs.length === 1 ? (dirs[0] + 2) % 4 : -1;
    const spots = [0, 1, 2, 3].filter((d) => houseSpot(x, y, d, ahead));
    if (spots.length === 0) return false;
    const d = rng.pick(spots);
    const hx = x + NEIGHBOURS[d].dx;
    const hy = y + NEIGHBOURS[d].dy;
    // Budova je natočená čelem k silnici, tedy opačně, než vede směr od silnice k ní
    const rotation = NEIGHBOURS[(d + 2) % 4].rotation;
    const model = pickModel(town, Math.hypot(hx - town.x, hy - town.y), year, rng);
    map.set(hx, hy, TileType.Building);
    map.setOwner(hx, hy, town.id);
    town.buildings.push({ x: hx, y: hy, rotation, model });
    capacity += buildingCapacity(model);
    return true;
  };

  // Střed města a první ulice do několika směrů
  if (!isTownRoad(map, town, town.x, town.y)) {
    if (!map.isFree(town.x, town.y) || !isFreeFor(map, town, town.x, town.y)) return;
    placeRoad(town.x, town.y);
    const arms = rng.shuffle([0, 1, 2, 3]).slice(0, 2 + rng.int(0, 2));
    for (const d of arms) extend(town.x, town.y, d, rng.int(2, better ? 4 : 3));
  }

  // Volná místa pro domy u silnic města (v dosahu); když jich je málo, město staví ulice
  const freeSpots = (): number => {
    let count = 0;
    const r = Math.ceil(town.radius * 1.4) + 2;
    for (let y = town.y - r; y <= town.y + r; y++) {
      for (let x = town.x - r; x <= town.x + r; x++) {
        if (!isTownRoad(map, town, x, y)) continue;
        const dirs = roadDirs(map, town, x, y);
        const ahead = dirs.length === 1 ? (dirs[0] + 2) % 4 : -1;
        for (let d = 0; d < 4; d++) if (houseSpot(x, y, d, ahead)) count++;
      }
    }
    return count;
  };

  // Ulice z dlaždice (x, y): odbočka do volné strany, nebo prodloužení slepé ulice
  const street = (x: number, y: number): boolean => {
    const dirs = roadDirs(map, town, x, y);
    const deadEnd = dirs.length === 1 ? (dirs[0] + 2) % 4 : -1;
    const sides = rng.shuffle([0, 1, 2, 3].filter((d) => !dirs.includes(d) && d !== deadEnd));
    const options =
      deadEnd >= 0 && rng.chance(0.5) ? [deadEnd, ...sides] : [...sides, ...(deadEnd >= 0 ? [deadEnd] : [])];
    for (const d of options) {
      const length = d === deadEnd ? rng.int(1, better ? 3 : 2) : rng.int(2, better ? 4 : 3);
      if (extend(x, y, d, length, d !== deadEnd) > 0) return true;
    }
    return false;
  };

  // Jeden pokus o růst: náhodná procházka po silnicích od středu, na jejím konci ulice nebo dům
  let spots = freeSpots();
  const step = (): boolean => {
    let x = town.x;
    let y = town.y;
    let back = -1;
    const steps = rng.int(0, Math.max(2, town.radius * 2));
    for (let i = 0; i < steps; i++) {
      const next = roadDirs(map, town, x, y).filter((d) => d !== back);
      if (next.length === 0) break;
      const d = rng.pick(next);
      x += NEIGHBOURS[d].dx;
      y += NEIGHBOURS[d].dy;
      back = (d + 2) % 4;
    }
    // Silnice předbíhají domy: když u nich dochází volná místa, staví se ulice
    const wanted = MIN_FREE_SPOTS + town.buildings.length * (better ? 0.12 : 0.08);
    if (spots < wanted) {
      if (street(x, y)) {
        spots = freeSpots();
        return true;
      }
      return false;
    }
    if (house(x, y)) {
      spots--;
      return true;
    }
    return false;
  };

  // Záložní růst, když náhodná procházka opakovaně nic nepostaví: nejbližší ulice, nebo dům u silnice
  const forced = (): boolean => {
    const roads: { x: number; y: number; distance: number }[] = [];
    const r = Math.ceil(town.radius * 1.4) + 2;
    for (let y = town.y - r; y <= town.y + r; y++) {
      for (let x = town.x - r; x <= town.x + r; x++) {
        if (isTownRoad(map, town, x, y))
          roads.push({ x, y, distance: Math.hypot(x - town.x, y - town.y) + rng.next() * 3 });
      }
    }
    roads.sort((a, b) => a.distance - b.distance);
    const wanted = MIN_FREE_SPOTS + town.buildings.length * (better ? 0.12 : 0.08);
    const tryHouse = (): boolean => roads.some((road) => house(road.x, road.y));
    const tryStreet = (): boolean => {
      const built = roads.some((road) => street(road.x, road.y));
      if (built) spots = freeSpots();
      return built;
    };
    return spots >= wanted ? tryHouse() || tryStreet() : tryStreet() || tryHouse();
  };

  let fails = 0;
  while (capacity < town.population && town.radius <= rules.maxRadius) {
    if (step()) {
      fails = 0;
      continue;
    }
    fails++;
    if (fails >= GROWTH_FAILS_BEFORE_FORCED) {
      if (!forced()) town.radius++;
      fails = 0;
    }
  }
  town.population = Math.min(town.population, capacity);
}

// Mřížka: silnice na pravidelných čarách, budovy na volných místech podél nich
function expandGridTown(map: GameMap, town: Town, year: number, rng: Rng): void {
  const rules = KIND_RULES[town.kind];
  let capacity = townCapacity(town);

  while (capacity < town.population && town.radius <= rules.maxRadius) {
    growRoads(map, town, town.radius);

    const slots: { x: number; y: number; rotation: number; distance: number }[] = [];
    const r = Math.ceil(town.radius * 1.3) + 1;
    for (let y = town.y - r; y <= town.y + r; y++) {
      for (let x = town.x - r; x <= town.x + r; x++) {
        if (!map.isFree(x, y) || !isFreeFor(map, town, x, y)) continue;
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
