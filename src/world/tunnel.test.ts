import { describe, expect, it } from 'vitest';
import { TUNNEL_PIECE_COST } from '../game/balance';
import { parseSave, restoreGame, serializeGame } from '../game/save';
import { emptyGame } from '../test/fixtures';
import { HEIGHT_STEP, TileType } from './map';
import { Edge, PIECES } from './rail';
import { findRoadRoute } from './roadRoute';
import { findRoute, groundAt, heightAt, inTunnelAt, pathLength } from './route';

const WE = PIECES.findIndex(([a, b]) => a === Edge.W && b === Edge.E);

// Hřbet napříč mapou: rohy x <= 8 na 0, x = 9 na 1, x = 10..14 na 2, x = 15 na 1, x >= 16 na 0.
// Dlaždice 8 a 15 jsou svahy úrovně 0 (portály), 9 a 14 svahy úrovně 1, 10..13 rovina úrovně 2
function ridgeGame() {
  const game = emptyGame(32, []);
  game.money = 10_000_000;
  const { map } = game.world;
  for (let cy = 0; cy <= 32; cy++) {
    for (let cx = 0; cx <= 32; cx++) map.setCornerLevel(cx, cy, Math.max(0, Math.min(2, cx - 8, 16 - cx)));
  }
  return game;
}

describe('tunely', () => {
  it('tunel vede od portálu rovně do kopce k protějšímu svahu ve stejné výšce', () => {
    const { world } = ridgeGame();
    const { rail } = world;
    expect(rail.tunnelShape(8, 5, false)).toMatchObject({ x: 8, y: 5, dir: Edge.E, span: 6, tunnel: true });
    expect(rail.tunnelShape(15, 5, false)).toMatchObject({ x: 15, y: 5, dir: Edge.W, span: 6 });
    expect(rail.tunnelShape(9, 5, false)).toMatchObject({ dir: Edge.E, span: 4 });
    expect(rail.tunnelShape(5, 5, false)).toBe('Portál tunelu musí stát na rovném svahu.');
    // Za portálem krátká plošina a pak terén klesá zpět na úroveň portálu, ale ne protějším svahem
    for (const cx of [20, 21]) for (const cy of [5, 6]) world.map.setCornerLevel(cx, cy, 1);
    world.map.setCornerLevel(22, 6, 1);
    expect(rail.tunnelShape(19, 5, false)).toBe('Tunel by vyšel na povrch: na druhé straně není svah ve stejné výšce.');
  });

  it('vlak projede tunelem pod kopcem, v tunelu není vidět a jede ve výšce portálu', () => {
    const game = ridgeGame();
    const { rail, map } = game.world;
    const before = game.money;
    expect(game.construction.tunnelPlan(8, 5, false).cost).toBe(6 * TUNNEL_PIECE_COST + 2 * 5_000);
    expect(game.construction.buildTunnel(8, 5)).toBeNull();
    expect(before - game.money).toBe(6 * TUNNEL_PIECE_COST + 2 * 5_000);
    expect(rail.has(8, 5, WE) && rail.has(15, 5, WE)).toBe(true);
    // Na povrchu nad tunelem zůstane tráva a jde tam stavět
    expect(map.isType(11, 5, TileType.Grass)).toBe(true);
    expect(rail.tunnelUnder(11, 5)).toBeDefined();
    for (let x = 3; x <= 7; x++) rail.addPiece(x, 5, WE);
    for (let x = 16; x <= 20; x++) rail.addPiece(x, 5, WE);
    const path = findRoute(rail, { x: 3, y: 5, exit: Edge.E, heading: 0 }, (x, y) => x === 20 && y === 5, {
      x: 20,
      y: 5,
    })!;
    expect(path).not.toBeNull();
    expect(path.find((s) => s.span)).toMatchObject({ x: 9, span: 6 });
    expect(pathLength(path)).toBe(17);
    // Trasa začíná za dlaždicí 3: portál 8 je d 4..5, tunel 5..11, portál 15 je 11..12.
    // Portál i tunel jsou rovně ve výšce portálu (úroveň 0), bez rampy mostu
    for (const d of [4.2, 4.8, 8, 11.8]) {
      expect(groundAt(rail, path, d)).toBe(0);
      expect(heightAt(rail, path, d)).toBe(0);
    }
    expect(inTunnelAt(rail, path, 4.2)).toBe(false);
    expect(inTunnelAt(rail, path, 4.8)).toBe(true);
    expect(inTunnelAt(rail, path, 9)).toBe(true);
    expect(inTunnelAt(rail, path, 11.2)).toBe(true);
    expect(inTunnelAt(rail, path, 11.8)).toBe(false);
  });

  it('silniční tunel: auta jím projedou, portály se stanou silnicí', () => {
    const game = ridgeGame();
    const { rail, map } = game.world;
    for (let x = 3; x <= 7; x++) map.set(x, 9, TileType.Road);
    for (let x = 16; x <= 20; x++) map.set(x, 9, TileType.Road);
    expect(game.construction.buildTunnel(8, 9, true)).toBeNull();
    expect(map.isType(8, 9, TileType.Road) && map.isType(15, 9, TileType.Road)).toBe(true);
    const route = findRoadRoute(rail, { x: 3, y: 9 }, (x, y) => x === 20 && y === 9)!;
    expect(route).not.toBeNull();
    expect(route.filter((t) => t.tunnel).map((t) => t.x)).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it('nad tunelem nejde měnit terén; demolice portálu zboří tunel; uložení tunel zachová', () => {
    const game = ridgeGame();
    const { rail } = game.world;
    expect(game.construction.buildTunnel(8, 5)).toBeNull();
    expect(game.construction.terraform([{ x: 12, y: 6 }], 'lower')).toBe('Nad tunelem terén měnit nejde.');
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'tunel'))));
    expect(restored.world.rail.bridges).toHaveLength(1);
    expect(restored.world.rail.bridges[0]).toMatchObject({ x: 8, y: 5, span: 6, tunnel: true });
    expect(restored.world.map.cornerLevel(12, 5)).toBe(2);
    expect(game.construction.demolish([{ x: 15, y: 5 }])).toBeNull();
    expect(rail.bridges).toHaveLength(0);
    expect(rail.hasTrack(8, 5)).toBe(false);
    expect(game.world.map.tileLevel(12, 5) * HEIGHT_STEP).toBeCloseTo(2 * HEIGHT_STEP);
  });
});
