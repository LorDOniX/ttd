import { describe, expect, it } from 'vitest';
import { GameMap, HEIGHT_STEP } from './map';
import { emptyGame } from '../test/fixtures';
import { parseSave, restoreGame, serializeGame } from '../game/save';
import { Edge, axisPiece } from './rail';
import { groundAt, type Segment } from './route';

// Kopec: rohy (5..7, 5..7) na úrovni 1, prostřední roh (6, 6) na úrovni 2
function hill(): GameMap {
  const map = new GameMap(16, 16);
  for (let cy = 5; cy <= 7; cy++) for (let cx = 5; cx <= 7; cx++) map.setCornerLevel(cx, cy, 1);
  map.setCornerLevel(6, 6, 2);
  return map;
}

describe('výška terénu', () => {
  it('výchozí mapa je rovina na úrovni 0', () => {
    const map = new GameMap(8, 8);
    expect(map.slope(3, 3)).toEqual({ kind: 'flat', level: 0 });
    expect(map.heightAt(3.5, 3.5)).toBe(0);
    expect(map.maxLevel()).toBe(0);
  });

  it('svah: rovina, nakloněná rovina se směrem stoupání, jiný tvar', () => {
    const map = new GameMap(8, 8);
    // Dlaždice (2, 2): severní rohy o úroveň výš → stoupá k severu
    map.setCornerLevel(2, 2, 1);
    map.setCornerLevel(3, 2, 1);
    expect(map.slope(2, 2)).toEqual({ kind: 'incline', level: 0, up: 0 });
    // Sousední dlaždice nad ní (2, 1) má jižní rohy na 1, severní na 0 → stoupá k jihu
    expect(map.slope(2, 1)).toEqual({ kind: 'incline', level: 0, up: 2 });
    map.setCornerLevel(3, 3, 1);
    map.setCornerLevel(3, 2, 1);
    expect(map.slope(3, 2)).toEqual({ kind: 'incline', level: 0, up: 3 });
    map.setCornerLevel(4, 2, 1);
    map.setCornerLevel(4, 3, 1);
    expect(map.slope(3, 2)).toEqual({ kind: 'flat', level: 1 });
    map.setCornerLevel(5, 5, 1);
    expect(map.slope(4, 4).kind).toBe('other');
    expect(map.isFlat(3, 2)).toBe(true);
  });

  it('výška bodu sleduje trojúhelníky dlaždice a změna rohu se zapíše jako změna dlaždic', () => {
    const map = hill();
    expect(map.heightAt(5, 5)).toBeCloseTo(HEIGHT_STEP);
    expect(map.heightAt(6, 6)).toBeCloseTo(2 * HEIGHT_STEP);
    expect(map.heightAt(5.5, 5.5)).toBeCloseTo(1.5 * HEIGHT_STEP);
    expect(map.tileLevel(5, 5)).toBe(1);
    expect(map.elevation(5, 5)).toBeCloseTo(HEIGHT_STEP);
    const cursor = map.changeCursor;
    map.setCornerLevel(6, 6, 1);
    expect(new Set(map.changesSince(cursor))).toEqual(new Set([5 * 16 + 5, 5 * 16 + 6, 6 * 16 + 5, 6 * 16 + 6]));
  });

  it('uložení zachová výšky; starší uložení je rovina', () => {
    const game = emptyGame(16);
    game.world.map.setCornerLevel(4, 4, 1);
    const data = serializeGame(game, 'x');
    expect(restoreGame(parseSave(JSON.stringify(data))).world.map.cornerLevel(4, 4)).toBe(1);
    const legacy = JSON.parse(JSON.stringify(data));
    delete legacy.map.heights;
    expect(restoreGame(parseSave(JSON.stringify(legacy))).world.map.cornerLevel(4, 4)).toBe(0);
  });

  it('kolej ve svahu stoupá s terénem, pole mostu vede rovně mezi nájezdy', () => {
    const game = emptyGame(16, []);
    const { map } = game.world;
    // Rampa podél x: rohy x <= 4 na úrovni 0, x = 5 na 1, x >= 6 na 2
    for (let y = 0; y <= 16; y++)
      for (let x = 0; x <= 16; x++) map.setCornerLevel(x, y, Math.max(0, Math.min(2, x - 4)));
    const piece = axisPiece('x');
    const path: Segment[] = [3, 4, 5, 6].map((x) => ({ x, y: 2, piece, entry: Edge.W, exit: Edge.E }));
    expect(groundAt(game.world.rail, path, 0.5)).toBe(0);
    expect(groundAt(game.world.rail, path, 1.5)).toBeCloseTo(0.5 * HEIGHT_STEP);
    expect(groundAt(game.world.rail, path, 2.5)).toBeCloseTo(1.5 * HEIGHT_STEP);
    expect(groundAt(game.world.rail, path, 3.5)).toBeCloseTo(2 * HEIGHT_STEP);
    // Pole mostu přes údolí: výška se mění jen lineárně mezi konci, ne podle terénu pod ním
    map.setCornerLevel(9, 2, 0);
    map.setCornerLevel(9, 3, 0);
    const span: Segment[] = [{ x: 7, y: 2, piece, entry: Edge.W, exit: Edge.E, span: 4 }];
    expect(groundAt(game.world.rail, span, 2)).toBeCloseTo(2 * HEIGHT_STEP);
  });
});
