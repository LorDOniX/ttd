import { describe, expect, it } from 'vitest';
import { generateWorld } from './generator';
import { industryTiles } from './industry';
import { TileType } from './map';
import { KIND_RULES, townCapacity } from './town';

describe('generátor světa', () => {
  it('stejný seed dá stejný svět', () => {
    const a = generateWorld(42, 128, 1950);
    const b = generateWorld(42, 128, 1950);
    expect(a.map.tiles).toEqual(b.map.tiles);
    expect(a.towns.map((t) => [t.name, t.population])).toEqual(b.towns.map((t) => [t.name, t.population]));
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

  it('města mají kapacitu budov alespoň na svou populaci', () => {
    for (const town of generateWorld(42, 256, 1950).towns) {
      expect(townCapacity(town)).toBeGreaterThanOrEqual(town.population);
    }
  });

  it('rozmístí doly a elektrárny na vlastní dlaždice mimo města', () => {
    const world = generateWorld(42, 256, 1950);
    const kinds = new Set(world.industries.map((i) => i.kind));
    expect(kinds).toEqual(new Set(['coal-mine', 'power-station']));
    for (const industry of world.industries) {
      for (const t of industryTiles(industry)) expect(world.map.get(t.x, t.y)).toBe(TileType.Industry);
      for (const town of world.towns) {
        expect(Math.hypot(town.x - industry.x, town.y - industry.y)).toBeGreaterThan(KIND_RULES[town.kind].maxRadius);
      }
    }
    expect(new Set(world.industries.map((i) => i.name)).size).toBe(world.industries.length);
  });
});
