import { describe, expect, it } from 'vitest';
import { addIndustry, buildLine, buyTrain, emptyGame, makeTown, runDays } from '../test/fixtures';
import { SUBSIDY_DURATION_MONTHS, SUBSIDY_OFFER_MONTHS } from './balance';
import { loadCargo, transferOut, type Carrier, type Transfers } from './cargo';
import { parseSave, restoreGame, serializeGame } from './save';
import { monthIndex, type Subsidy } from './subsidies';
import type { Game } from './game';

function passengerSubsidy(game: Game, from: number, to: number): Subsidy {
  const subsidy: Subsidy = {
    id: game.subsidies.nextId++,
    cargo: 'passengers',
    from: { kind: 'town', id: from },
    to: { kind: 'town', id: to },
    until: monthIndex(game.clock.date) + SUBSIDY_OFFER_MONTHS,
    awarded: false,
  };
  game.subsidies.list.push(subsidy);
  return subsidy;
}

describe('dotace', () => {
  it('nabídne přepravu mezi městy v dosahu a nabídka po roce vyprší', () => {
    const { game } = buildLine();
    while (!game.subsidies.list.some((s) => s.cargo === 'passengers')) expect(game.subsidies.offer()).toBe(true);
    const offer = game.subsidies.list.find((s) => s.cargo === 'passengers')!;
    expect(offer.awarded).toBe(false);
    expect([offer.from.id, offer.to.id].sort()).toEqual([0, 1]);
    expect(offer.until).toBe(monthIndex(game.clock.date) + SUBSIDY_OFFER_MONTHS);
    expect(game.subsidies.describe(offer)).toMatch(/^Přeprava cestujících: /);
    const expired: string[] = [];
    game.events.on('news', (text) => /vypršela/.test(text) && expired.push(text));
    runDays(game, 370);
    expect(game.subsidies.list).not.toContain(offer);
    expect(expired.length).toBeGreaterThan(0);
  });

  it('náklad nabízí závod s malým odvozem do závodu, který ho vykupuje', () => {
    const game = emptyGame(64);
    const mine = addIndustry(game, 'coal-mine', 5, 5);
    const plant = addIndustry(game, 'power-station', 40, 30);
    expect(game.subsidies.offer()).toBe(true);
    const [offer] = game.subsidies.list;
    expect(offer).toMatchObject({ cargo: 'coal', from: { kind: 'industry', id: mine.id } });
    expect(offer.to).toEqual({ kind: 'industry', id: plant.id });
    // Ze závodu, odkud se už odváží většina výroby, se dotace nenabízí
    game.subsidies.list.length = 0;
    mine.lastTransported = mine.production;
    expect(game.subsidies.offer()).toBe(false);
  });

  it('první dodávka dotaci udělí a za přepravu se pak platí násobek', () => {
    const { game, a, b, depot } = buildLine();
    const subsidy = passengerSubsidy(game, 0, 1);
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id]);
    a.waiting = 40;
    const deliveries: string[] = [];
    let paid = 0;
    game.events.on('income', (amount) => (paid += amount));
    game.events.on('news', (text) => /přivezl .* do stanice B/.test(text) && deliveries.push(text));
    const awarded: string[] = [];
    game.events.on('news', (text) => /Dotace udělena/.test(text) && awarded.push(text));
    for (let i = 0; i < 40_000 && deliveries.length === 0; i++) game.update(200);
    expect(awarded).toHaveLength(1);
    expect(subsidy.awarded).toBe(true);
    expect(subsidy.until).toBe(monthIndex(game.clock.date) + SUBSIDY_DURATION_MONTHS);
    const match = /\+([\d\s ]+)Kč \(z toho dotace ([\d\s ]+)Kč\)/.exec(deliveries[0])!;
    const [total, bonus] = [match[1], match[2]].map((n) => Number(n.replace(/\s/g, '')));
    // Výchozí násobek ×2: dotace je stejně velká jako základní jízdné
    expect(bonus).toBe(total - bonus);
    expect(train.income).toBe(paid);
  });

  it('dotace platí jen ze zdroje do cíle, ne obráceně', () => {
    const { game, a, b } = buildLine();
    passengerSubsidy(game, 0, 1);
    expect(game.subsidies.bonus('passengers', b.id, a, 1000)).toBe(0);
    expect(game.subsidies.bonus('mail', a.id, b, 1000)).toBe(0);
    expect(game.subsidies.list[0].awarded).toBe(false);
    game.subsidies.multiplier = 3;
    expect(game.subsidies.bonus('passengers', a.id, b, 1000)).toBe(2000);
    expect(game.subsidies.list[0].awarded).toBe(true);
  });

  it('náklad si přes překládku pamatuje stanici, kde nastoupil', () => {
    const carrier = (): Carrier => ({
      name: 'x',
      passengers: 0,
      boardedStation: -1,
      boardedAt: 0,
      tiles: 0,
      income: 0,
    });
    const a = { id: 1 };
    const transfer: { id: number; transfers?: Transfers } = { id: 2 };
    const first = carrier();
    loadCargo(first, a, 'passengers', 10, 10, 0);
    expect(first.origin).toBe(1);
    transferOut(first, transfer, 'passengers', 10, 50);
    const second = carrier();
    loadCargo(second, transfer, 'passengers', 10, 0, 5);
    expect(second.boardedStation).toBe(2);
    expect(second.origin).toBe(1);
  });

  it('zanikne-li zdroj nebo cíl, dotace se zruší', () => {
    const game = emptyGame(64, [makeTown(0, 10, 10), makeTown(1, 40, 30)]);
    const mine = addIndustry(game, 'coal-mine', 5, 30);
    game.subsidies.list.push({
      id: 1,
      cargo: 'coal',
      from: { kind: 'industry', id: mine.id },
      to: { kind: 'town', id: 1 },
      until: monthIndex(game.clock.date) + 12,
      awarded: true,
    });
    game.world.industries.length = 0;
    const news: string[] = [];
    game.events.on('news', (text) => news.push(text));
    runDays(game, 32);
    expect(game.subsidies.list.some((s) => s.id === 1)).toBe(false);
    expect(news.some((text) => /Dotace zrušena/.test(text))).toBe(true);
  });

  it('dotace a násobek se uloží a načtou', () => {
    const { game } = buildLine();
    passengerSubsidy(game, 0, 1);
    game.subsidies.list[0].awarded = true;
    game.subsidies.multiplier = 4;
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.subsidies.list).toEqual(game.subsidies.list);
    expect(copy.subsidies.multiplier).toBe(4);
    expect(copy.subsidies.nextId).toBe(game.subsidies.nextId);
    expect(copy.subsidies.rng.state).toBe(game.subsidies.rng.state);
  });
});
