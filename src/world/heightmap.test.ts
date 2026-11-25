import { describe, expect, it } from 'vitest';
import { generateWorld } from './generator';
import { flattenDown } from './heightmap';
import { industryTiles } from './industry';
import { GameMap, TileType } from './map';

// Sousední rohy (i úhlopříčně) se liší nejvýš o 1
function maxCornerStep(map: GameMap): number {
  let worst = 0;
  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const h = map.cornerLevel(cx, cy);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        if (cy + dy < 0) continue;
        worst = Math.max(worst, Math.abs(h - map.cornerLevel(cx + dx, cy + dy)));
      }
    }
  }
  return worst;
}

describe('generátor s kopci', () => {
  it('bez volby terénu zůstane mapa rovinou (staré seedy se nemění)', () => {
    const { map } = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1 });
    expect(map.maxLevel()).toBe(0);
  });

  it('kopcovitý terén: voda na úrovni 0, sousední rohy ±1, města a průmysl na rovině', () => {
    const world = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1, terrain: 'hilly' });
    const { map } = world;
    expect(map.maxLevel()).toBeGreaterThanOrEqual(4);
    expect(maxCornerStep(map)).toBeLessThanOrEqual(1);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.isType(x, y, TileType.Water)) expect(Math.max(...map.tileCorners(x, y))).toBe(0);
        if (map.isType(x, y, TileType.Building) || map.isRoad(x, y)) expect(map.isFlat(x, y)).toBe(true);
      }
    }
    expect(world.towns.length).toBeGreaterThan(0);
    expect(world.industries.length).toBeGreaterThan(0);
    for (const industry of world.industries) expect(map.allFlat(industryTiles(industry))).toBe(true);
  });

  it('mírně zvlněný terén je nižší než kopcovitý', () => {
    const gentle = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1, terrain: 'gentle' });
    const hilly = generateWorld(7, 128, 1950, { waterLevel: 0.34, townDensity: 1, terrain: 'hilly' });
    expect(gentle.map.maxLevel()).toBeGreaterThan(0);
    expect(gentle.map.maxLevel()).toBeLessThan(hilly.map.maxLevel());
  });

  it('srovnání oblasti odkope terén na nejnižší roh a okolí dorovná', () => {
    const map = new GameMap(16, 16);
    for (let cy = 0; cy <= 16; cy++) for (let cx = 0; cx <= 16; cx++) map.setCornerLevel(cx, cy, Math.min(cx, 6));
    const level = flattenDown(map, 6, 4, 9, 7);
    expect(level).toBe(6);
    expect(
      map.allFlat([
        { x: 6, y: 4 },
        { x: 9, y: 7 },
      ]),
    ).toBe(true);
    map.setCornerLevel(8, 8, 6);
    const low = flattenDown(map, 2, 2, 5, 5);
    expect(low).toBe(2);
    for (let y = 2; y <= 5; y++)
      for (let x = 2; x <= 5; x++) expect(map.slope(x, y)).toEqual({ kind: 'flat', level: 2 });
    expect(maxCornerStep(map)).toBeLessThanOrEqual(1);
  });
});
