import { describe, expect, it } from 'vitest';
import { buildLine, layTrack } from '../test/fixtures';
import { DEMOLISH_REFUND, ELECTRIFY_TILE_COST, TRAIN_MODELS } from './balance';
import { trackPieceCost } from './construction';
import { parseSave, restoreGame, serializeGame } from './save';
import type { Game } from './game';
import type { TilePos } from '../world/map';

const electric = TRAIN_MODELS.find((m) => m.id === 'electric')!;
const steam = TRAIN_MODELS.find((m) => m.id === 'steam')!;

function allTiles(game: Game): TilePos[] {
  const tiles: TilePos[] = [];
  for (let y = 0; y < game.world.map.height; y++) for (let x = 0; x < game.world.map.width; x++) tiles.push({ x, y });
  return tiles;
}

function electricLine() {
  const line = buildLine();
  line.game.clock.date = { year: 2000, month: 0, day: 1 };
  return line;
}

describe('elektrizace', () => {
  it('elektrickou lokomotivu jde koupit jen v elektrizovaném depu', () => {
    const { game, depot } = electricLine();
    expect(game.fleet.buy(depot, electric)).toMatch(/elektrizované depo/);
    expect(game.fleet.buy(depot, steam)).toBeNull();
    const money = game.money;
    expect(game.construction.electrify([{ x: depot.x, y: depot.y }])).toBeNull();
    expect(game.money).toBe(money - ELECTRIFY_TILE_COST);
    expect(game.fleet.buy(depot, electric)).toBeNull();
  });

  it('elektrický vlak jezdí jen pod vedením; parní všude', () => {
    const { game, a, b, depot } = electricLine();
    game.construction.electrify([{ x: depot.x, y: depot.y }]);
    game.fleet.buy(depot, electric);
    const train = game.fleet.trains[0];
    game.fleet.addWagon(train);
    game.fleet.addWagon(train);
    expect(game.fleet.start(train, [a.id, b.id])).toMatch(/nevede kolej/);
    // Vlak, kterému cestou zmizí vedení, hlásí, že chybí troleje
    expect(game.construction.electrify(allTiles(game))).toBeNull();
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    const news: string[] = [];
    game.events.on('news', (text) => news.push(text));
    for (let i = 0; i < 20_000 && !(train.state === 'running' && train.target === 1); i++) game.update(200);
    const ahead = train.path[Math.floor(train.path.length * 0.8)];
    expect(game.construction.electrify([{ x: ahead.x, y: ahead.y }], true)).toBeNull();
    for (let i = 0; i < 2000 && !news.some((t) => /trolejové vedení/.test(t)); i++) game.update(200);
    expect(news.some((t) => /nemůže najít cestu.*trolejové vedení/.test(t))).toBe(true);
    // Po doplnění vedení vlak cestu najde a dojede
    expect(game.construction.electrify([{ x: ahead.x, y: ahead.y }])).toBeNull();
    let delivered = false;
    a.waiting = 20;
    game.events.on('news', (text) => (delivered ||= /do stanice B/.test(text)));
    for (let i = 0; i < 40_000 && !delivered; i++) game.update(200);
    expect(delivered).toBe(true);
    // Pod jedoucím vlakem vedení sundat nejde, jinde ano (vrátí polovinu)
    const body = game.fleet.trains[0];
    expect(body.state).not.toBe('depot');
    expect(game.construction.electrify(allTiles(game), true)).toMatch(/elektrický vlak/);
  });

  it('stavba elektrizované koleje, nástupiště a depa natáhne vedení a stojí víc', () => {
    const { game } = electricLine();
    const { rail, map } = game.world;
    const steps = layTrack(game, { x: 5, y: 40 }, { x: 15, y: 40 });
    for (const s of steps) rail.removeTrack(s.x, s.y);
    const money = game.money;
    game.construction.buildTrack(steps, true);
    for (let i = 0; i < 200; i++) game.construction.update(1000);
    const tiles = new Set(steps.map((s) => `${s.x},${s.y}`)).size;
    const track = steps.reduce((sum, s) => sum + trackPieceCost(map, s.x, s.y), 0);
    expect(steps.every((s) => rail.isElectrified(s.x, s.y))).toBe(true);
    expect(money - game.money).toBe(track + tiles * ELECTRIFY_TILE_COST);
    // Zbouráním koleje zmizí i vedení
    rail.removeTrack(steps[0].x, steps[0].y);
    expect(rail.isElectrified(steps[0].x, steps[0].y)).toBe(false);
    expect(game.construction.buildStation({ x: 30, y: 50, axis: 'x', length: 3, tracks: 1 }, null, true)).toBeNull();
    expect(rail.isElectrified(30, 50)).toBe(true);
    expect(game.construction.buildDepot(50, 50, 1, true)).toBeNull();
    expect(rail.isElectrified(50, 50)).toBe(true);
  });

  it('sundání vedení vrátí polovinu ceny', () => {
    const { game } = electricLine();
    const tiles = allTiles(game);
    game.construction.electrify(tiles);
    const { count } = game.construction.electrifyCost(tiles, true);
    const money = game.money;
    expect(game.construction.electrify(tiles, true)).toBeNull();
    expect(game.money).toBe(money + count * ELECTRIFY_TILE_COST * DEMOLISH_REFUND);
    expect(game.construction.electrify(tiles, true)).toMatch(/není/);
  });

  it('obnova zůstane u stejného druhu: parní za motorovou, elektrická za elektrickou', () => {
    const { game, depot } = electricLine();
    game.construction.electrify([{ x: depot.x, y: depot.y }]);
    game.fleet.buy(depot, steam);
    game.fleet.buy(depot, electric);
    const [old, wired] = game.fleet.trains;
    game.clock.date = { year: 2030, month: 0, day: 1 };
    expect(game.fleet.renewalOffer(old).model.electric).toBeFalsy();
    expect(game.fleet.renewalOffer(wired).model.id).toBe('bullet');
  });

  it('vedení se uloží; starší uložení s elektrickými vlaky dostane vedení na celé železnici', () => {
    const { game, depot } = electricLine();
    game.construction.electrify([{ x: depot.x, y: depot.y }]);
    game.fleet.buy(depot, electric);
    const data = serializeGame(game, 'test');
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.world.rail.isElectrified(depot.x, depot.y)).toBe(true);
    expect(copy.world.rail.isElectrified(20, 10)).toBe(false);
    const legacy = JSON.parse(JSON.stringify(data));
    delete legacy.rail.electrified;
    const old = restoreGame(parseSave(JSON.stringify(legacy)));
    const { rail } = old.world;
    const tracked = [...rail.pieces.keys()].filter((i) => rail.pieces[i]);
    expect(tracked.every((i) => rail.electrified[i] === 1)).toBe(true);
  });
});
