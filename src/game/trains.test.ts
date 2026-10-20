import { describe, expect, it } from 'vitest';
import { TRAIN_MODELS, TRAIN_SELL_REFUND, WAGON_PRICE, WAGON_RUNNING_COST } from './balance';
import { buildLine, buyTrain, runDays } from '../test/fixtures';

describe('vlaky', () => {
  it('kyvadlově jezdí mezi nástupišti a na slepém konci se otočí', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    const arrivals: number[] = [];
    let flips = 0;
    let state = train.state;
    let flipped = train.flipped;
    for (let i = 0; i < 20_000 && arrivals.length < 4; i++) {
      game.update(200);
      if (train.state !== state && train.state === 'loading') arrivals.push(train.orders![train.target]);
      if (train.flipped !== flipped) flips++;
      state = train.state;
      flipped = train.flipped;
    }
    expect(arrivals).toEqual([a.id, b.id, a.id, b.id]);
    expect(flips).toBeGreaterThan(0);
  });

  it('za doručené cestující dostane zaplaceno', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    game.fleet.start(train, [a.id, b.id]);
    let paid = 0;
    game.events.on('income', (amount) => (paid += amount));
    runDays(game, 120);
    expect(paid).toBeGreaterThan(0);
    expect(train.income).toBe(paid);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
  });

  it('provozní náklady se strhávají měsíčně', () => {
    const { game, depot } = buildLine();
    buyTrain(game, depot, 3);
    const before = game.money;
    runDays(game, 31);
    expect(before - game.money).toBeCloseTo((TRAIN_MODELS[0].runningCost + 3 * WAGON_RUNNING_COST) / 12);
  });

  it('demolice pod vlakem a obsluhovaného nástupiště je zablokovaná', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    game.fleet.start(train, [a.id, b.id]);
    runDays(game, 3);
    const occupied = train.path[train.path.length - 1];
    expect(game.construction.demolish([{ x: occupied.x, y: occupied.y }])).not.toBeNull();
    expect(game.construction.demolish([{ x: b.x, y: b.y }])).toMatch(/obsluhuje/);
    expect(game.construction.demolish([{ x: depot.x, y: depot.y }])).toMatch(/Depo/);
  });

  it('vrátí se do depa a prodá se za polovinu', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id]);
    runDays(game, 5);
    game.fleet.sendToDepot(train);
    for (let i = 0; i < 20_000 && train.state !== 'depot'; i++) game.update(200);
    expect(train.state).toBe('depot');
    const before = game.money;
    game.fleet.sell(train);
    expect(game.money - before).toBe((TRAIN_MODELS[0].price + 2 * WAGON_PRICE) * TRAIN_SELL_REFUND);
    expect(game.fleet.trains).toHaveLength(0);
  });
});
