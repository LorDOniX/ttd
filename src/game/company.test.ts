import { describe, expect, it } from 'vitest';
import { companyValue, performance, performanceScore, performanceTitle } from './company';
import { sellPrice } from './trains';
import { buildLine, buyTrain } from '../test/fixtures';

describe('společnost', () => {
  it('hodnota je stav účtu bez úvěru a prodejní cena vlaků', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.borrow();
    expect(companyValue(game)).toBe(game.money - game.loan + sellPrice(train, game.clock.day));
  });

  it('hodnocení skládá pět částí po 200 bodech a dává titul', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    train.lastIncome = 100;
    game.thisYear.passengers = 10_000;
    game.thisYear.freight.coal = 10_000;
    const parts = performance(game);
    expect(parts).toHaveLength(5);
    expect(parts[0].points).toBe(200);
    expect(parts[2].points).toBe(200);
    expect(parts[3].points).toBe(40);
    const score = performanceScore(parts);
    expect(score).toBe(parts.reduce((sum, p) => sum + p.points, 0));
    expect(performanceTitle(score)).toBe(score >= 400 ? 'Manažer' : 'Podnikatel');
    expect(performanceTitle(900)).toBe('Magnát');
  });
});
