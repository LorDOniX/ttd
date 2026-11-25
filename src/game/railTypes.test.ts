import { describe, expect, it } from 'vitest';
import { addBuilding, emptyGame, layTrack, makeTown, runDays } from '../test/fixtures';
import { MONORAIL_COST_FACTOR, TRACK_PIECE_COST, TRAIN_MODELS } from './balance';
import { trackPieceCost } from './construction';
import type { Game } from './game';
import { parseSave, restoreGame, serializeGame } from './save';
import { modelRailType, type Train } from './trains';
import { Edge, RailType, defaultStationShape } from '../world/rail';
import { findRoute, railNetworks } from '../world/route';
import { findTrackPath } from '../world/railPath';

const model = (id: string) => TRAIN_MODELS.find((m) => m.id === id)!;

// Dvě města, nástupiště A a B spojená kolejí daného druhu, depo za A
function line(type: RailType) {
  const townA = makeTown(0, 10, 14);
  const townB = makeTown(1, 40, 24);
  const game = emptyGame(64, [townA, townB]);
  game.money = 50_000_000;
  game.clock.date = { year: 2020, month: 5, day: 1 };
  addBuilding(game, townA, 10, 12);
  addBuilding(game, townB, 40, 22);
  const { rail } = game.world;
  rail.buildType = type;
  const a = rail.addStation({ ...defaultStationShape(10, 10, 'x'), name: 'A', townId: 0 });
  const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), name: 'B', townId: 1 });
  layTrack(game, { x: 12, y: 10 }, { x: 38, y: 20 });
  const depot = rail.addDepot(8, 10, Edge.E);
  return { game, a, b, depot };
}

function buy(game: Game, depot: ReturnType<typeof line>['depot'], id: string): Train | string {
  return game.fleet.buyTrain(depot, model(id), 'passengers', 2);
}

describe('druhy kolejí: jednokolejka a maglev', () => {
  it('nová kolej dostane vybraný druh; jiný druh na ni nenaváže ani ji nepřevezme', () => {
    const { game } = line(RailType.Monorail);
    const { rail } = game.world;
    expect(rail.railTypeAt(20, 15) === RailType.Monorail || rail.railTypeAt(12, 10) === RailType.Monorail).toBe(true);
    expect(rail.railTypeAt(10, 10)).toBe(RailType.Monorail);
    expect(rail.railTypeAt(8, 10)).toBe(RailType.Monorail);
    rail.buildType = RailType.Rail;
    expect(rail.canPlace(12, 10, 0)).toBe(false);
    expect(rail.canPlace(12, 11, 0)).toBe(true);
    // Železnice podél jednokolejky ji nepřevezme jako hotovou kolej
    const plan = findTrackPath(rail, { x: 12, y: 10 }, { x: 16, y: 10 });
    expect(plan === null || plan.every((s) => rail.railTypeAt(s.x, s.y) !== RailType.Monorail || s.isNew)).toBe(true);
  });

  it('sítě různých druhů na sebe nenavazují ani při dotyku', () => {
    const { game } = line(RailType.Monorail);
    const { rail } = game.world;
    // Železnice navazující přímo na konec jednokolejky za depem
    rail.buildType = RailType.Rail;
    layTrack(game, { x: 7, y: 10 }, { x: 2, y: 10 });
    rail.buildType = RailType.Monorail;
    const labels = railNetworks(rail);
    const width = rail.map.width;
    expect(labels[10 * width + 9]).not.toBe(labels[10 * width + 5]);
    const route = findRoute(rail, { x: 9, y: 10, exit: Edge.W, heading: 4 }, (x, y) => x === 3 && y === 10, {
      x: 3,
      y: 10,
    });
    expect(route).toBeNull();
  });

  it('dílek jednokolejky je dražší a stavba ho zaplatí', () => {
    const { game } = line(RailType.Monorail);
    expect(trackPieceCost(game.world.map, 30, 30, RailType.Monorail)).toBe(
      Math.round(TRACK_PIECE_COST * MONORAIL_COST_FACTOR),
    );
    const { rail } = game.world;
    const steps = findTrackPath(rail, { x: 20, y: 40 }, { x: 25, y: 40 })!;
    const money = game.money;
    game.construction.buildTrack(steps);
    game.construction.update(60_000);
    expect(money - game.money).toBe(steps.length * Math.round(TRACK_PIECE_COST * MONORAIL_COST_FACTOR));
    expect(rail.railTypeAt(22, 40)).toBe(RailType.Monorail);
  });

  it('v depu jednokolejky jde koupit jen vlak jednokolejky a ten jezdí a vydělává', () => {
    const { game, a, b, depot } = line(RailType.Monorail);
    expect(modelRailType(model('monorail'))).toBe(RailType.Monorail);
    expect(game.fleet.fitsDepot(model('diesel'), depot)).toBe(false);
    expect(buy(game, depot, 'diesel')).toMatch(/depo na železnici/);
    const train = buy(game, depot, 'monorail') as Train;
    expect(typeof train).toBe('object');
    a.waiting = 60;
    b.waiting = 60;
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    runDays(game, 40);
    expect(train.income).toBeGreaterThan(0);
  });

  it('maglev: vlastní vlaky; elektrizace se ho netýká', () => {
    const { game, depot } = line(RailType.Maglev);
    expect(game.fleet.fitsDepot(model('maglev'), depot)).toBe(true);
    expect(game.fleet.fitsDepot(model('monorail'), depot)).toBe(false);
    expect(
      game.construction.electrify([
        { x: 20, y: 15 },
        { x: depot.x, y: depot.y },
      ]),
    ).toMatch(/kolej bez trolejí/);
  });

  it('uložení zachová druh koleje; starší uložení mají železnici', () => {
    const { game } = line(RailType.Monorail);
    const data = serializeGame(game, 'x');
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.world.rail.railTypeAt(10, 10)).toBe(RailType.Monorail);
    const legacy = JSON.parse(JSON.stringify(data));
    delete legacy.rail.railType;
    expect(restoreGame(parseSave(JSON.stringify(legacy))).world.rail.railTypeAt(10, 10)).toBe(RailType.Rail);
  });
});
