import { describe, expect, it } from 'vitest';
import { DEMOLISH_REFUND, SIGNAL_COST, TRACK_PIECE_COST } from './balance';
import { Reservations } from './reservations';
import type { Game } from './game';
import type { Train } from './trains';
import { addBuilding, buildLine, buyTrain, emptyGame, layTrack, makeTown, runDays } from '../test/fixtures';
import { Edge, PIECES, defaultStationShape } from '../world/rail';
import { findRoute, segmentIndexAt, type Segment } from '../world/route';
import { parseSave, restoreGame, serializeGame } from './save';

const straight = (x0: number, x1: number, y: number): Segment[] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y, piece: 1, entry: Edge.W, exit: Edge.E }));

const piece = (a: Edge, b: Edge): number => PIECES.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));

function fakeTrain(id: number, path: Segment[], pos: number): Train {
  return { id, path, pos } as Train;
}

describe('rezervace kolejí', () => {
  it('bez míst k čekání zarezervuje celou trasu, obsazenou žádnou', () => {
    const r = new Reservations(64, () => false);
    const a = fakeTrain(1, straight(0, 9, 5), 0.5);
    const b = fakeTrain(2, straight(5, 15, 5), 0.5);
    r.reset(a, 0);
    r.reset(b, 0);
    expect(r.extend(a)).toBe(false);
    expect(r.ownerAt(6, 5)).toBeUndefined();
    expect(r.extend(b)).toBe(true);
    expect(r.fullyReserved(b)).toBe(true);
    expect(r.ownerAt(15, 5)).toBe(2);
  });

  it('úsek končí na místě k čekání a za koncem vlaku se koleje uvolní', () => {
    const r = new Reservations(64, (x) => x === 4);
    const a = fakeTrain(1, straight(0, 9, 5), 0.5);
    r.reset(a, 0);
    expect(r.extend(a)).toBe(true);
    expect(r.ownerAt(4, 5)).toBe(1);
    expect(r.ownerAt(5, 5)).toBeUndefined();
    expect(r.limit(a)).toBe(5);
    a.pos = 4.5;
    r.sync(a, 3.5);
    expect(r.ownerAt(2, 5)).toBeUndefined();
    expect(r.ownerAt(3, 5)).toBe(1);
  });
});

// Dvoukolejná nástupiště A a B spojená jednokolejkou, depo za A
function twoTrackLine(): Game {
  const townA = makeTown(0, 10, 24);
  const townB = makeTown(1, 40, 24);
  const game = emptyGame(64, [townA, townB]);
  addBuilding(game, townA, 10, 22);
  addBuilding(game, townB, 40, 22);
  const { rail } = game.world;
  rail.addStation({ x: 10, y: 20, axis: 'x', length: 3, tracks: 2, name: 'A', townId: 0 });
  rail.addStation({ x: 40, y: 20, axis: 'x', length: 3, tracks: 2, name: 'B', townId: 1 });
  layTrack(game, { x: 12, y: 20 }, { x: 38, y: 20 });
  layTrack(game, { x: 12, y: 19 }, { x: 16, y: 20 });
  layTrack(game, { x: 38, y: 19 }, { x: 34, y: 20 });
  rail.addDepot(8, 20, Edge.E);
  return game;
}

function bodyTiles(train: Train): Set<string> {
  const tiles = new Set<string>();
  const from = segmentIndexAt(train.path, Math.max(0, train.pos - (train.wagons + 1) * 0.5));
  const to = segmentIndexAt(train.path, Math.max(0, train.pos - 1e-6));
  for (let i = from; i <= to; i++) tiles.add(`${train.path[i].x},${train.path[i].y}`);
  return tiles;
}

describe('vlaky s rezervací', () => {
  it('se nesrazí a na dvoukolejných nástupištích se vystřídají', () => {
    const game = twoTrackLine();
    const [a, b] = game.world.rail.stations;
    const depot = game.world.rail.depots[0];
    const first = buyTrain(game, depot);
    const second = buyTrain(game, depot);
    expect(game.fleet.start(first, [a.id, b.id])).toBeNull();
    expect(game.fleet.start(second, [a.id, b.id])).toBeNull();
    const arrivals = new Map<number, number>();
    const states = [first.state, second.state];
    // Koleje (řady y), na kterých vlaky v nástupištích zastavily
    const tracksUsed = new Set<number>();
    for (let i = 0; i < 60_000; i++) {
      game.update(200);
      [first, second].forEach((t, k) => {
        if (t.state === 'loading' && states[k] !== 'loading') {
          arrivals.set(t.id, (arrivals.get(t.id) ?? 0) + 1);
          tracksUsed.add(t.path[t.path.length - 1].y);
        }
        states[k] = t.state;
      });
      if (first.state !== 'depot' && second.state !== 'depot') {
        // Ve dlaždici depa čekající vlak není vidět, sdílet ji smí
        const overlap = [...bodyTiles(first)].filter((tile) => tile !== '8,20' && bodyTiles(second).has(tile));
        expect(overlap).toEqual([]);
      }
    }
    // Jednokolejka mezi nástupišti by se bez druhé koleje zablokovala
    expect(arrivals.get(first.id)).toBeGreaterThanOrEqual(20);
    expect(arrivals.get(second.id)).toBeGreaterThanOrEqual(20);
    expect([...tracksUsed].sort()).toEqual([19, 20]);
    // Dlouhá simulace: při souběhu všech testů trvá přes výchozích 5 s
  }, 20_000);

  it('na jednokolejce bez výhybny se vlaky zablokují a hráč se hned dozví proč', () => {
    const { game, a, b, depot } = buildLine();
    const first = buyTrain(game, depot);
    const second = buyTrain(game, depot);
    game.fleet.start(first, [a.id, b.id]);
    game.fleet.start(second, [a.id, b.id]);
    const news: string[] = [];
    game.events.on('news', (text) => news.push(text));
    runDays(game, 200);
    expect([first, second].every((t) => game.fleet.isBlocked(t))).toBe(true);
    const warnings = news.filter((n) => n.includes('navzájem blokují'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Vlak 1/);
    expect(warnings[0]).toMatch(/Vlak 2/);
    expect(news.some((n) => n.includes('čeká na volnou trať'))).toBe(false);
  });

  it('s dvoukolejným nástupištěm v cíli se vlaky na jednokolejce střídají', () => {
    const townA = makeTown(0, 10, 14);
    const townB = makeTown(1, 40, 24);
    const game = emptyGame(64, [townA, townB]);
    addBuilding(game, townA, 10, 12);
    addBuilding(game, townB, 40, 22);
    const { rail } = game.world;
    const a = rail.addStation({ ...defaultStationShape(10, 10, 'x'), name: 'A', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), tracks: 2, name: 'B', townId: 1 });
    layTrack(game, { x: 12, y: 10 }, { x: 38, y: 20 });
    layTrack(game, { x: 38, y: 19 }, { x: 34, y: 18 });
    const depot = rail.addDepot(8, 10, Edge.E);
    game.money = 5_000_000;
    const first = buyTrain(game, depot);
    game.fleet.start(first, [a.id, b.id]);
    runDays(game, 3);
    const second = buyTrain(game, depot);
    game.fleet.start(second, [a.id, b.id]);
    let deliveries = 0;
    game.events.on('income', () => deliveries++);
    runDays(game, 200);
    // Druhý vlak zajede na volnou kolej nástupiště B, místo aby čekal za prvním
    expect(deliveries).toBeGreaterThan(10);
  });
});

describe('návěstidla', () => {
  it('jdou jen na rovnou kolej bez výhybky, stojí peníze a demolice je vrátí', () => {
    const { game, a } = buildLine();
    const { rail } = game.world;
    const tile = singleTrackTiles(game)[5];
    expect(game.construction.toggleSignal(a.x, a.y)).toMatch(/rovnou kolej/);
    const before = game.money;
    expect(game.construction.toggleSignal(tile.x, tile.y)).toBeNull();
    expect(rail.hasSignal(tile.x, tile.y)).toBe(true);
    expect(before - game.money).toBe(SIGNAL_COST);
    expect(game.construction.toggleSignal(tile.x, tile.y)).toBeNull();
    expect(game.money - before).toBe(-SIGNAL_COST * (1 - DEMOLISH_REFUND));
    game.construction.toggleSignal(tile.x, tile.y);
    expect(game.construction.demolishPlan([tile]).cost).toBe(-(TRACK_PIECE_COST + SIGNAL_COST) * DEMOLISH_REFUND);
    game.construction.demolish([tile]);
    expect(rail.hasSignal(tile.x, tile.y)).toBe(false);
  });

  // Oba vlaky jedou zároveň po trati mezi A a B stejným směrem
  function followOnLine(withSignals: boolean): boolean {
    const { game, a, b, depot } = buildLine();
    if (withSignals)
      singleTrackTiles(game)
        .filter((_, i) => i % 5 === 4)
        .forEach((t) => game.world.rail.addSignal(t.x, t.y));
    const first = buyTrain(game, depot);
    const second = buyTrain(game, depot);
    game.fleet.start(first, [a.id, b.id]);
    game.fleet.start(second, [a.id, b.id]);
    const onLine = (t: Train): boolean => {
      if (t.state !== 'running' || game.fleet.isBlocked(t)) return false;
      const head = t.path[segmentIndexAt(t.path, t.pos)];
      return head.x > 13 && head.x < 37 && t.orders![t.target] === b.id;
    };
    for (let i = 0; i < 20_000; i++) {
      game.update(200);
      if (onLine(first) && onLine(second)) return true;
    }
    return false;
  }

  it('dělí trať na úseky, takže za sebou jede víc vlaků', () => {
    expect(followOnLine(false)).toBe(false);
    expect(followOnLine(true)).toBe(true);
  });
});

// Dlaždice trati s jediným kusem koleje seřazené podle polohy
function singleTrackTiles(game: Game): { x: number; y: number }[] {
  const { map, rail } = game.world;
  const tiles: { x: number; y: number }[] = [];
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) if (rail.canPlaceSignal(x, y)) tiles.push({ x, y });
  }
  return tiles;
}

describe('jednosměrná a cestová návěstidla', () => {
  it('proti jednosměrnému návěstidlu nevede žádná trasa, po směru ano', () => {
    const game = emptyGame();
    const { rail } = game.world;
    layTrack(game, { x: 10, y: 10 }, { x: 20, y: 10 });
    rail.addSignal(15, 10, Edge.E);
    expect(rail.allowsExit(15, 10, 1, Edge.E)).toBe(true);
    expect(rail.allowsExit(15, 10, 1, Edge.W)).toBe(false);
    const east = findRoute(rail, { x: 10, y: 10, exit: Edge.E, heading: 0 }, (x) => x === 20, { x: 20, y: 10 });
    expect(east).not.toBeNull();
    const west = findRoute(rail, { x: 20, y: 10, exit: Edge.W, heading: 4 }, (x) => x === 10, { x: 10, y: 10 });
    expect(west).toBeNull();
  });

  it('dvoukolejka s jednosměrkami: vlaky jezdí každý po své koleji a nezablokují se', () => {
    const townA = makeTown(0, 10, 24);
    const townB = makeTown(1, 40, 24);
    const game = emptyGame(64, [townA, townB]);
    addBuilding(game, townA, 10, 22);
    addBuilding(game, townB, 40, 22);
    const { rail } = game.world;
    const a = rail.addStation({ ...defaultStationShape(10, 20, 'x'), name: 'A', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), name: 'B', townId: 1 });
    // Kolej y = 20 vede celou cestu, souběžná y = 19 se na obou koncích napojí výhybkami
    for (let x = 12; x <= 38; x++) rail.addPiece(x, 20, piece(Edge.W, Edge.E));
    for (let x = 16; x <= 34; x++) rail.addPiece(x, 19, piece(Edge.W, Edge.E));
    rail.addPiece(15, 19, piece(Edge.E, Edge.S));
    rail.addPiece(15, 20, piece(Edge.N, Edge.W));
    rail.addPiece(35, 19, piece(Edge.W, Edge.S));
    rail.addPiece(35, 20, piece(Edge.N, Edge.E));
    for (const x of [18, 24, 30]) rail.addSignal(x, 20, Edge.E);
    for (const x of [20, 26, 32]) rail.addSignal(x, 19, Edge.W);
    const depot = rail.addDepot(8, 20, Edge.E);
    game.money = 10_000_000;
    const trains = [buyTrain(game, depot), buyTrain(game, depot), buyTrain(game, depot)];
    trains.forEach((t, i) => {
      if (i > 0) runDays(game, 6);
      expect(game.fleet.start(t, [a.id, b.id])).toBeNull();
    });
    const arrivals = new Map<number, number>();
    const states = trains.map((t) => t.state);
    for (let i = 0; i < 40_000; i++) {
      game.update(200);
      trains.forEach((t, k) => {
        if (t.state === 'loading' && states[k] !== 'loading') arrivals.set(t.id, (arrivals.get(t.id) ?? 0) + 1);
        states[k] = t.state;
        // Mezi výhybkami jede vlak na východ jen po y = 20 a na západ jen po y = 19
        const head = t.path[segmentIndexAt(t.path, Math.max(0, t.pos - 1e-6))];
        if (t.state === 'running' && head && head.x >= 17 && head.x <= 33) {
          if (head.exit === Edge.E) expect(head.y).toBe(20);
          if (head.exit === Edge.W) expect(head.y).toBe(19);
        }
      });
    }
    for (const t of trains) expect(arrivals.get(t.id) ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('u obsazené koleje nástupiště vlak hned najede na volnou, bez dlouhého čekání', () => {
    const townA = makeTown(0, 10, 24);
    const townB = makeTown(1, 40, 24);
    const game = emptyGame(64, [townA, townB]);
    addBuilding(game, townA, 10, 22);
    addBuilding(game, townB, 40, 22);
    const { rail } = game.world;
    const a = rail.addStation({ ...defaultStationShape(10, 20, 'x'), name: 'A', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), tracks: 2, name: 'B', townId: 1 });
    for (let x = 12; x <= 38; x++) rail.addPiece(x, 20, piece(Edge.W, Edge.E));
    // Odbočka na druhou kolej nástupiště B (y = 19)
    rail.addPiece(35, 20, piece(Edge.W, Edge.N));
    rail.addPiece(35, 19, piece(Edge.S, Edge.E));
    for (let x = 36; x <= 38; x++) rail.addPiece(x, 19, piece(Edge.W, Edge.E));
    // Návěstidlo před odbočkou: tady vlak volí kolej
    rail.addSignal(30, 20);
    // Depo mezi A a B vjezdem k trati, oba vlaky z něj jedou nejdřív na B
    const depot = rail.addDepot(24, 21, Edge.N);
    rail.addPiece(24, 20, piece(Edge.S, Edge.E));
    game.money = 5_000_000;
    const first = buyTrain(game, depot);
    const second = buyTrain(game, depot);
    // První vlak čeká na B na plné naložení uhlí, které tam není – kolej drží pořád
    game.fleet.setCargo(first, 'coal');
    // Oba vyjedou naráz, takže si trasu naplánují ke stejné (zatím volné) koleji
    expect(game.fleet.start(first, [b.id, a.id], [{ load: 'full' }, {}])).toBeNull();
    expect(game.fleet.start(second, [b.id, a.id])).toBeNull();
    expect(second.path.at(-1)!.y).toBe(20);
    let blockedDays = 0;
    let arrived = false;
    for (let i = 0; i < 400 && !arrived; i++) {
      runDays(game, 0.25);
      // Čekání za prvním vlakem při výjezdu z depa je v pořádku; počítá se stání u obsazeného nástupiště
      if (first.state === 'loading' && game.fleet.isBlocked(second)) blockedDays += 0.25;
      arrived = second.state === 'loading';
    }
    expect(first.state).toBe('loading');
    expect(arrived).toBe(true);
    expect(second.path.at(-1)!.y).not.toBe(first.path.at(-1)!.y);
    expect(blockedDays).toBeLessThanOrEqual(0.5);
  });

  it('jednosměrka se uloží a načte', () => {
    const game = emptyGame();
    layTrack(game, { x: 10, y: 10 }, { x: 20, y: 10 });
    game.world.rail.addSignal(15, 10, Edge.W);
    game.world.rail.addSignal(17, 10);
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.world.rail.signalDir(15, 10)).toBe(Edge.W);
    expect(copy.world.rail.signalDir(17, 10)).toBeUndefined();
    expect(copy.world.rail.hasSignal(17, 10)).toBe(true);
  });
});

describe('stavba návěstidel', () => {
  it('tažením postaví víc najednou, kliknutí otáčí směr a odstranění vrátí půlku', () => {
    const game = emptyGame();
    const { rail } = game.world;
    layTrack(game, { x: 10, y: 10 }, { x: 30, y: 10 });
    const before = game.money;
    expect(
      game.construction.buildSignals([
        { x: 12, y: 10 },
        { x: 16, y: 10, dir: Edge.E },
        { x: 40, y: 40 },
      ]),
    ).toBeNull();
    expect(before - game.money).toBe(2 * SIGNAL_COST);
    expect(rail.signalDir(16, 10)).toBe(Edge.E);
    // Obousměrné → jedním směrem → druhým → obousměrné
    const dirs = [0, 1, 2].map(() => {
      game.construction.cycleSignal(12, 10);
      return rail.signalDir(12, 10);
    });
    expect(dirs).toEqual([Edge.E, Edge.W, undefined]);
    const money = game.money;
    expect(game.construction.removeSignal(16, 10)).toBeNull();
    expect(game.money - money).toBe(SIGNAL_COST * DEMOLISH_REFUND);
    expect(rail.signalDir(16, 10)).toBeUndefined();
    expect(game.construction.buildSignals([{ x: 50, y: 50 }])).toMatch(/bez výhybky/);
  });
});
