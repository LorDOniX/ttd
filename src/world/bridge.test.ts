import { describe, expect, it } from 'vitest';
import { BRIDGE_PIECE_COST, DEMOLISH_REFUND, TRACK_PIECE_COST } from '../game/balance';
import { parseSave, restoreGame, serializeGame } from '../game/save';
import { Reservations } from '../game/reservations';
import type { Train } from '../game/trains';
import { addBuilding, buyTrain, emptyGame, makeTown } from '../test/fixtures';
import { TileType } from './map';
import { Edge, PIECES, defaultStationShape, type RailNetwork } from './rail';
import { BRIDGE_HEIGHT, findRoute, heightAt, pathLength, railNetworks, reverseSegment, segmentPoint } from './route';

const WE = PIECES.findIndex(([a, b]) => a === Edge.W && b === Edge.E);
const NS = PIECES.findIndex(([a, b]) => a === Edge.N && b === Edge.S);

// Kolej y = 20 z x = 10 do 30 s mostem 18–22 přes kolej N–J v x = 20
function bridgedLine(): ReturnType<typeof emptyGame> {
  const game = emptyGame();
  const { rail } = game.world;
  for (let y = 10; y <= 30; y++) rail.addPiece(20, y, NS);
  for (let x = 10; x <= 18; x++) rail.addPiece(x, 20, WE);
  for (let x = 22; x <= 30; x++) rail.addPiece(x, 20, WE);
  expect(rail.bridgeProblem(18, 20, 22, 20)).toBeNull();
  rail.addBridge(18, 20, 22, 20);
  return game;
}

function route(rail: RailNetwork, fromX: number, toX: number) {
  return findRoute(rail, { x: fromX, y: 20, exit: Edge.E, heading: 0 }, (x, y) => x === toX && y === 20, {
    x: toX,
    y: 20,
  });
}

describe('mosty', () => {
  it('trasa vede přes most jedním polem nad kolejí, která pod ním zůstane', () => {
    const { world } = bridgedLine();
    const path = route(world.rail, 10, 30)!;
    expect(path).not.toBeNull();
    const span = path.find((s) => s.span)!;
    expect(span).toMatchObject({ x: 19, y: 20, span: 3, exit: Edge.E });
    expect(path.some((s) => !s.span && s.x === 20 && s.y === 20)).toBe(false);
    expect(pathLength(path)).toBe(20);
    expect(world.rail.has(20, 20, NS)).toBe(true);
    expect(world.map.isBridged(20, 20)).toBe(true);
    // Kolej pod mostem nikam nevede
    expect(route(world.rail, 10, 20)).toBeNull();
  });

  it('pole mostu je rovné, nájezdy stoupají a obrácený průjezd vede zpět', () => {
    const { world } = bridgedLine();
    const path = route(world.rail, 10, 30)!;
    const i = path.findIndex((s) => s.span);
    const before = pathLength(path.slice(0, i));
    expect(heightAt(world.rail, path, before + 1.5)).toBe(BRIDGE_HEIGHT);
    expect(heightAt(world.rail, path, before - 0.5)).toBeCloseTo(BRIDGE_HEIGHT / 2, 6);
    expect(heightAt(world.rail, path, 2)).toBe(0);
    const span = path[i];
    expect(segmentPoint(span, 0)).toEqual([19, 20.5]);
    expect(segmentPoint(span, 1)).toEqual([22, 20.5]);
    expect(reverseSegment(span)).toMatchObject({ x: 21, entry: Edge.E, exit: Edge.W, span: 3 });
    expect(segmentPoint(reverseSegment(span), 0)).toEqual([22, 20.5]);
  });

  it('sítě jsou spojené přes most a koleje pod ním jsou jiná síť', () => {
    const { world } = bridgedLine();
    const labels = railNetworks(world.rail);
    const w = world.map.width;
    expect(labels[20 * w + 10]).toBe(labels[20 * w + 30]);
    expect(labels[20 * w + 20]).not.toBe(labels[20 * w + 10]);
  });

  it('vlak na mostě neblokuje vlak pod mostem', () => {
    const { world } = bridgedLine();
    const r = new Reservations(world.map.width, () => false);
    const over = { id: 1, path: route(world.rail, 10, 30)!, pos: 0.5 } as Train;
    const under = {
      id: 2,
      path: findRoute(world.rail, { x: 20, y: 10, exit: Edge.S, heading: 2 }, (x, y) => x === 20 && y === 30, {
        x: 20,
        y: 30,
      })!,
      pos: 0.5,
    } as Train;
    r.reset(over, 0);
    r.reset(under, 0);
    expect(r.extend(over)).toBe(true);
    expect(r.extend(under)).toBe(true);
    expect(r.fullyReserved(over)).toBe(true);
    expect(r.fullyReserved(under)).toBe(true);
  });

  it('nejde přes budovu, šikmo, křížem přes jiný most ani na vodu nájezdem', () => {
    const { world } = bridgedLine();
    const { rail, map } = world;
    map.set(40, 40, TileType.Building);
    expect(rail.bridgeProblem(38, 40, 42, 40)).toMatch(/budovy/);
    expect(rail.bridgeProblem(38, 40, 42, 41)).toMatch(/rovně/);
    expect(rail.bridgeProblem(20, 18, 20, 22)).toMatch(/křížit/);
    expect(rail.bridgeProblem(38, 50, 39, 50)).toMatch(/3 dlaždice/);
    map.set(50, 50, TileType.Water);
    expect(rail.bridgeProblem(50, 50, 50, 54)).toMatch(/volné zemi/);
    // Pod mostem se nestaví depo ani nástupiště
    map.set(20, 20, TileType.Grass);
    expect(map.isFree(21, 20)).toBe(false);
    expect(rail.canPlaceStation({ ...defaultStationShape(21, 21, 'y') })).toBe(false);
  });

  it('stavba stojí peníze, demolice nájezdu zboří celý most a vrátí polovinu', () => {
    const game = emptyGame();
    const before = game.money;
    expect(game.construction.buildBridge(10, 10, 15, 10)).toBeNull();
    expect(before - game.money).toBe(4 * BRIDGE_PIECE_COST + 2 * TRACK_PIECE_COST);
    expect(game.world.rail.bridges).toHaveLength(1);
    const money = game.money;
    expect(game.construction.demolish([{ x: 15, y: 10 }])).toBeNull();
    expect(game.world.rail.bridges).toHaveLength(0);
    expect(game.world.map.isBridged(12, 10)).toBe(false);
    expect(game.world.map.get(10, 10)).toBe(TileType.Grass);
    expect(game.money - money).toBe((4 * BRIDGE_PIECE_COST + 2 * TRACK_PIECE_COST) * DEMOLISH_REFUND);
  });

  it('vlak jezdí přes most a počítá ujeté dlaždice i přes pole mostu', () => {
    const townA = makeTown(0, 10, 24);
    const townB = makeTown(1, 40, 24);
    const game = emptyGame(64, [townA, townB]);
    addBuilding(game, townA, 10, 22);
    addBuilding(game, townB, 40, 22);
    const { rail } = game.world;
    for (let y = 10; y <= 30; y++) rail.addPiece(25, y, NS);
    for (let x = 12; x <= 38; x++) if (x < 24 || x > 26) rail.addPiece(x, 20, WE);
    rail.addBridge(23, 20, 27, 20);
    const a = rail.addStation({ ...defaultStationShape(10, 20, 'x'), name: 'A', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), name: 'B', townId: 1 });
    const depot = rail.addDepot(8, 20, Edge.E);
    const train = buyTrain(game, depot);
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    let arrivals = 0;
    let state = train.state;
    let crossed = false;
    for (let i = 0; i < 20_000 && arrivals < 4; i++) {
      game.update(200);
      if (train.path.some((s) => s.span)) crossed = true;
      if (train.state === 'loading' && state !== 'loading') arrivals++;
      state = train.state;
    }
    expect(crossed).toBe(true);
    expect(arrivals).toBe(4);
  });

  it('most se uloží a načte i s polem nad kolejí', () => {
    const game = bridgedLine();
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.world.rail.bridges).toEqual(game.world.rail.bridges);
    expect(copy.world.map.isBridged(20, 20)).toBe(true);
    expect(copy.world.rail.bridgeFrom(18, 20, Edge.E)?.span).toBe(3);
  });
});
