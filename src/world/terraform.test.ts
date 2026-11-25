import { describe, expect, it } from 'vitest';
import { emptyGame, layTrack } from '../test/fixtures';
import { TERRAFORM_CORNER_COST } from '../game/balance';
import { TileType } from './map';
import { areaCorners, nearestCorner, planTerraform } from './terraform';

describe('úpravy terénu', () => {
  it('zvednutí rohu dorovná okolí a zaplatí každý změněný roh', () => {
    const game = emptyGame(32, []);
    game.money = 1_000_000;
    const { map } = game.world;
    const corner = nearestCorner(10, 10, 0.9, 0.8);
    expect(corner).toEqual({ x: 11, y: 11 });
    expect(game.construction.terraform([corner], 'raise')).toBeNull();
    expect(map.cornerLevel(11, 11)).toBe(1);
    expect(map.slope(10, 10).kind).toBe('other');
    // Druhé zvednutí: roh na 2, osm sousedů dorovnáno na 1
    const before = game.money;
    expect(game.construction.terraform([corner], 'raise')).toBeNull();
    expect(map.cornerLevel(11, 11)).toBe(2);
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ])
      expect(map.cornerLevel(11 + dx, 11 + dy)).toBe(1);
    expect(before - game.money).toBe(9 * TERRAFORM_CORNER_COST);
  });

  it('oblast: zvednout, snížit a srovnat na úroveň výchozího rohu', () => {
    const game = emptyGame(32, []);
    game.money = 10_000_000;
    const { map } = game.world;
    expect(game.construction.terraform(areaCorners(5, 5, 8, 7), 'raise')).toBeNull();
    expect(game.construction.terraform(areaCorners(5, 5, 8, 7), 'raise')).toBeNull();
    for (let y = 5; y <= 7; y++)
      for (let x = 5; x <= 8; x++) expect(map.slope(x, y)).toEqual({ kind: 'flat', level: 2 });
    expect(map.slope(4, 6).kind).toBe('incline');
    expect(game.construction.terraform(areaCorners(6, 6, 6, 6), 'lower')).toBeNull();
    expect(map.slope(6, 6)).toEqual({ kind: 'flat', level: 1 });
    // Srovnat celé okolí na úroveň 0 (výchozí roh mimo kopec)
    expect(game.construction.terraform(areaCorners(2, 2, 12, 12), 'level', 0)).toBeNull();
    expect(map.maxLevel()).toBe(0);
    expect(game.construction.terraform(areaCorners(2, 2, 3, 3), 'level', 0)).toBe('Terén už je srovnaný.');
  });

  it('pod kolejí, u vody, pod nulou a bez peněz terén měnit nejde', () => {
    const game = emptyGame(32, []);
    game.money = 1_000_000;
    const { map } = game.world;
    layTrack(game, { x: 3, y: 10 }, { x: 12, y: 10 });
    expect(game.construction.terraform([{ x: 6, y: 10 }], 'raise')).toBe(
      'Nejdřív je třeba odstranit stavbu, kolej nebo silnici.',
    );
    // Zvednutí dál od koleje se dorovnáním dotkne jen trávy
    expect(planTerraform(map, [{ x: 6, y: 13 }], 'raise').problem).toBeNull();
    map.set(20, 20, TileType.Water);
    expect(game.construction.terraform([{ x: 21, y: 21 }], 'raise')).toBe('Terén u vody zůstane na úrovni hladiny.');
    expect(game.construction.terraform([{ x: 25, y: 25 }], 'lower')).toBe('Níž terén snížit nejde.');
    game.money = 0;
    expect(game.construction.terraform([{ x: 25, y: 25 }], 'raise')).toMatch(/Nedostatek peněz/);
    expect(map.cornerLevel(25, 25)).toBe(0);
  });
});
