import { describe, expect, it } from 'vitest';
import { BREAKDOWN_DAYS, RELIABILITY_DECAY_PER_DAY, TRAIN_MODELS } from './balance';
import { breakdownChance, newMaintenance, rollBreakdown, wearOut } from './reliability';
import { parseSave, restoreGame, serializeGame } from './save';
import { buildLine, buyTrain, runDays } from '../test/fixtures';

describe('spolehlivost', () => {
  it('klesá každý den, u starého vozidla dvakrát rychleji', () => {
    const v = newMaintenance(0.9, 0, 150);
    wearOut(v, 100, false);
    expect(v.reliability).toBeCloseTo(0.9 - 100 * RELIABILITY_DECAY_PER_DAY, 6);
    const old = newMaintenance(0.9, 0, 150);
    wearOut(old, 100, true);
    expect(0.9 - old.reliability).toBeCloseTo(2 * (0.9 - v.reliability), 6);
  });

  it('šance na poruchu roste s nespolehlivostí, snížené poruchy jsou vzácnější, bez poruch žádné', () => {
    expect(breakdownChance(0.5, 'normal')).toBeGreaterThan(breakdownChance(0.8, 'normal'));
    expect(breakdownChance(0.5, 'reduced')).toBeLessThan(breakdownChance(0.5, 'normal'));
    expect(breakdownChance(0, 'none')).toBe(0);
    const v = newMaintenance(0.2, 0, 150);
    expect(rollBreakdown(v, 1, 'normal', 0)).toBe(true);
    expect(v).toMatchObject({ brokenDays: BREAKDOWN_DAYS, breakdowns: 1 });
    expect(rollBreakdown(v, 1, 'normal', 0.999)).toBe(false);
  });

  it('nový vlak má spolehlivost svého modelu', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot);
    expect(train.reliability).toBe(TRAIN_MODELS[0].reliability);
    expect(train.serviceInterval).toBe(150);
  });
});

describe('poruchy a servis vlaků', () => {
  it('nespolehlivý vlak se porouchá a po dobu opravy stojí', () => {
    const { game, a, b, depot } = buildLine();
    game.breakdowns = 'normal';
    const train = buyTrain(game, depot);
    train.serviceInterval = 10_000;
    game.fleet.start(train, [a.id, b.id]);
    let broke = false;
    for (let day = 0; day < 300 && !broke; day++) {
      train.reliability = 0;
      runDays(game, 0.25);
      if (train.brokenDays > 0) {
        broke = true;
        const pos = train.pos;
        runDays(game, 1);
        expect(train.pos).toBe(pos);
        expect(train.speed).toBe(0);
      }
    }
    expect(broke).toBe(true);
    runDays(game, BREAKDOWN_DAYS + 1);
    expect(train.brokenDays).toBe(0);
  });

  it('bez poruch se vlak nekazí ani nejezdí na servis', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot);
    train.serviceInterval = 30;
    game.fleet.start(train, [a.id, b.id]);
    for (let day = 0; day < 200; day++) {
      train.reliability = 0;
      runDays(game, 1);
      expect(train.brokenDays).toBe(0);
      expect(train.servicing).toBeUndefined();
    }
  });

  it('po intervalu zajede vlak na servis do nejbližšího depa a pokračuje v řádu', () => {
    const { game, a, b, depot } = buildLine();
    game.breakdowns = 'reduced';
    const train = buyTrain(game, depot);
    train.serviceInterval = 40;
    game.fleet.start(train, [a.id, b.id]);
    let services = 0;
    let inService = false;
    let arrivals = 0;
    let state = train.state;
    for (let day = 0; day < 400; day++) {
      runDays(game, 0.5);
      const now = train.state === 'depot' && train.serviceUntil !== undefined;
      if (now && !inService) {
        services++;
        expect(train.reliability).toBe(TRAIN_MODELS[0].reliability);
      }
      inService = now;
      if (train.state === 'loading' && state !== 'loading') arrivals++;
      state = train.state;
    }
    expect(services).toBeGreaterThanOrEqual(2);
    expect(arrivals).toBeGreaterThanOrEqual(6);
    expect(game.clock.now - train.lastService).toBeLessThan(train.serviceInterval + 60);
  });

  it('údržba i nastavení poruch se uloží a načtou', () => {
    const { game, depot } = buildLine();
    game.breakdowns = 'reduced';
    const train = buyTrain(game, depot);
    Object.assign(train, { reliability: 0.42, lastService: 3, serviceInterval: 90, brokenDays: 2, breakdowns: 5 });
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.breakdowns).toBe('reduced');
    expect(copy.fleet.trains[0]).toMatchObject({
      reliability: 0.42,
      lastService: 3,
      serviceInterval: 90,
      brokenDays: 2,
      breakdowns: 5,
    });
  });
});
