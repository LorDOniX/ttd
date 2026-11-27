import { describe, expect, it } from 'vitest';
import { parseSave, restoreGame, serializeGame } from './save';
import { cleanFlags, conditionMet, conditionText, ordersError, type OrderFlags } from './trains';
import { buildLine, buyTrain, runDays } from '../test/fixtures';
import { defaultStationShape } from '../world/rail';

const when = (condition: NonNullable<OrderFlags['condition']>): OrderFlags => ({ condition });

describe('podmíněné příkazy', () => {
  it('volby podmínky se ověří, skok musí mířit na jiný existující příkaz', () => {
    expect(cleanFlags(when({ variable: 'load', comparator: '>=', value: 79.6, goto: 2 }))).toEqual(
      when({ variable: 'load', comparator: '>=', value: 80, goto: 2 }),
    );
    expect(cleanFlags({ condition: { variable: 'x', comparator: '?', value: NaN, goto: -1 } } as never)).toEqual(
      when({ variable: 'always', comparator: '>=', value: 0, goto: 0 }),
    );
    const flags = [{}, when({ variable: 'always', comparator: '>=', value: 0, goto: 5 }), {}];
    expect(ordersError([1, 0, 2], flags)).toBe('Podmínka v příkazu 2 skáče na neexistující příkaz.');
    expect(ordersError([1, 0, 2], [{}, when({ variable: 'always', comparator: '>=', value: 0, goto: 2 }), {}])).toBe(
      null,
    );
    expect(conditionText({ variable: 'load', comparator: '>=', value: 80, goto: 0 })).toBe(
      'Když naložení (%) ≥ 80, skoč na 1',
    );
    expect(conditionText({ variable: 'service', comparator: '=', value: 1, goto: 2 })).toBe(
      'Když potřebuje servis, skoč na 3',
    );
  });

  it('po odjezdu se podmínka vyhodnotí: naložený vlak skočí, prázdný pokračuje dalším příkazem', () => {
    const { game, a, b, depot } = buildLine();
    const c = game.world.rail.addStation({ ...defaultStationShape(25, 30, 'x'), name: 'C', townId: 0 });
    const train = buyTrain(game, depot, 2);
    train.orders = [a.id, 0, b.id, c.id];
    train.orderFlags = [{}, when({ variable: 'load', comparator: '>=', value: 50, goto: 3 }), {}, {}];
    train.target = 0;
    const context = { today: game.clock.day, now: game.clock.now, breakdowns: game.breakdowns };
    expect(conditionMet(train, train.orderFlags[1].condition!, context)).toBe(false);
    expect(game.fleet.nextOrder(train)).toBe(2);
    train.passengers = 40;
    expect(game.fleet.nextOrder(train)).toBe(3);
    expect(game.fleet.orderName(train, 1)).toBe('Když naložení (%) ≥ 50, skoč na 4');
    // Smyčka samých podmínek se nezacyklí
    train.orderFlags = [
      {},
      when({ variable: 'always', comparator: '>=', value: 0, goto: 2 }),
      when({ variable: 'always', comparator: '>=', value: 0, goto: 1 }),
      {},
    ];
    expect(game.fleet.nextOrder(train)).toBe(0);
  });

  it('vlak s podmínkou jezdí dál podle řádu; uložení podmínku zachová', () => {
    const { game, a, b, depot } = buildLine();
    game.money = 10_000_000;
    const train = buyTrain(game, depot, 2);
    const flags = [{}, when({ variable: 'always', comparator: '>=', value: 0, goto: 2 }), {}];
    expect(game.fleet.start(train, [a.id, 0, b.id], flags)).toBeNull();
    runDays(game, 90);
    expect(train.income).toBeGreaterThan(0);
    expect(train.target === 0 || train.target === 2).toBe(true);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'p'))));
    expect(restored.fleet.trains[0].orderFlags[1]).toEqual(flags[1]);
  });
});
