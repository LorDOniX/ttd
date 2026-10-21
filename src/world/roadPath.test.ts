import { describe, expect, it } from 'vitest';
import { emptyGame } from '../test/fixtures';
import { TileType } from './map';
import { findRoadPath, roadEdgeAtCursor, singleRoadSteps } from './roadPath';

describe('hledání trasy silnice', () => {
  it('rovná silnice po trávě', () => {
    const { world } = emptyGame();
    const path = findRoadPath(world.rail, { x: 5, y: 5 }, { x: 15, y: 5 })!;
    expect(path).toHaveLength(11);
    expect(path.every((s) => s.isNew)).toBe(true);
  });

  it('kolmo přes samotnou rovnou kolej vede přejezdem', () => {
    const { world } = emptyGame();
    for (let y = 0; y < 64; y++) world.rail.addPiece(10, y, 0);
    const path = findRoadPath(world.rail, { x: 5, y: 20 }, { x: 15, y: 20 })!;
    expect(path.some((s) => s.x === 10)).toBe(true);
    expect(path).toHaveLength(11);
  });

  it('přes dlaždici s více kusy koleje vést nesmí', () => {
    const { world } = emptyGame();
    for (let y = 0; y < 64; y++) {
      world.rail.addPiece(10, y, 0);
      world.rail.addPiece(10, y, 2);
    }
    expect(findRoadPath(world.rail, { x: 5, y: 20 }, { x: 15, y: 20 })).toBeNull();
  });

  it('vodu obejde', () => {
    const { world } = emptyGame();
    for (let x = 0; x < 30; x++) world.map.set(x, 10, TileType.Water);
    const path = findRoadPath(world.rail, { x: 5, y: 5 }, { x: 5, y: 15 })!;
    expect(path.some((s) => world.map.get(s.x, s.y) === TileType.Water)).toBe(false);
  });
});

describe('silnice kliknutím', () => {
  it('hrana podle polohy kurzoru, uprostřed žádná', () => {
    expect(roadEdgeAtCursor(0.5, 0.5)).toBeNull();
    expect(roadEdgeAtCursor(0.9, 0.6)).toBe(1);
    expect(roadEdgeAtCursor(0.4, 0.1)).toBe(0);
  });

  it('na volné dlaždici postaví silnici, na silnici ji prodlouží ke kurzoru', () => {
    const { world } = emptyGame();
    expect(singleRoadSteps(world.rail, { x: 5, y: 5 }, 0.5, 0.5)).toEqual([{ x: 5, y: 5, isNew: true }]);
    world.map.set(5, 5, TileType.Road);
    expect(singleRoadSteps(world.rail, { x: 5, y: 5 }, 0.5, 0.5)).toBeNull();
    expect(singleRoadSteps(world.rail, { x: 5, y: 5 }, 0.9, 0.5)).toEqual([
      { x: 5, y: 5, isNew: false },
      { x: 6, y: 5, isNew: true },
    ]);
    world.map.set(5, 4, TileType.Water);
    expect(singleRoadSteps(world.rail, { x: 5, y: 5 }, 0.5, 0.1)).toBeNull();
  });
});
