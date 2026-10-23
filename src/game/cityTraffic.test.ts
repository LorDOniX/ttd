import { describe, expect, it } from 'vitest';
import { generateWorld } from '../world/generator';
import { GameMap, TileType } from '../world/map';
import { RailNetwork } from '../world/rail';
import type { Town } from '../world/town';
import { CityTraffic } from './cityTraffic';
import { vehiclePoint } from './roadVehicles';

describe('městský provoz', () => {
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

    const blockedPath = car.path.map(({ x, y }) => `${x},${y}`);
    traffic.update(4, new Set([crossing.y * map.width + crossing.x]), [], 1);
    expect(car.path.map(({ x, y }) => `${x},${y}`)).not.toEqual(blockedPath);

    traffic.update(1, new Set(), [], 1);
    expect(car.pos).toBeGreaterThan(0);

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

    expect(waitingCar.pos).toBeCloseTo(0.7);
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

    expect(fartherCar.pos).toBeCloseTo(0.7);
    expect(nearerCar.pos).toBeGreaterThan(1.5);

    traffic.update(1.4, new Set(), [], 1);

    expect(nearerCar.pos).toBeGreaterThan(2.5);

    traffic.update(0.4, new Set(), [], 1);

    expect(fartherCar.pos).toBeGreaterThan(0.7);
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
