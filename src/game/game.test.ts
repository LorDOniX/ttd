import { describe, expect, it } from 'vitest';
import { addBuilding, emptyGame, layTrack, makeTown } from '../test/fixtures';
import { TileType } from '../world/map';
import { DEMOLISH_TREES_COST } from './balance';

describe('historie zpráv', () => {
  it('pamatuje si datum a nejvýš 200 posledních zpráv', () => {
    const game = emptyGame();
    for (let i = 0; i < 205; i++) game.news(`zpráva ${i}`);
    expect(game.newsLog).toHaveLength(200);
    expect(game.newsLog[0].text).toBe('zpráva 5');
    expect(game.newsLog[199]).toEqual({ date: game.clock.date, text: 'zpráva 204' });
  });
});

describe('demolice', () => {
  it('ohlásí vrácenou částku i zaplacenou demolici budovy se středem zbořené plochy', () => {
    const town = makeTown(0, 30, 30);
    const game = emptyGame(64, [town]);
    addBuilding(game, town, 40, 40);
    layTrack(game, { x: 10, y: 10 }, { x: 13, y: 10 });
    const events: [number, number, number][] = [];
    game.events.on('demolished', (...args) => events.push(args));

    const rails = [10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    expect(game.construction.demolish(rails)).toBeNull();
    expect(game.construction.demolish([{ x: 40, y: 40 }])).toBeNull();
    // Prázdná tráva nic nestojí ani nevrací
    expect(game.construction.demolish([{ x: 50, y: 50 }])).toBeNull();

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual([4 * 5_000 * 0.5, 12, 10.5]);
    expect(events[1][0]).toBeLessThan(0);
    expect(events[1].slice(1)).toEqual([40.5, 40.5]);
  });

  it('vykácení stromů se platí', () => {
    const game = emptyGame();
    game.world.map.set(20, 20, TileType.Trees);
    game.world.map.set(21, 20, TileType.Trees);
    const money = game.money;

    expect(
      game.construction.demolish([
        { x: 20, y: 20 },
        { x: 21, y: 20 },
      ]),
    ).toBeNull();
    expect(game.money).toBe(money - 2 * DEMOLISH_TREES_COST);
    expect(game.world.map.get(20, 20)).toBe(TileType.Grass);
  });
});
