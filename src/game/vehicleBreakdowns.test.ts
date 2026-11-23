import { describe, expect, it } from 'vitest';
import { AIRCRAFT_MODELS, BREAKDOWN_DAYS, ROAD_VEHICLE_MODELS, SHIP_MODELS } from './balance';
import { aircraftReliability } from './aircraft';
import type { Game } from './game';
import { reliabilityForYear, restoreMaintenance } from './reliability';
import { roadVehicleReliability } from './roadVehicles';
import { parseSave, restoreGame, serializeGame } from './save';
import { shipReliability } from './ships';
import { addBuilding, emptyGame, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
import { portAt } from '../world/port';
import { Edge, type Depot, type Station } from '../world/rail';

interface Line {
  game: Game;
  a: Station;
  b: Station;
}

// Rovná silnice y = 10 od x = 8 do 40, zastávky na x = 12 a 36, garáž na začátku silnice
function roadLine(): Line & { depot: Depot } {
  const townA = makeTown(0, 12, 12);
  const townB = makeTown(1, 36, 12);
  const game = emptyGame(64, [townA, townB]);
  addBuilding(game, townA, 12, 12);
  addBuilding(game, townB, 36, 12);
  const { map, rail } = game.world;
  for (let x = 8; x <= 40; x++) map.set(x, 10, TileType.Road);
  game.construction.buildRoadStop(12, 10);
  game.construction.buildRoadStop(36, 10);
  game.construction.buildRoadDepot(8, 11, Edge.N);
  const [a, b] = rail.stations;
  return { game, a, b, depot: rail.roadDepots[0] };
}

function airLine(): Line {
  const townA = makeTown(0, 20, 20);
  const townB = makeTown(1, 80, 30);
  const game = emptyGame(128, [townA, townB]);
  game.money = 10_000_000;
  addBuilding(game, townA, 20, 24);
  addBuilding(game, townB, 80, 34);
  expect(game.construction.buildAirport('small', 20, 20, 'x')).toBeNull();
  expect(game.construction.buildAirport('small', 80, 30, 'y')).toBeNull();
  const [a, b] = game.world.rail.stations;
  return { game, a, b };
}

// Jezero s ostrůvkem, přístavy na severním a jižním břehu; v červnu voda nezamrzá
function waterLine(): Line {
  const townA = makeTown(0, 14, 16);
  const townB = makeTown(1, 46, 34);
  const game = emptyGame(64, [townA, townB]);
  game.money = 10_000_000;
  game.clock.date = { year: 1950, month: 5, day: 1 };
  const { map } = game.world;
  for (let y = 20; y <= 30; y++) for (let x = 10; x <= 50; x++) map.set(x, y, TileType.Water);
  for (let y = 24; y <= 26; y++) for (let x = 25; x <= 35; x++) map.set(x, y, TileType.Grass);
  addBuilding(game, townA, 14, 16);
  addBuilding(game, townB, 46, 34);
  expect(game.construction.buildPort(portAt(map, { x: 14, y: 19 }, Edge.S)!)).toBeNull();
  expect(game.construction.buildPort(portAt(map, { x: 46, y: 31 }, Edge.N)!)).toBeNull();
  const [a, b] = game.world.rail.stations;
  return { game, a, b };
}

describe('údržba aut, letadel a lodí', () => {
  it('spolehlivost modelu roste s rokem uvedení a starší uložení dostanou výchozí údržbu', () => {
    expect(reliabilityForYear(1930)).toBeCloseTo(0.78);
    expect(reliabilityForYear(1990)).toBeGreaterThan(reliabilityForYear(1960));
    expect(reliabilityForYear(2100)).toBeCloseTo(0.95);
    const old = restoreMaintenance({}, 0.8, 1000);
    expect(old).toEqual({ reliability: 0.8, lastService: 1000, serviceInterval: 150, brokenDays: 0, breakdowns: 0 });
    expect(restoreMaintenance({ reliability: 3, serviceInterval: 5 }, 0.8, 0)).toMatchObject({
      reliability: 1,
      serviceInterval: 30,
    });
  });

  it('nové vozidlo má plnou spolehlivost a výchozí interval servisu', () => {
    const { game, depot } = roadLine();
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    expect(bus.reliability).toBe(roadVehicleReliability(bus));
    expect(bus.serviceInterval).toBe(150);
    game.roadFleet.setServiceInterval(bus, 5);
    expect(bus.serviceInterval).toBe(30);
  });
});

describe('auta', () => {
  it('porouchané auto stojí, po opravě jede dál', () => {
    const { game, a, b, depot } = roadLine();
    game.breakdowns = 'normal';
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    bus.serviceInterval = 800;
    game.roadFleet.start(bus, [a.id, b.id]);
    let broke = false;
    for (let i = 0; i < 1200 && !broke; i++) {
      bus.reliability = 0;
      runDays(game, 0.25);
      if (bus.brokenDays > 0 && bus.state === 'running') {
        broke = true;
        const pos = bus.pos;
        runDays(game, 1);
        expect(bus.pos).toBe(pos);
      }
    }
    expect(broke).toBe(true);
    expect(bus.breakdowns).toBeGreaterThan(0);
    runDays(game, BREAKDOWN_DAYS + 1);
    expect(bus.brokenDays).toBe(0);
  });

  it('po intervalu zajede do garáže na servis a pokračuje v řádu', () => {
    const { game, a, b, depot } = roadLine();
    game.breakdowns = 'reduced';
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    bus.serviceInterval = 30;
    game.roadFleet.start(bus, [a.id, b.id]);
    let detours = 0;
    let wasServicing = false;
    for (let day = 0; day < 200; day++) {
      runDays(game, 0.5);
      bus.brokenDays = 0;
      expect(bus.state).not.toBe('depot');
      if (bus.servicing !== undefined && !wasServicing) detours++;
      wasServicing = bus.servicing !== undefined;
    }
    expect(detours).toBeGreaterThanOrEqual(2);
    expect(game.clock.now - bus.lastService).toBeLessThan(bus.serviceInterval + 40);
    expect(bus.income).toBeGreaterThan(0);
  });

  it('bez poruch auto na servis nejezdí', () => {
    const { game, a, b, depot } = roadLine();
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    bus.serviceInterval = 30;
    game.roadFleet.start(bus, [a.id, b.id]);
    for (let day = 0; day < 120; day++) {
      bus.reliability = 0;
      runDays(game, 1);
      expect(bus.servicing).toBeUndefined();
      expect(bus.brokenDays).toBe(0);
    }
  });

  it('auto poslané do garáže se tam zastaví a projde servisem', () => {
    const { game, a, b, depot } = roadLine();
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    game.roadFleet.start(bus, [a.id, b.id]);
    runDays(game, 20);
    bus.reliability = 0.3;
    game.roadFleet.sendToDepot(bus);
    runDays(game, 30);
    expect(bus.state).toBe('depot');
    expect(bus.reliability).toBe(roadVehicleReliability(bus));
  });
});

describe('letadla', () => {
  it('po intervalu pojíždí na servis do hangáru a pak letí dál', () => {
    const { game, a, b } = airLine();
    game.breakdowns = 'reduced';
    game.airFleet.buy(a, AIRCRAFT_MODELS[0]);
    const plane = game.airFleet.aircraft[0];
    plane.serviceInterval = 30;
    game.airFleet.start(plane, [a.id, b.id]);
    let services = 0;
    let last = plane.lastService;
    for (let day = 0; day < 300; day++) {
      runDays(game, 0.5);
      plane.brokenDays = 0;
      expect(plane.state).not.toBe('hangar');
      if (plane.lastService !== last) {
        services++;
        last = plane.lastService;
        expect(plane.reliability).toBeCloseTo(aircraftReliability(plane), 2);
      }
    }
    expect(services).toBeGreaterThanOrEqual(2);
    expect(plane.income).toBeGreaterThan(0);
  });

  it('porucha ve vzduchu letadlo zpomalí a po přistání zajede na servis', () => {
    const { game, a, b } = airLine();
    game.breakdowns = 'normal';
    game.airFleet.buy(a, AIRCRAFT_MODELS[0]);
    const plane = game.airFleet.aircraft[0];
    plane.serviceInterval = 800;
    game.airFleet.start(plane, [a.id, b.id]);
    for (let i = 0; i < 400 && plane.state !== 'flying'; i++) runDays(game, 0.05);
    expect(plane.state).toBe('flying');
    let pos = plane.pos;
    runDays(game, 0.1);
    const normal = plane.pos - pos;
    plane.brokenDays = BREAKDOWN_DAYS;
    plane.breakdowns = 1;
    pos = plane.pos;
    runDays(game, 0.1);
    expect(plane.state).toBe('flying');
    expect(plane.pos - pos).toBeCloseTo(normal / 2, 3);
    let serviced = false;
    for (let i = 0; i < 400 && !serviced; i++) {
      runDays(game, 0.25);
      serviced = plane.breakdowns === 0;
    }
    expect(serviced).toBe(true);
  });
});

describe('lodě', () => {
  it('po intervalu projde servisem v loděnici přístavu a pluje dál', () => {
    const { game, a, b } = waterLine();
    game.breakdowns = 'reduced';
    game.shipFleet.buy(a, SHIP_MODELS[0]);
    const ship = game.shipFleet.ships[0];
    ship.serviceInterval = 30;
    game.shipFleet.start(ship, [a.id, b.id]);
    let services = 0;
    let last = ship.lastService;
    for (let day = 0; day < 200; day++) {
      runDays(game, 0.5);
      ship.brokenDays = 0;
      expect(ship.state).not.toBe('depot');
      if (ship.lastService !== last) {
        services++;
        last = ship.lastService;
        expect(ship.reliability).toBeCloseTo(shipReliability(ship), 2);
      }
    }
    expect(services).toBeGreaterThanOrEqual(2);
    expect(ship.income).toBeGreaterThan(0);
  });

  it('porouchaná loď stojí na místě', () => {
    const { game, a, b } = waterLine();
    game.shipFleet.buy(a, SHIP_MODELS[0]);
    const ship = game.shipFleet.ships[0];
    game.shipFleet.start(ship, [a.id, b.id]);
    for (let i = 0; i < 200 && ship.state !== 'sailing'; i++) runDays(game, 0.25);
    expect(ship.state).toBe('sailing');
    ship.brokenDays = BREAKDOWN_DAYS;
    const pos = ship.pos;
    runDays(game, 1);
    expect(ship.pos).toBe(pos);
    runDays(game, BREAKDOWN_DAYS);
    expect(ship.pos).toBeGreaterThan(pos);
  });
});

describe('uložení údržby', () => {
  it('zachová spolehlivost a interval; starší uložení bez údržby se doplní', () => {
    const { game, a, b, depot } = roadLine();
    game.roadFleet.buy(depot, ROAD_VEHICLE_MODELS[0]);
    const bus = game.roadFleet.vehicles[0];
    game.roadFleet.start(bus, [a.id, b.id]);
    runDays(game, 10);
    bus.serviceInterval = 90;
    const data = serializeGame(game, 'x');
    const copy = restoreGame(parseSave(JSON.stringify(data))).roadFleet.vehicles[0];
    expect(copy.serviceInterval).toBe(90);
    expect(copy.reliability).toBeCloseTo(bus.reliability);
    const legacy = JSON.parse(JSON.stringify(data));
    for (const key of ['reliability', 'lastService', 'serviceInterval', 'brokenDays', 'breakdowns']) {
      delete legacy.roadFleet.vehicles[0][key];
    }
    const old = restoreGame(parseSave(JSON.stringify(legacy))).roadFleet.vehicles[0];
    expect(old.reliability).toBe(roadVehicleReliability(old));
    expect(old.serviceInterval).toBe(150);
    expect(old.brokenDays).toBe(0);
  });
});
