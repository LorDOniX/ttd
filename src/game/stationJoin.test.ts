import { describe, expect, it } from 'vitest';
import { addBuilding, addIndustry, buildLine, buyTrain, makeTown } from '../test/fixtures';
import { CATCHMENT_RADIUS } from './balance';
import { catchmentArea, catchmentRadius } from './passengers';
import { parseSave, restoreGame, serializeGame } from './save';
import { poolId, stationTiles, type Station } from '../world/rail';

const parallel = { x: 10, y: 11, axis: 'x' as const, length: 3, tracks: 1 };

function lastStation(stations: Station[]): Station {
  return stations[stations.length - 1];
}

describe('dosah podle druhu stanice', () => {
  it('zastávka aut 3, nádraží 4, přístav 5, letiště podle velikosti', () => {
    expect(catchmentRadius({})).toBe(CATCHMENT_RADIUS.rail);
    expect(catchmentRadius({ kind: 'road' })).toBe(3);
    expect(catchmentRadius({ kind: 'water' })).toBe(5);
    expect(catchmentRadius({ kind: 'air', airport: 'small' })).toBe(3);
    expect(catchmentRadius({ kind: 'air', airport: 'large' })).toBe(4);
    const area = catchmentArea({ x: 20, y: 20, axis: 'x', length: 1, tracks: 1, kind: 'road' });
    expect(area).toEqual({ x0: 17, x1: 23, y0: 17, y1: 23 });
  });
});

describe('spojování stanic', () => {
  it('nástupiště postavené vedle stanice se k ní samo připojí a sdílí jméno, náklad i hodnocení', () => {
    const { game, a } = buildLine();
    expect(game.construction.adjacentStation(stationTiles(parallel))).toBe(a);
    expect(game.construction.buildStation(parallel)).toBeNull();
    const { rail } = game.world;
    const part = lastStation(rail.stations);
    expect(part.joinedTo).toBe(a.id);
    expect(part.name).toBe(a.name);
    expect(rail.membersOf(a)).toEqual([a, part]);
    expect(rail.primaries()).not.toContain(part);
    part.waiting = 17;
    part.freight.coal = 5;
    expect(a.waiting).toBe(17);
    expect(a.freight.coal).toBe(5);
    expect(part.ratings).toBe(a.ratings);
    expect(poolId(part)).toBe(a.id);
  });

  it('samostatně (Ctrl a „nová stanice“) a příliš daleko se nepřipojí', () => {
    const { game, a } = buildLine();
    expect(game.construction.buildStation(parallel, null)).toBeNull();
    const separate = lastStation(game.world.rail.stations);
    expect(separate.joinedTo).toBeUndefined();
    expect(separate.name).not.toBe(a.name);
    const far = { x: 10, y: 40, axis: 'x' as const, length: 3, tracks: 1 };
    expect(game.construction.joinCandidates(stationTiles(far))).not.toContain(a);
    expect(game.construction.buildStation(far, a.id)).toMatch(/daleko/);
    // Zvolená vzdálenější stanice v dosahu spojení
    const near = { x: 10, y: 17, axis: 'x' as const, length: 3, tracks: 1 };
    expect(game.construction.adjacentStation(stationTiles(near))).toBeNull();
    expect(game.construction.buildStation(near, a.id)).toBeNull();
    expect(lastStation(game.world.rail.stations).joinedTo).toBe(a.id);
  });

  it('dosah spojené stanice je sjednocení dosahů částí; závod sváží náklad jen jednou', () => {
    const { game, a, b, depot } = buildLine();
    const townC = makeTown(2, 10, 28);
    game.world.towns.push(townC);
    addBuilding(game, townC, 10, 23);
    const mine = addIndustry(game, 'coal-mine', 5, 14);
    expect(game.passengers.townsInReach(a)).not.toContain(townC);
    const part = { x: 10, y: 19, axis: 'x' as const, length: 3, tracks: 1 };
    expect(game.construction.buildStation(part, a.id)).toBeNull();
    expect(game.passengers.townsInReach(a)).toContain(townC);
    const joined = lastStation(game.world.rail.stations);
    expect(game.passengers.townsInReach(joined)).toEqual(game.passengers.townsInReach(a));
    // Důl je v dosahu obou částí, stanice ho přesto obsluhuje jednou
    expect(game.freight.industriesInReach(a)).toContain(mine);
    expect(game.freight.industriesInReach(joined)).toContain(mine);
    const train = buyTrain(game, depot, 0);
    game.fleet.addWagon(train, 'coal');
    // Řád jen pro svoz (k části nevedou koleje)
    train.orders = [joined.id, b.id];
    train.orderFlags = [{}, {}];
    expect(game.freight.pickupStations(mine)).toEqual([a]);
  });

  it('zbouráním hlavní části převezme stanici další část', () => {
    const { game, a } = buildLine();
    game.construction.buildStation(parallel);
    const { rail } = game.world;
    const part = lastStation(rail.stations);
    a.waiting = 30;
    const name = a.name;
    rail.removeStation(a);
    expect(part.joinedTo).toBeUndefined();
    expect(part.name).toBe(name);
    expect(part.waiting).toBe(30);
    expect(rail.primaries()).toContain(part);
  });

  it('spojení přežije uložení a načtení', () => {
    const { game, a } = buildLine();
    game.construction.buildStation(parallel);
    a.waiting = 12;
    const copy = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'test'))));
    const { rail } = copy.world;
    const [primary, part] = rail.membersOf(rail.stations.find((s) => s.id === a.id)!);
    expect(part.joinedTo).toBe(primary.id);
    part.waiting = 40;
    part.freight.coal = 3;
    expect(primary.waiting).toBe(40);
    expect(primary.freight.coal).toBe(3);
    expect(rail.primaries()).toHaveLength(2);
  });
});
