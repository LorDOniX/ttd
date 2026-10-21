import { describe, expect, it } from 'vitest';
import { RATING_DAILY_CHANGE, RATING_MAX_DAILY_LEAVE, RATING_START } from './balance';
import { inflowFactor, leaveShare, ratingParts, updateRating } from './rating';
import { buildLine, buyTrain, runDays } from '../test/fixtures';

describe('hodnocení nástupiště', () => {
  it('skládá se z doby od vlaku, jeho rychlosti a počtu čekajících', () => {
    const { a } = buildLine();
    expect(ratingParts(a, 100)).toEqual({ visit: 0, speed: 0, waiting: 0.3 });
    Object.assign(a, { lastVisit: 95, lastSpeed: 5, waiting: 150 });
    expect(ratingParts(a, 100)).toEqual({ visit: 0.4, speed: 0.15, waiting: 0.2 });
    Object.assign(a, { lastVisit: 80, lastSpeed: 20, waiting: 500 });
    expect(ratingParts(a, 100)).toEqual({ visit: 0.3, speed: 0.3, waiting: 0 });
  });

  it('k cíli se posouvá nejvýš o 1 bod denně', () => {
    const { a } = buildLine();
    a.rating = 0.9;
    updateRating(a, 0);
    expect(a.rating).toBeCloseTo(0.9 - RATING_DAILY_CHANGE);
  });

  it('ovlivňuje příliv a odchod cestujících', () => {
    expect(inflowFactor(RATING_START)).toBe(1);
    expect(inflowFactor(1)).toBe(1.5);
    expect(leaveShare(0.5)).toBe(0);
    expect(leaveShare(0)).toBe(RATING_MAX_DAILY_LEAVE);
  });

  it('obsluhované nástupiště hodnocení zvedá, opuštěné klesá a cestující odcházejí', () => {
    const { game, a, b, depot, townA, townB } = buildLine();
    // Menší města, aby jeden vlak stačil odvážet
    townA.population = townB.population = 1500;
    const train = buyTrain(game, depot);
    game.fleet.start(train, [a.id, b.id]);
    runDays(game, 90);
    // Jediný parní vlak se dvěma vagony drží nástupiště kolem neutrálních 50 %
    expect(a.rating).toBeGreaterThan(0.45);

    game.fleet.sendToDepot(train);
    runDays(game, 120);
    expect(a.rating).toBeLessThan(0.35);
    const waiting = a.waiting;
    const full = game.passengers.inflow(a) * 3;
    expect(waiting).toBeLessThan(full);
  });
});
