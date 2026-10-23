import { describe, expect, it } from 'vitest';
import { emptyGame } from '../test/fixtures';
import { TileType } from '../world/map';
import { findRoadPath } from '../world/roadPath';
import { roadMoves } from '../world/roadRoute';
import { DEMOLISH_REFUND, ROAD_BRIDGE_COST, ROAD_TILE_COST } from './balance';

// Řeka přes celou mapu v řádcích 9 až 11
function riverGame() {
  const game = emptyGame();
  for (let x = 0; x < 64; x++) for (let y = 9; y < 12; y++) game.world.map.set(x, y, TileType.Water);
  return game;
}

describe('silniční mosty', () => {
  it('stavba přes řeku postaví most a zaplatí jeho cenu', () => {
    const game = riverGame();
    const { map, rail } = game.world;
    const path = findRoadPath(rail, { x: 5, y: 5 }, { x: 5, y: 15 })!;
    const money = game.money;
    game.construction.buildRoad(path);
    game.construction.update(60_000);
    for (let y = 9; y < 12; y++) expect(map.get(5, y)).toBe(TileType.RoadBridgeY);
    expect(money - game.money).toBe(3 * ROAD_BRIDGE_COST + (path.length - 3) * ROAD_TILE_COST);
  });

  it('auto přejede most jen podél něj, sousední most se nepropojí', () => {
    const game = riverGame();
    const { map, rail } = game.world;
    for (let y = 9; y < 12; y++) {
      map.set(5, y, TileType.RoadBridgeY);
      map.set(6, y, TileType.RoadBridgeY);
    }
    map.set(5, 8, TileType.Road);
    map.set(5, 12, TileType.Road);
    expect(roadMoves(rail, 5, 10)).toEqual([
      { x: 5, y: 9 },
      { x: 5, y: 11 },
    ]);
    expect(roadMoves(rail, 5, 8)).toContainEqual({ x: 5, y: 9 });
  });

  it('demolice vrátí vodu a část ceny', () => {
    const game = riverGame();
    const { map } = game.world;
    map.set(5, 10, TileType.RoadBridgeX);
    const money = game.money;
    expect(game.construction.demolish([{ x: 5, y: 10 }])).toBeNull();
    expect(map.get(5, 10)).toBe(TileType.Water);
    expect(game.money - money).toBe(ROAD_BRIDGE_COST * DEMOLISH_REFUND);
  });
});
