import { describe, expect, it } from 'vitest';
import { GameClock } from './clock';

describe('herní kalendář', () => {
  it('rok trvá 15 minut reálného času', () => {
    const clock = new GameClock();
    let years = 0;
    clock.events.on('year', () => years++);
    // Jeden krok navíc kvůli zaokrouhlení součtu zlomků dne
    for (let ms = 0; ms <= 15 * 60 * 1000; ms += 250) clock.tick(250);
    expect(years).toBe(1);
    expect(clock.date).toEqual({ year: 1951, month: 0, day: 1 });
  });

  it('hra skončí v roce 2050 a dál čas nepokračuje', () => {
    const clock = new GameClock();
    let ends = 0;
    let months = 0;
    clock.events.on('end', () => ends++);
    clock.events.on('month', () => months++);
    while (!clock.ended) clock.tick(250);
    clock.tick(1000);
    expect(ends).toBe(1);
    expect(months).toBe(1200);
    expect(clock.date).toEqual({ year: 2050, month: 0, day: 1 });
  });

  it('pauza zastaví čas', () => {
    const clock = new GameClock();
    clock.paused = true;
    expect(clock.tick(10_000)).toBe(0);
    expect(clock.day).toBe(0);
  });
});
