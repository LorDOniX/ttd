import { describe, expect, it } from 'vitest';
import { buildLine, layTrack } from '../test/fixtures';
import { TRAIN_MODELS } from './balance';
import { RailType } from '../world/rail';
import { trackTilesBetween } from '../world/route';

describe('elektrizace podél tažené trasy', () => {
  it('dlaždice po kolejích mezi dvěma body, bez odboček a jen po souvislé trati', () => {
    const { game } = buildLine();
    const { rail } = game.world;
    // Odbočka, která do trasy patřit nemá
    layTrack(game, { x: 20, y: 13 }, { x: 20, y: 6 });
    const tiles = trackTilesBetween(rail, { x: 12, y: 10 }, { x: 38, y: 20 })!;
    expect(tiles[0]).toEqual({ x: 12, y: 10 });
    expect(tiles.at(-1)).toEqual({ x: 38, y: 20 });
    expect(tiles.every((t) => rail.hasTrack(t.x, t.y))).toBe(true);
    expect(tiles.some((t) => t.x === 20 && t.y === 6)).toBe(false);
    // Sousední dlaždice po sobě (bez mostů)
    for (let i = 1; i < tiles.length; i++) {
      expect(Math.abs(tiles[i].x - tiles[i - 1].x) + Math.abs(tiles[i].y - tiles[i - 1].y)).toBe(1);
    }
    expect(trackTilesBetween(rail, { x: 12, y: 10 }, { x: 50, y: 50 })).toBeNull();
  });

  it('elektrizace podél trasy natáhne vedení jen na trať mezi body', () => {
    const { game } = buildLine();
    const { rail } = game.world;
    layTrack(game, { x: 20, y: 13 }, { x: 20, y: 6 });
    const tiles = trackTilesBetween(rail, { x: 12, y: 10 }, { x: 38, y: 20 })!;
    expect(game.construction.electrify(tiles)).toBeNull();
    expect(rail.isElectrified(12, 10)).toBe(true);
    expect(rail.isElectrified(20, 6)).toBe(false);
  });

  it('jiný druh koleje trasu přeruší', () => {
    const { game } = buildLine();
    const { rail } = game.world;
    rail.buildType = RailType.Monorail;
    layTrack(game, { x: 4, y: 30 }, { x: 10, y: 30 });
    rail.buildType = RailType.Rail;
    layTrack(game, { x: 11, y: 30 }, { x: 16, y: 30 });
    expect(trackTilesBetween(rail, { x: 4, y: 30 }, { x: 16, y: 30 })).toBeNull();
  });

  it('elektrické lokomotivy jsou už od 50. let a modely jsou seřazené podle roku', () => {
    const electric = TRAIN_MODELS.filter((m) => m.electric);
    expect(electric[0].year).toBeLessThan(1960);
    expect(TRAIN_MODELS.every((m, i) => i === 0 || TRAIN_MODELS[i - 1].year <= m.year)).toBe(true);
  });
});
