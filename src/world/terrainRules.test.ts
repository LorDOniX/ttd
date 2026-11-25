import { describe, expect, it } from 'vitest';
import { emptyGame, layTrack, makeTown } from '../test/fixtures';
import { TileType } from './map';
import { Edge, PIECES, axisPiece, defaultStationShape } from './rail';
import { findRoadPath } from './roadPath';
import { roadMoves } from './roadRoute';
import { industrySiteProblem } from './industry';
import { createTownShape, expandTown } from './town';
import { Rng } from './rng';
import { roadConnects } from '../render/roads';
import { hillSpeed, trainClimb, type Train } from '../game/trains';
import type { Segment } from './route';

// Rampa podél x: rohy x <= 10 na úrovni 0, x = 11 na 1, x >= 12 na 2 → dlaždice 10 a 11 stoupají k východu
function rampGame() {
  const game = emptyGame(32, []);
  game.money = 100_000_000;
  const { map } = game.world;
  for (let y = 0; y <= 32; y++)
    for (let x = 0; x <= 32; x++) map.setCornerLevel(x, y, Math.max(0, Math.min(2, x - 10)));
  return game;
}

describe('pravidla stavby na svazích', () => {
  it('ve svahu jde jen rovná kolej ve směru stoupání; autorail tak vede trasu', () => {
    const game = rampGame();
    const { rail, map } = game.world;
    expect(map.slope(10, 5)).toEqual({ kind: 'incline', level: 0, up: Edge.E });
    expect(rail.canPlace(10, 5, axisPiece('x'))).toBe(true);
    expect(rail.canPlace(10, 5, axisPiece('y'))).toBe(false);
    const corner = PIECES.findIndex(([a, b]) => (a === Edge.N && b === Edge.E) || (a === Edge.E && b === Edge.N));
    expect(rail.canPlace(10, 5, corner)).toBe(false);
    expect(rail.canPlace(13, 5, corner)).toBe(true);
    // Šikmá trasa přes svah: na svahu jen rovné kusy podél x
    const path = layTrack(game, { x: 4, y: 2 }, { x: 18, y: 10 });
    for (const step of path.filter((s) => s.x === 10 || s.x === 11)) expect(step.piece).toBe(axisPiece('x'));
  });

  it('nástupiště, depo, zastávka a garáž jen na rovině', () => {
    const game = rampGame();
    game.world.towns.push(makeTown(0, 24, 24));
    const { construction } = game;
    expect(construction.buildStation(defaultStationShape(10, 5, 'x'))).toBe('Nástupiště potřebuje rovný terén.');
    expect(construction.buildStation(defaultStationShape(14, 5, 'x'))).toBeNull();
    expect(construction.buildDepot(11, 8, Edge.E)).toBe('Depo potřebuje rovný terén.');
    expect(construction.buildRoadDepot(10, 12, Edge.W)).toBe('Garáž potřebuje rovný terén.');
    expect(construction.buildRoadDepot(5, 12, Edge.W)).toBeNull();
  });

  it('město staví silnice i domy jen na rovině', () => {
    const game = rampGame();
    const { map } = game.world;
    const rng = new Rng(3);
    const town = { ...makeTown(0, 8, 16, 3000), shape: createTownShape(rng) };
    expandTown(map, town, 1950, rng);
    expect(town.buildings.length).toBeGreaterThan(0);
    for (const b of town.buildings) expect(map.isFlat(b.x, b.y)).toBe(true);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) if (map.isRoad(x, y)) expect(map.isFlat(x, y)).toBe(true);
    }
  });

  it('průmysl jen na rovině', () => {
    const game = rampGame();
    const { map, towns, industries } = game.world;
    expect(industrySiteProblem(map, towns, industries, 'coal-mine', 9, 14)).toBe('Areál potřebuje rovný terén');
  });

  it('silnice ve svahu jen nahoru a dolů; hledání silnice svah projede rovně', () => {
    const game = rampGame();
    const { map, rail } = game.world;
    for (const [x, y] of [
      [9, 5],
      [10, 5],
      [11, 5],
      [10, 4],
      [10, 6],
    ])
      map.set(x, y, TileType.Road);
    const moves = roadMoves(rail, 10, 5).map((t) => `${t.x},${t.y}`);
    expect(moves.sort()).toEqual(['11,5', '9,5']);
    const connects = roadConnects(map, rail);
    expect(connects(10, 5, Edge.N)).toBe(false);
    expect(connects(10, 5, Edge.E)).toBe(true);
    const steps = findRoadPath(rail, { x: 5, y: 20 }, { x: 16, y: 26 })!;
    expect(steps).not.toBeNull();
    const onSlope = steps.filter((s) => s.x === 10 || s.x === 11);
    expect(new Set(onSlope.map((s) => s.y)).size).toBe(1);
  });

  it('most: nájezdy na rovině ve stejné výšce a terén pod polem níž', () => {
    const game = rampGame();
    const { map, rail } = game.world;
    expect(rail.bridgeProblem(8, 5, 13, 5)).toBe('Nájezdy mostu musí být ve stejné výšce.');
    expect(rail.bridgeProblem(10, 8, 13, 8)).toBe('Nájezdy mostu musí stát na rovném terénu.');
    expect(rail.bridgeProblem(2, 20, 8, 20)).toBeNull();
    map.setCornerLevel(5, 20, 1);
    expect(rail.bridgeProblem(2, 20, 8, 20)).toBe('Terén pod mostem je výš než nájezdy.');
    expect(rail.roadBridgeProblem(2, 20, 8, 20)).toBe('Terén pod mostem je výš než nájezdy.');
  });

  it('vlak do kopce zpomalí (víc s více vozy), z kopce a po rovině jede plnou rychlostí', () => {
    const game = rampGame();
    const { rail, map } = game.world;
    // Delší svah: rohy x = 10..18 stoupají o úroveň na dlaždici
    for (let y = 0; y <= 32; y++)
      for (let x = 0; x <= 32; x++) map.setCornerLevel(x, y, Math.max(0, Math.min(8, x - 10)));
    const piece = axisPiece('x');
    const east: Segment[] = [];
    for (let x = 3; x <= 20; x++) east.push({ x, y: 5, piece, entry: Edge.W, exit: Edge.E });
    // Hlava v půlce dlaždice 14, celá souprava (i delší) stojí ve svahu
    const up = { path: east, pos: 14.5 - 3, wagons: 2 } as unknown as Train;
    expect(trainClimb(up, rail)).toBeCloseTo(1);
    expect(hillSpeed(up, rail, 10)).toBeCloseTo(10 * (1 - 0.32));
    const heavy = { ...up, wagons: 6 } as unknown as Train;
    expect(hillSpeed(heavy, rail, 10)).toBeLessThan(hillSpeed(up, rail, 10));
    const flat = { path: east, pos: 6, wagons: 2 } as unknown as Train;
    expect(hillSpeed(flat, rail, 10)).toBe(10);
    const west: Segment[] = [...east].reverse().map((s) => ({ ...s, entry: Edge.E, exit: Edge.W }));
    const down = { path: west, pos: 21 - 14.5, wagons: 2 } as unknown as Train;
    expect(trainClimb(down, rail)).toBeLessThan(0);
    expect(hillSpeed(down, rail, 10)).toBe(10);
  });
});
