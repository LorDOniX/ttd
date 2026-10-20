import { describe, expect, it } from 'vitest';
import { DEPOT_COST, LOAN_STEP, MAX_LOAN, PLATFORM_TILE_COST, TRACK_PIECE_COST } from './balance';
import { infrastructureValue } from './construction';
import { buildLine, emptyGame, runDays } from '../test/fixtures';

describe('úvěr', () => {
  it('půjčuje po krocích do limitu a splácí jen z dostupných peněz', () => {
    const game = emptyGame();
    const start = game.money;
    expect(game.borrow()).toBeNull();
    expect(game.loan).toBe(LOAN_STEP);
    expect(game.money).toBe(start + LOAN_STEP);
    while (game.loan < MAX_LOAN) game.borrow();
    expect(game.borrow()).toMatch(/nejvýš/);
    expect(game.loan).toBe(MAX_LOAN);

    game.money = LOAN_STEP - 1;
    expect(game.repay()).toMatch(/chybí/);
    game.money = LOAN_STEP;
    expect(game.repay()).toBeNull();
    expect(game.loan).toBe(MAX_LOAN - LOAN_STEP);
    // Půjčka ani splátka nejsou příjmem nebo výdajem
    expect(game.thisYear.income).toBe(0);
    expect(game.thisYear.expenses).toBe(0);
  });

  it('úrok 8 % ročně se platí měsíčně', () => {
    const game = emptyGame();
    for (let i = 0; i < 10; i++) game.borrow();
    runDays(game, 31);
    expect(game.thisYear.costs.interest).toBe(Math.round((1_000_000 * 0.08) / 12));
  });
});

describe('údržba tratí', () => {
  it('stojí měsíčně 5 % ročně z ceny kolejí, nástupišť a dep', () => {
    const { game } = buildLine();
    const value = infrastructureValue(game.world);
    const stations = 2 * 3 * PLATFORM_TILE_COST;
    expect(value).toBeGreaterThan(stations + DEPOT_COST + 20 * TRACK_PIECE_COST);
    runDays(game, 31);
    expect(game.thisYear.costs.maintenance).toBe(Math.round((value * 0.05) / 12));
  });
});

describe('historie let', () => {
  it('uzavřený rok se uloží do historie včetně prosincových plateb', () => {
    const { game } = buildLine();
    runDays(game, 366);
    expect(game.history).toHaveLength(1);
    const [year] = game.history;
    expect(year.year).toBe(1950);
    expect(year.costs.maintenance).toBe(12 * game.monthlyMaintenance);
    expect(game.thisYear.costs.maintenance).toBe(0);
  });
});
