import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import type { Town } from '../world/town';
import type { CityCar } from './cityTraffic';
import { collectTrafficHotspots } from './traffic';

function roadMap(): GameMap {
  const map = new GameMap(8, 8);
  for (let x = 1; x <= 5; x++) {
    map.set(x, 3, TileType.Road);
    map.setOwner(x, 3, 0);
  }
  return map;
}

const car = (id: number, stuckSeconds = 0): CityCar => ({
  id,
  townId: 0,
  model: 'sedan',
  speed: 1,
  path: [1, 2, 3, 4, 5].map((x) => ({ x, y: 3 })),
  pos: 1.2,
  stuckSeconds,
});

describe('přehled městského provozu', () => {
  it('sčítá auta na silniční dlaždici a zvýrazní čekání', () => {
    const map = roadMap();
    const towns = [{ id: 0, name: 'Praha' }] as Town[];

    const hotspots = collectTrafficHotspots(map, towns, [car(1), car(2, 2)], []);

    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]).toMatchObject({ townName: 'Praha', vehicles: 2, waiting: 1, score: 4 });
  });

  it('ignoruje silniční vozidla stojící v garáži a pozice mimo vozovku', () => {
    const map = roadMap();
    const garage = { state: 'depot' as const, path: [] as { x: number; y: number }[], pos: 0 };
    const offRoad = { state: 'running' as const, path: [{ x: 1, y: 1 }], pos: 0 };

    expect(collectTrafficHotspots(map, [], [], [garage, offRoad])).toEqual([]);
  });
});
