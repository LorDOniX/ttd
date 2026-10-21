import { describe, expect, it } from 'vitest';
import { buildLine, buyTrain, runDays } from '../test/fixtures';
import { industryTiles, type Industry, type IndustryKind } from '../world/industry';
import { TileType } from '../world/map';
import type { Game } from './game';

function addIndustry(game: Game, kind: IndustryKind, x: number, y: number): Industry {
  const industry: Industry = {
    id: game.world.industries.length,
    kind,
    name: kind,
    x,
    y,
    rotation: 0,
    production: kind === 'coal-mine' ? 120 : 0,
    transported: 0,
    lastTransported: 0,
  };
  for (const t of industryTiles(industry)) game.world.map.set(t.x, t.y, TileType.Industry);
  game.world.industries.push(industry);
  return industry;
}

// Linka A – B s dolem v dosahu A a elektrárnou v dosahu B
function coalLine(withPlant = true) {
  const line = buildLine();
  const mine = addIndustry(line.game, 'coal-mine', 5, 5);
  if (withPlant) addIndustry(line.game, 'power-station', 43, 16);
  return { ...line, mine };
}

describe('nákladní doprava uhlí', () => {
  it('důl sváží uhlí jen na nástupiště, kam jezdí vlak na uhlí', () => {
    const { game, a, b, depot, mine } = coalLine();
    runDays(game, 10);
    expect(a.coal).toBe(0);
    expect(game.freight.pickupStations(mine)).toEqual([]);

    const train = buyTrain(game, depot, 2);
    expect(game.fleet.setCargo(train, 'coal')).toBeNull();
    game.fleet.start(train, [a.id, b.id]);
    expect(game.freight.pickupStations(mine)).toEqual([a]);
    expect(game.fleet.setCargo(train, 'passengers')).toMatch(/depu/);
    runDays(game, 10);
    expect(mine.transported).toBeGreaterThan(0);
    // Cestující do vlaku na uhlí nenastupují
    expect(a.waiting).toBeGreaterThan(0);
  });

  it('vlak doveze uhlí k elektrárně a dostane zaplaceno', () => {
    const { game, a, b, depot } = coalLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.setCargo(train, 'coal');
    game.fleet.start(train, [a.id, b.id]);
    a.coal = 60;
    let paid = 0;
    game.events.on('income', (amount) => (paid += amount));
    runDays(game, 120);
    expect(game.freight.acceptsCoal(b)).toBe(true);
    expect(game.thisYear.coal).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(0);
    expect(train.income).toBe(paid);
    expect(game.thisYear.passengers).toBe(0);
  });

  it('s čekáním na plné naložení odveze vždy plný vlak', () => {
    const deliveries = (fullLoad: boolean): number[] => {
      const { game, a, b, depot } = coalLine();
      const train = buyTrain(game, depot, 2);
      game.fleet.setCargo(train, 'coal');
      game.fleet.setOrders(train, [a.id, b.id]);
      if (fullLoad) game.fleet.toggleFullLoad(train, a.id);
      game.fleet.start(train, train.orders!);
      const amounts: number[] = [];
      let filling = false;
      game.events.on('news', (text) => {
        const match = /přivezl (\d+) t uhlí/.exec(text);
        if (match) amounts.push(Number(match[1]));
      });
      for (let i = 0; i < 20_000 && amounts.length < 2; i++) {
        game.update(200);
        filling ||= game.fleet.isFillingUp(train);
      }
      expect(filling).toBe(fullLoad);
      return amounts;
    };
    expect(deliveries(true)).toEqual([60, 60]);
    expect(deliveries(false)[0]).toBeLessThan(60);
  });

  it('odebraná zastávka zruší i čekání na plné naložení', () => {
    const { game, a, b, depot } = coalLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.setOrders(train, [a.id, b.id]);
    game.fleet.toggleFullLoad(train, a.id);
    game.fleet.toggleFullLoad(train, b.id);
    game.fleet.toggleFullLoad(train, b.id);
    expect(train.fullLoad).toEqual([a.id]);
    game.fleet.setOrders(train, [b.id]);
    expect(train.fullLoad).toEqual([]);
  });

  it('bez elektrárny v dosahu zůstane uhlí ve vlaku', () => {
    const { game, a, b, depot } = coalLine(false);
    const train = buyTrain(game, depot, 2);
    game.fleet.setCargo(train, 'coal');
    game.fleet.start(train, [a.id, b.id]);
    a.coal = 60;
    runDays(game, 120);
    expect(game.thisYear.coal).toBe(0);
    expect(train.passengers).toBe(60);
  });
});
