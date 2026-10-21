import { describe, expect, it } from 'vitest';
import { addBuilding, addIndustry, buildLine, buyTrain, runDays } from '../test/fixtures';
import { TOWN_ACCEPTS_MIN_BUILDINGS } from './balance';

// Linka A – B s dolem v dosahu A a elektrárnou v dosahu B
function coalLine(withPlant = true) {
  const line = buildLine();
  const mine = addIndustry(line.game, 'coal-mine', 5, 5);
  if (withPlant) addIndustry(line.game, 'power-station', 43, 16);
  return { ...line, mine };
}

describe('nákladní doprava uhlí', () => {
  it('důl sváží uhlí jen na nástupiště, kam jezdí vlak na uhlí', () => {
    const { game, a, b, depot, mine } = coalLine();
    runDays(game, 10);
    expect(a.freight.coal).toBe(0);
    expect(game.freight.pickupStations(mine)).toEqual([]);

    const train = buyTrain(game, depot, 2);
    expect(game.fleet.setCargo(train, 'coal')).toBeNull();
    game.fleet.start(train, [a.id, b.id]);
    expect(game.freight.pickupStations(mine)).toEqual([a]);
    expect(game.fleet.setCargo(train, 'passengers')).toMatch(/depu/);
    runDays(game, 10);
    expect(mine.transported).toBeGreaterThan(0);
    // Cestující do vlaku na uhlí nenastupují
    expect(a.waiting).toBeGreaterThan(0);
  });

  it('vlak doveze uhlí k elektrárně a dostane zaplaceno', () => {
    const { game, a, b, depot } = coalLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.setCargo(train, 'coal');
    game.fleet.start(train, [a.id, b.id]);
    a.freight.coal = 60;
    let paid = 0;
    game.events.on('income', (amount) => (paid += amount));
    runDays(game, 120);
    expect(game.freight.accepted(b)).toContain('coal');
    expect(game.thisYear.freight.coal).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(0);
    expect(train.income).toBe(paid);
    expect(game.thisYear.passengers).toBe(0);
  });

  it('s čekáním na plné naložení odveze vždy plný vlak', () => {
    const deliveries = (fullLoad: boolean): number[] => {
      const { game, a, b, depot } = coalLine();
      const train = buyTrain(game, depot, 2);
      game.fleet.setCargo(train, 'coal');
      game.fleet.setOrders(train, [a.id, b.id]);
      if (fullLoad) game.fleet.toggleFullLoad(train, a.id);
      game.fleet.start(train, train.orders!);
      const amounts: number[] = [];
      let filling = false;
      game.events.on('news', (text) => {
        const match = /přivezl (\d+) t uhlí/.exec(text);
        if (match) amounts.push(Number(match[1]));
      });
      for (let i = 0; i < 20_000 && amounts.length < 2; i++) {
        game.update(200);
        filling ||= game.fleet.isFillingUp(train);
      }
      expect(filling).toBe(fullLoad);
      return amounts;
    };
    expect(deliveries(true)).toEqual([60, 60]);
    expect(deliveries(false)[0]).toBeLessThan(60);
  });

  it('odebraná zastávka zruší i čekání na plné naložení', () => {
    const { game, a, b, depot } = coalLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.setOrders(train, [a.id, b.id]);
    game.fleet.toggleFullLoad(train, a.id);
    game.fleet.toggleFullLoad(train, b.id);
    game.fleet.toggleFullLoad(train, b.id);
    expect(train.fullLoad).toEqual([a.id]);
    game.fleet.setOrders(train, [b.id]);
    expect(train.fullLoad).toEqual([]);
  });

  it('bez elektrárny v dosahu zůstane uhlí ve vlaku', () => {
    const { game, a, b, depot } = coalLine(false);
    const train = buyTrain(game, depot, 2);
    game.fleet.setCargo(train, 'coal');
    game.fleet.start(train, [a.id, b.id]);
    a.freight.coal = 60;
    runDays(game, 120);
    expect(game.thisYear.freight.coal).toBe(0);
    expect(train.passengers).toBe(60);
  });
});

describe('výrobní řetězce', () => {
  it('dovezené dřevo dostane pila v dosahu nástupiště', () => {
    const { game, a, b, depot } = buildLine();
    const sawmill = addIndustry(game, 'sawmill', 43, 16);
    expect(game.freight.accepted(b)).toEqual(['wood']);
    const train = buyTrain(game, depot, 2);
    game.fleet.setCargo(train, 'wood');
    game.fleet.start(train, [a.id, b.id]);
    a.freight.wood = 60;
    for (let i = 0; i < 20_000 && game.thisYear.freight.wood === 0; i++) game.update(200);
    expect(game.thisYear.freight.wood).toBe(60);
    expect(sawmill.received).toBe(60);
  });

  it('pila vyrobí z minulého měsíce zboží a město ho vykoupí', () => {
    const { game, a, b, depot, townA } = buildLine();
    const sawmill = addIndustry(game, 'sawmill', 43, 16);
    sawmill.received = 90;
    // Zboží vykupuje jen nástupiště s dostatkem městské zástavby v dosahu
    expect(game.freight.accepted(a)).toEqual([]);
    for (let x = 6; x < 6 + TOWN_ACCEPTS_MIN_BUILDINGS - 1; x++) addBuilding(game, townA, x, 14);
    expect(game.freight.accepted(a)).toEqual(['mail', 'goods']);
    const train = buyTrain(game, depot, 2);
    game.fleet.setCargo(train, 'goods');
    game.fleet.start(train, [b.id, a.id]);
    runDays(game, 31);
    expect(sawmill.lastReceived).toBe(90);
    expect(sawmill.production).toBe(90);
    for (let i = 0; i < 200 && game.thisYear.freight.goods === 0; i++) runDays(game, 1);
    expect(game.thisYear.freight.goods).toBeGreaterThan(0);
  });

  it('pošta vzniká ve městě u nástupiště s poštovním vlakem a vykoupí ji jiné město', () => {
    const { game, a, b, depot, townB } = buildLine();
    for (let x = 36; x < 36 + TOWN_ACCEPTS_MIN_BUILDINGS; x++) addBuilding(game, townB, x, 24);
    runDays(game, 10);
    expect(a.freight.mail).toBe(0);
    const train = buyTrain(game, depot, 1);
    game.fleet.setCargo(train, 'mail');
    game.fleet.start(train, [a.id, b.id]);
    // Město o 3 000 obyvatelích pošle čtvrtinu ze 180 cestujících měsíčně
    expect(game.freight.monthlyMail(a)).toBeCloseTo(45);
    for (let i = 0; i < 400 && game.thisYear.freight.mail === 0; i++) runDays(game, 1);
    expect(game.thisYear.freight.mail).toBeGreaterThan(0);
  });
});

describe('vyvážení', () => {
  // Příjem vlaku se 4 vagony za 11 měsíců prvního roku po měsíci rozjezdu
  function yearIncome(cargo: 'passengers' | 'coal'): number {
    const { game, a, b, depot, townA, townB } = cargo === 'coal' ? coalLine() : buildLine();
    // Města jako na začátku hry
    townA.population = townB.population = 1500;
    if (cargo === 'coal') game.world.industries[0].production = 105;
    const train = buyTrain(game, depot, 4);
    game.fleet.setCargo(train, cargo);
    game.fleet.start(train, [a.id, b.id]);
    runDays(game, 30);
    let income = 0;
    game.events.on('income', (amount) => (income += amount));
    runDays(game, 330);
    return income;
  }

  it('uhelný vlak od průměrného dolu vydělá zhruba jako osobní mezi dvěma malými městy', () => {
    const ratio = yearIncome('coal') / yearIncome('passengers');
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });
});
