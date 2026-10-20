import { describe, expect, it } from 'vitest';
import { parseSave, restoreGame, serializeGame } from './save';
import { buildLine, buyTrain, runDays } from '../test/fixtures';
import type { Game } from './game';

function snapshot(game: Game): string {
  return JSON.stringify({
    money: Math.round(game.money),
    date: game.clock.date,
    population: game.world.towns.map((t) => t.population),
    trains: game.fleet.trains.map((t) => [t.state, t.pos.toFixed(6), t.passengers, Math.round(t.income)]),
    waiting: game.world.rail.stations.map((s) => s.waiting.toFixed(6)),
    rng: game.rng.state,
    tiles: Array.from(game.world.map.tiles),
  });
}

describe('uložení a načtení', () => {
  it('obnovená hra pokračuje stejně jako originál', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    game.fleet.start(train, [a.id, b.id]);
    game.setCompanyName('ČSD Test');
    runDays(game, 200);

    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.companyName).toBe('ČSD Test');
    for (let i = 0; i < 20_000; i++) {
      game.update(200);
      copy.update(200);
    }
    expect(snapshot(copy)).toBe(snapshot(game));
  });

  it('poškozený soubor odmítne', () => {
    const { game } = buildLine();
    const valid = serializeGame(game, 'test');
    expect(() => parseSave('{')).toThrow(/JSON/);
    expect(() => parseSave('{"version":99}')).toThrow(/verze/);
    expect(() => parseSave(JSON.stringify({ ...valid, map: { ...valid.map, width: 99_999 } }))).toThrow(/velikost/);
    expect(() => restoreGame(parseSave(JSON.stringify({ ...valid, rail: { ...valid.rail, pieces: 'AAAA' } })))).toThrow(
      /Poškozená/,
    );
  });

  it('starší uložení bez rozměru nástupiště načte jako 1×3', () => {
    const { game } = buildLine();
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    for (const station of data.rail.stations) {
      delete station.length;
      delete station.tracks;
    }
    const restored = restoreGame(parseSave(JSON.stringify(data)));
    expect(restored.world.rail.stations.map((s) => [s.length, s.tracks])).toEqual([
      [3, 1],
      [3, 1],
    ]);
  });
});
