import { describe, expect, it } from 'vitest';
import { TRAIN_MODELS, TRAIN_SELL_REFUND, WAGON_PRICE, WAGON_RUNNING_COST } from './balance';
import type { Game } from './game';
import { ordersError, type Train } from './trains';
import { addBuilding, buildLine, buyTrain, layTrack, makeTown, runDays } from '../test/fixtures';
import { defaultStationShape } from '../world/rail';

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
    const before = game.thisYear.costs.running;
    runDays(game, 31);
    expect(game.thisYear.costs.running - before).toBeCloseTo(
      (TRAIN_MODELS[0].runningCost + 3 * WAGON_RUNNING_COST) / 12,
    );
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

describe('jízdní řád', () => {
  // Linka A – B prodloužená za B na nástupiště C
  function threeStops() {
    const line = buildLine();
    const { game } = line;
    layTrack(game, { x: 42, y: 20 }, { x: 54, y: 20 });
    const townC = makeTown(2, 56, 24);
    game.world.towns.push(townC);
    addBuilding(game, townC, 56, 22);
    const c = game.world.rail.addStation({ ...defaultStationShape(56, 20, 'x'), name: 'C', townId: 2 });
    return { ...line, c };
  }

  function arrivals(game: Game, train: Train, count: number): number[] {
    const result: number[] = [];
    let state = train.state;
    for (let i = 0; i < 50_000 && result.length < count; i++) {
      game.update(200);
      if (train.state !== state && train.state === 'loading') result.push(train.orders![train.target]);
      state = train.state;
    }
    return result;
  }

  it('objíždí zastávky dokola a na každé vymění cestující', () => {
    const { game, a, b, c, depot } = threeStops();
    for (const s of [a, b, c]) s.waiting = 30;
    const paidAt: number[] = [];
    game.events.on('income', (_amount, x) => paidAt.push(Math.floor(x)));
    const train = buyTrain(game, depot);
    expect(game.fleet.start(train, [a.id, b.id, c.id])).toBeNull();
    expect(arrivals(game, train, 5)).toEqual([a.id, b.id, c.id, a.id, b.id]);
    expect(paidAt.slice(0, 3)).toEqual([b.x, c.x, a.x]);
  });

  it('odmítne řád s jednou zastávkou nebo stejnou zastávkou za sebou', () => {
    expect(ordersError([1])).toMatch(/dvě/);
    expect(ordersError([1, 2, 2])).toMatch(/po sobě/);
    // Konec řádu navazuje na začátek
    expect(ordersError([1, 2, 1])).toMatch(/po sobě/);
    expect(ordersError([1, 2, 1, 3])).toBeNull();
  });

  it('změna řádu za jízdy zachová cíl, který v řádu zůstal', () => {
    const { game, a, b, c, depot } = threeStops();
    const train = buyTrain(game, depot);
    game.fleet.start(train, [a.id, b.id]);
    expect(arrivals(game, train, 1)).toEqual([a.id]);
    expect(game.fleet.setOrders(train, [c.id, a.id, b.id])).toBeNull();
    expect(train.orders![train.target]).toBe(a.id);
    expect(arrivals(game, train, 2)).toEqual([b.id, c.id]);
    expect(game.fleet.setOrders(train, [a.id])).toMatch(/dvě/);
  });

  it('v depu smí být řád rozpracovaný a po návratu z trati zůstane', () => {
    const { game, a, b, depot } = threeStops();
    const train = buyTrain(game, depot);
    expect(game.fleet.setOrders(train, [a.id])).toBeNull();
    expect(game.fleet.start(train, train.orders!)).toMatch(/dvě/);
    game.fleet.setOrders(train, [a.id, b.id]);
    expect(game.fleet.start(train, train.orders!)).toBeNull();
    game.fleet.sendToDepot(train);
    for (let i = 0; i < 20_000 && train.state !== 'depot'; i++) game.update(200);
    expect(train.orders).toEqual([a.id, b.id]);
  });
});
