import { describe, expect, it } from 'vitest';
import { addIndustry, buildLine, buyTrain } from '../test/fixtures';
import { REFIT_COST_PER_WAGON } from './balance';
import { parseSave, restoreGame, serializeGame } from './save';
import { cleanFlags, refitLoadStops } from './trains';

// Linka A – B s dolem v dosahu A a elektrárnou v dosahu B
function coalLine() {
  const line = buildLine();
  const mine = addIndustry(line.game, 'coal-mine', 5, 5);
  addIndustry(line.game, 'power-station', 43, 16);
  line.game.subsidies.offer = () => false;
  return { ...line, mine };
}

describe('přestavba vagonů', () => {
  it('v depu stojí poplatek za každý vagon, mimo depo nejde', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 3);
    const money = game.money;
    expect(game.fleet.refitCost(train, 'passengers')).toBe(0);
    expect(game.fleet.setCargo(train, 'passengers')).toBeNull();
    expect(game.money).toBe(money);
    expect(game.fleet.setCargo(train, 'coal')).toBeNull();
    expect(game.money).toBe(money - 3 * REFIT_COST_PER_WAGON);
    expect(train.cargo).toBe('coal');
    game.fleet.start(train, [a.id, b.id]);
    expect(game.fleet.setCargo(train, 'goods')).toMatch(/depu/);
    game.money = 0;
    expect(game.fleet.refitCost(train, 'goods')).toBeGreaterThan(0);
  });

  it('příkaz přestavby na stanici: vlak tam a zpět veze uhlí a cestující', () => {
    const { game, a, b, depot, mine } = coalLine();
    const train = buyTrain(game, depot, 2);
    expect(train.cargo).toBe('passengers');
    game.fleet.start(train, [a.id, b.id], [{ refit: 'coal' }, { refit: 'passengers' }]);
    // Důl sváží uhlí i pro vlak, který se na uhlí teprve přestaví
    expect(game.freight.pickupStations(mine)).toEqual([a]);
    a.freight.coal = 60;
    b.waiting = 60;
    const cargos: string[] = [];
    let refits = 0;
    let last = train.cargo;
    let vehicleCosts = 0;
    const before = game.thisYear.costs.vehicles;
    for (let i = 0; i < 60_000 && cargos.length < 4; i++) {
      game.update(200);
      if (train.cargo !== last) {
        refits++;
        last = train.cargo;
      }
      if (train.state === 'loading' && train.passengers > 0 && cargos.at(-1) !== train.cargo) cargos.push(train.cargo);
    }
    vehicleCosts = game.thisYear.costs.vehicles - before;
    expect(cargos).toEqual(['coal', 'passengers', 'coal', 'passengers']);
    expect(game.thisYear.freight.coal).toBeGreaterThan(0);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
    expect(vehicleCosts).toBe(refits * 2 * REFIT_COST_PER_WAGON);
  });

  it('s nákladem ve vagonech se vlak nepřestaví a doloží, co veze', () => {
    const { game, a, b, depot } = coalLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id], [{ refit: 'coal', unload: 'none' }, {}]);
    train.passengers = 10;
    train.boardedStation = b.id;
    const news: string[] = [];
    game.events.on('news', (text) => news.push(text));
    for (let i = 0; i < 20_000 && !news.some((t) => /nepřestavěl/.test(t)); i++) game.update(200);
    expect(news.some((t) => /nepřestavěl: ve vagonech zůstal náklad/.test(t))).toBe(true);
    expect(train.cargo).toBe('passengers');
  });

  it('zastávky s nákladem po přestavbě a uložení příkazu přestavby', () => {
    const { game, a, b, depot } = coalLine();
    const train = buyTrain(game, depot, 2);
    expect(game.fleet.start(train, [a.id, b.id], [{ refit: 'coal' }, {}])).toBeNull();
    expect(refitLoadStops(train, 'coal')).toEqual([a.id, b.id]);
    game.fleet.setOrderFlags(train, 1, { refit: 'goods' });
    expect(refitLoadStops(train, 'coal')).toEqual([a.id]);
    expect(refitLoadStops(train, 'goods')).toEqual([b.id]);
    expect(refitLoadStops(train, 'grain')).toEqual([]);
    expect(cleanFlags({ refit: 'nesmysl' as never })).toEqual({});
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    expect(copy.fleet.trains[0].orderFlags).toEqual([{ refit: 'coal' }, { refit: 'goods' }]);
  });
});
