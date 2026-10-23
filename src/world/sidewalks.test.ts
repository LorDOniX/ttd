import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from './map';
import { EDGE_DELTA } from './rail';
import { hasCrosswalks, nodePoint, sidewalkSteps, type RoadConnects } from './sidewalks';

function townRoad(map: GameMap, tiles: [number, number][], town = 0): void {
  for (const [x, y] of tiles) {
    map.set(x, y, TileType.Road);
    map.setOwner(x, y, town);
  }
}

const connects =
  (map: GameMap): RoadConnects =>
  (x, y, edge) =>
    map.isRoad(x + EDGE_DELTA[edge][0], y + EDGE_DELTA[edge][1]);

// Všechny uzly dosažitelné z uzlu start
function reachable(map: GameMap, start: number): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const { to } of sidewalkSteps(map, connects(map), queue.pop()!)) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

const node = (map: GameMap, x: number, y: number, corner: number): number => (y * map.width + x) * 4 + corner;

describe('chodníky', () => {
  it('na rovné silnici vede chodník podél okraje a přes hranu dál, silnici nepřechází', () => {
    const map = new GameMap(10, 10);
    townRoad(map, [
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    const steps = sidewalkSteps(map, connects(map), node(map, 4, 5, 0));
    expect(steps.map((s) => s.to).sort()).toEqual([node(map, 3, 5, 1), node(map, 4, 5, 1)].sort());
    expect(steps.every((s) => !s.crossing)).toBe(true);
  });

  it('slepá ulice se dá obejít kolem konce na druhou stranu', () => {
    const map = new GameMap(10, 10);
    townRoad(map, [
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    const all = reachable(map, node(map, 3, 5, 0));
    expect(all.has(node(map, 5, 5, 2))).toBe(true);
  });

  it('na křižovatce jsou zebry a přes ně se dostane na všechny chodníky', () => {
    const map = new GameMap(12, 12);
    const cross: [number, number][] = [];
    for (let i = 1; i < 11; i++) cross.push([i, 5], [5, i]);
    townRoad(map, cross);
    expect(hasCrosswalks(map, connects(map), 5, 5)).toBe(true);
    expect(hasCrosswalks(map, connects(map), 4, 5)).toBe(false);
    const steps = sidewalkSteps(map, connects(map), node(map, 5, 5, 0));
    expect(steps.filter((s) => s.crossing)).toHaveLength(2);
    // Všechny rohy všech 19 dlaždic křížení
    expect(reachable(map, node(map, 1, 5, 0)).size).toBe(19 * 4);
  });

  it('chodník nepřejde na silnici jiného města ani mimo město', () => {
    const map = new GameMap(10, 10);
    townRoad(map, [[3, 5]], 0);
    townRoad(map, [[4, 5]], 1);
    map.set(5, 5, TileType.Road);
    const all = reachable(map, node(map, 3, 5, 0));
    expect([...all].every((n) => n >> 2 === 5 * 10 + 3)).toBe(true);
    expect(sidewalkSteps(map, connects(map), node(map, 5, 5, 0))).toEqual([]);
  });

  it('roh leží uprostřed chodníku', () => {
    const map = new GameMap(10, 10);
    expect(nodePoint(map, node(map, 2, 3, 2))).toEqual({ x: 2.9, y: 3.9 });
  });
});
