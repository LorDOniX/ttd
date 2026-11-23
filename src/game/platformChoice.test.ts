import { describe, expect, it } from 'vitest';
import { buildLine, buyTrain, layTrack, runDays } from '../test/fixtures';
import { Edge, type Station } from '../world/rail';
import type { Game } from './game';
import type { Train } from './trains';

// Linka A – B; k nástupišti A je připojené druhé nástupiště A2 o kolej vedle (y = 11), napojené výhybkou,
// u B depo za východním koncem
function twoPlatforms(length = 3) {
  const line = buildLine();
  const { game } = line;
  const shape = { x: 10, y: 11, axis: 'x' as const, length, tracks: 1 };
  expect(game.construction.buildStation(shape)).toBeNull();
  const { rail } = game.world;
  const a2 = rail.stations[rail.stations.length - 1];
  expect(a2.joinedTo).toBe(line.a.id);
  layTrack(game, { x: 10 + Math.floor(length / 2) + 1, y: 11 }, { x: 18, y: 10 });
  const depotB = rail.addDepot(42, 20, Edge.W);
  layTrack(game, { x: 41, y: 20 }, { x: 42, y: 20 });
  return { ...line, a2, depotB };
}

function headStation(game: Game, train: Train): Station | undefined {
  const head = train.path[train.path.length - 1];
  return head && game.world.rail.stationAt(head.x, head.y);
}

describe('volné nástupiště spojené stanice', () => {
  it('když první nástupiště drží jiný vlak, druhý zastaví u volného nástupiště téže stanice a naloží', () => {
    const { game, a, b, a2, depot, depotB } = twoPlatforms();
    game.subsidies.offer = () => false;
    // Vlak 1 stojí na A podle jízdního řádu dlouho a nástupiště drží
    const first = buyTrain(game, depot, 2);
    expect(game.fleet.start(first, [a.id, b.id], [{ wait: 500 }, {}])).toBeNull();
    for (let i = 0; i < 100 && first.state !== 'loading'; i++) runDays(game, 0.25);
    expect(first.state).toBe('loading');
    expect(headStation(game, first)).toBe(a);

    const second = buyTrain(game, depotB, 2);
    expect(game.fleet.start(second, [b.id, a.id])).toBeNull();
    let atA2 = false;
    for (let i = 0; i < 400 && !atA2; i++) {
      runDays(game, 0.25);
      a2.waiting = 50;
      atA2 = second.state === 'loading' && headStation(game, second) === a2;
    }
    expect(atA2).toBe(true);
    runDays(game, 1);
    expect(second.passengers).toBeGreaterThan(0);
    expect(first.state).toBe('loading');
  });

  it('krátké nástupiště nevadí, když má spojená stanice dost dlouhé; vlak si vybere to dlouhé', () => {
    const { game, a, b, a2, depotB } = twoPlatforms(5);
    const train = buyTrain(game, depotB, 6);
    // Souprava se 6 vagony (3,5 dlaždice) je delší než A (3 dlaždice), A2 má 5
    expect(game.fleet.setOrders(train, [b.id, a.id])).toBeNull();
    expect(game.fleet.shortStations(train)).toEqual([b]);
    expect(game.fleet.start(train, [b.id, a.id])).toBeNull();
    let stop: Station | undefined;
    for (let i = 0; i < 400 && !stop; i++) {
      runDays(game, 0.25);
      if (train.state === 'loading' && train.target === 1) stop = headStation(game, train);
    }
    expect(stop).toBe(a2);
  });
});
