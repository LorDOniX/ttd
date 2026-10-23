import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { RailNetwork } from '../world/rail';
import type { Town } from '../world/town';
import { CityTraffic } from './cityTraffic';
import { selectTrafficLights, TrafficLights } from './trafficLights';

function cityGrid(population = 1200): { map: GameMap; town: Town } {
  const map = new GameMap(7, 7);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      map.set(x, y, TileType.Road);
      map.setOwner(x, y, 0);
    }
  }
  return {
    map,
    town: {
      id: 0,
      name: 'Město',
      kind: 'city',
      x: 3,
      y: 3,
      population,
      radius: 3,
      shape: Array(12).fill(1),
      buildings: [],
      served: false,
    },
  };
}

describe('městské semafory', () => {
  it('vybírá deterministicky křižovatky ve větších městech', () => {
    const { map, town } = cityGrid();
    const rail = new RailNetwork(map);
    const selected = selectTrafficLights(map, rail, [town]);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ x: 3, y: 3, townId: 0 });
    expect(selectTrafficLights(map, rail, [town])).toEqual(selected);
    expect(selectTrafficLights(map, rail, [{ ...town, population: 1199 }])).toEqual([]);
  });

  it('střídá povolený směr a zastaví auta pro červenou i změnu fáze', () => {
    const { map, town } = cityGrid();
    const rail = new RailNetwork(map);
    const lights = new TrafficLights(map, rail, [town]);
    const junction = lights.all[0];
    const phaseOffset = junction.phaseOffset % 18;
    lights.update(((18 - phaseOffset + 18) % 18) + 1);

    expect(lights.greenAxis(junction.x, junction.y)).toBe('x');
    expect(lights.allows({ x: junction.x - 1, y: junction.y }, junction)).toBe(true);
    expect(lights.allows({ x: junction.x, y: junction.y - 1 }, junction)).toBe(false);

    lights.update(8.5);
    expect(lights.greenAxis(junction.x, junction.y)).toBe('y');
    expect(lights.allows({ x: junction.x, y: junction.y - 1 }, junction)).toBe(true);
    expect(lights.allows({ x: junction.x - 1, y: junction.y }, junction)).toBe(false);

    lights.update(8);
    expect(lights.greenAxis(junction.x, junction.y)).toBeNull();
    expect(lights.allows({ x: junction.x - 1, y: junction.y }, junction)).toBe(false);
  });

  it('městské auto zůstane před červenou a po zelené pokračuje', () => {
    const { map, town } = cityGrid();
    const rail = new RailNetwork(map);
    const lights = new TrafficLights(map, rail, [town]);
    const junction = lights.all[0];
    const phaseOffset = junction.phaseOffset % 18;
    lights.update((9.5 - phaseOffset + 18) % 18);
    const traffic = new CityTraffic(map, rail, [town], 42, 1);
    traffic.setTrafficLights(lights);
    const car = traffic.cars[0];
    traffic.cars.splice(1);
    car.path = [
      { x: junction.x - 1, y: junction.y },
      junction,
      { x: junction.x + 1, y: junction.y },
      { x: junction.x + 2, y: junction.y },
    ];
    car.pos = 0;

    traffic.update(0.25, new Set(), [], 1);
    expect(car.pos).toBe(0);
    expect(car.stuckSeconds).toBe(0);

    lights.update(9.5);
    traffic.update(0.25, new Set(), [], 1);
    expect(car.pos).toBeGreaterThan(0);
  });

  it('nezastavuje na křižovatce, která semafor nemá', () => {
    const { map, town } = cityGrid();
    const lights = new TrafficLights(map, new RailNetwork(map), [town]);

    expect(lights.allows({ x: 0, y: 3 }, { x: 1, y: 3 })).toBe(true);
  });
});
