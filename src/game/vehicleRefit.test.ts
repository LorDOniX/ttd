import { describe, expect, it } from 'vitest';
import { addBuilding, addIndustry, emptyGame, makeTown, runDays } from '../test/fixtures';
import { AIRCRAFT_MODELS, ROAD_VEHICLE_MODELS, SHIP_MODELS } from './balance';
import { aircraftCapacity, aircraftCargo } from './aircraft';
import { parseSave, restoreGame, serializeGame } from './save';
import { shipCapacity, shipCargo } from './ships';
import { formatVehicleLoad, vehicleCapacity, vehicleCargo } from './roadVehicles';
import { refitCapacity, refitOptions, vehicleRefitCost } from './vehicleRefit';
import { TileType } from '../world/map';
import { portAt } from '../world/port';
import { Edge } from '../world/rail';

const roadModel = (id: string) => ROAD_VEHICLE_MODELS.find((m) => m.id === id)!;

// Silnice y = 10 od x = 4 do 40, zastávky na x = 8 a 36, garáž na začátku
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

describe('přestavba aut, lodí a letadel', () => {
  it('na co jde přestavět: sypký náklad mezi sebou, kusové zboží a pošta, letadla cestující ↔ pošta', () => {
    expect(refitOptions('road', 'coal')).toEqual(['coal', 'iron-ore', 'grain', 'wood']);
    expect(refitOptions('road', 'goods')).toEqual(['goods', 'steel', 'food', 'mail']);
    expect(refitOptions('road', 'oil')).toEqual(['oil']);
    expect(refitOptions('road', 'passengers')).toEqual(['passengers']);
    expect(refitOptions('ship', 'passengers')).toEqual(['passengers']);
    expect(refitOptions('air', 'passengers')).toEqual(['passengers', 'mail']);
    expect(refitCapacity(30, 'passengers', 'mail')).toBe(20);
    expect(refitCapacity(20, 'goods', 'steel')).toBe(25);
    expect(vehicleRefitCost(400_000)).toBe(20_000);
    expect(vehicleRefitCost(10_000)).toBe(2_000);
  });

  it('nákladní auto se v garáži přestaví za poplatek, mimo garáž ne; náklad propadne', () => {
    const { game, a, b, depot } = roadLine();
    const model = roadModel('coal-balogh');
    expect(game.roadFleet.buy(depot, model)).toBeNull();
    const truck = game.roadFleet.vehicles[0];
    truck.passengers = 10;
    const money = game.money;
    expect(game.roadFleet.refit(truck, 'grain')).toBeNull();
    expect(game.money).toBe(money - vehicleRefitCost(model.price));
    expect(vehicleCargo(truck)).toBe('grain');
    expect(vehicleCapacity(truck)).toBe(model.capacity);
    expect(truck.passengers).toBe(0);
    expect(formatVehicleLoad(truck)).toContain('obilí');
    expect(game.roadFleet.refit(truck, 'oil')).toMatch(/nejde/);
    expect(game.roadFleet.refit(truck, 'coal')).toBeNull();
    expect(truck.cargo).toBeUndefined();
    game.roadFleet.refit(truck, 'wood');
    game.roadFleet.start(truck, [a.id, b.id]);
    expect(game.roadFleet.refit(truck, 'grain')).toMatch(/garáži/);
  });

  it('přestavěné auto odváží nový náklad a závod mu ho sváží', () => {
    const { game, a, b, depot } = roadLine();
    const forest = addIndustry(game, 'forest', 10, 6);
    game.roadFleet.buy(depot, roadModel('coal-balogh'));
    const truck = game.roadFleet.vehicles[0];
    expect(game.roadFleet.refit(truck, 'wood')).toBeNull();
    game.roadFleet.start(truck, [a.id, b.id]);
    expect(game.freight.pickupStations(forest)).toEqual([a]);
    a.freight.wood = 40;
    let loaded = false;
    for (let i = 0; i < 200 && !loaded; i++) {
      runDays(game, 0.25);
      loaded = truck.passengers > 0;
    }
    expect(loaded).toBe(true);
    expect(a.freight.wood).toBeLessThan(40);
  });

  it('letadlo se v hangáru přestaví na poštu s menší kapacitou', () => {
    const townA = makeTown(0, 20, 20);
    const townB = makeTown(1, 80, 30);
    const game = emptyGame(128, [townA, townB]);
    game.money = 10_000_000;
    expect(game.construction.buildAirport('small', 20, 20, 'x')).toBeNull();
    const [airport] = game.world.rail.stations;
    const model = AIRCRAFT_MODELS[0];
    game.airFleet.buy(airport, model);
    const plane = game.airFleet.aircraft[0];
    expect(game.airFleet.refitOptions(plane)).toEqual(['passengers', 'mail']);
    expect(game.airFleet.refit(plane, 'mail')).toBeNull();
    expect(aircraftCargo(plane)).toBe('mail');
    expect(aircraftCapacity(plane)).toBe(refitCapacity(model.capacity, 'passengers', 'mail'));
  });

  it('nákladní loď se v loděnici přestaví, osobní ne; uložení přestavbu zachová', () => {
    const townA = makeTown(0, 14, 16);
    const game = emptyGame(64, [townA]);
    game.money = 10_000_000;
    game.clock.date = { year: 1950, month: 5, day: 1 };
    const { map } = game.world;
    for (let y = 20; y <= 30; y++) for (let x = 10; x <= 50; x++) map.set(x, y, TileType.Water);
    expect(game.construction.buildPort(portAt(map, { x: 14, y: 19 }, Edge.S)!)).toBeNull();
    const [port] = game.world.rail.stations;
    game.shipFleet.buy(
      port,
      SHIP_MODELS.find((m) => m.id === 'goods-ship')!,
    );
    game.shipFleet.buy(port, SHIP_MODELS[0]);
    const [cargoShip, liner] = game.shipFleet.ships;
    expect(game.shipFleet.refit(cargoShip, 'mail')).toBeNull();
    expect(shipCargo(cargoShip)).toBe('mail');
    expect(shipCapacity(cargoShip)).toBe(160);
    expect(game.shipFleet.refit(liner, 'mail')).toMatch(/nejde/);
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'x')))).shipFleet.ships[0];
    expect(shipCargo(copy)).toBe('mail');
  });
});
