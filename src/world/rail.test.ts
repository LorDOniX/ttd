import { describe, expect, it } from 'vitest';
import { DEMOLISH_REFUND, PLATFORM_TILE_COST } from '../game/balance';
import { emptyGame, makeTown } from '../test/fixtures';
import { TileType } from './map';
import { stationTiles, type StationShape } from './rail';

describe('nástupiště', () => {
  it('velké nástupiště zabere obdélník kolem středu', () => {
    const shape: StationShape = { x: 12, y: 10, axis: 'x', length: 5, tracks: 3 };
    const tiles = stationTiles(shape);
    expect(tiles).toHaveLength(15);
    expect(Math.min(...tiles.map((t) => t.x))).toBe(10);
    expect(Math.max(...tiles.map((t) => t.x))).toBe(14);
    expect(Math.min(...tiles.map((t) => t.y))).toBe(9);
    expect(Math.max(...tiles.map((t) => t.y))).toBe(11);
  });

  it('stavba stojí podle počtu dílků a demolice vrátí polovinu', () => {
    const game = emptyGame(64, [makeTown(0, 30, 30)]);
    const shape: StationShape = { x: 12, y: 10, axis: 'y', length: 4, tracks: 2 };
    const before = game.money;
    expect(game.construction.buildStation(shape)).toBeNull();
    expect(before - game.money).toBe(8 * PLATFORM_TILE_COST);
    expect(stationTiles(shape).every((t) => game.world.map.get(t.x, t.y) === TileType.Station)).toBe(true);

    const plan = game.construction.demolishPlan([{ x: 12, y: 10 }]);
    expect(plan.tiles).toHaveLength(8);
    expect(plan.cost).toBe(-8 * PLATFORM_TILE_COST * DEMOLISH_REFUND);
  });

  it('na vodu ani do města nástupiště nepostaví', () => {
    const game = emptyGame(64, [makeTown(0, 30, 30)]);
    game.world.map.set(13, 10, TileType.Water);
    expect(game.construction.buildStation({ x: 12, y: 10, axis: 'x', length: 3, tracks: 1 })).toMatch(/nelze/);
  });
});
