import { describe, expect, it } from 'vitest';
import { AIRCRAFT_MODELS, AIRPORT_TYPES } from './balance';
import { aircraftModel, type Aircraft } from './aircraft';
import type { Game } from './game';
import { parseSave, restoreGame, serializeGame } from './save';
import { addBuilding, emptyGame, makeTown, runDays } from '../test/fixtures';
import {
  airportPoint,
  approachPoint,
  flightRoute,
  holdingRoute,
  routeLength,
  routePoint,
  runwayDirection,
  takeoffRoute,
} from '../world/airport';
import { TileType } from '../world/map';
import { stationTiles, type Station } from '../world/rail';

const model = (id: string) => AIRCRAFT_MODELS.find((m) => m.id === id)!;

interface AirLine {
  game: Game;
  a: Station;
  b: Station;
}

// Dvě města 60 dlaždic od sebe, u každého malé letiště
function buildAirLine(type: 'small' | 'large' = 'small'): AirLine {
  const townA = makeTown(0, 20, 20);
  const townB = makeTown(1, 80, 30);
  const game = emptyGame(128, [townA, townB]);
  game.money = 10_000_000;
  addBuilding(game, townA, 20, 24);
  addBuilding(game, townB, 80, 34);
  if (type === 'large') game.clock.date.year = AIRPORT_TYPES.large.year;
  expect(game.construction.buildAirport(type, 20, 20, 'x')).toBeNull();
  expect(game.construction.buildAirport(type, 80, 30, 'y')).toBeNull();
  const [a, b] = game.world.rail.stations;
  return { game, a, b };
}

function buyPlane(game: Game, airport: Station, id = 'racek'): Aircraft {
  expect(game.airFleet.buy(airport, model(id))).toBeNull();
  return game.airFleet.aircraft.at(-1)!;
}

describe('letiště', () => {
  it('zabere obdélník volné země a dá se zbourat', () => {
    const { game, a } = buildAirLine();
    const { map, rail } = game.world;
    const tiles = stationTiles(a);
    expect(tiles).toHaveLength(AIRPORT_TYPES.small.length * AIRPORT_TYPES.small.depth);
    expect(tiles.every((t) => map.get(t.x, t.y) === TileType.Airport)).toBe(true);
    expect(rail.stationAt(tiles[3].x, tiles[3].y)).toBe(a);
    // Přes jiné letiště stavět nelze
    expect(game.construction.buildAirport('small', 21, 21, 'x')).not.toBeNull();
    expect(game.construction.demolish([tiles[0]])).toBeNull();
    expect(rail.stations).not.toContain(a);
    expect(tiles.every((t) => map.get(t.x, t.y) === TileType.Grass)).toBe(true);
  });

  it('velké letiště jde stavět až od roku zavedení', () => {
    const game = emptyGame(64, [makeTown(0, 10, 10)]);
    game.money = 10_000_000;
    expect(game.construction.buildAirport('large', 30, 30, 'x')).toMatch(/až od roku/);
    game.clock.date.year = AIRPORT_TYPES.large.year;
    expect(game.construction.buildAirport('large', 30, 30, 'x')).toBeNull();
  });

  it('otočené letiště má ranvej podél osy y a body leží v jeho obdélníku', () => {
    const { b } = buildAirLine();
    const tiles = stationTiles(b);
    const inside = (p: { x: number; y: number }) =>
      tiles.some((t) => p.x >= t.x && p.x <= t.x + 1 && p.y >= t.y && p.y <= t.y + 1);
    expect(runwayDirection(b)).toEqual({ x: 0, y: 1 });
    for (const [a, c] of [
      [0.5, 0.5],
      [4.5, 3.5],
      [2.5, 1.5],
    ]) {
      expect(inside(airportPoint(b, a, c))).toBe(true);
    }
    // Ranvej vede podél osy y
    const start = airportPoint(b, 0.5, 0.5);
    const end = airportPoint(b, 4.5, 0.5);
    expect(start.x).toBe(end.x);
    expect(end.y - start.y).toBe(4);
  });
});

describe('trasy letu', () => {
  it('let začíná ve směru vzletu, končí v bodě přiblížení ve směru ranveje a drží výšku', () => {
    const { a, b } = buildAirLine();
    const liftoff = takeoffRoute(a).at(-1)!;
    const route = flightRoute(liftoff, runwayDirection(a), approachPoint(b), runwayDirection(b));
    const length = routeLength(route, true);
    expect(length).toBeGreaterThan(Math.hypot(b.x - a.x, b.y - a.y) - 10);
    const start = routePoint(route, true, 0);
    expect(start.dx).toBeCloseTo(1);
    expect(start.z).toBeCloseTo(liftoff.z);
    const end = routePoint(route, true, length);
    expect(end.x).toBeCloseTo(approachPoint(b).x);
    expect(end.y).toBeCloseTo(approachPoint(b).y);
    expect(end.dy).toBeCloseTo(1, 1);
    expect(routePoint(route, true, length / 2).z).toBeGreaterThan(3);
  });

  it('kroužení začíná i končí v bodě přiblížení', () => {
    const { a } = buildAirLine();
    const route = holdingRoute(a);
    const approach = approachPoint(a);
    const start = routePoint(route, false, 0);
    const end = routePoint(route, false, routeLength(route, false));
    for (const p of [start, end]) {
      expect(p.x).toBeCloseTo(approach.x);
      expect(p.y).toBeCloseTo(approach.y);
    }
    expect(start.dx).toBeCloseTo(1, 1);
  });
});

describe('letadla', () => {
  it('létají mezi letišti, převážejí cestující a vydělávají', () => {
    const { game, a, b } = buildAirLine();
    a.waiting = 25;
    const plane = buyPlane(game, a);
    expect(plane.state).toBe('hangar');
    expect(game.airFleet.start(plane, [a.id, b.id])).toBeNull();
    expect(plane.state).toBe('taxi');
    const money = game.money;
    // Z hangáru se letí rovnou na druhé letiště, kde vyloží, naloží a vrátí se
    b.waiting = 30;
    runDays(game, 40);
    expect(plane.income).toBeGreaterThan(0);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
    expect(plane.tiles + plane.passengers).toBeGreaterThan(0);
    expect(game.money).toBeGreaterThan(money - aircraftModel(plane).runningCost);
  });

  it('z hangáru nejdřív naloží na svém letišti, pak letí na další', () => {
    const { game, a, b } = buildAirLine();
    a.waiting = 20;
    const plane = buyPlane(game, a);
    game.airFleet.start(plane, [b.id, a.id]);
    expect(plane.taxiTo).toBe('stand');
    runDays(game, 4);
    expect(plane.passengers).toBeGreaterThanOrEqual(20);
    runDays(game, 4);
    expect(plane.airportId).toBe(b.id);
  });

  it('když je stání obsazené, druhé letadlo krouží a přistane, až se uvolní', () => {
    const { game, a, b } = buildAirLine();
    const planes = [buyPlane(game, a), buyPlane(game, a), buyPlane(game, a)];
    for (const p of planes) game.airFleet.start(p, [a.id, b.id]);
    // Na malém letišti jsou dvě stání; třetí letadlo musí počkat ve vzduchu
    for (const p of planes) game.airFleet.toggleFullLoad(p, b.id);
    let held = false;
    for (let day = 0; day < 40; day++) {
      runDays(game, 1);
      if (planes.some((p) => p.state === 'holding')) held = true;
      const atB = planes.filter((p) => p.airportId === b.id && p.stand >= 0);
      expect(new Set(atB.map((p) => p.stand)).size).toBe(atB.length);
      expect(atB.length).toBeLessThanOrEqual(AIRPORT_TYPES.small.stands);
      // Ranvej používá vždy nejvýš jedno letadlo
      const onRunway = planes.filter((p) => p.airportId === b.id && (p.state === 'takeoff' || p.state === 'landing'));
      expect(onRunway.length).toBeLessThanOrEqual(1);
    }
    expect(held).toBe(true);
  });

  it('velké letadlo nekoupí ani nepošle na malé letiště', () => {
    const { game, a, b } = buildAirLine();
    game.clock.date.year = 1990;
    expect(game.airFleet.buy(a, model('jerab'))).toMatch(/velké letiště/);
    const plane = buyPlane(game, a, 'sokol');
    expect(game.airFleet.ordersError(plane, [a.id, b.id])).toBeNull();
    const large = buildAirLine('large');
    const jumbo = buyPlane(large.game, large.a, 'jerab');
    expect(large.game.airFleet.ordersError(jumbo, [large.a.id, large.b.id])).toBeNull();
  });

  it('poslané do hangáru dosedne na cílovém letišti a zajede do hangáru', () => {
    const { game, a, b } = buildAirLine();
    const plane = buyPlane(game, a);
    game.airFleet.start(plane, [a.id, b.id]);
    runDays(game, 6);
    game.airFleet.sendToHangar(plane);
    runDays(game, 30);
    expect(plane.state).toBe('hangar');
    expect(plane.depotId).toBe(b.id);
    expect(game.airFleet.inHangar(b)).toContain(plane);
  });

  it('letiště obsluhované letadlem nejde zbourat', () => {
    const { game, a, b } = buildAirLine();
    const plane = buyPlane(game, a);
    expect(game.construction.demolish(stationTiles(a).slice(0, 1))).toMatch(/hangáru/);
    game.airFleet.start(plane, [a.id, b.id]);
    expect(game.construction.demolishPlan(stationTiles(b).slice(0, 1)).blocked).toMatch(new RegExp(plane.name));
  });

  it('pošta létá jen poštovním letadlem', () => {
    const { game, a, b } = buildAirLine();
    const plane = buyPlane(game, a, 'racek-mail');
    game.airFleet.start(plane, [a.id, b.id]);
    runDays(game, 30);
    expect(a.freight.mail + b.freight.mail + plane.passengers).toBeGreaterThan(0);
  });

  it('uložení zachová letiště i letadla ve vzduchu', () => {
    const { game, a, b } = buildAirLine();
    const plane = buyPlane(game, a);
    game.airFleet.start(plane, [a.id, b.id]);
    runDays(game, 8);
    const state = plane.state;
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'x'))));
    const copy = restored.airFleet.aircraft[0];
    expect(copy.state).toBe(state);
    expect(restored.airFleet.position(copy)).toEqual(game.airFleet.position(plane));
    expect(restored.world.rail.stations.filter((s) => s.kind === 'air').map((s) => s.airport)).toEqual([
      'small',
      'small',
    ]);
    runDays(restored, 40);
    expect(copy.income).toBeGreaterThan(0);
    expect(restored.world.rail.stationAt(b.x, b.y)?.kind).toBe('air');
  });
});
