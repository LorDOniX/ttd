import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { canStand, nearestStandable } from './firstPerson';

describe('chůze z první osoby', () => {
  it('po trávě, silnici i lese projde, do budovy a vody ne', () => {
    const map = new GameMap(8, 8);
    map.set(2, 2, TileType.Road);
    map.set(3, 2, TileType.Trees);
    map.set(4, 2, TileType.Building);
    map.set(5, 2, TileType.Water);
    expect(canStand(map, 1.5, 2.5)).toBe(true);
    expect(canStand(map, 2.5, 2.5)).toBe(true);
    expect(canStand(map, 3.5, 2.5)).toBe(true);
    expect(canStand(map, 4.5, 2.5)).toBe(false);
    expect(canStand(map, 5.5, 2.5)).toBe(false);
  });

  it('tělo nepustí těsně ke zdi ani za okraj mapy', () => {
    const map = new GameMap(8, 8);
    map.set(4, 2, TileType.Building);
    expect(canStand(map, 3.5, 2.5)).toBe(true);
    expect(canStand(map, 3.98, 2.5)).toBe(false);
    expect(canStand(map, 0.02, 0.5)).toBe(false);
  });

  it('panáček položený na budovu skončí na nejbližší volné dlaždici', () => {
    const map = new GameMap(8, 8);
    for (let x = 2; x <= 4; x++) for (let y = 2; y <= 4; y++) map.set(x, y, TileType.Building);
    expect(nearestStandable(map, 1, 1)).toEqual({ x: 1, y: 1 });
    const spot = nearestStandable(map, 3, 3)!;
    expect(Math.max(Math.abs(spot.x - 3), Math.abs(spot.y - 3))).toBe(2);
    expect(nearestStandable(map, 3, 3, 1)).toBeNull();
  });
});
