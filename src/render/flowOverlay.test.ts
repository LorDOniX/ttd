import { describe, expect, it } from 'vitest';
import { buildFlowGeometry, flowColor, flowWidth, FLOW_COLORS, type FlowLink } from './flowOverlay';

const link = (capacity: number, usage: number): FlowLink => ({
  from: { x: 0, y: 0, ground: 0 },
  to: { x: 10, y: 0, ground: 0 },
  capacity,
  usage,
});

describe('mapa toků', () => {
  it('barva podle vytížení, šířka podle kapacity', () => {
    expect(flowColor(0)).toBe(FLOW_COLORS[0].color);
    expect(flowColor(0.2)).toBe(0x4fbd75);
    expect(flowColor(0.5)).toBe(0xe4c94a);
    expect(flowColor(0.8)).toBe(0xec8b38);
    expect(flowColor(1.4)).toBe(0xdf493e);
    expect(flowWidth(10)).toBeLessThan(flowWidth(500));
    expect(flowWidth(1e6)).toBeCloseTo(0.32);
  });

  it('oblouk nad terénem se šipkou; směry tam a zpět leží vedle sebe', () => {
    const there = link(100, 50);
    const back: FlowLink = { ...there, from: there.to, to: there.from };
    const geometry = buildFlowGeometry([there, back]);
    const positions = geometry.getAttribute('position');
    // 24 dílů po dvou trojúhelnících a šipka, pro každý směr
    expect(positions.count).toBe(2 * (24 * 6 + 3));
    // Uprostřed oblouk stoupá nad terén
    const ys = Array.from({ length: positions.count }, (_, i) => positions.getY(i));
    expect(Math.max(...ys)).toBeGreaterThan(1);
    // Směr tam je posunutý na jednu stranu (z > 0 při jízdě na východ), zpět na druhou
    const zThere = Array.from({ length: 24 * 6 }, (_, i) => positions.getZ(i));
    const zBack = Array.from({ length: 24 * 6 }, (_, i) => positions.getZ(24 * 6 + 3 + i));
    expect(Math.min(...zThere)).toBeGreaterThan(0);
    expect(Math.max(...zBack)).toBeLessThan(0);
  });
});
