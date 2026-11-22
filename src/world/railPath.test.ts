import { describe, expect, it } from 'vitest';
import { DEPOT_COST, TRACK_PIECE_COST } from '../game/balance';
import { assertContinuous, emptyGame, layTrack } from '../test/fixtures';
import { TileType } from './map';
import { Edge, PIECES, defaultStationShape, isCorner } from './rail';
import {
  autorailLine,
  autorailPlan,
  depotLinks,
  findTrackPath,
  pieceAtCursor,
  removablePieceAt,
  singlePieceStep,
} from './railPath';

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

  it('autorail: tažení skoro vodorovně staví rovnou kolej v řadě začátku', () => {
    const line = autorailLine({ x: 10, y: 10, fx: 0.5, fy: 0.5 }, { x: 20, y: 12, fx: 0.5, fy: 0.5 });
    expect(line).toHaveLength(11);
    expect(line.every((p) => p.y === 10 && p.piece === WE)).toBe(true);
    const back = autorailLine({ x: 10, y: 10, fx: 0.5, fy: 0.5 }, { x: 10, y: 4, fx: 0.5, fy: 0.5 });
    expect(back.map((p) => p.y)).toEqual([10, 9, 8, 7, 6, 5, 4]);
    expect(back.every((p) => p.piece === 0)).toBe(true);
  });

  it('autorail: šikmé tažení staví úhlopříčku z rohových kusů, i když začne uprostřed dlaždice', () => {
    for (const [start, end] of [
      [
        { x: 20, y: 20, fx: 0.5, fy: 0.5 },
        { x: 25, y: 25, fx: 0.5, fy: 0.5 },
      ],
      [
        { x: 20, y: 20, fx: 0.7, fy: 0.3 },
        { x: 26, y: 24, fx: 0.5, fy: 0.5 },
      ],
      [
        { x: 20, y: 20, fx: 0.9, fy: 0.9 },
        { x: 25, y: 15, fx: 0.9, fy: 0.9 },
      ],
      [
        { x: 20, y: 20, fx: 0.2, fy: 0.2 },
        { x: 14, y: 26, fx: 0.5, fy: 0.5 },
      ],
    ]) {
      const line = autorailLine(start, end).map((p) => ({ ...p, isNew: true }));
      expect(line.length).toBeGreaterThan(8);
      expect(line.every((p) => isCorner(p.piece))).toBe(true);
      expect(line[0]).toMatchObject({ x: start.x, y: start.y });
      assertContinuous(line);
      // Přesně šikmé tažení skončí u kurzoru, jinak se konec přichytí na úhlopříčku
      const last = line[line.length - 1];
      const exact = Math.abs(end.x - start.x) === Math.abs(end.y - start.y);
      expect(Math.abs(last.x - end.x) + Math.abs(last.y - end.y)).toBeLessThanOrEqual(exact ? 1 : 2);
    }
    // Poloha kurzoru na začátku vybere jednu ze dvou rovnoběžných řad
    const upper = autorailLine({ x: 20, y: 20, fx: 0.8, fy: 0.2 }, { x: 24, y: 24, fx: 0.5, fy: 0.5 });
    const lower = autorailLine({ x: 20, y: 20, fx: 0.2, fy: 0.8 }, { x: 24, y: 24, fx: 0.5, fy: 0.5 });
    expect(PIECES[upper[0].piece]).toEqual([Edge.N, Edge.E]);
    expect(PIECES[lower[0].piece]).toEqual([Edge.S, Edge.W]);
  });

  it('autorail se zastaví na první překážce, zbytek označí', () => {
    const { world } = emptyGame();
    world.map.set(15, 10, TileType.Building);
    const plan = autorailPlan(world.rail, { x: 10, y: 10, fx: 0.5, fy: 0.5 }, { x: 20, y: 10, fx: 0.5, fy: 0.5 });
    expect(plan.steps.map((s) => s.x)).toEqual([10, 11, 12, 13, 14]);
    expect(plan.blocked).toHaveLength(6);
    // Úhlopříčka přes vodu nevede (most jen rovně)
    world.map.set(22, 22, TileType.Water);
    const diag = autorailPlan(world.rail, { x: 20, y: 20, fx: 0.5, fy: 0.5 }, { x: 26, y: 26, fx: 0.5, fy: 0.5 });
    expect(diag.blocked.length).toBeGreaterThan(0);
    expect(diag.steps.every((s) => world.map.get(s.x, s.y) !== TileType.Water)).toBe(true);
  });

  it('autorail s Ctrl odebírá jen postavené kusy, dlaždice bez koleje je zase tráva', () => {
    const game = emptyGame();
    const { rail, map } = game.world;
    layTrack(game, { x: 10, y: 10 }, { x: 14, y: 10 });
    const plan = autorailPlan(rail, { x: 8, y: 10, fx: 0.5, fy: 0.5 }, { x: 12, y: 10, fx: 0.5, fy: 0.5 }, 'remove');
    expect(plan.steps.map((s) => s.x)).toEqual([10, 11, 12]);
    expect(game.construction.removeTrack(plan.steps)).toBeNull();
    expect(map.get(11, 10)).toBe(TileType.Grass);
    expect(rail.has(13, 10, WE)).toBe(true);
    expect(removablePieceAt(rail, { x: 13, y: 10, fx: 0.1, fy: 0.1 })).toMatchObject({ piece: WE });
  });

  it('depem přímka neprojede zadní stěnou, vjezdem se napojí', () => {
    const { world } = emptyGame();
    world.rail.addDepot(15, 10, Edge.E);
    const through = autorailPlan(world.rail, { x: 10, y: 10, fx: 0.5, fy: 0.5 }, { x: 20, y: 10, fx: 0.5, fy: 0.5 });
    expect(through.steps.map((s) => s.x)).toEqual([10, 11, 12, 13, 14]);
    const into = autorailPlan(world.rail, { x: 20, y: 10, fx: 0.5, fy: 0.5 }, { x: 15, y: 10, fx: 0.5, fy: 0.5 });
    expect(into.blocked).toHaveLength(0);
    expect(into.steps.at(-1)).toMatchObject({ x: 15, isNew: false });
  });

  it('depo postavené vjezdem ke kolmé koleji se na ni samo napojí výhybkami', () => {
    const game = emptyGame();
    const { rail } = game.world;
    layTrack(game, { x: 11, y: 15 }, { x: 11, y: 25 });
    const links = depotLinks(rail, 10, 20, Edge.E);
    expect(links.map((l) => PIECES[l.piece])).toEqual([
      [Edge.W, Edge.N],
      [Edge.S, Edge.W],
    ]);
    const before = game.money;
    expect(game.construction.buildDepot(10, 20, Edge.E)).toBeNull();
    expect(before - game.money).toBe(DEPOT_COST + 2 * TRACK_PIECE_COST);
    for (const link of links) expect(rail.has(link.x, link.y, link.piece)).toBe(true);
    // Z depa vede souvislá trasa na kolej oběma směry
    assertContinuous([{ x: 10, y: 20, piece: WE, isNew: false }, links[0], { x: 11, y: 19, piece: 0, isNew: false }]);
    // Konec koleje přímo před depem: napojí se jen tam, kam kolej pokračuje
    const end = emptyGame();
    layTrack(end, { x: 31, y: 20 }, { x: 31, y: 25 });
    expect(depotLinks(end.world.rail, 30, 20, Edge.E).map((l) => PIECES[l.piece])).toEqual([[Edge.S, Edge.W]]);
    // Kolej, která už k vjezdu vede, se nemění
    layTrack(end, { x: 40, y: 20 }, { x: 45, y: 20 });
    expect(depotLinks(end.world.rail, 39, 20, Edge.E)).toHaveLength(0);
  });

  it('kolej položená kolmo před existující depo se na něj napojí', () => {
    const { world } = emptyGame();
    world.rail.addDepot(10, 20, Edge.E);
    const plan = autorailPlan(world.rail, { x: 11, y: 15, fx: 0.5, fy: 0.5 }, { x: 11, y: 25, fx: 0.5, fy: 0.5 });
    const links = plan.steps.filter((s) => isCorner(s.piece));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.x === 11 && l.y === 20)).toBe(true);
  });
});
