import { describe, expect, it } from 'vitest';
import { FEEDER_SHARE } from './balance';
import { transferWaiting, type Carrier } from './cargo';
import { fare } from './passengers';
import { parseSave, restoreGame, serializeGame } from './save';
import { orderFlags, ordersError } from './trains';
import { addBuilding, addIndustry, buildLine, buyTrain, emptyGame, makeTown, runDays } from '../test/fixtures';
import { Edge, PIECES, defaultStationShape } from '../world/rail';

const WE = PIECES.findIndex(([a, b]) => a === Edge.W && b === Edge.E);

function carrier(name: string, passengers: number, boardedStation: number, boardedAt: number, tiles: number): Carrier {
  return { name, passengers, boardedStation, boardedAt, tiles, income: 0 };
}

const hold = { atPlatform: 90, capacity: 90, speed: 3 };

describe('překládka', () => {
  it('první vozidlo dostane podíl, peníze přijdou až při doručení a odečte se od něj podíl', () => {
    const game = emptyGame();
    const { rail } = game.world;
    const a = rail.addStation({ ...defaultStationShape(10, 10, 'x'), name: 'A', townId: 0 });
    const t = rail.addStation({ ...defaultStationShape(20, 10, 'x'), name: 'T', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(30, 10, 'x'), name: 'B', townId: 0 });
    const now = game.clock.now;
    const feeder = carrier('Autobus', 30, a.id, now - 5, 20);
    const money = game.money;
    game.passengers.exchange(feeder, hold, t, false, { unload: 'transfer', load: 'none' });
    const credit = Math.round(fare(30, 20, 5) * FEEDER_SHARE);
    expect(feeder.passengers).toBe(0);
    expect(feeder.income).toBe(credit);
    expect(game.money).toBe(money);
    expect(transferWaiting(t, 'passengers')).toBe(30);

    // Druhý vlak naloží přeložené cestující i s jejich historií
    t.waiting = 0;
    const train = carrier('Vlak', 0, -1, now, 0);
    game.passengers.exchange(train, hold, t);
    expect(train).toMatchObject({ passengers: 30, tiles: 20, boardedStation: t.id });
    expect(train.feeder).toBe(credit);
    expect(transferWaiting(t, 'passengers')).toBe(0);

    train.tiles += 10;
    game.passengers.exchange(train, hold, b);
    const income = fare(30, 30, 5);
    expect(game.money - money).toBe(income);
    expect(train.income).toBe(income - credit);
    expect(feeder.income + train.income).toBe(income);
  });

  it('nevykládat nechá náklad ve vlaku, nenakládat nic nenaloží', () => {
    const game = emptyGame();
    const { rail } = game.world;
    const s = rail.addStation({ ...defaultStationShape(20, 10, 'x'), name: 'S', townId: 0 });
    s.waiting = 50;
    const keep = carrier('Vlak', 30, 99, game.clock.now, 10);
    game.passengers.exchange(keep, hold, s, false, { unload: 'none', load: 'none' });
    expect(keep.passengers).toBe(30);
    expect(s.waiting).toBe(50);
  });

  it('vyložit vše nechá nevykupovaný náklad na stanici jako překládku', () => {
    const game = emptyGame();
    const s = game.world.rail.addStation({ ...defaultStationShape(20, 10, 'x'), name: 'S', townId: 0 });
    addIndustry(game, 'coal-mine', 30, 30);
    const coal = carrier('Vlak', 40, 99, game.clock.now, 10);
    game.freight.exchange(coal, hold, s, 'coal');
    expect(coal.passengers).toBe(40);
    game.freight.exchange(coal, hold, s, 'coal', false, { unload: 'unload', load: 'none' });
    expect(coal.passengers).toBe(0);
    expect(transferWaiting(s, 'coal')).toBe(40);
  });
});

describe('příkazy vlaku', () => {
  it('řád potřebuje dvě nástupiště, depo se do nich nepočítá', () => {
    expect(ordersError([1, 0], [{}, { depot: true }])).toMatch(/dvě zastávky/);
    expect(ordersError([1, 2, 0], [{}, {}, { depot: true }])).toBeNull();
  });

  it('servis v depu: vlak zajede do depa a pokračuje dalším příkazem', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    expect(game.fleet.start(train, [a.id, b.id, depot.id], [{}, {}, { depot: true }])).toBeNull();
    let serviced = 0;
    let leftAfterService = false;
    let wasInService = false;
    for (let day = 0; day < 400 && !leftAfterService; day++) {
      runDays(game, 0.5);
      const inService = train.state === 'depot' && train.serviceUntil !== undefined;
      if (inService && !wasInService) serviced++;
      if (wasInService && train.state === 'running') leftAfterService = true;
      wasInService = inService;
    }
    expect(serviced).toBeGreaterThanOrEqual(1);
    expect(leftAfterService).toBe(true);
    // Po servisu jede k prvnímu příkazu (A)
    expect(train.target).toBe(0);
  });

  it('projet: vlak stanicí v řádu projede bez zastavení a nevyloží v ní', () => {
    const townA = makeTown(0, 10, 24);
    const townB = makeTown(1, 40, 24);
    const game = emptyGame(64, [townA, townB]);
    addBuilding(game, townA, 10, 22);
    addBuilding(game, townB, 40, 22);
    const { rail } = game.world;
    for (let x = 12; x <= 38; x++) rail.addPiece(x, 20, WE);
    const a = rail.addStation({ ...defaultStationShape(10, 20, 'x'), name: 'A', townId: 0 });
    const m = rail.addStation({ ...defaultStationShape(25, 20, 'x'), name: 'M', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), name: 'B', townId: 1 });
    const depot = rail.addDepot(8, 20, Edge.E);
    const train = buyTrain(game, depot);
    expect(game.fleet.start(train, [a.id, m.id, b.id], [{}, { via: true }, {}])).toBeNull();
    expect(orderFlags(train, 1).via).toBe(true);
    const stops: string[] = [];
    let previous = train.state;
    for (let i = 0; i < 20_000 && stops.length < 6; i++) {
      game.update(200);
      if (train.state === 'loading' && previous !== 'loading') {
        const head = train.path[train.path.length - 1];
        stops.push(rail.stationAt(head.x, head.y)?.name ?? '?');
      }
      previous = train.state;
    }
    expect(stops).not.toContain('M');
    expect(stops).toContain('A');
    expect(stops).toContain('B');
  });

  it('volby příkazu platí pro celou linku a přežijí přesun zastávek', () => {
    const { game, a, b, depot } = buildLine();
    const first = buyTrain(game, depot);
    const second = buyTrain(game, depot);
    game.fleet.setOrders(first, [a.id, b.id]);
    game.fleet.shareOrders(second, first);
    game.fleet.setOrderFlags(first, 1, { unload: 'transfer', load: 'none' });
    expect(orderFlags(second, 1)).toEqual({ unload: 'transfer', load: 'none' });
    // Bez voleb si zastávky ponechají své volby i po prohození
    game.fleet.setOrders(first, [b.id, a.id]);
    expect(first.orderFlags).toEqual([{ unload: 'transfer', load: 'none' }, {}]);
    expect(game.fleet.orderName(first, 0)).toBe(b.name);
  });
});

describe('uložení příkazů a překládky', () => {
  it('volby příkazů, servis v depu a náklad z překládky se uloží a načtou', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    game.fleet.setOrders(train, [a.id, b.id, depot.id], [{ load: 'full' }, { unload: 'transfer' }, { depot: true }]);
    b.transfers = { passengers: [{ amount: 12, boardedAt: 3, tiles: 7, feeder: 100 }] };
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.fleet.trains[0].orderFlags).toEqual([{ load: 'full' }, { unload: 'transfer' }, { depot: true }]);
    expect(transferWaiting(copy.world.rail.stations[1], 'passengers')).toBe(12);
  });

  it('starší uložení s čekáním do plna podle zastávek se převede na volby příkazů', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    game.fleet.setOrders(train, [a.id, b.id]);
    const data = JSON.parse(JSON.stringify(serializeGame(game, 'test')));
    delete data.fleet.trains[0].orderFlags;
    data.fleet.trains[0].fullLoad = [b.id];
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.fleet.trains[0].orderFlags).toEqual([{}, { load: 'full' }]);
    expect('fullLoad' in copy.fleet.trains[0]).toBe(false);
  });
});
