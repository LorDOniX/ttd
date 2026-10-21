import { describe, expect, it } from 'vitest';
import { DEMOLISH_REFUND, SIGNAL_COST, TRACK_PIECE_COST } from './balance';
import { Reservations } from './reservations';
import type { Game } from './game';
import type { Train } from './trains';
import { addBuilding, buildLine, buyTrain, emptyGame, layTrack, makeTown, runDays } from '../test/fixtures';
import { Edge, defaultStationShape } from '../world/rail';
import { segmentIndexAt, type Segment } from '../world/route';

const straight = (x0: number, x1: number, y: number): Segment[] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y, piece: 1, entry: Edge.W, exit: Edge.E }));

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
  });

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
