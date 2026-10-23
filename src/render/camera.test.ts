import { describe, expect, it } from 'vitest';
import { nextRotationTarget } from './camera';

const quarterTurn = Math.PI / 2;

describe('otočení kamery', () => {
  it('z celého kroku pokračuje o dalších 90 stupňů', () => {
    expect(nextRotationTarget(quarterTurn, 1)).toBe(quarterTurn * 2);
    expect(nextRotationTarget(quarterTurn, -1)).toBe(0);
  });

  it('z mezilehlého úhlu nejdřív dojede na nejbližší hranici ve směru kliknutí', () => {
    expect(nextRotationTarget(quarterTurn * 0.4, 1)).toBe(quarterTurn);
    expect(nextRotationTarget(quarterTurn * 0.4, -1)).toBe(0);
    expect(nextRotationTarget(-quarterTurn * 0.4, 1)).toBe(0);
    expect(nextRotationTarget(-quarterTurn * 0.4, -1)).toBe(-quarterTurn);
  });

  it('považuje zanedbatelnou odchylku za zarovnaný krok', () => {
    expect(nextRotationTarget(quarterTurn + 1e-8, 1)).toBe(quarterTurn * 2);
  });
});
