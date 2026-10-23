import { describe, expect, it } from 'vitest';
import { ROAD_VEHICLE_MODELS } from './balance';
import type { Game } from './game';
import { parseSave, restoreGame, serializeGame } from './save';
import { addBuilding, addIndustry, emptyGame, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
import { Edge, axisPiece, type Depot, type Station } from '../world/rail';
import { roadMoves } from '../world/roadRoute';
import { vehiclePoint } from './roadVehicles';

const model = (id: string) => ROAD_VEHICLE_MODELS.find((m) => m.id === id)!;

interface RoadLine {
  game: Game;
  a: Station;
  b: Station;
  depot: Depot;
}

// Rovná silnice y = 10 od x = 8 do 40, zastávky na x = 12 a 36, garáž pod začátkem silnice
function buildRoadLine(): RoadLine {
  const townA = makeTown(0, 12, 12);
  const townB = makeTown(1, 36, 12);
  const game = emptyGame(64, [townA, townB]);
  addBuilding(game, townA, 12, 12);
  addBuilding(game, townB, 36, 12);
  const { map, rail } = game.world;
  for (let x = 8; x <= 40; x++) map.set(x, 10, TileType.Road);
  game.construction.buildRoadStop(12, 10);
  game.construction.buildRoadStop(36, 10);
  game.construction.buildRoadDepot(8, 11, Edge.N);
  const [a, b] = rail.stations;
  return { game, a, b, depot: rail.roadDepots[0] };
}

describe('zastávky a garáže aut', () => {
  it('zastávka jde jen na rovnou silnici a po zbourání silnice zůstane', () => {
    const { game, a } = buildRoadLine();
    const { map, rail } = game.world;
    expect(a.kind).toBe('road');
    expect(a.axis).toBe('x');
    expect(map.get(12, 10)).toBe(TileType.RoadStop);
    expect(game.construction.buildRoadStop(20, 20)).not.toBeNull();
    map.set(20, 9, TileType.Road);
    map.set(20, 11, TileType.Road);
    // Křižovatka
    expect(game.construction.buildRoadStop(20, 10)).not.toBeNull();

    expect(game.construction.demolish([{ x: 12, y: 10 }])).toBeNull();
    expect(map.get(12, 10)).toBe(TileType.Road);
    expect(rail.stations).not.toContain(a);
  });

  it('zastávkou se projíždí jen podél silnice, do garáže jen vjezdem', () => {
    const { game } = buildRoadLine();
    const { map, rail } = game.world;
    map.set(12, 11, TileType.Road);
    const fromStop = roadMoves(rail, 12, 10).map((t) => `${t.x},${t.y}`);
    expect(fromStop.sort()).toEqual(['11,10', '13,10']);
    expect(roadMoves(rail, 8, 11)).toEqual([{ x: 8, y: 10 }]);
    map.set(9, 11, TileType.Road);
    expect(roadMoves(rail, 9, 11).some((t) => t.x === 8 && t.y === 11)).toBe(false);
  });
});

describe('silniční vozidla', () => {
  it('autobus vozí cestující mezi zastávkami a vydělává', () => {
    const { game, a, b, depot } = buildRoadLine();
    expect(game.roadFleet.buy(depot, model('bus-regal'))).toBeNull();
    const bus = game.roadFleet.vehicles[0];
    expect(bus.name).toBe('Autobus 1');
    a.waiting = 50;
    b.waiting = 50;
    expect(game.roadFleet.start(bus, [a.id, b.id])).toBeNull();
    expect(bus.state).toBe('running');
    runDays(game, 40);
    expect(bus.income).toBeGreaterThan(0);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
    expect(a.ratings.passengers.lastVisit).toBeGreaterThanOrEqual(0);
  });

  it('řád potřebuje dvě různé zastávky aut', () => {
    const { game, a, depot } = buildRoadLine();
    game.roadFleet.buy(depot, model('bus-regal'));
    const bus = game.roadFleet.vehicles[0];
    expect(game.roadFleet.start(bus, [a.id])).not.toBeNull();
    expect(game.roadFleet.start(bus, [a.id, a.id])).not.toBeNull();
    expect(bus.state).toBe('depot');
  });

  it('zastávku obsluhovanou autem ani silnici pod autem nejde zbourat', () => {
    const { game, a, b, depot } = buildRoadLine();
    game.roadFleet.buy(depot, model('bus-regal'));
    const bus = game.roadFleet.vehicles[0];
    game.roadFleet.start(bus, [a.id, b.id]);
    expect(game.construction.demolish([{ x: 36, y: 10 }])).toContain('obsluhuje');
    expect(game.construction.demolish([{ x: 8, y: 11 }])).toContain('Na silnici stojí');
    runDays(game, 2);
    expect(game.construction.demolish([{ x: 8, y: 11 }])).toContain('Garáž');
  });

  it('do garáže dojede a zůstane v ní', () => {
    const { game, a, b, depot } = buildRoadLine();
    game.roadFleet.buy(depot, model('bus-regal'));
    const bus = game.roadFleet.vehicles[0];
    game.roadFleet.start(bus, [a.id, b.id]);
    runDays(game, 3);
    game.roadFleet.sendToDepot(bus);
    runDays(game, 30);
    expect(bus.state).toBe('depot');
    game.roadFleet.sell(bus);
    expect(game.roadFleet.vehicles).toHaveLength(0);
  });

  it('nákladní auto odváží uhlí z dolu do elektrárny', () => {
    const { game, a, b, depot } = buildRoadLine();
    addIndustry(game, 'coal-mine', 11, 6);
    addIndustry(game, 'power-station', 35, 6);
    game.roadFleet.buy(depot, model('coal-balogh'));
    const truck = game.roadFleet.vehicles[0];
    expect(truck.name).toBe('Nákladní vůz 1');
    game.roadFleet.start(truck, [a.id, b.id]);
    runDays(game, 90);
    expect(game.thisYear.freight.coal).toBeGreaterThan(0);
    expect(truck.income).toBeGreaterThan(0);
  });

  it('uložení a načtení zachová garáže i auta', () => {
    const { game, a, b, depot } = buildRoadLine();
    game.roadFleet.buy(depot, model('bus-regal'));
    game.roadFleet.start(game.roadFleet.vehicles[0], [a.id, b.id]);
    runDays(game, 5);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'x'))));
    expect(restored.world.rail.roadDepots).toHaveLength(1);
    expect(restored.roadFleet.vehicles).toHaveLength(1);
    expect(restored.roadFleet.vehicles[0].state).toBe('running');
    expect(restored.world.rail.stations.every((s) => s.kind === 'road')).toBe(true);
    runDays(restored, 40);
    expect(restored.roadFleet.vehicles[0].income).toBeGreaterThan(0);
  });

  it('auta ve stejném pruhu se řadí za sebe a neprojíždějí sebou', () => {
    const { game, a, b, depot } = buildRoadLine();
    for (let i = 0; i < 3; i++) {
      game.roadFleet.buy(depot, model('bus-regal'));
      game.roadFleet.start(game.roadFleet.vehicles[i], [a.id, b.id]);
    }
    let minGap = Infinity;
    for (let day = 0; day < 60; day++) {
      runDays(game, 1);
      const points = game.roadFleet.vehicles.filter((v) => v.state !== 'depot').map((v) => vehiclePoint(v.path, v.pos));
      for (const p of points) {
        for (const q of points) {
          const sameDirection = p !== q && p.dx === q.dx && p.dy === q.dy;
          if (sameDirection) minGap = Math.min(minGap, Math.hypot(p.x - q.x, p.y - q.y));
        }
      }
    }
    expect(minGap).toBeGreaterThan(0.45);
    expect(game.roadFleet.vehicles.every((v) => v.income > 0)).toBe(true);
  });

  it('před přejezdem se zavřenou závorou auto stojí, po otevření pokračuje', () => {
    const { game, a, b, depot } = buildRoadLine();
    game.world.rail.addPiece(20, 10, axisPiece('y'));
    expect(game.world.map.get(20, 10)).toBe(TileType.Crossing);
    const { reservations } = game.fleet;
    let closed = true;
    const ownerAt = reservations.ownerAt.bind(reservations);
    reservations.ownerAt = (x, y) => (closed && x === 20 && y === 10 ? 99 : ownerAt(x, y));
    game.roadFleet.buy(depot, model('bus-regal'));
    const bus = game.roadFleet.vehicles[0];
    game.roadFleet.start(bus, [a.id, b.id]);
    runDays(game, 15);
    const tile = game.roadFleet.tileOf(bus)!;
    expect(tile).toEqual({ x: 19, y: 10 });
    expect(bus.state).toBe('running');
    closed = false;
    runDays(game, 3);
    expect(game.roadFleet.tileOf(bus)!.x).toBeGreaterThan(20);
  });

  it('před obsazeným přechodem auto počká a po přejití pokračuje', () => {
    const { game, a, b, depot } = buildRoadLine();
    game.world.map.set(10, 9, TileType.Road);
    game.world.map.set(10, 11, TileType.Road);
    game.roadFleet.buy(depot, model('bus-regal'));
    const bus = game.roadFleet.vehicles[0];
    game.roadFleet.start(bus, [a.id, b.id]);
    const crossingIndex = bus.path.findIndex((tile) => tile.x === 10 && tile.y === 10);
    expect(crossingIndex).toBeGreaterThan(0);

    game.roadFleet.setPedestrianCrossings(new Set([10 * game.world.map.width + 10]));
    runDays(game, 18);
    expect(bus.pos).toBeCloseTo(crossingIndex - 0.5 - 0.2);
    expect(game.roadFleet.tileOf(bus)).toEqual({ x: 9, y: 10 });

    game.roadFleet.setPedestrianCrossings(new Set());
    runDays(game, 1);
    expect(bus.pos).toBeGreaterThan(crossingIndex - 0.5 - 0.2);
  });
});
