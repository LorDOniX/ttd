import { describe, expect, it } from 'vitest';
import { TOWN_GROWTH_BASE, TOWN_GROWTH_PER_STATION, TOWN_SUPPLY_BONUS } from './balance';
import { emptyGame, makeTown } from '../test/fixtures';
import { defaultStationShape } from '../world/rail';
import { Rng } from '../world/rng';
import { createTownShape, expandTown, townCapacity } from '../world/town';

// Skutečně vystavěné město: obyvatel tolik, kolik se vejde do budov
function builtTown() {
  const town = {
    ...makeTown(0, 30, 30, 800),
    radius: 2,
    shape: createTownShape(new Rng(3)),
    layout: 'better' as const,
  };
  const game = emptyGame(64, [town]);
  expandTown(game.world.map, town, 1950, new Rng(7));
  game.townGrowth.enabled = true;
  return { game, town };
}

describe('růst měst podle obsluhy', () => {
  it('bez obsluhy roste jen málo, každá aktivní stanice přidá', () => {
    const { game, town } = builtTown();
    expect(town.population).toBe(Math.min(800, townCapacity(town)));
    expect(game.townGrowth.annualRate(town)).toBeCloseTo(TOWN_GROWTH_BASE);
    const { rail } = game.world;
    const a = rail.addStation({ ...defaultStationShape(30, 30, 'x'), name: 'A', townId: 0 });
    const b = rail.addStation({ ...defaultStationShape(28, 33, 'x'), name: 'B', townId: 0 });
    expect(game.passengers.townsInReach(a)).toContain(town);
    // Stanice bez vozidel se nepočítá
    expect(game.townGrowth.activeStations(town)).toBe(0);
    a.ratings.passengers.lastVisit = game.clock.now;
    b.ratings.mail.lastVisit = game.clock.now;
    expect(game.townGrowth.activeStations(town)).toBe(2);
    expect(game.townGrowth.annualRate(town)).toBeCloseTo(TOWN_GROWTH_BASE + 2 * TOWN_GROWTH_PER_STATION);
  });

  it('dovoz potravin a cestujících za minulý měsíc růst zrychlí', () => {
    const { game, town } = builtTown();
    const a = game.world.rail.addStation({ ...defaultStationShape(30, 30, 'x'), name: 'A', townId: 0 });
    a.ratings.passengers.lastVisit = game.clock.now;
    const base = game.townGrowth.annualRate(town);
    const thousands = town.population / 1000;
    game.townGrowth.recordDelivery(a, 'food', TOWN_SUPPLY_BONUS.food.per1000 * thousands + 1);
    game.townGrowth.recordDelivery(a, 'passengers', TOWN_SUPPLY_BONUS.passengers.per1000 * thousands + 1);
    game.townGrowth.recordDelivery(a, 'coal', 1000);
    expect(town.supplied?.food).toBeGreaterThan(0);
    game.clock.events.emit('month', game.clock.date);
    expect(town.lastSupplied?.food).toBeGreaterThan(0);
    expect(town.supplied?.food).toBe(0);
    a.ratings.passengers.lastVisit = game.clock.now;
    expect(game.townGrowth.annualRate(town)).toBeCloseTo(
      base + TOWN_SUPPLY_BONUS.food.bonus + TOWN_SUPPLY_BONUS.passengers.bonus,
    );
  });

  it('obsluhované město za rok vyroste víc než neobsluhované', () => {
    const served = builtTown();
    const lonely = builtTown();
    const a = served.game.world.rail.addStation({ ...defaultStationShape(30, 30, 'x'), name: 'A', townId: 0 });
    const start = served.town.population;
    const buildings = served.town.buildings.length;
    for (let month = 0; month < 12; month++) {
      a.ratings.passengers.lastVisit = served.game.clock.now;
      served.game.clock.events.emit('month', served.game.clock.date);
      lonely.game.clock.events.emit('month', lonely.game.clock.date);
    }
    expect(served.town.population - start).toBeGreaterThan(lonely.town.population - start);
    expect(served.town.population).toBeGreaterThan(start * (1 + TOWN_GROWTH_PER_STATION * 0.8));
    expect(served.town.buildings.length).toBeGreaterThanOrEqual(buildings);
    expect(served.town.served).toBe(true);
    expect(lonely.town.served).toBe(false);
  });
});
