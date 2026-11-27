import { describe, expect, it } from 'vitest';
import { CANAL_COST, DEMOLISH_REFUND, LOCK_COST, SHIP_MODELS } from './balance';
import { parseSave, restoreGame, serializeGame } from './save';
import { addBuilding, emptyGame, makeTown, runDays } from '../test/fixtures';
import { HEIGHT_STEP, TileType } from '../world/map';
import { CANAL_DROP, canSail, findWaterRoute, portAt, waterBodies, waterSurface } from '../world/port';
import { Edge } from '../world/rail';

// Moře x 0–5 (úroveň 0), od rohu x = 11 plošina v úrovni 1; dlaždice x = 10 je svah stoupající na východ
function canalGame() {
  const townA = makeTown(0, 3, 4);
  const townB = makeTown(1, 18, 4);
  const game = emptyGame(32, [townA, townB]);
  game.money = 10_000_000;
  game.clock.date = { year: 1960, month: 5, day: 1 };
  const { map } = game.world;
  for (let cy = 0; cy <= 32; cy++) for (let cx = 0; cx <= 32; cx++) map.setCornerLevel(cx, cy, cx >= 11 ? 1 : 0);
  for (let y = 0; y < 32; y++) for (let x = 0; x <= 5; x++) map.set(x, y, TileType.Water);
  addBuilding(game, townA, 7, 4);
  addBuilding(game, townB, 18, 4);
  return { game, map };
}

describe('kanály a zdymadla', () => {
  it('kanál jen na rovnou volnou zem; u moře na úrovni 0 navazuje, nahoře je samostatná hladina', () => {
    const { game, map } = canalGame();
    expect(game.construction.canalPlan([{ x: 10, y: 10 }]).tiles).toEqual([]);
    const money = game.money;
    const lower = [6, 7, 8, 9].map((x) => ({ x, y: 10 }));
    expect(game.construction.buildCanal(lower)).toBeNull();
    expect(money - game.money).toBe(4 * CANAL_COST);
    expect(game.construction.buildCanal([11, 12, 13].map((x) => ({ x, y: 10 })))).toBeNull();
    expect(canSail(map, 5, 10, 6, 10)).toBe(true);
    // Mezi kanálem v úrovni 0 a 1 bez zdymadla nic (a svah mezi nimi je souš)
    const bodies = waterBodies(map);
    expect(bodies[10 * 32 + 6]).toBe(bodies[10 * 32 + 5]);
    expect(bodies[10 * 32 + 11]).not.toBe(bodies[10 * 32 + 9]);
    expect(waterSurface(map, 12.5, 10.5, -0.06, HEIGHT_STEP)).toBeCloseTo(HEIGHT_STEP - CANAL_DROP);
  });

  it('zdymadlo na svahu spojí hladiny; dole i nahoře přibude kanál, loď jím projede jen podél svahu', () => {
    const { game, map } = canalGame();
    game.construction.buildCanal([6, 7, 8].map((x) => ({ x, y: 10 })));
    expect(game.construction.lockPlan(8, 10).problem).toBe('Zdymadlo musí stát na rovném svahu.');
    const plan = game.construction.lockPlan(10, 10);
    expect(plan).toMatchObject({ problem: null, cost: LOCK_COST + 2 * CANAL_COST });
    expect(game.construction.buildLock(10, 10)).toBeNull();
    expect(map.get(10, 10)).toBe(TileType.Lock);
    expect(map.get(9, 10)).toBe(TileType.Canal);
    expect(map.get(11, 10)).toBe(TileType.Canal);
    expect(canSail(map, 9, 10, 10, 10)).toBe(true);
    expect(canSail(map, 10, 10, 11, 10)).toBe(true);
    game.construction.buildCanal([{ x: 10, y: 11 }]);
    expect(map.get(10, 11)).toBe(TileType.Grass);
    const route = findWaterRoute(map, { x: 3, y: 10 }, { x: 11, y: 10 })!;
    expect(route.map((t) => t.x)).toContain(10);
    // Ve zdymadle hladina uprostřed vystoupá
    expect(waterSurface(map, 10.1, 10.5, -0.06, HEIGHT_STEP)).toBeCloseTo(-CANAL_DROP);
    expect(waterSurface(map, 10.9, 10.5, -0.06, HEIGHT_STEP)).toBeCloseTo(HEIGHT_STEP - CANAL_DROP);
  });

  it('loď z přístavu na moři doplouje zdymadlem do přístavu na horním kanálu', () => {
    const { game, map } = canalGame();
    game.construction.buildCanal([6, 7, 8, 9].map((x) => ({ x, y: 6 })));
    expect(game.construction.buildLock(10, 6)).toBeNull();
    game.construction.buildCanal([12, 13, 14, 15, 16, 17, 18, 19, 20].map((x) => ({ x, y: 6 })));
    const shapeA = portAt(map, { x: 6, y: 4 }, Edge.W)!;
    const shapeB = portAt(map, { x: 18, y: 5 }, Edge.S)!;
    expect(shapeA).not.toBeNull();
    expect(shapeB).not.toBeNull();
    expect(game.construction.buildPort(shapeA)).toBeNull();
    expect(game.construction.buildPort(shapeB)).toBeNull();
    const [a, b] = game.world.rail.stations;
    expect(game.shipFleet.buy(a, SHIP_MODELS[0])).toBeNull();
    const ship = game.shipFleet.ships[0];
    expect(game.shipFleet.start(ship, [a.id, b.id])).toBeNull();
    a.waiting = 40;
    b.waiting = 40;
    runDays(game, 90);
    expect(ship.income).toBeGreaterThan(0);
  });

  it('demolice kanálu vrátí polovinu; uložení kanály a zdymadla zachová', () => {
    const { game, map } = canalGame();
    game.construction.buildCanal([6, 7, 8].map((x) => ({ x, y: 10 })));
    game.construction.buildLock(10, 10);
    const money = game.money;
    expect(game.construction.demolish([{ x: 7, y: 10 }])).toBeNull();
    expect(game.money - money).toBe(CANAL_COST * DEMOLISH_REFUND);
    expect(map.get(7, 10)).toBe(TileType.Grass);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'k'))));
    expect(restored.world.map.get(10, 10)).toBe(TileType.Lock);
    expect(restored.world.map.get(11, 10)).toBe(TileType.Canal);
  });
});
