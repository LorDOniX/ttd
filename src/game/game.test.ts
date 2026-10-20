import { describe, expect, it } from 'vitest';
import { emptyGame } from '../test/fixtures';

describe('historie zpráv', () => {
  it('pamatuje si datum a nejvýš 200 posledních zpráv', () => {
    const game = emptyGame();
    for (let i = 0; i < 205; i++) game.news(`zpráva ${i}`);
    expect(game.newsLog).toHaveLength(200);
    expect(game.newsLog[0].text).toBe('zpráva 5');
    expect(game.newsLog[199]).toEqual({ date: game.clock.date, text: 'zpráva 204' });
  });
});
