import { describe, expect, it } from 'vitest';
import { addBuilding, emptyGame, makeTown } from '../test/fixtures';
import { GameMap, MapChanges, TileType } from './map';
import { defaultStationShape } from './rail';

describe('log změn mapy', () => {
  it('zaznamená jen skutečné změny', () => {
    const map = new GameMap(8, 8);
    const changes = new MapChanges(map);
    map.set(1, 1, TileType.Water);
    map.set(1, 1, TileType.Water);
    map.setOwner(2, 1, 0);
    expect(changes.take()).toEqual([9, 10]);
    expect(changes.take()).toEqual([]);
  });

  it('každý čtenář má vlastní pozici', () => {
    const map = new GameMap(8, 8);
    const early = new MapChanges(map);
    map.set(0, 0, TileType.Road);
    const late = new MapChanges(map);
    map.set(1, 0, TileType.Road);
    expect(early.take()).toEqual([0, 1]);
    expect(late.take()).toEqual([1]);
  });

  it('čtenáři, který zaostal za zahozeným logem, oznámí překreslení všeho', () => {
    const map = new GameMap(512, 512);
    const changes = new MapChanges(map);
    for (let i = 0; i < 70_000; i++) map.set(i % 512, Math.floor(i / 512), TileType.Water);
    expect(changes.take()).toBeNull();
    expect(changes.take()).toEqual([]);
  });
});

describe('dosah nástupiště', () => {
  it('po přistavění budovy se dosah přepočítá', () => {
    const a = makeTown(0, 20, 20);
    const b = makeTown(1, 40, 40);
    const game = emptyGame(64, [a, b]);
    addBuilding(game, a, 20, 22);
    const station = game.world.rail.addStation({ ...defaultStationShape(20, 20, 'x'), name: 'S', townId: 0 });
    expect(game.passengers.townsInReach(station)).toEqual([a]);
    addBuilding(game, b, 23, 18);
    expect(game.passengers.townsInReach(station)).toHaveLength(2);
    expect(game.passengers.townsInReach(station)).toContain(b);
  });
});
