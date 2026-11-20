import { describe, expect, it } from 'vitest';
import { SHIP_MODELS } from './balance';
import type { Game } from './game';
import { parseSave, restoreGame, serializeGame } from './save';
import { waterFrozen, type Ship } from './ships';
import { addBuilding, emptyGame, makeTown, runDays } from '../test/fixtures';
import { TileType } from '../world/map';
import { berthTiles, findWaterRoute, portAt, type PortShape } from '../world/port';
import { Edge, stationTiles, type Station } from '../world/rail';

const model = (id: string) => SHIP_MODELS.find((m) => m.id === id)!;

interface WaterLine {
  game: Game;
  a: Station;
  b: Station;
}

// Jezero x 10–50, y 20–30 s ostrůvkem uprostřed; přístav A na severním břehu, B na jižním. Hra začíná v červnu,
// aby voda nebyla zamrzlá
function buildWaterLine(): WaterLine {
  const townA = makeTown(0, 14, 16);
  const townB = makeTown(1, 46, 34);
  const game = emptyGame(64, [townA, townB]);
  game.money = 10_000_000;
  game.clock.date = { year: 1950, month: 5, day: 1 };
  const { map } = game.world;
  for (let y = 20; y <= 30; y++) for (let x = 10; x <= 50; x++) map.set(x, y, TileType.Water);
  for (let y = 24; y <= 26; y++) for (let x = 25; x <= 35; x++) map.set(x, y, TileType.Grass);
  addBuilding(game, townA, 14, 16);
  addBuilding(game, townB, 46, 34);
  const shapeA = portAt(map, { x: 14, y: 19 }, Edge.S)!;
  const shapeB = portAt(map, { x: 46, y: 31 }, Edge.N)!;
  expect(game.construction.buildPort(shapeA)).toBeNull();
  expect(game.construction.buildPort(shapeB)).toBeNull();
  const [a, b] = game.world.rail.stations;
  return { game, a, b };
}

function buyShip(game: Game, port: Station, id = 'parnik'): Ship {
  expect(game.shipFleet.buy(port, model(id))).toBeNull();
  return game.shipFleet.ships.at(-1)!;
}

describe('přístavy', () => {
  it('stojí na břehu, kotviště zůstanou vodou a nedá se přes ně stavět', () => {
    const { game, a } = buildWaterLine();
    const { map, rail } = game.world;
    expect(a.kind).toBe('water');
    expect(stationTiles(a).every((t) => map.get(t.x, t.y) === TileType.Port)).toBe(true);
    const berths = berthTiles(a as PortShape);
    expect(berths.every((t) => map.get(t.x, t.y) === TileType.Water && rail.isBerth(t.x, t.y))).toBe(true);
    expect(rail.canPlace(berths[0].x, berths[0].y, 0)).toBe(false);
    // Daleko od vody přístav nejde
    expect(portAt(map, { x: 5, y: 5 }, Edge.S)).toBeNull();
    expect(game.construction.demolish([stationTiles(a)[0]])).toBeNull();
    expect(rail.stations).not.toContain(a);
    expect(rail.isBerth(berths[0].x, berths[0].y)).toBe(false);
  });

  it('plavební trasa obepluje ostrov a nevede přes souš', () => {
    const { game, a, b } = buildWaterLine();
    const { map } = game.world;
    const route = findWaterRoute(map, berthTiles(a as PortShape)[0], berthTiles(b as PortShape)[0])!;
    expect(route.length).toBeGreaterThan(10);
    expect(route.every((t) => map.get(t.x, t.y) === TileType.Water)).toBe(true);
  });
});

describe('lodě', () => {
  it('plují mezi přístavy, převážejí cestující a vydělávají', () => {
    const { game, a, b } = buildWaterLine();
    a.waiting = 100;
    const ship = buyShip(game, a);
    expect(game.shipFleet.start(ship, [a.id, b.id])).toBeNull();
    // Výchozí přístav je v řádu, loď rovnou nakládá
    expect(ship.state).toBe('loading');
    expect(ship.passengers).toBeGreaterThanOrEqual(100);
    runDays(game, 40);
    expect(ship.income).toBeGreaterThan(0);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
  });

  it('Přeskočit: kotvící loď hned vypluje, plující změní cíl', () => {
    const { game, a, b } = buildWaterLine();
    const ship = buyShip(game, a);
    game.shipFleet.start(ship, [a.id, b.id]);
    expect(ship.state).toBe('loading');
    game.shipFleet.skipTo(ship, 1);
    expect(ship.state).toBe('sailing');
    expect(ship.portId).toBe(b.id);
    game.shipFleet.skipTo(ship, 0);
    expect(ship.portId).toBe(a.id);
  });

  it('do jiného jezera řád nepovolí', () => {
    const { game, a } = buildWaterLine();
    const { map } = game.world;
    for (let y = 40; y <= 50; y++) for (let x = 10; x <= 20; x++) map.set(x, y, TileType.Water);
    const shape = portAt(map, { x: 14, y: 39 }, Edge.S)!;
    expect(game.construction.buildPort(shape)).toBeNull();
    const c = game.world.rail.stations.at(-1)!;
    const ship = buyShip(game, a);
    expect(game.shipFleet.start(ship, [a.id, c.id])).toMatch(/nedá doplout/);
  });

  it('obsazené kotviště: další loď počká nebo zakotví u druhého', () => {
    const { game, a, b } = buildWaterLine();
    const ships = [buyShip(game, a), buyShip(game, a), buyShip(game, a)];
    for (const ship of ships) {
      game.shipFleet.start(ship, [a.id, b.id]);
      game.shipFleet.toggleFullLoad(ship, b.id);
    }
    let waited = false;
    for (let day = 0; day < 60; day++) {
      runDays(game, 1);
      if (ships.some((s) => s.state === 'waiting')) waited = true;
      const moored = ships.filter((s) => s.state === 'loading' && s.portId === b.id);
      expect(new Set(moored.map((s) => s.berth)).size).toBe(moored.length);
    }
    expect(waited).toBe(true);
  });

  it('most přes trasu loď objede, nebo ohlásí, že nemá cestu', () => {
    const { game, a, b } = buildWaterLine();
    const ship = buyShip(game, a);
    game.shipFleet.start(ship, [a.id, b.id]);
    runDays(game, 3);
    expect(ship.state).toBe('sailing');
    // Most napříč západním průlivem (x = 18): trasa vede druhou stranou ostrova
    const { rail } = game.world;
    for (let y = 20; y <= 23; y++) rail.addPiece(18, y, 0);
    for (let y = 27; y <= 30; y++) rail.addPiece(18, y, 0);
    game.events.emit('railChanged');
    expect(ship.path.slice(1, -1).every((p) => Math.floor(p.x) !== 18)).toBe(true);
    runDays(game, 40);
    expect(ship.income).toBeGreaterThan(0);
  });

  it('poslaná do loděnice zakotví v cílovém přístavu', () => {
    const { game, a, b } = buildWaterLine();
    const ship = buyShip(game, a, 'coal-ship');
    game.shipFleet.start(ship, [a.id, b.id]);
    runDays(game, 3);
    game.shipFleet.sendToDepot(ship);
    runDays(game, 40);
    expect(ship.state).toBe('depot');
    expect(ship.depotId).toBe(b.id);
    expect(game.construction.demolishPlan(stationTiles(b).slice(0, 1)).blocked).toMatch(/loděnici/);
  });

  it('v zimě voda zamrzne: lodě stojí v ledu, kotvící jen nakládají, na jaře plují dál', () => {
    expect(waterFrozen({ month: 0, day: 10 })).toBe(true);
    expect(waterFrozen({ month: 11, day: 5 })).toBe(false);
    expect(waterFrozen({ month: 11, day: 25 })).toBe(true);
    expect(waterFrozen({ month: 2, day: 25 })).toBe(false);
    expect(waterFrozen({ month: 6, day: 1 })).toBe(false);

    const { game, a, b } = buildWaterLine();
    game.clock.date = { year: 1950, month: 11, day: 10 };
    const sailing = buyShip(game, a);
    game.shipFleet.start(sailing, [b.id, a.id]);
    const moored = buyShip(game, a);
    runDays(game, 3);
    expect(sailing.state).toBe('sailing');
    // Před Vánoci zamrzne: plující loď stojí v ledu, loď vypravená v zamrzlém přístavu jen nakládá
    runDays(game, 10);
    expect(game.shipFleet.frozen).toBe(true);
    const at = game.shipFleet.position(sailing);
    a.waiting = 0;
    game.shipFleet.start(moored, [a.id, b.id]);
    expect(moored.state).toBe('loading');
    runDays(game, 40);
    expect(game.shipFleet.position(sailing)).toEqual(at);
    expect(moored.state).toBe('loading');
    expect(moored.passengers).toBeGreaterThan(0);
    expect(game.newsLog.some((n) => n.text.includes('zamrzla'))).toBe(true);
    // Na jaře led roztaje a lodě vyplují
    game.clock.date = { year: 1951, month: 3, day: 1 };
    runDays(game, 30);
    expect(game.shipFleet.position(sailing)).not.toEqual(at);
    expect(game.newsLog.some((n) => n.text.includes('roztál'))).toBe(true);
  });

  it('uložení zachová přístavy i lodě na cestě', () => {
    const { game, a, b } = buildWaterLine();
    const ship = buyShip(game, a);
    game.shipFleet.start(ship, [a.id, b.id]);
    runDays(game, 6);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'x'))));
    const copy = restored.shipFleet.ships[0];
    expect(copy.state).toBe(ship.state);
    expect(restored.shipFleet.position(copy)).toEqual(game.shipFleet.position(ship));
    expect(restored.world.rail.isBerth(berthTiles(b as PortShape)[0].x, berthTiles(b as PortShape)[0].y)).toBe(true);
    runDays(restored, 40);
    expect(copy.income).toBeGreaterThan(0);
  });
});
