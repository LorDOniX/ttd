import { describe, expect, it } from 'vitest';
import { DEMOLISH_REFUND, ROAD_BRIDGE_COST, ROAD_TILE_COST, ROAD_VEHICLE_MODELS } from './balance';
import type { Game } from './game';
import { safeVehiclePosition } from './roadVehicles';
import { parseSave, restoreGame, serializeGame } from './save';
import { addBuilding, emptyGame, layTrack, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
import { Edge, axisPiece } from '../world/rail';
import { findRoadRoute, roadElevation, roadMoves, roadSteps, type RoadTile } from '../world/roadRoute';

// Silnice y = 10 z x = 4 do 12 a z x = 18 do 28, mezi nimi tři koleje napříč (x = 14, 15, 16)
function railGap(): Game {
  const townA = makeTown(0, 6, 12);
  const townB = makeTown(1, 26, 12);
  const game = emptyGame(64, [townA, townB]);
  game.money = 10_000_000;
  addBuilding(game, townA, 6, 12);
  addBuilding(game, townB, 26, 12);
  const { map } = game.world;
  for (let x = 4; x <= 12; x++) map.set(x, 10, TileType.Road);
  for (let x = 18; x <= 28; x++) map.set(x, 10, TileType.Road);
  for (const x of [14, 15, 16]) layTrack(game, { x, y: 2 }, { x, y: 20 });
  return game;
}

describe('silniční mosty přes koleje a silnice', () => {
  it('most přes koleje: cena, pole nad kolejemi, koleje pod ním zůstanou', () => {
    const game = railGap();
    const { map, rail } = game.world;
    expect(game.construction.roadBridgePlan(12, 10, 18, 10)).toEqual({
      cost: 5 * ROAD_BRIDGE_COST,
      problem: null,
      span: 5,
    });
    const money = game.money;
    expect(game.construction.buildRoadBridge(12, 10, 18, 10)).toBeNull();
    expect(money - game.money).toBe(5 * ROAD_BRIDGE_COST);
    for (let x = 13; x <= 17; x++) expect(map.isBridged(x, 10)).toBe(true);
    expect(map.get(15, 10)).toBe(TileType.Rail);
    expect(rail.roadBridgeAtHead(18, 10)).toBe(rail.roadBridges[0]);
    // Na nájezdu nejde přejezd ani zastávka, přes pole nejde jiný most
    expect(rail.canPlace(12, 10, axisPiece('y'))).toBe(false);
    expect(game.construction.buildRoadStop(12, 10)).not.toBeNull();
    expect(game.construction.bridgePlan(15, 8, 15, 12).problem).toBe('Mosty se nesmí křížit.');
  });

  it('nájezdy z volné země dostanou silnici; nájezd nesmí být na křižovatce a pod mostem nesmí stát budova', () => {
    const game = railGap();
    const { map } = game.world;
    const plan = game.construction.roadBridgePlan(13, 5, 17, 5);
    expect(plan.cost).toBe(3 * ROAD_BRIDGE_COST + 2 * ROAD_TILE_COST);
    expect(game.construction.buildRoadBridge(13, 5, 17, 5)).toBeNull();
    expect(map.get(13, 5)).toBe(TileType.Road);
    map.set(11, 11, TileType.Road);
    map.set(11, 9, TileType.Road);
    expect(game.construction.roadBridgePlan(11, 10, 11, 14).problem).toBe('Nájezd mostu nesmí být na křižovatce.');
    expect(game.construction.roadBridgePlan(6, 15, 6, 11).problem).toContain('Pod mostem nesmí');
  });

  it('auta jezdí po mostě, trasa vede po poli mostu ve výšce', () => {
    const game = railGap();
    const { rail } = game.world;
    expect(game.construction.buildRoadBridge(12, 10, 18, 10)).toBeNull();
    const route = findRoadRoute(rail, { x: 4, y: 10 }, (x, y) => x === 28 && y === 10)!;
    expect(route.filter((t) => t.level).map((t) => t.x)).toEqual([13, 14, 15, 16, 17]);
    expect(route).toHaveLength(25);
    expect(roadElevation(route, 7)).toBe(0);
    expect(roadElevation(route, 8)).toBe(0.5);
    expect(roadElevation(route, 8.25)).toBeCloseTo(0.75);
    expect(roadElevation(route, 11)).toBe(1);
    // Po zemi se z nájezdu dopředu nejede
    expect(roadMoves(rail, 12, 10)).toEqual([{ x: 11, y: 10 }]);
    expect(roadSteps(rail, { x: 12, y: 10 })).toEqual([
      { x: 11, y: 10 },
      { x: 13, y: 10, level: 1 },
    ]);

    game.construction.buildRoadStop(6, 10);
    game.construction.buildRoadStop(26, 10);
    game.construction.buildRoadDepot(4, 11, Edge.N);
    const [a, b] = rail.stations;
    a.waiting = 50;
    b.waiting = 50;
    expect(game.roadFleet.buy(rail.roadDepots[0], ROAD_VEHICLE_MODELS[0])).toBeNull();
    const bus = game.roadFleet.vehicles[0];
    expect(game.roadFleet.start(bus, [a.id, b.id])).toBeNull();
    let up = false;
    for (let i = 0; i < 200; i++) {
      runDays(game, 0.25);
      if (bus.state === 'running' && roadElevation(bus.path, bus.pos) === 1) up = true;
    }
    expect(up).toBe(true);
    expect(bus.income).toBeGreaterThan(0);
  });

  it('most přes silnici: provoz pod mostem jede dál po zemi', () => {
    const game = emptyGame();
    const { map, rail } = game.world;
    for (let y = 2; y <= 20; y++) map.set(15, y, TileType.Road);
    expect(game.construction.buildRoadBridge(14, 10, 16, 10)).toBeNull();
    expect(roadMoves(rail, 15, 10)).toEqual([
      { x: 15, y: 9 },
      { x: 15, y: 11 },
    ]);
    const under = findRoadRoute(rail, { x: 15, y: 2 }, (x, y) => x === 15 && y === 20)!;
    expect(under.every((t) => !t.level)).toBe(true);
    // Auto na mostě a auto pod ním se navzájem neblokují
    const over: RoadTile[] = [
      { x: 13, y: 10 },
      { x: 14, y: 10 },
      { x: 15, y: 10, level: 1 },
      { x: 16, y: 10 },
    ];
    const below = [
      { x: 15, y: 9 },
      { x: 15, y: 10 },
      { x: 15, y: 11 },
    ];
    expect(safeVehiclePosition(over, 1.5, 2.5, [{ path: below, pos: 1 }])).toBe(2.5);
    expect(safeVehiclePosition(below, 0.5, 1.5, [{ path: over, pos: 2 }])).toBe(1.5);
  });

  it('demolice nájezdu zboří most a vrátí část ceny, silnice zůstanou; auto na mostě ji zablokuje', () => {
    const game = railGap();
    const { map, rail } = game.world;
    expect(game.construction.buildRoadBridge(12, 10, 18, 10)).toBeNull();
    const route = findRoadRoute(rail, { x: 11, y: 10 }, (x, y) => x === 19 && y === 10)!;
    game.roadFleet.vehicles.push({
      ...game.roadFleet.vehicles[0],
      id: 99,
      name: 'Auto 99',
      state: 'running',
      path: route,
      pos: 4,
    } as never);
    expect(game.construction.demolish([{ x: 12, y: 10 }])).toBe('Na mostě je Auto 99.');
    game.roadFleet.vehicles.length = 0;
    const money = game.money;
    expect(game.construction.demolish([{ x: 12, y: 10 }])).toBeNull();
    expect(rail.roadBridges).toHaveLength(0);
    expect(map.isBridged(15, 10)).toBe(false);
    expect(map.get(12, 10)).toBe(TileType.Road);
    expect(map.get(18, 10)).toBe(TileType.Road);
    expect(game.money - money).toBe(5 * ROAD_BRIDGE_COST * DEMOLISH_REFUND);
  });

  it('uložení zachová silniční most', () => {
    const game = railGap();
    expect(game.construction.buildRoadBridge(12, 10, 18, 10)).toBeNull();
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'x'))));
    const { rail, map } = restored.world;
    expect(rail.roadBridges).toEqual(game.world.rail.roadBridges);
    expect(map.isBridged(15, 10)).toBe(true);
    expect(findRoadRoute(rail, { x: 4, y: 10 }, (x, y) => x === 28 && y === 10)).not.toBeNull();
  });
});
