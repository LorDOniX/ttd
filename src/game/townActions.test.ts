import { describe, expect, it } from 'vitest';
import { AD_CAMPAIGN_COST, AD_RATING_BOOST, FUND_GROWTH } from './balance';
import { advertise, fundBuildings, fundBuildingsCost } from './townActions';
import { buildLine, emptyGame, makeTown } from '../test/fixtures';
import { createTownShape, expandTown } from '../world/town';

describe('akce ve městě', () => {
  it('reklama zvedne hodnocení stanic ve městě, bez stanice nejde', () => {
    const { game, a, b, townA } = buildLine();
    const before = game.money;
    const rating = a.rating;
    expect(advertise(game, townA)).toBeNull();
    expect(a.rating).toBeCloseTo(rating + AD_RATING_BOOST);
    expect(b.rating).toBeCloseTo(rating);
    expect(before - game.money).toBe(AD_CAMPAIGN_COST);
    const lonely = makeTown(2, 50, 50);
    expect(advertise(game, lonely)).toMatch(/nástupiště/);
  });

  it('financovaná výstavba hned přidá obyvatele i budovy', () => {
    const town = { ...makeTown(0, 32, 32, 800), radius: 2 };
    const game = emptyGame(64, [town]);
    town.shape = createTownShape(game.rng);
    expandTown(game.world.map, town, 1950, game.rng);
    const { population } = town;
    const buildings = town.buildings.length;
    const cost = fundBuildingsCost(town);
    expect(fundBuildings(game, town)).toBeNull();
    expect(town.population).toBe(Math.round(population * (1 + FUND_GROWTH)));
    expect(town.buildings.length).toBeGreaterThan(buildings);
    expect(game.thisYear.costs.construction).toBe(cost);
  });
});
