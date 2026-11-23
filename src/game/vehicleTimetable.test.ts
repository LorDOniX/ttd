import { describe, expect, it } from 'vitest';
import { addBuilding, buildLine, buyTrain, emptyGame, makeTown, runDays } from '../test/fixtures';
import { AIRCRAFT_MODELS, ROAD_VEHICLE_MODELS } from './balance';
import { parseSave, restoreGame, serializeGame } from './save';
import {
  arrived,
  departed,
  remapTimetable,
  restoreTimetable,
  setTimetableEntry,
  timetableEntry,
  type Timetabled,
} from './vehicleTimetable';
import { TileType } from '../world/map';
import { Edge } from '../world/rail';

function roadLine() {
  const townA = makeTown(0, 8, 12);
  const townB = makeTown(1, 36, 12);
  const game = emptyGame(64, [townA, townB]);
  game.money = 10_000_000;
  addBuilding(game, townA, 8, 12);
  addBuilding(game, townB, 36, 12);
  for (let x = 4; x <= 40; x++) game.world.map.set(x, 10, TileType.Road);
  game.construction.buildRoadStop(8, 10);
  game.construction.buildRoadStop(36, 10);
  game.construction.buildRoadDepot(4, 11, Edge.N);
  const [a, b] = game.world.rail.stations;
  return { game, a, b, depot: game.world.rail.roadDepots[0] };
}

describe('časy jízdního řádu aut, letadel a lodí', () => {
  it('plán, naměřená jízda, zpoždění a čekání při příjezdu dřív', () => {
    const v: Timetabled = { orders: [1, 2] };
    setTimetableEntry(v, 1, { travel: 10, wait: 3 });
    expect(timetableEntry(v, 1)).toEqual({ travel: 10, wait: 3 });
    departed(v, 100);
    expect(arrived(v, 1, 106)).toEqual({ early: 4, wait: 3 });
    expect(v.lastTravel).toEqual([null, 6]);
    expect(v.lateness).toBe(0);
    departed(v, 200);
    expect(arrived(v, 1, 213)).toEqual({ early: 0, wait: 3 });
    expect(v.lateness).toBe(3);
    setTimetableEntry(v, 1, { travel: null, wait: null });
    expect(v.timetable).toBeUndefined();
  });

  it('po změně řádu zůstanou časy u zastávek, které v řádu zůstaly; uložení je ověří', () => {
    const v: Timetabled = { orders: [1, 2, 3] };
    setTimetableEntry(v, 2, { travel: 7 });
    remapTimetable(v, [1, 2, 3], [3, 1]);
    expect(v.timetable).toEqual([{ travel: 7 }, {}]);
    expect(restoreTimetable([{ travel: -1 }, { travel: 2.25, wait: 'x' }, { wait: 4 }], 2)).toEqual([
      {},
      { travel: 2.3 },
    ]);
    expect(restoreTimetable(undefined, 2)).toBeUndefined();
  });

  it('autobus měří jízdy, s automatickým vyplňováním si zapíše plán a podle něj čeká', () => {
    const { game, a, b, depot } = roadLine();
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    expect(game.roadFleet.start(bus, [a.id, b.id])).toBeNull();
    game.roadFleet.setAutofill(bus, true);
    runDays(game, 60);
    expect(bus.lastTravel?.every((d) => d !== null && d > 0)).toBe(true);
    expect(timetableEntry(bus, 1).travel).toBeGreaterThan(0);
    // Plán jízdy mnohem delší než skutečná jízda: autobus na zastávce počká
    game.roadFleet.setAutofill(bus, false);
    game.roadFleet.setTimetable(bus, 0, { travel: 40 });
    game.roadFleet.setTimetable(bus, 1, { travel: 40 });
    let waited = 0;
    for (let i = 0; i < 400 && waited === 0; i++) {
      runDays(game, 0.25);
      if (bus.state === 'loading' && bus.waitDays > 15) waited = bus.waitDays;
    }
    expect(waited).toBeGreaterThan(15);
    expect(bus.lateness).toBe(0);
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'x')))).roadFleet.vehicles[0];
    expect(timetableEntry(copy, 1).travel).toBe(40);
  });

  it('letadlo dodrží plánované stání na letišti', () => {
    const townA = makeTown(0, 20, 20);
    const townB = makeTown(1, 80, 30);
    const game = emptyGame(128, [townA, townB]);
    game.money = 10_000_000;
    game.construction.buildAirport('small', 20, 20, 'x');
    game.construction.buildAirport('small', 80, 30, 'y');
    const [a, b] = game.world.rail.stations;
    game.airFleet.buy(a, AIRCRAFT_MODELS[0]);
    const plane = game.airFleet.aircraft[0];
    game.airFleet.start(plane, [a.id, b.id]);
    game.airFleet.setTimetable(plane, 1, { wait: 12 });
    let stay = 0;
    for (let i = 0; i < 400 && stay === 0; i++) {
      runDays(game, 0.25);
      if (plane.state === 'loading' && plane.airportId === b.id) stay = plane.waitDays;
    }
    expect(stay).toBeGreaterThan(10);
    expect(plane.lastTravel?.[1]).toBeGreaterThan(0);
  });
});

describe('hromadné akce skupiny', () => {
  it('všechna auta skupiny do garáže a zase vypravit', () => {
    const { game, a, b, depot } = roadLine();
    for (let i = 0; i < 3; i++) game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const group = game.groups.create('road');
    for (const v of game.roadFleet.vehicles) {
      game.roadFleet.setOrders(v, [a.id, b.id]);
      expect(game.groups.assign(v, 'road', group.id)).toBeNull();
    }
    const members = game.groups.members(group);
    expect(game.startAll('road', members)).toEqual({ count: 3, error: null });
    expect(game.roadFleet.vehicles.every((v) => v.state !== 'depot')).toBe(true);
    runDays(game, 5);
    expect(game.sendAllToDepot('road', members)).toBe(3);
    runDays(game, 40);
    expect(game.roadFleet.vehicles.every((v) => v.state === 'depot')).toBe(true);
    expect(game.sendAllToDepot('road', members)).toBe(0);
  });

  it('vlaky skupiny do depa', () => {
    const { game, a, b, depot } = buildLine();
    const trains = [buyTrain(game, depot, 1), buyTrain(game, depot, 1)];
    for (const t of trains) game.fleet.setOrders(t, [a.id, b.id]);
    expect(game.startAll('train', trains).count).toBe(2);
    runDays(game, 3);
    expect(game.sendAllToDepot('train', trains)).toBe(2);
    expect(trains.every((t) => t.target === -1)).toBe(true);
  });
});
