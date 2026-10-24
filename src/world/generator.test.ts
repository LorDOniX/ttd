import { describe, expect, it } from 'vitest';
import { generateWorld } from './generator';
import { INDUSTRY_TYPES, clearingTiles, industryTiles } from './industry';
import { TileType } from './map';
import { KIND_RULES, townCapacity } from './town';

describe('generátor světa', () => {
  it('stejný seed dá stejný svět', () => {
    const a = generateWorld(42, 128, 1950);
    const b = generateWorld(42, 128, 1950);
    expect(a.map.tiles).toEqual(b.map.tiles);
    expect(a.towns.map((t) => [t.name, t.population])).toEqual(b.towns.map((t) => [t.name, t.population]));
  });

  it('každá mapa obsahuje právě jedno město Brno', () => {
    for (const [seed, size, waterLevel, townDensity] of [
      [0, 128, 0.34, 1],
      [7, 256, 0.28, 0.6],
      [42, 512, 0.42, 1.5],
      [9, 128, 2, 1],
    ] as const) {
      const world = generateWorld(seed, size, 1950, { waterLevel, townDensity });
      expect(world.towns.filter((town) => town.name === 'Brno')).toHaveLength(1);
    }
  });

  it('výchozí parametry zachovávají dosavadní mapy', () => {
    const implicit = generateWorld(7, 128, 1950);
    const explicit = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1 });
    expect(implicit.map.tiles).toEqual(explicit.map.tiles);
  });

  it('víc vody a měst podle parametrů', () => {
    const few = generateWorld(3, 256, 1950, { waterLevel: 0.28, townDensity: 0.6 });
    const many = generateWorld(3, 256, 1950, { waterLevel: 0.42, townDensity: 1.5 });
    const water = (w: typeof few): number => w.map.tiles.filter((t) => t === 1).length;
    expect(water(many)).toBeGreaterThan(water(few));
    expect(many.towns.length).toBeGreaterThan(few.towns.length);
  });

  it('hustota průmyslu mění počet závodů a uloží se do světa', () => {
    const few = generateWorld(3, 256, 1950, { waterLevel: 0.34, townDensity: 1, industryDensity: 0.5 });
    const many = generateWorld(3, 256, 1950, { waterLevel: 0.34, townDensity: 1, industryDensity: 2 });
    expect(many.industries.length).toBeGreaterThan(few.industries.length);
    expect(many.industryDensity).toBe(2);
    expect(generateWorld(3, 128, 1950).industryDensity).toBe(1);
  });

  it('města mají kapacitu budov alespoň na svou populaci', () => {
    for (const town of generateWorld(42, 256, 1950).towns) {
      expect(townCapacity(town)).toBeGreaterThanOrEqual(town.population);
    }
  });

  it('rozmístí všechny druhy průmyslu na vlastní dlaždice mimo města', () => {
    const world = generateWorld(42, 256, 1950);
    const kinds = new Set(world.industries.map((i) => i.kind));
    expect(kinds).toEqual(new Set(Object.keys(INDUSTRY_TYPES)));
    for (const industry of world.industries) {
      for (const t of industryTiles(industry)) expect(world.map.get(t.x, t.y)).toBe(TileType.Industry);
      // Kromě lesa je kolem závodu jen tráva
      if (industry.kind !== 'forest') {
        for (const t of clearingTiles(industry)) expect(world.map.get(t.x, t.y)).toBe(TileType.Grass);
      }
      for (const town of world.towns) {
        expect(Math.hypot(town.x - industry.x, town.y - industry.y)).toBeGreaterThan(KIND_RULES[town.kind].maxRadius);
      }
    }
    expect(new Set(world.industries.map((i) => i.name)).size).toBe(world.industries.length);
  });
});
