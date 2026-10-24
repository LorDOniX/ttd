import { describe, expect, it } from 'vitest';
import { dominantSeason, seasonBlendForDate, seasonForDate, type Season } from './seasons';

describe('roční období', () => {
  it.each([
    [0, 'winter'],
    [1, 'winter'],
    [2, 'spring'],
    [4, 'spring'],
    [5, 'summer'],
    [7, 'summer'],
    [8, 'autumn'],
    [10, 'autumn'],
    [11, 'winter'],
  ])('v měsíci %i vybírá období %s', (month, season) => {
    expect(seasonForDate({ month }, 'auto')).toBe(season as Season);
  });

  it('ruční volba přebije datum', () => {
    expect(seasonForDate({ month: 0 }, 'summer')).toBe('summer');
    expect(seasonForDate({ month: 6 }, 'winter')).toBe('winter');
  });

  it('v prvním měsíci období plynule přechází z předchozího', () => {
    expect(seasonBlendForDate({ month: 8, day: 1 }, 'auto')).toEqual({ from: 'summer', to: 'autumn', t: 0 });
    const middle = seasonBlendForDate({ month: 8, day: 16 }, 'auto');
    expect(middle.t).toBeCloseTo(0.5);
    expect(seasonBlendForDate({ month: 8, day: 30 }, 'auto').t).toBeCloseTo(29 / 30);
    expect(seasonBlendForDate({ month: 11, day: 10 }, 'auto').from).toBe('autumn');
    expect(seasonBlendForDate({ month: 2, day: 10 }, 'auto').from).toBe('winter');
    expect(seasonBlendForDate({ month: 9, day: 10 }, 'auto')).toEqual({ from: 'autumn', to: 'autumn', t: 1 });
    expect(seasonBlendForDate({ month: 8, day: 1 }, 'summer')).toEqual({ from: 'summer', to: 'summer', t: 1 });
    expect(dominantSeason({ from: 'summer', to: 'autumn', t: 0.4 })).toBe('summer');
    expect(dominantSeason({ from: 'summer', to: 'autumn', t: 0.6 })).toBe('autumn');
  });
});
