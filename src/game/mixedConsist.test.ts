import { describe, expect, it } from 'vitest';
import { addBuilding, addIndustry, buildLine, buyTrain, runDays } from '../test/fixtures';
import { REFIT_COST_PER_WAGON, TOWN_ACCEPTS_MIN_BUILDINGS } from './balance';
import { CARGOS } from './cargo';
import { cargoCapacity, consistCargos, loadOf, setConsist, totalLoad, wagonCargos } from './consist';
import { parseSave, restoreGame, serializeGame } from './save';
import { formatLoad } from './trains';

describe('smíšené soupravy a kapacita podle nákladu', () => {
  it('kapacita vagonu se liší podle nákladu', () => {
    expect(CARGOS.passengers.wagonCapacity).toBe(30);
    expect(CARGOS.coal.wagonCapacity).toBe(30);
    expect(CARGOS.mail.wagonCapacity).toBe(20);
    expect(CARGOS.goods.wagonCapacity).toBe(20);
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.addWagon(train, 'mail');
    expect(wagonCargos(train)).toEqual(['passengers', 'passengers', 'mail']);
    expect(cargoCapacity(train, 'passengers')).toBe(60);
    expect(cargoCapacity(train, 'mail')).toBe(20);
    expect(formatLoad(train)).toBe('0 / 60 cestujících, 0 / 20 t pošty');
  });

  it('setConsist zachová náklad druhů, které zůstaly, a ořízne ho podle nové kapacity', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 3);
    train.passengers = 80;
    setConsist(train, ['passengers', 'mail', 'mail']);
    expect(train.passengers).toBe(30);
    expect(loadOf(train, 'mail')).toBe(0);
    train.holds![0].passengers = 35;
    setConsist(train, ['mail', 'passengers']);
    expect(train.cargo).toBe('mail');
    expect(train.passengers).toBe(20);
    expect(loadOf(train, 'passengers')).toBe(30);
    setConsist(train, ['mail', 'mail']);
    expect(train.holds).toBeUndefined();
    expect(train.wagonCargo).toBeUndefined();
    expect(totalLoad(train)).toBe(20);
  });

  it('přestavba jednoho vagonu v depu stojí poplatek za vagon, odpojit jde i vagon uprostřed', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 3);
    const money = game.money;
    expect(game.fleet.refitWagon(train, 1, 'mail')).toBeNull();
    expect(game.money).toBe(money - REFIT_COST_PER_WAGON);
    expect(wagonCargos(train)).toEqual(['passengers', 'mail', 'passengers']);
    expect(game.fleet.refitCost(train, 'passengers')).toBe(REFIT_COST_PER_WAGON);
    game.fleet.removeWagon(train, 1);
    expect(wagonCargos(train)).toEqual(['passengers', 'passengers']);
    expect(train.holds).toBeUndefined();
    game.fleet.start(train, [a.id, b.id]);
    expect(game.fleet.refitWagon(train, 0, 'coal')).toMatch(/depu/);
  });

  it('vlak s osobními a poštovními vagony veze cestující i poštu a vydělá na obojím', () => {
    const { game, a, b, depot, townA, townB } = buildLine();
    game.subsidies.offer = () => false;
    // Poštu vykupují jen nástupiště s dost budovami v dosahu
    for (let x = 6; x < 6 + TOWN_ACCEPTS_MIN_BUILDINGS; x++) addBuilding(game, townA, x, 14);
    for (let x = 36; x < 36 + TOWN_ACCEPTS_MIN_BUILDINGS; x++) addBuilding(game, townB, x, 24);
    const train = buyTrain(game, depot, 2);
    game.fleet.addWagon(train, 'mail');
    a.waiting = 100;
    a.freight.mail = 40;
    b.waiting = 100;
    b.freight.mail = 40;
    expect(game.fleet.start(train, [a.id, b.id])).toBeNull();
    let both = false;
    for (let i = 0; i < 200 && !both; i++) {
      runDays(game, 0.25);
      both = train.passengers > 0 && loadOf(train, 'mail') > 0;
    }
    expect(both).toBe(true);
    expect(loadOf(train, 'mail')).toBeLessThanOrEqual(20);
    runDays(game, 40);
    expect(game.thisYear.passengers).toBeGreaterThan(0);
    expect(game.thisYear.freight.mail).toBeGreaterThan(0);
    expect(train.income).toBeGreaterThan(0);
  });

  it('důl sváží uhlí i pro smíšenou soupravu s vagonem na uhlí', () => {
    const { game, a, b, depot } = buildLine();
    const mine = addIndustry(game, 'coal-mine', 5, 5);
    const train = buyTrain(game, depot, 1);
    expect(game.freight.pickupStations(mine)).toEqual([]);
    game.fleet.addWagon(train, 'coal');
    game.fleet.setOrders(train, [a.id, b.id]);
    expect(consistCargos(train)).toEqual(['passengers', 'coal']);
    expect(game.freight.pickupStations(mine)).toEqual([a]);
  });

  it('přestavba celé soupravy příkazem srovná smíšenou soupravu na jeden náklad', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.addWagon(train, 'mail');
    expect(game.fleet.refitCost(train, 'coal')).toBe(3 * REFIT_COST_PER_WAGON);
    expect(game.fleet.setCargo(train, 'mail')).toBeNull();
    expect(wagonCargos(train)).toEqual(['mail', 'mail', 'mail']);
    expect(train.holds).toBeUndefined();
  });

  it('uložení zachová vagony i náklad každého druhu; starší uložení mají jeden náklad', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.addWagon(train, 'mail');
    train.passengers = 40;
    train.holds![0].passengers = 15;
    train.holds![0].boardedStation = 0;
    const data = serializeGame(game, 'x');
    const copy = restoreGame(parseSave(JSON.stringify(data))).fleet.trains[0];
    expect(wagonCargos(copy)).toEqual(['passengers', 'passengers', 'mail']);
    expect(copy.passengers).toBe(40);
    expect(loadOf(copy, 'mail')).toBe(15);
    const legacy = JSON.parse(JSON.stringify(data));
    delete legacy.fleet.trains[0].wagonCargo;
    delete legacy.fleet.trains[0].holds;
    const old = restoreGame(parseSave(JSON.stringify(legacy))).fleet.trains[0];
    expect(wagonCargos(old)).toEqual(['passengers', 'passengers', 'passengers']);
    expect(old.holds).toBeUndefined();
  });
});
