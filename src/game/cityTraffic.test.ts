import { describe, expect, it } from 'vitest';
import { generateWorld } from '../world/generator';
import { GameMap, TileType } from '../world/map';
import { RailNetwork } from '../world/rail';
import type { Town } from '../world/town';
import { CITY_CAR_MODELS, CityTraffic } from './cityTraffic';
import { ROAD_VEHICLE_MODELS } from './balance';
import { vehiclePoint } from './roadVehicles';

// Silnice z dlaždic tiles patřící městu 0
function townRoads(tiles: readonly [number, number][]): { map: GameMap; town: Town } {
  const map = new GameMap(16, 16);
  for (const [x, y] of tiles) {
    map.set(x, y, TileType.Road);
    map.setOwner(x, y, 0);
  }
  const town: Town = {
    id: 0,
    name: 'Město',
    kind: 'city',
    x: 8,
    y: 8,
    population: 300,
    radius: 2,
    shape: Array(12).fill(1),
    buildings: [],
    served: false,
  };
  return { map, town };
}

describe('městský provoz', () => {
  it('odstraněné auto se objeví jinde v témže městě', () => {
    const { map, town } = townRoads(Array.from({ length: 14 }, (_, x): [number, number] => [x + 1, 5]));
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 3, 1);
    const car = traffic.cars[0];
    traffic.cars.splice(1);
    car.path = [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
    ];
    car.pos = 1;
    car.stuckSeconds = 10;
    const before = vehiclePoint(car.path, car.pos);
    expect(traffic.relocate(car.id)).toBe(true);
    const after = vehiclePoint(car.path, car.pos);
    expect(traffic.cars).toEqual([car]);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThanOrEqual(3);
    expect(car.path.every((tile) => tile.y === 5 && tile.x >= 1 && tile.x <= 14)).toBe(true);
    expect(car.stuckSeconds).toBe(0);
    expect(traffic.relocate(-1)).toBe(false);
  });

  it('na křižovatce nevjede do krátké slepé odbočky, když vede cesta dál', () => {
    // Hlavní silnice y = 5, na x = 5 a x = 8 jednodílné slepé odbočky na sever i na jih
    const main = Array.from({ length: 14 }, (_, x): [number, number] => [x + 1, 5]);
    const { map, town } = townRoads([...main, [5, 4], [5, 6], [8, 4]]);
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 3, 1);
    const car = traffic.cars[0];
    traffic.cars.splice(1);
    car.path = [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ];
    car.pos = 1;
    const visited = new Set<string>();
    for (let step = 0; step < 200; step++) {
      traffic.update(0.05, new Set(), [], 1);
      for (const tile of car.path) visited.add(`${tile.x},${tile.y}`);
    }
    expect(visited.has('5,4') || visited.has('5,6') || visited.has('8,4')).toBe(false);
    expect(visited.has('9,5')).toBe(true);
  });

  it('ve slepé ulici bez křižovatky se auto na konci otočí', () => {
    const { map, town } = townRoads(Array.from({ length: 6 }, (_, x): [number, number] => [x + 2, 5]));
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 3, 1);
    const car = traffic.cars[0];
    traffic.cars.splice(1);
    car.path = [
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
    ];
    car.pos = 1;
    const xs: number[] = [];
    for (let step = 0; step < 200; step++) {
      traffic.update(0.05, new Set(), [], 1);
      xs.push(vehiclePoint(car.path, car.pos).x);
    }
    expect(Math.max(...xs)).toBeGreaterThan(7);
    expect(xs.at(-1)!).toBeLessThan(Math.max(...xs));
    expect(car.stuckSeconds).toBe(0);
  });

  it('auto otočené ve slepé odbočce nečeká na vozidlo, které do ní míří', () => {
    // Křižovatka (5, 5) se slepou odbočkou (5, 4); jedno auto se v odbočce otáčí, druhé do ní chce vjet
    const { map, town } = townRoads([...Array.from({ length: 10 }, (_, x): [number, number] => [x + 1, 5]), [5, 4]]);
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 3, 1);
    const turning = traffic.cars[0];
    const waiting = { ...turning, id: turning.id + 100 };
    traffic.cars.splice(0, traffic.cars.length, turning, waiting);
    turning.path = [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ];
    turning.pos = 1;
    waiting.path = [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 5 },
    ];
    waiting.pos = 2.1;
    for (let step = 0; step < 60; step++) traffic.update(0.05, new Set(), [], 1);
    expect(vehiclePoint(turning.path, turning.pos).x).toBeGreaterThan(6);
  });
  it('jezdí jen modely, které si hráč nemůže koupit', () => {
    const playerModels = new Set(ROAD_VEHICLE_MODELS.map(({ model }) => model));
    expect(CITY_CAR_MODELS.filter((model) => playerModels.has(model))).toEqual([]);
    const world = generateWorld(42, 128, 1950, { waterLevel: 0.3, townDensity: 1 });
    const traffic = new CityTraffic(world.map, world.rail, world.towns, world.seed, 1);
    expect(traffic.cars.every((car) => CITY_CAR_MODELS.includes(car.model) && car.speed > 0)).toBe(true);
  });

  it('vytvoří auta v městech úměrně jejich populaci', () => {
    const world = generateWorld(42, 128, 1950, { waterLevel: 0.3, townDensity: 1 });
    const traffic = new CityTraffic(world.map, world.rail, world.towns, world.seed, 1);
    expect(traffic.cars.length).toBeGreaterThan(0);
    for (const car of traffic.cars) {
      const town = world.towns[car.townId];
      expect(town.population).toBeGreaterThan(0);
      expect(car.path.length).toBeGreaterThan(2);
    }
  });

  it('pohybuje auta podle reálného času, ne rychlosti herního kalendáře', () => {
    const map = new GameMap(12, 12);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        map.set(x, y, TileType.Road);
        map.setOwner(x, y, 0);
      }
    }
    const town: Town = {
      id: 0,
      name: 'Město',
      kind: 'city',
      x: 6,
      y: 6,
      population: 300,
      radius: 2,
      shape: Array(12).fill(1),
      buildings: [],
      served: false,
    };
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 42, 1);
    const car = traffic.cars[0];
    traffic.cars.splice(1);
    car.path = Array.from({ length: 6 }, (_, i) => ({ x: 3 + i, y: 5 }));
    car.pos = 1;
    const start = car.pos;

    traffic.update(0.25, new Set(), [], 1);

    expect(car.pos - start).toBeCloseTo(car.speed * 0.25);
  });

  it('drží bezpečný odstup a zastaví před přechodem, pak pokračuje', () => {
    const map = new GameMap(12, 12);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        map.set(x, y, TileType.Road);
        map.setOwner(x, y, 0);
      }
    }
    const town: Town = {
      id: 0,
      name: 'Město',
      kind: 'city',
      x: 6,
      y: 6,
      population: 300,
      radius: 2,
      shape: Array(12).fill(1),
      buildings: [],
      served: false,
    };
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 42, 1);
    const car = traffic.cars[0];
    traffic.cars.splice(1);
    car.path = Array.from({ length: 6 }, (_, i) => ({ x: 3 + i, y: 5 }));
    car.pos = 1;
    const crossing = car.path[2];
    traffic.update(1, new Set([crossing.y * map.width + crossing.x]), [], 1);
    expect(car.pos).toBeCloseTo(1.25);

    traffic.update(4, new Set([crossing.y * map.width + crossing.x]), [], 1);
    // Přechod je hned na další dlaždici, objet ho nejde bez skoku; auto počká na místě
    expect(car.pos).toBeCloseTo(1.25);

    traffic.update(1, new Set(), [], 1);
    expect(car.pos).toBeGreaterThan(1.25);

    for (let day = 0; day < 20; day++) traffic.update(0.1, new Set(), [], 1);
    const point = vehiclePoint(car.path, car.pos);
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
  });

  it('nenechá dvě auta jedoucí stejným pruhem předjet se ani překrýt', () => {
    const world = generateWorld(15, 128, 1950, { waterLevel: 0.3, townDensity: 1.5 });
    const traffic = new CityTraffic(world.map, world.rail, world.towns, world.seed, 1);
    for (let day = 0; day < 60; day++) traffic.update(0.1, new Set(), [], 1);

    for (let i = 0; i < traffic.cars.length; i++) {
      const a = traffic.cars[i];
      const p = vehiclePoint(a.path, a.pos);
      for (const b of traffic.cars.slice(i + 1)) {
        const q = vehiclePoint(b.path, b.pos);
        if (p.dx * q.dx + p.dy * q.dy <= 0.5) continue;
        const lateral = Math.abs((q.x - p.x) * p.dy - (q.y - p.y) * p.dx);
        if (lateral < 0.3) {
          const along = (q.x - p.x) * p.dx + (q.y - p.y) * p.dy;
          expect(Math.abs(along)).toBeGreaterThanOrEqual(0.49);
        }
      }
    }
  });

  it('čekající auto se zastaví před křižovatkou obsazenou jiným autem', () => {
    const map = new GameMap(12, 12);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        map.set(x, y, TileType.Road);
        map.setOwner(x, y, 0);
      }
    }
    const town: Town = {
      id: 0,
      name: 'Město',
      kind: 'city',
      x: 6,
      y: 6,
      population: 600,
      radius: 2,
      shape: Array(12).fill(1),
      buildings: [],
      served: false,
    };
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 42, 1);
    const [blockingCar, waitingCar] = traffic.cars;
    blockingCar.path = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
      { x: 10, y: 5 },
    ];
    blockingCar.pos = 1.6;
    blockingCar.speed = 0;
    waitingCar.path = [
      { x: 3, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
    ];
    waitingCar.pos = 1;

    traffic.update(0.5, new Set(), [], 1);

    // Už je za stopčárou, tak počká na místě a necouvá
    expect(waitingCar.pos).toBeCloseTo(1);
    expect(vehiclePoint(waitingCar.path, waitingCar.pos).x).toBeLessThan(6);
  });

  it('na křižovatce jede první auto blíž stopčáře, druhé pokračuje po jeho průjezdu', () => {
    const map = new GameMap(12, 12);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        map.set(x, y, TileType.Road);
        map.setOwner(x, y, 0);
      }
    }
    const town: Town = {
      id: 0,
      name: 'Město',
      kind: 'city',
      x: 6,
      y: 6,
      population: 600,
      radius: 2,
      shape: Array(12).fill(1),
      buildings: [],
      served: false,
    };
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 42, 1);
    const [fartherCar, nearerCar] = traffic.cars;
    fartherCar.path = [
      { x: 4, y: 6 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 7, y: 6 },
    ];
    fartherCar.pos = 1;
    fartherCar.speed = 1;
    nearerCar.path = [
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 6, y: 7 },
    ];
    nearerCar.pos = 1.2;
    nearerCar.speed = 1;

    traffic.update(0.6, new Set(), [], 1);

    expect(fartherCar.pos).toBeCloseTo(1);
    expect(nearerCar.pos).toBeGreaterThan(1.5);

    traffic.update(1.4, new Set(), [], 1);

    expect(nearerCar.pos).toBeGreaterThan(2.5);

    traffic.update(0.4, new Set(), [], 1);

    expect(fartherCar.pos).toBeGreaterThan(1);
  });

  it('dvě auta přijíždějící proti sobě projedou křižovatku postupně bez deadlocku', () => {
    const map = new GameMap(12, 12);
    for (let x = 3; x <= 9; x++) {
      map.set(x, 6, TileType.Road);
      map.setOwner(x, 6, 0);
    }
    for (let y = 3; y <= 9; y++) {
      map.set(6, y, TileType.Road);
      map.setOwner(6, y, 0);
    }
    const town: Town = {
      id: 0,
      name: 'Město',
      kind: 'city',
      x: 6,
      y: 6,
      population: 600,
      radius: 2,
      shape: Array(12).fill(1),
      buildings: [],
      served: false,
    };
    const traffic = new CityTraffic(map, new RailNetwork(map), [town], 42, 1);
    const [eastbound, northbound] = traffic.cars;
    traffic.cars.splice(2);
    eastbound.path = Array.from({ length: 7 }, (_, i) => ({ x: 3 + i, y: 6 }));
    northbound.path = Array.from({ length: 7 }, (_, i) => ({ x: 6, y: 3 + i }));
    eastbound.pos = northbound.pos = 2.8;
    eastbound.speed = northbound.speed = 1;
    let eastboundDistance = 0;
    let northboundDistance = 0;

    for (let frame = 0; frame < 120; frame++) {
      const beforeEastbound = vehiclePoint(eastbound.path, eastbound.pos);
      const beforeNorthbound = vehiclePoint(northbound.path, northbound.pos);
      traffic.update(0.1, new Set(), [], 1);
      const afterEastbound = vehiclePoint(eastbound.path, eastbound.pos);
      const afterNorthbound = vehiclePoint(northbound.path, northbound.pos);
      eastboundDistance += Math.hypot(afterEastbound.x - beforeEastbound.x, afterEastbound.y - beforeEastbound.y);
      northboundDistance += Math.hypot(afterNorthbound.x - beforeNorthbound.x, afterNorthbound.y - beforeNorthbound.y);
    }

    expect(eastboundDistance).toBeGreaterThan(1);
    expect(northboundDistance).toBeGreaterThan(1);
  });
});
