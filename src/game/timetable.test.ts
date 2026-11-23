import { describe, expect, it } from 'vitest';
import { buildLine, buyTrain } from '../test/fixtures';
import { parseSave, restoreGame, serializeGame } from './save';
import { cleanFlags, orderFlags, type Train } from './trains';
import type { Game } from './game';

// Dojede (nebo už stojí) na zastávku řádu s indexem index; vrací herní čas příjezdu
function arriveAt(game: Game, train: Train, index: number): number {
  let wasAway = train.state !== 'loading' || train.target !== index;
  for (let i = 0; i < 40_000; i++) {
    game.update(200);
    const there = train.state === 'loading' && train.target === index;
    if (there && wasAway) return game.clock.now;
    if (!there) wasAway = true;
  }
  throw new Error('Vlak nedojel');
}

describe('skupiny vozidel', () => {
  it('vytvoření, přiřazení, přejmenování, souhrn a zrušení', () => {
    const { game, depot } = buildLine();
    const a = buyTrain(game, depot, 1);
    const b = buyTrain(game, depot, 1);
    const group = game.groups.create('train');
    expect(group.name).toBe('Skupina 1');
    expect(game.groups.create('train').name).toBe('Skupina 2');
    expect(game.groups.assign(a, 'train', group.id)).toBeNull();
    expect(game.groups.assign(a, 'road', group.id)).toMatch(/neexistuje/);
    a.income = 100;
    a.costs = 30;
    a.lastIncome = 50;
    expect(game.groups.members(group)).toEqual([a]);
    expect(game.groups.rename(group, '  Uhelná linka ')).toBeNull();
    expect(group.name).toBe('Uhelná linka');
    expect(game.groups.rename(group, '   ')).toMatch(/jméno/);
    // Klon zůstane ve skupině originálu
    const copy = game.fleet.clone(a, depot);
    expect(typeof copy === 'string' ? copy : copy.group).toBe(group.id);
    game.groups.remove(group);
    expect(a.group).toBeUndefined();
    expect(b.group).toBeUndefined();
    expect(game.groups.of('train')).toHaveLength(1);
  });

  it('skupiny se uloží a načtou, neplatné přiřazení se zahodí', () => {
    const { game, depot } = buildLine();
    const train = buyTrain(game, depot, 1);
    const group = game.groups.create('train', 'Expresy');
    game.groups.assign(train, 'train', group.id);
    const data = serializeGame(game, 'test');
    const copy = restoreGame(parseSave(JSON.stringify(data)));
    expect(copy.groups.of('train')).toEqual([group]);
    expect(copy.fleet.trains[0].group).toBe(group.id);
    const broken = JSON.parse(JSON.stringify(data));
    broken.groups.list = [];
    expect(restoreGame(parseSave(JSON.stringify(broken))).fleet.trains[0].group).toBeUndefined();
  });
});

describe('jízdní řád s časy', () => {
  it('časy v příkazu: desetiny dne, stání jen na stanici', () => {
    expect(cleanFlags({ travel: 3.14, wait: 2 })).toEqual({ travel: 3.1, wait: 2 });
    expect(cleanFlags({ travel: -1, wait: Number.NaN })).toEqual({});
    expect(cleanFlags({ depot: true, travel: 5, wait: 2 })).toEqual({ depot: true, travel: 5 });
    expect(cleanFlags({ waypoint: true, travel: 5 })).toEqual({ waypoint: true });
  });

  it('automatické vyplnění zapíše naměřenou dobu jízdy do plánu', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id]);
    game.fleet.setAutofill(train, true);
    arriveAt(game, train, 0);
    arriveAt(game, train, 1);
    const measured = train.lastTravel?.[1];
    expect(measured).toBeGreaterThan(0);
    expect(orderFlags(train, 1).travel).toBe(measured);
    expect(train.lateness).toBe(0);
  });

  it('kdo přijede dřív, počká; plánované stání prodlouží pobyt; pozdní příjezd je zpoždění', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 2);
    game.fleet.start(train, [a.id, b.id]);
    arriveAt(game, train, 0);
    // Zjistí běžnou dobu jízdy do B
    arriveAt(game, train, 1);
    const normal = train.lastTravel![1]!;
    game.fleet.setTimetable(train, 1, { travel: normal + 6 });
    game.fleet.setTimetable(train, 0, { wait: 9 });
    arriveAt(game, train, 0);
    expect(train.waitDays).toBeGreaterThanOrEqual(9);
    arriveAt(game, train, 1);
    // Přijel zhruba o 6 dní dřív, takže stojí aspoň tak dlouho navíc
    expect(train.waitDays).toBeGreaterThan(5);
    expect(train.lateness).toBe(0);
    game.fleet.setTimetable(train, 1, { travel: Math.max(0.1, normal - 2) });
    arriveAt(game, train, 0);
    arriveAt(game, train, 1);
    expect(train.lateness).toBeGreaterThan(1);
    game.fleet.clearTimetable(train);
    expect(train.orderFlags).toEqual([{}, {}]);
    expect(train.lateness).toBeUndefined();
  });

  it('u sdíleného řádu platí časy pro celou linku', () => {
    const { game, a, b, depot } = buildLine();
    const train = buyTrain(game, depot, 1);
    game.fleet.start(train, [a.id, b.id]);
    const copy = game.fleet.clone(train, depot, true);
    if (typeof copy === 'string') throw new Error(copy);
    game.fleet.setTimetable(copy, 1, { travel: 12, wait: 3 });
    expect(orderFlags(train, 1)).toEqual({ travel: 12, wait: 3 });
    game.fleet.setTimetable(train, 1, { wait: null });
    expect(orderFlags(copy, 1)).toEqual({ travel: 12 });
  });
});
