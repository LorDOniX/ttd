import { describe, expect, it } from 'vitest';
import {
  MAX_WAGONS,
  OLD_TRAIN_COST_FACTOR,
  TRAIN_LOADING_DAYS,
  TRAIN_MIN_SELL,
  TRAIN_MODELS,
  TRAIN_SELL_REFUND,
  WAGON_PRICE,
  WAGON_RUNNING_COST,
} from './balance';
import type { Game } from './game';
import { ordersError, sellFactor, sellPrice, trainAge, wagonsAtStation, type Train } from './trains';
import { addBuilding, buildLine, buyTrain, layTrack, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
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

  it('vrátí se do depa a prodá se zhruba za polovinu', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id]);
    runDays(game, 5);
    game.fleet.sendToDepot(train);
    for (let i = 0; i < 20_000 && train.state !== 'depot'; i++) game.update(200);
    expect(train.state).toBe('depot');
    const before = game.money;
    const price = sellPrice(train, game.clock.day);
    // Pár dní stáří cenu jen nepatrně sníží
    expect(price / ((TRAIN_MODELS[0].price + 2 * WAGON_PRICE) * TRAIN_SELL_REFUND)).toBeCloseTo(1, 2);
    game.fleet.sell(train);
    expect(game.money - before).toBe(price);
    expect(game.fleet.trains).toHaveLength(0);
  });

  it('náklad zůstane ve vlaku v depu a po výjezdu se vyloží', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id]);
    a.waiting = 40;
    for (let i = 0; i < 20_000 && train.passengers === 0; i++) game.update(200);
    const load = train.passengers;
    expect(load).toBeGreaterThan(30);
    game.fleet.sendToDepot(train);
    for (let i = 0; i < 20_000 && train.state !== 'depot'; i++) game.update(200);
    expect(train.passengers).toBe(load);
    game.fleet.removeWagon(train);
    expect(train.passengers).toBe(30);

    expect(game.fleet.start(train, [b.id, a.id])).toBeNull();
    for (let i = 0; i < 20_000 && game.thisYear.passengers === 0; i++) game.update(200);
    expect(game.thisYear.passengers).toBe(30);
  });
});

describe('stárnutí vlaků', () => {
  const YEAR = 365.25;

  it('prodejní cena klesá lineárně z poloviny na 10 % za 25 let', () => {
    expect(sellFactor(0)).toBe(TRAIN_SELL_REFUND);
    expect(sellFactor(12.5)).toBeCloseTo(0.3);
    expect(sellFactor(25)).toBeCloseTo(TRAIN_MIN_SELL);
    expect(sellFactor(40)).toBeCloseTo(TRAIN_MIN_SELL);
  });

  it('po životnosti stojí provoz o polovinu víc a hráč dostane jedno upozornění', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 1);
    train.builtDay = game.clock.day - 26 * YEAR;
    const news: string[] = [];
    game.events.on('news', (text) => news.push(text));
    runDays(game, 62);
    const base = TRAIN_MODELS[0].runningCost + WAGON_RUNNING_COST;
    expect(game.thisYear.costs.running).toBeCloseTo((2 * base * OLD_TRAIN_COST_FACTOR) / 12);
    expect(news.filter((n) => n.includes('konce životnosti'))).toHaveLength(1);
  });

  it('obnova v depu vymění lokomotivu za nejnovější model a zachová vagony i řád', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 3);
    game.fleet.setOrders(train, [a.id, b.id]);
    train.builtDay = -20 * YEAR;
    game.clock.date = { ...game.clock.date, year: 1975 };
    const { model, cost } = game.fleet.renewalOffer(train);
    expect(model.id).toBe('diesel');
    const before = game.money;
    expect(game.fleet.renew(train)).toBeNull();
    expect(before - game.money).toBe(cost);
    expect([train.modelId, train.wagons, train.orders, train.builtDay]).toEqual(['diesel', 3, [a.id, b.id], 0]);
  });

  it('jedoucí vlak zajede na obnovu do depa a pak pokračuje podle řádu', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    game.fleet.start(train, [a.id, b.id]);
    runDays(game, 5);
    train.builtDay = game.clock.day - 30 * YEAR;
    expect(game.fleet.requestRenewal(train)).toBeNull();
    for (let i = 0; i < 20_000 && train.renewing; i++) game.update(200);
    expect(trainAge(train, game.clock.day)).toBeLessThan(0.1);
    expect(train.state).toBe('running');
    expect(train.orders).toEqual([a.id, b.id]);
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

describe('vlak delší než nástupiště', () => {
  function untilLoadingAt(game: Game, train: Train, stationId: number): void {
    for (let i = 0; i < 20_000; i++) {
      game.update(200);
      if (train.state === 'loading' && train.orders![train.target] === stationId) return;
    }
    throw new Error('Vlak do stanice nedorazil');
  }

  it('pobyt ve stanici se prodlouží podle přeloženého nákladu', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 5);
    game.fleet.start(train, [a.id, b.id]);
    a.waiting = 150;
    untilLoadingAt(game, train, a.id);
    expect(train.passengers).toBe(150);
    // Nejkratší zastavení a den na 150 naložených
    expect(train.waitDays).toBeGreaterThan(TRAIN_LOADING_DAYS + 0.9);
  });

  it('vagonů může být tolik, kolik pojme nejdelší nástupiště', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, MAX_WAGONS);
    expect(MAX_WAGONS).toBe(13);
    expect(game.fleet.addWagon(train)).toMatch(/nejvýš 13/);
  });

  it('nakládá a vykládá jen vagony stojící na nástupišti a hráče varuje', () => {
    const { game, a, b, depot } = buildLine();
    // B bez města v dosahu, aby tam nikdo nenastupoval
    game.world.map.set(40, 22, TileType.Grass);
    const train = buyTrain(game, depot, 7);
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    expect(game.fleet.shortStations(train)).toEqual([a, b]);

    // Souprava 4 dlaždice, na nástupišti 1×3 stojí lokomotiva a 5 vagonů
    a.waiting = 500;
    untilLoadingAt(game, train, a.id);
    expect(wagonsAtStation(train, a)).toBe(5);
    expect(train.passengers).toBe(150);

    // Plný vlak: v B vystoupí jen 5 vagonů u nástupiště, zbytek jede dál
    train.passengers = 7 * 30;
    const delivered = game.thisYear.passengers;
    untilLoadingAt(game, train, b.id);
    expect(game.thisYear.passengers - delivered).toBe(150);
    expect(train.passengers).toBe(60);
  });

  it('krátký vlak nástupiště nepřesahuje', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 5);
    game.fleet.setOrders(train, [a.id, b.id]);
    expect(game.fleet.shortStations(train)).toEqual([]);
  });
});
