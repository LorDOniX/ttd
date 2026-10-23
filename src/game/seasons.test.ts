import { describe, expect, it } from 'vitest';
import { seasonForDate, type Season } from './seasons';

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
});
