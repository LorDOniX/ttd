import { describe, expect, it } from 'vitest';
import { buildLine, buyTrain } from '../test/fixtures';
import { DEMOLISH_REFUND, WAYPOINT_COST } from './balance';
import { parseSave, restoreGame, serializeGame } from './save';
import { orderFlags, ordersError } from './trains';
import type { Game } from './game';

// Rovná kolej na trati mezi A a B, kam jde průjezdný bod
function straightTile(game: Game): { x: number; y: number } {
  const { rail } = game.world;
  for (let x = 15; x < 36; x++) {
    for (let y = 8; y < 22; y++) if (rail.waypointAxis(x, y)) return { x, y };
  }
  throw new Error('Na trati není rovná kolej');
}

describe('průjezdné body', () => {
  it('staví se jen na rovnou kolej, druhým kliknutím se odstraní', () => {
    const { game } = buildLine();
    const { rail } = game.world;
    expect(game.construction.toggleWaypoint(1, 1)).toMatch(/rovnou kolej/);
    const tile = straightTile(game);
    const money = game.money;
    expect(game.construction.toggleWaypoint(tile.x, tile.y)).toBeNull();
    expect(game.money).toBe(money - WAYPOINT_COST);
    const waypoint = rail.waypointAt(tile.x, tile.y)!;
    expect(waypoint.name).toMatch(/bod 1$/);
    // Na bod nejde výhybka ani návěstidlo
    const other = waypoint.axis === 'x' ? 0 : 1;
    expect(rail.canPlace(tile.x, tile.y, other)).toBe(false);
    expect(rail.canPlaceSignal(tile.x, tile.y)).toBe(false);
    expect(game.construction.toggleWaypoint(tile.x, tile.y)).toBeNull();
    expect(rail.waypointAt(tile.x, tile.y)).toBeUndefined();
    expect(game.money).toBe(money - WAYPOINT_COST + WAYPOINT_COST * DEMOLISH_REFUND);
  });

  it('vlak bodem z řádu projede bez zastavení a pokračuje k další zastávce', () => {
    const { game, a, b, depot } = buildLine();
    const tile = straightTile(game);
    game.construction.toggleWaypoint(tile.x, tile.y);
    const waypoint = game.world.rail.waypointAt(tile.x, tile.y)!;
    const train = buyTrain(game, depot, 2);
    expect(game.fleet.start(train, [a.id, waypoint.id, b.id], [{}, { waypoint: true }, {}])).toBeNull();
    expect(game.fleet.orderName(train, 1)).toBe(waypoint.name);
    a.waiting = 30;
    let stoppedAtWaypoint = false;
    let passed = false;
    let delivered = false;
    game.events.on('news', (text) => (delivered ||= /do stanice B/.test(text)));
    for (let i = 0; i < 40_000 && !delivered; i++) {
      game.update(200);
      const flags = orderFlags(train, train.target);
      if (flags.waypoint && train.state === 'loading') stoppedAtWaypoint = true;
      if (train.target === 2) passed = true;
    }
    expect(passed).toBe(true);
    expect(delivered).toBe(true);
    expect(stoppedAtWaypoint).toBe(false);
  });

  it('bod v řádu se nepočítá jako zastávka a nejde zbourat', () => {
    expect(ordersError([1, 5], [{}, { waypoint: true }])).toMatch(/dvě zastávky/);
    expect(ordersError([1, 5, 5, 2], [{}, { waypoint: true }, { waypoint: true }, {}])).toMatch(/průjezdný bod/);
    expect(ordersError([1, 5, 2], [{}, { waypoint: true }, {}])).toBeNull();
    const { game, a, b, depot } = buildLine();
    const tile = straightTile(game);
    game.construction.toggleWaypoint(tile.x, tile.y);
    const waypoint = game.world.rail.waypointAt(tile.x, tile.y)!;
    const train = buyTrain(game, depot, 1);
    game.fleet.start(train, [a.id, waypoint.id, b.id], [{}, { waypoint: true }, {}]);
    expect(game.construction.toggleWaypoint(tile.x, tile.y)).toMatch(/jízdním řádu/);
    expect(game.fleet.demolitionBlocker(tile.x, tile.y)).toMatch(/jízdním řádu|stojí/);
  });

  it('zbouráním koleje zmizí i bod; body se uloží a načtou', () => {
    const { game } = buildLine();
    const tile = straightTile(game);
    game.construction.toggleWaypoint(tile.x, tile.y);
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.world.rail.waypoints).toEqual(game.world.rail.waypoints);
    expect(copy.world.rail.nextWaypointId).toBe(game.world.rail.nextWaypointId);
    game.world.rail.removeTrack(tile.x, tile.y);
    expect(game.world.rail.waypoints).toHaveLength(0);
  });
});
