import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { generateWorld } from './generator';
import { GameMap, TileType } from './map';
import { TOWN_LAYOUTS, growTown, isTownLayout, townLayout, type Town, type TownLayout } from './town';

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

function townRoads(map: GameMap, town: Town): Set<string> {
  const roads = new Set<string>();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.isType(x, y, TileType.Road) && map.getOwner(x, y) === town.id) roads.add(`${x},${y}`);
    }
  }
  return roads;
}

// Silnice města dosažitelné ze středu
function reachable(roads: Set<string>, town: Town): Set<string> {
  const seen = new Set<string>();
  const start = `${town.x},${town.y}`;
  if (!roads.has(start)) return seen;
  const queue = [start];
  seen.add(start);
  while (queue.length > 0) {
    const [x, y] = queue.pop()!.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOURS) {
      const key = `${x + dx},${y + dy}`;
      if (roads.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  return seen;
}

function world(layout: TownLayout | 'random') {
  return generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1, townLayout: layout });
}

describe('rozložení měst', () => {
  it('každé město má zvolené rozložení, náhodné je mezi města rozdělí', () => {
    for (const layout of TOWN_LAYOUTS) {
      expect(world(layout).towns.every((town) => townLayout(town) === layout)).toBe(true);
    }
    const mixed = new Set(world('random').towns.map((town) => town.layout));
    expect(mixed.size).toBeGreaterThan(1);
    expect([...mixed].every(isTownLayout)).toBe(true);
  });

  it('výchozí rozložení je organické (lepší silnice)', () => {
    const implicit = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1 });
    expect(implicit.towns.every((town) => town.layout === 'better')).toBe(true);
  });

  it('organická města: silnice spojené se středem a každý dům u silnice', () => {
    for (const layout of ['better', 'original'] as const) {
      const { map, towns } = world(layout);
      for (const town of towns) {
        const roads = townRoads(map, town);
        expect(reachable(roads, town).size).toBe(roads.size);
        for (const b of town.buildings) {
          const byRoad = NEIGHBOURS.some(([dx, dy]) => map.isType(b.x + dx, b.y + dy, TileType.Road));
          expect(byRoad, `${town.name} ${b.x},${b.y}`).toBe(true);
        }
      }
    }
  });

  it('lepší silnice nestaví bloky silnic 2×2', () => {
    const { map, towns } = world('better');
    for (const town of towns) {
      const roads = townRoads(map, town);
      for (const key of roads) {
        const [x, y] = key.split(',').map(Number);
        const block = roads.has(`${x + 1},${y}`) && roads.has(`${x},${y + 1}`) && roads.has(`${x + 1},${y + 1}`);
        expect(block, `${town.name} ${key}`).toBe(false);
      }
    }
  });

  it('organická města nejsou mřížka: mají slepé ulice i nepravidelné rozestupy', () => {
    const { map, towns } = world('better');
    const brno = towns.find((town) => town.name === 'Brno')!;
    const roads = townRoads(map, brno);
    const deadEnds = [...roads].filter((key) => {
      const [x, y] = key.split(',').map(Number);
      return NEIGHBOURS.filter(([dx, dy]) => roads.has(`${x + dx},${y + dy}`)).length === 1;
    });
    expect(deadEnds.length).toBeGreaterThan(0);
    const columns = new Set([...roads].map((key) => Number(key.split(',')[0]) % 3));
    expect(columns.size).toBe(3);
  });

  it('Brno dosáhne stejného počátečního počtu obyvatel jako v mřížce', () => {
    const target = world('grid2').towns.find((town) => town.name === 'Brno')!.population;
    for (const layout of ['better', 'original'] as const) {
      const brno = world(layout).towns.find((town) => town.name === 'Brno')!;
      expect(brno.population).toBe(target);
    }
  });

  it('organické město dál roste a je deterministické', () => {
    const grow = () => {
      const { map, towns } = world('better');
      const brno = towns.find((town) => town.name === 'Brno')!;
      const before = brno.buildings.length;
      const rng = new Rng(3);
      for (let year = 1950; year < 1970; year++) growTown(map, brno, year, rng);
      return { before, after: brno.buildings.length, tiles: [...map.tiles] };
    };
    const a = grow();
    const b = grow();
    expect(a.after).toBeGreaterThan(a.before);
    expect(a.tiles).toEqual(b.tiles);
  });

  it('starší města bez rozložení rostou dál v mřížce', () => {
    const town = { kind: 'city', layout: undefined } as unknown as Town;
    expect(townLayout(town)).toMatch(/^grid/);
  });
});
