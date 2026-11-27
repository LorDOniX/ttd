import { describe, expect, it } from 'vitest';
import { DEMOLISH_REFUND, ROAD_VEHICLE_MODELS, TRAM_TRACK_COST } from './balance';
import { parseSave, restoreGame, serializeGame } from './save';
import { isTram } from './roadVehicles';
import { addBuilding, emptyGame, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
import { Edge } from '../world/rail';
import { findRoadRoute } from '../world/roadRoute';

const tramModel = ROAD_VEHICLE_MODELS.find((m) => m.id === 'tram-classic')!;

// Silnice y = 10 z x = 4 do 28, zastávky na x = 6 a 26, garáž pod x = 4
function street() {
  const townA = makeTown(0, 6, 12);
  const townB = makeTown(1, 26, 12);
  const game = emptyGame(64, [townA, townB]);
  game.money = 10_000_000;
  game.clock.date = { year: 1960, month: 1, day: 1 };
  addBuilding(game, townA, 6, 12);
  addBuilding(game, townB, 26, 12);
  const { map, rail } = game.world;
  for (let x = 4; x <= 28; x++) map.set(x, 10, TileType.Road);
  game.construction.buildRoadStop(6, 10);
  game.construction.buildRoadStop(26, 10);
  game.construction.buildRoadDepot(4, 11, Edge.N);
  const line = Array.from({ length: 25 }, (_, i) => ({ x: 4 + i, y: 10 }));
  return { game, map, rail, line, stops: rail.stations };
}

describe('tramvaje', () => {
  it('kolej jen po silnici; cena, odebrání vrátí polovinu', () => {
    const { game, rail, line } = street();
    expect(game.construction.tramPlan([{ x: 4, y: 9 }]).problem).toBe('Tramvajová kolej vede jen po silnici.');
    const money = game.money;
    expect(game.construction.buildTram(line)).toBeNull();
    expect(money - game.money).toBe(line.length * TRAM_TRACK_COST);
    expect(rail.hasTram(6, 10)).toBe(true);
    expect(game.construction.buildTram(line)).toBe('Kolej už tu leží.');
    const before = game.money;
    expect(game.construction.buildTram([{ x: 28, y: 10 }], true)).toBeNull();
    expect(game.money - before).toBe(TRAM_TRACK_COST * DEMOLISH_REFUND);
    expect(rail.hasTram(28, 10)).toBe(false);
  });

  it('tramvaj hledá cestu jen po koleji, autobus po silnici', () => {
    const { game, rail } = street();
    game.construction.buildTram(Array.from({ length: 10 }, (_, i) => ({ x: 4 + i, y: 10 })));
    const toEnd = (x: number, y: number) => x === 20 && y === 10;
    expect(findRoadRoute(rail, { x: 6, y: 10 }, toEnd)).not.toBeNull();
    expect(findRoadRoute(rail, { x: 6, y: 10 }, toEnd, true)).toBeNull();
    expect(findRoadRoute(rail, { x: 6, y: 10 }, (x, y) => x === 13 && y === 10, true)).toHaveLength(8);
  });

  it('tramvaj z garáže na koleji vozí cestující mezi zastávkami na koleji', () => {
    const { game, line, stops, rail } = street();
    const [a, b] = stops;
    expect(game.roadFleet.buy(rail.roadDepots[0], tramModel)).toBeNull();
    const tram = game.roadFleet.vehicles[0];
    expect(isTram(tram)).toBe(true);
    expect(tram.name).toMatch(/^Tramvajový vůz/);
    // Bez koleje nevyjede
    expect(game.roadFleet.start(tram, [a.id, b.id])).toContain('tramvajová kolej');
    tram.state = 'depot';
    expect(game.construction.buildTram([...line, { x: 4, y: 11 }])).toBeNull();
    expect(game.roadFleet.start(tram, [a.id, b.id])).toBeNull();
    a.waiting = 50;
    b.waiting = 50;
    runDays(game, 60);
    expect(tram.income).toBeGreaterThan(0);
    expect(tram.path.every((t) => rail.hasTram(t.x, t.y))).toBe(true);
  });

  it('zbouráním silnice zmizí i kolej; uložení koleje zachová', () => {
    const { game, rail, line } = street();
    game.construction.buildTram(line);
    expect(game.construction.demolish([{ x: 15, y: 10 }])).toBeNull();
    expect(rail.hasTram(15, 10)).toBe(false);
    // Nová silnice na stejném místě je bez koleje
    game.world.map.set(15, 10, TileType.Road);
    expect(rail.hasTram(15, 10)).toBe(false);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 't'))));
    expect(restored.world.rail.hasTram(14, 10)).toBe(true);
    expect(restored.world.rail.hasTram(15, 10)).toBe(false);
  });
});
