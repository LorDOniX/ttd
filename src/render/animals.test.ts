import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { animalPlacements, nextForestTile } from './animals';

describe('zvířata v krajině', () => {
  it('rozmístí zvířata deterministicky do lesních dlaždic', () => {
    const map = new GameMap(50, 50);
    map.tiles.fill(TileType.Trees);

    const placements = animalPlacements(map);

    expect(placements.length).toBeGreaterThan(0);
    expect(animalPlacements(map)).toEqual(placements);
    expect(placements.every(({ tile }) => map.tiles[tile] === TileType.Trees)).toBe(true);
    const bunnies = placements.filter(({ model }) => model === 'animal-bunny');
    expect(bunnies.length).toBeGreaterThan(0);
    expect(bunnies.every(({ scale }) => scale >= 0.176 && scale <= 0.242)).toBe(true);
    const bees = placements.filter(({ model }) => model === 'animal-bee');
    expect(bees.length).toBeGreaterThan(0);
    expect(bees.every(({ altitude }) => altitude >= 0.3 && altitude <= 0.55)).toBe(true);
    expect(placements.filter(({ model }) => model !== 'animal-bee').every(({ altitude }) => altitude === 0)).toBe(true);
  });

  it('nevytváří zvířata u solitérních stromů', () => {
    const map = new GameMap(5, 5);
    map.set(2, 2, TileType.Trees);

    expect(animalPlacements(map)).toEqual([]);
  });

  it('každý krok toulání vede jen na sousední lesní dlaždici', () => {
    const map = new GameMap(5, 5);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
    ]) {
      map.set(x, y, TileType.Trees);
    }

    let tile = 6;
    let previousTile = -1;
    for (let step = 0; step < 20; step++) {
      const next = nextForestTile(map, tile, previousTile, step);
      expect(next).not.toBeNull();
      expect(map.tiles[next!]).toBe(TileType.Trees);
      expect(
        Math.abs((next! % map.width) - (tile % map.width)) +
          Math.abs(Math.floor(next! / map.width) - Math.floor(tile / map.width)),
      ).toBe(1);
      previousTile = tile;
      tile = next!;
    }
  });
});
