import { describe, expect, it } from 'vitest';
import { destTotal, transferWaiting, type Carrier } from './cargo';
import { newGameDistribution } from './cargodist';
import type { Game } from './game';
import { parseSave, restoreGame, serializeGame } from './save';
import { ROAD_VEHICLE_MODELS, TRAIN_MODELS } from './balance';
import type { Train } from './trains';
import { addBuilding, addIndustry, buildLine, buyTrain, emptyGame, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
import { Edge, defaultStationShape, type Station } from '../world/rail';

// Tři města se stanicemi A, B, C; linka 1 jezdí A ↔ B, linka 2 B ↔ C. Vlaky jen „jezdí“ podle řádu
// (stojí mimo depo), výměna nákladu se volá přímo
function twoLines(): { game: Game; a: Station; b: Station; c: Station; line1: Train; line2: Train } {
  const towns = [makeTown(0, 10, 12), makeTown(1, 30, 12), makeTown(2, 50, 12)];
  const game = emptyGame(64, towns);
  game.cargodist.settings = newGameDistribution();
  towns.forEach((town, i) => addBuilding(game, town, 10 + i * 20, 12));
  const { rail } = game.world;
  const a = rail.addStation({ ...defaultStationShape(10, 10, 'x'), name: 'A', townId: 0 });
  const b = rail.addStation({ ...defaultStationShape(30, 10, 'x'), name: 'B', townId: 1 });
  const c = rail.addStation({ ...defaultStationShape(50, 10, 'x'), name: 'C', townId: 2 });
  const depot = rail.addDepot(5, 20, Edge.E);
  const line1 = buyTrain(game, depot, 3);
  const line2 = buyTrain(game, depot, 3);
  line1.orders = [a.id, b.id];
  line2.orders = [b.id, c.id];
  for (const t of [line1, line2]) {
    t.orderFlags = [];
    t.state = 'running';
  }
  game.events.emit('trainsChanged');
  return { game, a, b, c, line1, line2 };
}

function carrier(name: string): Carrier {
  return { name, passengers: 0, boardedStation: -1, boardedAt: 0, tiles: 0, income: 0 };
}

const hold = (next: number) => ({ atPlatform: 90, capacity: 90, speed: 4, next });

describe('cargodist: náklad s cílem', () => {
  it('cestující z A mají cíl B nebo C; vlak linky 1 je naloží, v B vystoupí jen ti do B, ostatní přestoupí', () => {
    const { game, a, b, c } = twoLines();
    const demand = game.cargodist.demandFrom(a, 'passengers');
    expect([...demand.keys()].sort()).toEqual([b.id, c.id].sort());
    a.waiting = 0;
    a.waiting += 40;
    game.cargodist.addFresh(a, 'passengers', 40);
    const planned = a.planned!.passengers!;
    // Do B i do C se jede přes B
    expect(Object.keys(planned).sort()).toEqual([`${b.id}:${b.id}`, `${b.id}:${c.id}`].sort());
    const toC = Math.round(planned[`${b.id}:${c.id}`]);

    const train = carrier('Vlak 1');
    game.passengers.exchange(train, hold(b.id), a);
    expect(train.passengers).toBe(40);
    expect(destTotal(train.dests)).toBe(40);
    expect(train.dests![c.id]).toBeCloseTo(toC, 0);
    expect(a.waiting).toBeCloseTo(0);

    // V B: cestující do B vystoupí a zaplatí se, cestující do C přestoupí (čekají na lince 2)
    b.waiting = 0;
    const money = game.money;
    train.tiles = 20;
    game.passengers.exchange(train, hold(a.id), b, false, { load: 'none' });
    expect(game.money).toBeGreaterThan(money);
    expect(train.passengers).toBe(0);
    expect(transferWaiting(b, 'passengers')).toBe(toC);
    expect(b.transfers!.passengers!.every((p) => p.dest === c.id)).toBe(true);

    // Vlak linky 1 zpět do A přestupující do C nevezme; vlak linky 2 ano
    const back = carrier('Vlak 1 zpět');
    game.passengers.exchange(back, hold(a.id), b);
    expect(back.passengers).toBe(0);
    const second = carrier('Vlak 2');
    game.passengers.exchange(second, hold(c.id), b);
    expect(second.passengers).toBe(toC);
    expect(second.dests).toEqual({ [c.id]: toC });
    second.tiles += 20;
    const before = game.money;
    game.passengers.exchange(second, hold(b.id), c, false, { load: 'none' });
    expect(second.passengers).toBe(0);
    expect(game.money).toBeGreaterThan(before);
  });

  it('náklad, který jede dál stejnou linkou, zůstane na palubě', () => {
    const { game, a, b, c, line1 } = twoLines();
    // Linka 1 prodloužená do C: A → B → C → B
    line1.orders = [a.id, b.id, c.id, b.id];
    game.events.emit('trainsChanged');
    a.waiting = 30;
    game.cargodist.addFresh(a, 'passengers', 30);
    const train = carrier('Vlak');
    game.passengers.exchange(train, hold(b.id), a);
    const toC = train.dests![c.id];
    expect(toC).toBeGreaterThan(0);
    b.waiting = 0;
    game.passengers.exchange(train, hold(c.id), b, false, { load: 'none' });
    expect(train.passengers).toBe(toC);
    expect(transferWaiting(b, 'passengers')).toBe(0);
  });

  it('cíl, který přestal být dosažitelný, se z paluby smaže a náklad se doručí jako dosud', () => {
    const { game, a, b, c, line2 } = twoLines();
    a.waiting = 30;
    game.cargodist.addFresh(a, 'passengers', 30);
    const train = carrier('Vlak');
    game.passengers.exchange(train, hold(b.id), a);
    expect(train.dests![c.id]).toBeGreaterThan(0);
    // Linka 2 skončí: do C se už nedá dojet, cestující vystoupí v B
    line2.state = 'depot';
    game.events.emit('trainsChanged');
    game.passengers.exchange(train, hold(a.id), b, false, { load: 'none' });
    expect(train.passengers).toBe(0);
    expect(transferWaiting(b, 'passengers')).toBe(0);
  });

  it('ručně se nic nemění: náklad nemá cíl a vystoupí na první cizí stanici', () => {
    const { game, a, b } = twoLines();
    game.cargodist.setMode('passengers', 'manual');
    a.waiting = 30;
    const train = carrier('Vlak');
    game.passengers.exchange(train, hold(b.id), a);
    expect(train.passengers).toBe(30);
    expect(train.dests).toBeUndefined();
    expect(a.planned?.passengers ?? {}).toEqual({});
  });

  it('nákladní vlak asymetricky veze uhlí do elektrárny, ne na mezistanici bez výkupu', () => {
    const game = emptyGame(64, []);
    game.cargodist.setMode('freight', 'asymmetric');
    const { rail } = game.world;
    const mine = addIndustry(game, 'coal-mine', 8, 12);
    addIndustry(game, 'power-station', 48, 12);
    const a = rail.addStation({ ...defaultStationShape(10, 10, 'x'), name: 'Důl', townId: 0 });
    const m = rail.addStation({ ...defaultStationShape(30, 10, 'x'), name: 'Mezi', townId: 0 });
    const p = rail.addStation({ ...defaultStationShape(50, 10, 'x'), name: 'Elektrárna', townId: 0 });
    const depot = rail.addDepot(5, 20, Edge.E);
    const train = game.fleet.buyTrain(depot, TRAIN_MODELS[0], 'coal', 3) as Train;
    train.orders = [a.id, m.id, p.id, m.id];
    train.orderFlags = [];
    train.state = 'running';
    game.events.emit('trainsChanged');
    const demand = game.cargodist.demandFrom(a, 'coal');
    expect([...demand.keys()]).toEqual([p.id]);
    expect(demand.get(p.id)).toBeCloseTo(game.cargodist.supply(a, 'coal'));
    a.freight.coal = 60;
    game.cargodist.addFresh(a, 'coal', 60);
    const coal = carrier('Uhelný vlak');
    game.freight.exchange(coal, hold(m.id), a, 'coal');
    expect(coal.dests).toEqual({ [p.id]: 60 });
    // Na mezistanici zůstane, v elektrárně se vyloží
    game.freight.exchange(coal, hold(p.id), m, 'coal', false, { load: 'none' });
    expect(coal.passengers).toBe(60);
    coal.tiles = 40;
    game.freight.exchange(coal, hold(m.id), p, 'coal', false, { load: 'none' });
    expect(coal.passengers).toBe(0);
    expect(mine.kind).toBe('coal-mine');
  });

  it('ve hře: vlak mezi A a B vozí cestující s cílem a vydělává', () => {
    const { game, a, b, depot } = buildLine();
    game.cargodist.settings = newGameDistribution();
    game.money = 10_000_000;
    const train = buyTrain(game, depot, 3);
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    runDays(game, 60);
    expect(train.income).toBeGreaterThan(0);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
    // Čerství cestující na stanici mají cíl
    expect(Object.keys(a.planned?.passengers ?? {})).toEqual([`${b.id}:${b.id}`]);
  });

  it('ve hře: autobus mezi dvěma zastávkami vozí cestující s cílem', () => {
    const townA = makeTown(0, 6, 12);
    const townB = makeTown(1, 26, 12);
    const game = emptyGame(64, [townA, townB]);
    game.cargodist.settings = newGameDistribution();
    game.money = 10_000_000;
    addBuilding(game, townA, 6, 12);
    addBuilding(game, townB, 26, 12);
    const { map, rail } = game.world;
    for (let x = 4; x <= 28; x++) map.set(x, 10, TileType.Road);
    game.construction.buildRoadStop(6, 10);
    game.construction.buildRoadStop(26, 10);
    game.construction.buildRoadDepot(4, 11, Edge.N);
    const [a, b] = rail.stations;
    expect(game.roadFleet.buy(rail.roadDepots[0], ROAD_VEHICLE_MODELS[0])).toBeNull();
    const bus = game.roadFleet.vehicles[0];
    expect(game.roadFleet.start(bus, [a.id, b.id])).toBeNull();
    expect(game.cargodist.demandFrom(a, 'passengers').has(b.id)).toBe(true);
    let destined = false;
    for (let i = 0; i < 240; i++) {
      runDays(game, 0.25);
      if (bus.dests && bus.dests[b.id] > 0) destined = true;
    }
    expect(destined).toBe(true);
    expect(bus.income).toBeGreaterThan(0);
  });

  it('uložení zachová cíle na palubě, plán stanic i cíle balíků z překládky', () => {
    const { game, a, b, c, line1 } = twoLines();
    a.waiting = 40;
    game.cargodist.addFresh(a, 'passengers', 40);
    game.passengers.exchange(line1, hold(b.id), a, false, { load: 'none' });
    a.waiting = 20;
    game.cargodist.addFresh(a, 'passengers', 20);
    game.passengers.exchange(line1, hold(b.id), a);
    const dests = { ...line1.dests };
    expect(Object.keys(dests).length).toBe(2);
    b.waiting = 0;
    game.passengers.exchange(line1, hold(a.id), b, false, { load: 'none' });
    a.waiting = 10;
    game.cargodist.addFresh(a, 'passengers', 10);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'cd'))));
    const ra = restored.world.rail.stations.find((s) => s.id === a.id)!;
    const rb = restored.world.rail.stations.find((s) => s.id === b.id)!;
    expect(ra.planned).toEqual(a.planned);
    expect(rb.transfers!.passengers!.map((p) => p.dest)).toEqual(b.transfers!.passengers!.map((p) => p.dest));
    expect(rb.transfers!.passengers!.every((p) => p.dest === c.id)).toBe(true);
    // Na palubě: naložení cestující s cíli
    const train = restored.fleet.trains.find((t) => t.id === line1.id)!;
    expect(train.dests).toEqual(line1.dests);
    expect(restored.cargodist.settings).toEqual(newGameDistribution());
  });

  it('balík z překládky k cíli, kam už nic nejede, po měsíci ztratí cíl a nastoupí do čehokoli', () => {
    const { game, a, b, c, line2 } = twoLines();
    a.waiting = 30;
    game.cargodist.addFresh(a, 'passengers', 30);
    const train = carrier('Vlak');
    game.passengers.exchange(train, hold(b.id), a);
    game.passengers.exchange(train, hold(a.id), b, false, { load: 'none' });
    expect(b.transfers!.passengers![0].dest).toBe(c.id);
    line2.state = 'depot';
    game.events.emit('trainsChanged');
    game.clock.events.emit('month', game.clock.date);
    expect(b.transfers!.passengers![0].dest).toBeUndefined();
    const back = carrier('Zpět');
    b.waiting = 0;
    game.passengers.exchange(back, hold(a.id), b);
    expect(back.passengers).toBeGreaterThan(0);
  });

  it('přepnutí na ručně zahodí plán stanic', () => {
    const { game, a } = twoLines();
    a.waiting = 30;
    game.cargodist.addFresh(a, 'passengers', 30);
    expect(a.planned!.passengers).toBeDefined();
    game.cargodist.setMode('passengers', 'manual');
    expect(a.planned!.passengers).toBeUndefined();
    expect(a.waiting).toBe(30);
  });
});
