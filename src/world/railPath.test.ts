import { describe, expect, it } from 'vitest';
import { assertContinuous, emptyGame, layTrack } from '../test/fixtures';
import { TileType } from './map';
import { Edge, PIECES, defaultStationShape, isCorner } from './rail';
import { diagonalPath, findTrackPath, pieceAtCursor, singlePieceStep, type PathStep } from './railPath';

const WE = 1;

describe('hledání trasy kolejí', () => {
  it('rovná trasa vede jen rovnými kusy', () => {
    const { world } = emptyGame();
    const path = findTrackPath(world.rail, { x: 5, y: 5 }, { x: 15, y: 5 })!;
    expect(path).toHaveLength(11);
    expect(path.every((s) => s.piece === WE)).toBe(true);
  });

  it('diagonála a zatáčka do L jsou spojité a bez ostrých zatáček', () => {
    const { world } = emptyGame();
    for (const [from, to] of [
      [
        { x: 5, y: 20 },
        { x: 15, y: 30 },
      ],
      [
        { x: 30, y: 5 },
        { x: 45, y: 11 },
      ],
    ]) {
      const path = findTrackPath(world.rail, from, to)!;
      expect(path).not.toBeNull();
      assertContinuous(path);
      expect(isCorner(path[0].piece)).toBe(false);
      expect(isCorner(path[path.length - 1].piece)).toBe(false);
    }
  });

  it('existující kolej se znovu nepočítá jako nová', () => {
    const game = emptyGame();
    layTrack(game, { x: 5, y: 5 }, { x: 15, y: 5 });
    const path = findTrackPath(game.world.rail, { x: 5, y: 5 }, { x: 20, y: 5 })!;
    expect(path.filter((s) => s.isNew)).toHaveLength(5);
  });

  it('malé jezero objede, přes řeku postaví rovný most', () => {
    const lake = emptyGame();
    for (let y = 25; y < 35; y++) for (let x = 20; x < 24; x++) lake.world.map.set(x, y, TileType.Water);
    const around = findTrackPath(lake.world.rail, { x: 10, y: 30 }, { x: 34, y: 30 })!;
    expect(around.some((s) => lake.world.map.get(s.x, s.y) === TileType.Water)).toBe(false);

    const river = emptyGame();
    for (let y = 0; y < 64; y++) for (let x = 20; x < 24; x++) river.world.map.set(x, y, TileType.Water);
    const across = findTrackPath(river.world.rail, { x: 10, y: 30 }, { x: 34, y: 30 })!;
    const bridge = across.filter((s) => river.world.map.get(s.x, s.y) === TileType.Water);
    expect(bridge).toHaveLength(4);
    expect(bridge.every((s) => !isCorner(s.piece))).toBe(true);
  });

  it('do nástupiště vjede jen podélně', () => {
    const { world } = emptyGame();
    world.rail.addStation({ ...defaultStationShape(20, 30, 'x'), name: 'S', townId: 0 });
    const path = findTrackPath(world.rail, { x: 20, y: 40 }, { x: 21, y: 30 })!;
    assertContinuous(path);
    expect(path[path.length - 1].piece).toBe(WE);
  });

  it('depem nejde projet', () => {
    const { world } = emptyGame();
    world.rail.addDepot(10, 20, Edge.E);
    const path = findTrackPath(world.rail, { x: 5, y: 20 }, { x: 15, y: 20 })!;
    expect(path.some((s) => s.x === 10 && s.y === 20)).toBe(false);
  });

  it('jeden dílek: rovný podle polohy kurzoru, v rohu dlaždice zatáčka', () => {
    expect(pieceAtCursor(0.9, 0.55)).toBe(WE);
    expect(pieceAtCursor(0.45, 0.1)).toBe(0);
    expect(PIECES[pieceAtCursor(0.1, 0.1)]).toEqual([Edge.W, Edge.N]);
    expect(PIECES[pieceAtCursor(0.9, 0.9)]).toEqual([Edge.E, Edge.S]);
  });

  it('jeden dílek na silnici položí jen přejezd, existující kus není nový', () => {
    const game = emptyGame();
    const { world } = game;
    for (let x = 0; x < 64; x++) world.map.set(x, 10, TileType.Road);
    // Kurzor míří podél silnice, položí se kolmý přejezd
    expect(singlePieceStep(world.rail, { x: 5, y: 10 }, 0.9, 0.5)).toMatchObject({ piece: 0, isNew: true });
    layTrack(game, { x: 20, y: 20 }, { x: 25, y: 20 });
    expect(singlePieceStep(world.rail, { x: 22, y: 20 }, 0.8, 0.5)).toMatchObject({ piece: WE, isNew: false });
    world.map.set(30, 30, TileType.Building);
    expect(singlePieceStep(world.rail, { x: 30, y: 30 }, 0.5, 0.5)).toBeNull();
  });

  it('tažení z rohu dlaždice staví diagonálu jen z rohových kusů ve směru tažení', () => {
    const { world } = emptyGame();
    const corner = (path: PathStep[]): boolean => path.every((s) => isCorner(s.piece));
    // Z rohu S–V po jeho vlastní ose (1, −1): první kus je zatáčka pod kurzorem
    const own = diagonalPath(world.rail, { x: 20, y: 20, fx: 0.9, fy: 0.9 }, { x: 25, y: 15, fx: 0.9, fy: 0.9 })!;
    expect(own).toHaveLength(11);
    expect(own[0]).toMatchObject({ x: 20, y: 20, piece: pieceAtCursor(0.9, 0.9) });
    expect(own.at(-1)).toMatchObject({ x: 25, y: 15 });
    expect(corner(own)).toBe(true);
    assertContinuous(own);
    // Z téhož rohu po druhé ose (1, 1) i opačným směrem
    for (const end of [
      { x: 25, y: 25, fx: 0.9, fy: 0.9 },
      { x: 16, y: 16, fx: 0.5, fy: 0.5 },
    ]) {
      const path = diagonalPath(world.rail, { x: 20, y: 20, fx: 0.9, fy: 0.9 }, end)!;
      expect(path.length).toBeGreaterThan(5);
      expect(corner(path)).toBe(true);
      assertContinuous(path);
    }
    // Tažení ze středu dlaždice diagonálu nestaví
    expect(diagonalPath(world.rail, { x: 20, y: 20, fx: 0.5, fy: 0.5 }, { x: 25, y: 25, fx: 0.5, fy: 0.5 })).toBeNull();
  });

  it('diagonála přes vodu nevede', () => {
    const { world } = emptyGame();
    world.map.set(22, 18, TileType.Water);
    world.map.set(22, 17, TileType.Water);
    expect(diagonalPath(world.rail, { x: 20, y: 20, fx: 0.9, fy: 0.9 }, { x: 25, y: 15, fx: 0.9, fy: 0.9 })).toBeNull();
  });
});
