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

  it('uložení verze 6 načte vlaky na cestující, nástupiště bez uhlí a důl se střední těžbou', () => {
    const { game, depot } = buildLine();
    buyTrain(game, depot);
    game.world.industries.push({
      id: 0,
      kind: 'coal-mine',
      name: 'Důl',
      x: 50,
      y: 50,
      rotation: 0,
      production: 0,
      transported: 0,
      lastTransported: 0,
    });
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    data.version = 6;
    for (const train of data.fleet.trains) {
      delete train.cargo;
      delete train.fullLoad;
    }
    for (const station of data.rail.stations) delete station.freight;
    for (const industry of data.industries) {
      delete industry.production;
      delete industry.transported;
      delete industry.lastTransported;
    }
    delete data.game.thisYear.freight;
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.fleet.trains[0].cargo).toBe('passengers');
    expect(copy.fleet.trains[0].fullLoad).toEqual([]);
    expect(copy.world.rail.stations.map((s) => s.freight.coal)).toEqual([0, 0]);
    expect(copy.world.industries[0].production).toBe(105);
    expect(copy.thisYear.freight.coal).toBe(0);
  });

  it('uložení verze 8 převede uhlí na nástupištích a ve statistice na obecný náklad', () => {
    const { game, depot } = buildLine();
    game.fleet.setCargo(buyTrain(game, depot), 'coal');
    game.history.push({ ...game.thisYear, year: 1950 });
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    data.version = 8;
    data.rail.stations.forEach((station: Record<string, unknown>, i: number) => {
      delete station.freight;
      station.coal = 10 * (i + 1);
    });
    for (const year of [data.game.thisYear, ...data.game.history]) {
      delete year.freight;
      year.coal = 70;
    }
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.fleet.trains[0].cargo).toBe('coal');
    expect(copy.world.rail.stations.map((s) => s.freight)).toEqual([{ coal: 10 }, { coal: 20 }]);
    expect(copy.thisYear.freight).toEqual({ coal: 70 });
    expect(copy.history[0].freight).toEqual({ coal: 70 });
  });

  it('průmysl se uloží a neplatný z cizího souboru zahodí', () => {
    const { game } = buildLine();
    game.world.industries.push({
      id: 0,
      kind: 'coal-mine',
      name: 'Důl',
      x: 50,
      y: 50,
      rotation: 1,
      production: 80,
      transported: 5,
      lastTransported: 40,
    });
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    data.industries.push({ kind: 'castle', name: 'X', x: 1, y: 1, rotation: 0 }, { kind: 'coal-mine', x: 63 });
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.world.industries).toEqual(game.world.industries);
  });

  it('návěstidla se uloží a neplatná se při načtení zahodí', () => {
    const { game } = buildLine();
    game.world.rail.addSignal(20, 12);
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    data.rail.signals.push(-5, 1e9, 'x');
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect([...copy.world.rail.signals]).toEqual([12 * 64 + 20]);
  });

  it('úvěr a historie let se uloží', () => {
    const { game } = buildLine();
    game.borrow();
    runDays(game, 400);
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.loan).toBe(game.loan);
    expect(copy.history).toEqual(game.history);
  });

  it('uložení verze 1 převede: bez úvěru, loňský rok do historie', () => {
    const { game } = buildLine();
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    const { companyName, money, rngState } = data.game;
    data.version = 1;
    data.clock.date.year = 1960;
    data.game = {
      companyName,
      money,
      rngState,
      thisYear: { income: 10, expenses: 5, passengers: 1 },
      lastYear: { income: 100, expenses: 50, passengers: 7 },
    };
    const restored = restoreGame(parseSave(JSON.stringify(data)));
    expect(restored.loan).toBe(0);
    expect(restored.thisYear.expenses).toBe(5);
    expect(restored.thisYear.costs.interest).toBe(0);
    expect(restored.history).toEqual([
      expect.objectContaining({ year: 1959, income: 100, expenses: 50, passengers: 7 }),
    ]);
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

  it('uložení verze 2 načte nástupiště s výchozím hodnocením', () => {
    const { game } = buildLine();
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    data.version = 2;
    for (const station of data.rail.stations) {
      delete station.rating;
      delete station.lastVisit;
      delete station.lastSpeed;
    }
    const [a] = restoreGame(parseSave(JSON.stringify(data))).world.rail.stations;
    expect([a.rating, a.lastVisit, a.lastSpeed]).toEqual([0.5, -1, 0]);
  });

  it('uložení verze 3 načte vlaky jako koupené na začátku hry', () => {
    const { game, depot } = buildLine();
    buyTrain(game, depot);
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    data.version = 3;
    for (const train of data.fleet.trains) {
      delete train.builtDay;
      delete train.agingWarned;
      delete train.renewing;
    }
    const [train] = restoreGame(parseSave(JSON.stringify(data))).fleet.trains;
    expect([train.builtDay, train.agingWarned, train.renewing]).toEqual([0, false, false]);
  });
});
