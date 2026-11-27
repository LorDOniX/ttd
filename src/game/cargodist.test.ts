import { describe, expect, it } from 'vitest';
import { CARGO_DIST_STOP_DAYS } from './balance';
import {
  buildLinkGraph,
  graphLinks,
  manualDistribution,
  newGameDistribution,
  parseDistribution,
  tripsPerMonth,
  type CargoRoute,
} from './cargodist';
import { parseSave, restoreGame, serializeGame } from './save';
import { buildLine, buyTrain } from '../test/fixtures';
import { defaultStationShape } from '../world/rail';

const at = (x: number) => ({ x, y: 0 });

describe('cargodist: nastavení', () => {
  it('výchozí je ručně; nová hra symetricky pro cestující a poštu; uložení nastavení zachová', () => {
    const { game } = buildLine();
    expect(game.cargodist.settings).toEqual(manualDistribution());
    expect(game.cargodist.enabled('passengers')).toBe(false);
    game.cargodist.settings = newGameDistribution();
    expect(game.cargodist.mode('passengers')).toBe('symmetric');
    expect(game.cargodist.mode('coal')).toBe('manual');
    game.cargodist.setMode('freight', 'asymmetric');
    // Ostatní náklad symetricky nejde
    game.cargodist.setMode('freight', 'symmetric');
    expect(game.cargodist.mode('goods')).toBe('asymmetric');
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'cd'))));
    expect(restored.cargodist.settings).toEqual({ passengers: 'symmetric', mail: 'symmetric', freight: 'asymmetric' });
    // Starší uložení bez údaje: vše ručně
    expect(parseDistribution(undefined)).toEqual(manualDistribution());
    expect(parseDistribution({ passengers: 'asymmetric', freight: 'symmetric' })).toEqual({
      passengers: 'asymmetric',
      mail: 'manual',
      freight: 'manual',
    });
  });
});

describe('cargodist: graf linek', () => {
  it('spojení mezi po sobě jdoucími zastávkami, kapacity linek se sčítají', () => {
    const line: CargoRoute = {
      cargo: 'passengers',
      stops: [1, 2, 3, 2],
      points: [at(0), at(10), at(30), at(10)],
      capacity: 60,
      speed: 4,
    };
    // Kolo 60 dlaždic za 15 dní a 4 zastávky po 2 dnech
    expect(tripsPerMonth(line)).toBeCloseTo(30 / (60 / 4 + 4 * CARGO_DIST_STOP_DAYS));
    const shuttle: CargoRoute = { cargo: 'passengers', stops: [1, 2], points: [at(0), at(10)], capacity: 30, speed: 5 };
    const mail: CargoRoute = { ...shuttle, cargo: 'mail' };
    const graph = buildLinkGraph([line, shuttle, mail], 'passengers');
    const links = graphLinks(graph).map((l) => `${l.from}-${l.to}`);
    expect(links.sort()).toEqual(['1-2', '2-1', '2-3', '3-2']);
    const ab = graph.get(1)!.get(2)!;
    expect(ab.distance).toBe(10);
    expect(ab.capacity).toBeCloseTo(60 * tripsPerMonth(line) + 30 * tripsPerMonth(shuttle));
    expect(graph.get(2)!.get(3)!.capacity).toBeCloseTo(60 * tripsPerMonth(line));
  });

  it('graf z řádů vozidel v provozu: bez vlaků v depu a bez průjezdů; části stanice splynou', () => {
    const { game, a, b, depot } = buildLine();
    const { rail } = game.world;
    const train = buyTrain(game, depot, 3);
    expect(game.cargodist.linksFrom(a, 'passengers')).toEqual([]);
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    const [ab] = game.cargodist.linksFrom(a, 'passengers');
    expect(ab).toMatchObject({ from: a.id, to: b.id });
    expect(ab.capacity).toBeGreaterThan(0);
    expect(game.cargodist.linksFrom(b, 'passengers').map((l) => l.to)).toEqual([a.id]);
    expect(game.cargodist.linksFrom(a, 'coal')).toEqual([]);

    // Průjezd bez zastavení se nepočítá: A → C (přes B) → A
    const c = rail.addStation({ ...defaultStationShape(25, 30, 'x'), name: 'C', townId: 0 });
    train.orders = [a.id, b.id, c.id];
    train.orderFlags = [{}, { via: true }, {}];
    game.events.emit('trainsChanged');
    expect(game.cargodist.linksFrom(a, 'passengers').map((l) => l.to)).toEqual([c.id]);

    // Zastávka aut připojená k A je táž stanice
    const stop = rail.addStation({ ...defaultStationShape(10, 12, 'x'), name: 'A', townId: 0, kind: 'road' });
    stop.joinedTo = a.id;
    train.orders = [stop.id, b.id];
    train.orderFlags = [];
    game.events.emit('trainsChanged');
    expect(game.cargodist.linksFrom(a, 'passengers').map((l) => l.to)).toEqual([b.id]);
  });
});
