import { describe, expect, it } from 'vitest';
import { CARGO_DIST_STOP_DAYS } from './balance';
import {
  buildLinkGraph,
  computeDemand,
  computeFlows,
  shortestNextHop,
  graphLinks,
  manualDistribution,
  newGameDistribution,
  parseDistribution,
  tripsPerMonth,
  type CargoRoute,
  type LinkGraph,
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

// Graf ze seznamu spojení [z, do, kapacita, délka]
function graphOf(links: [number, number, number, number][]): LinkGraph {
  const graph: LinkGraph = new Map();
  for (const [from, to, capacity, distance] of links) {
    if (!graph.has(from)) graph.set(from, new Map());
    graph.get(from)!.set(to, { from, to, capacity, distance });
  }
  return graph;
}

const both = (a: number, b: number, capacity: number, distance: number): [number, number, number, number][] => [
  [a, b, capacity, distance],
  [b, a, capacity, distance],
];

describe('cargodist: poptávka a toky', () => {
  const positions = new Map([
    [1, { x: 0, y: 0 }],
    [2, { x: 10, y: 0 }],
    [3, { x: 20, y: 0 }],
    [4, { x: 400, y: 0 }],
  ]);

  it('symetricky podle nabídky cíle, asymetricky rovným dílem; jen dosažitelné cíle, které náklad přijímají', () => {
    // 1 ↔ 2 ↔ 3, do 4 se jen jede (z 4 nikam)
    const graph = graphOf([...both(1, 2, 100, 10), ...both(2, 3, 100, 10), [3, 4, 100, 380]]);
    const supply = new Map([
      [1, 90],
      [2, 30],
      [3, 60],
      [4, 60],
    ]);
    const accepts = new Set([1, 2, 3, 4]);
    const sym = computeDemand(graph, { supply, accepts, positions }, 'symmetric');
    const from1 = sym.get(1)!;
    // Váha cíle = nabídka / (1 + vzdálenost / 100)
    const w2 = 30 / 1.1;
    const w3 = 60 / 1.2;
    const w4 = 60 / 5;
    expect(from1.get(2)).toBeCloseTo((90 * w2) / (w2 + w3 + w4));
    expect(from1.get(4)).toBeCloseTo((90 * w4) / (w2 + w3 + w4));
    // Ze 4 nevede žádné spojení
    expect(sym.has(4)).toBe(false);

    const asym = computeDemand(graph, { supply, accepts: new Set([3, 4]), positions }, 'asymmetric');
    expect(asym.get(1)!.get(3)! / asym.get(1)!.get(4)!).toBeCloseTo(5 / 1.2);
    expect([...asym.get(3)!.keys()]).toEqual([4]);
    expect(computeDemand(graph, { supply, accepts, positions }, 'manual').size).toBe(0);
  });

  it('toky po cestě: na každé stanici podíl další zastávky k cíli', () => {
    const graph = graphOf([...both(1, 2, 100, 10), ...both(2, 3, 100, 10)]);
    const demand = new Map([[1, new Map([[3, 40]])]]);
    const flows = computeFlows(graph, demand);
    expect(flows.get(1)!.get(3)).toEqual(new Map([[2, 40]]));
    expect(flows.get(2)!.get(3)).toEqual(new Map([[3, 40]]));
    expect(shortestNextHop(graph, 3, 1)).toBe(2);
    expect(shortestNextHop(graph, 1, 4)).toBeUndefined();
  });

  it('přetížené přímé spojení: část nákladu jede objížďkou', () => {
    // Přímo 1 → 2 (10 dlaždic, kapacita 30), objížďka 1 → 3 → 2 (12 dlaždic, kapacita 500)
    const graph = graphOf([
      [1, 2, 30, 10],
      [1, 3, 500, 6],
      [3, 2, 500, 6],
    ]);
    const flows = computeFlows(graph, new Map([[1, new Map([[2, 120]])]]));
    const hops = flows.get(1)!.get(2)!;
    expect(hops.get(2)).toBeGreaterThan(0);
    expect(hops.get(3)).toBeGreaterThan(0);
    expect(hops.get(2)! + hops.get(3)!).toBeCloseTo(120);
    // Bez přetížení jede všechno přímo
    const light = computeFlows(graph, new Map([[1, new Map([[2, 20]])]]));
    expect(light.get(1)!.get(2)).toEqual(new Map([[2, 20]]));
  });

  it('ve hře: cestující z A mají cíl B a jedou přímo, při ruční distribuci žádná poptávka', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 3);
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    expect(game.cargodist.demandFrom(a, 'passengers').size).toBe(0);
    game.cargodist.settings = newGameDistribution();
    const demand = game.cargodist.demandFrom(a, 'passengers');
    expect([...demand.keys()]).toEqual([b.id]);
    expect(demand.get(b.id)).toBeCloseTo(game.passengers.inflow(a));
    expect(game.cargodist.nextHops(a, 'passengers', b.id)).toEqual(new Map([[b.id, 1]]));
    expect(game.cargodist.flowsAt(b, 'passengers').get(a.id)).toBeDefined();
  });
});
