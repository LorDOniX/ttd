import { describe, expect, it } from 'vitest';
import {
  INDUSTRY_CHANGE_CHANCE,
  INDUSTRY_FUND_COST,
  INDUSTRY_IDLE_CLOSE_CHANCE,
  INDUSTRY_IDLE_YEARS,
  NEW_INDUSTRY_CHANCE_PER_TILE,
} from './balance';
import { addIndustry, emptyGame, runDays } from '../test/fixtures';
import { INDUSTRY_TYPES, industryTiles } from '../world/industry';
import { TileType } from '../world/map';
import type { Game } from './game';

// Náhoda vyjde jen u vybraných pravděpodobností
function only(game: Game, ...hits: number[]): void {
  game.rng.chance = (p) => hits.includes(p);
}

function newsOf(game: Game): string[] {
  const news: string[] = [];
  game.events.on('news', (text) => news.push(text));
  return news;
}

describe('založení závodu hráčem', () => {
  it('postaví areál na volném místě a stráhne cenu', () => {
    const game = emptyGame();
    game.money = 5_000_000;
    let changed = 0;
    game.events.on('industriesChanged', () => changed++);

    expect(game.industryLife.fund('coal-mine', 20, 20, 2)).toBeNull();

    const [mine] = game.world.industries;
    expect(mine).toMatchObject({ kind: 'coal-mine', x: 20, y: 20, rotation: 2, lastDelivery: game.clock.day });
    const range = INDUSTRY_TYPES['coal-mine'].production!;
    expect(mine.production).toBeGreaterThanOrEqual(range.min);
    expect(mine.production).toBeLessThanOrEqual(range.max);
    expect(industryTiles(mine).every((t) => game.world.map.get(t.x, t.y) === TileType.Industry)).toBe(true);
    expect(game.money).toBe(5_000_000 - INDUSTRY_FUND_COST['coal-mine']);
    expect(changed).toBe(1);
  });

  it('odmítne místo u jiného závodu, u okraje i bez peněz', () => {
    const game = emptyGame();
    game.money = 5_000_000;
    addIndustry(game, 'farm', 20, 20);
    expect(game.industryLife.fund('sawmill', 30, 20, 0)).toContain('jiného závodu');
    expect(game.industryLife.fund('sawmill', 0, 0, 0)).toContain('okraje');
    game.money = INDUSTRY_FUND_COST.refinery - 1;
    expect(game.industryLife.fund('refinery', 40, 40, 0)).toContain('Nedostatek peněz');
    expect(game.world.industries).toHaveLength(1);
  });
});

describe('živý průmysl', () => {
  it('dobře obsloužený důl zvýší těžbu', () => {
    const game = emptyGame();
    const mine = addIndustry(game, 'coal-mine', 20, 20);
    mine.transported = 100;
    game.rng.chance = (p) => p !== 64 * 64 * NEW_INDUSTRY_CHANCE_PER_TILE && p !== INDUSTRY_IDLE_CLOSE_CHANCE;
    runDays(game, 31);
    expect(mine.production).toBe(180);
  });

  it('vyčerpaný důl zanikne a uvolní dlaždice', () => {
    const game = emptyGame();
    const mine = addIndustry(game, 'coal-mine', 20, 20);
    mine.production = 35;
    only(game, INDUSTRY_CHANGE_CHANCE);
    const news = newsOf(game);
    let changed = 0;
    game.events.on('industriesChanged', () => changed++);
    runDays(game, 31);
    expect(game.world.industries).toEqual([]);
    expect(industryTiles(mine).every((t) => game.world.map.get(t.x, t.y) === TileType.Grass)).toBe(true);
    expect(news.some((text) => text.includes('vyčerpané'))).toBe(true);
    expect(changed).toBe(1);
  });

  it('zpracovatel bez dodávek po letech zanikne, zásobovaný ne', () => {
    const game = emptyGame();
    const idle = addIndustry(game, 'sawmill', 10, 10);
    const supplied = addIndustry(game, 'steel-mill', 30, 30);
    idle.lastDelivery = -INDUSTRY_IDLE_YEARS * 365 - 1;
    supplied.lastDelivery = -INDUSTRY_IDLE_YEARS * 365 + 60;
    only(game, INDUSTRY_IDLE_CLOSE_CHANCE);
    runDays(game, 31);
    expect(game.world.industries).toEqual([supplied]);
  });

  it('elektrárna nezaniká', () => {
    const game = emptyGame();
    const plant = addIndustry(game, 'power-station', 10, 10);
    plant.lastDelivery = -100 * 365;
    only(game, INDUSTRY_IDLE_CLOSE_CHANCE, INDUSTRY_CHANGE_CHANCE);
    runDays(game, 31);
    expect(game.world.industries).toEqual([plant]);
  });

  it('občas vznikne nový závod na volné zemi', () => {
    const game = emptyGame();
    only(game, 64 * 64 * NEW_INDUSTRY_CHANCE_PER_TILE);
    const news = newsOf(game);
    runDays(game, 31);
    expect(game.world.industries).toHaveLength(1);
    const [industry] = game.world.industries;
    expect(industryTiles(industry).every((t) => game.world.map.get(t.x, t.y) === TileType.Industry)).toBe(true);
    expect(news).toContain(`Zahájen provoz: ${industry.name}.`);
  });
});
