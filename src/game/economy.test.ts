import { describe, expect, it } from 'vitest';
import { TOWN_GROWTH_BASE, TOWN_GROWTH_SERVED } from './balance';
import { catchmentArea, fare, inArea } from './passengers';
import { addBuilding, emptyGame, makeTown } from '../test/fixtures';
import { defaultStationShape } from '../world/rail';
import { growTown, townCapacity } from '../world/town';

describe('jízdné', () => {
  it('sazba klesá s dobou přepravy', () => {
    expect(fare(10, 10, 20)).toBe(1000);
    expect(fare(10, 10, 45)).toBe(500);
    expect(fare(10, 10, 100)).toBe(200);
  });
});

describe('cestující', () => {
  it('město posílá 3 % obyvatel měsíčně a dělí je mezi svá nástupiště', () => {
    const town = makeTown(0, 20, 20, 3000);
    const game = emptyGame(64, [town]);
    addBuilding(game, town, 20, 22);
    const { rail } = game.world;
    const a = rail.addStation({ ...defaultStationShape(20, 20, 'x'), name: 'A', townId: 0 });
    expect(game.passengers.monthlyPassengers(a)).toBeCloseTo(90);
    const b = rail.addStation({ ...defaultStationShape(20, 24, 'x'), name: 'B', townId: 0 });
    expect(game.passengers.monthlyPassengers(a)).toBeCloseTo(45);
    expect(game.passengers.monthlyPassengers(b)).toBeCloseTo(45);
  });

  it('dosah sahá 4 dlaždice od okraje nástupiště', () => {
    const area = catchmentArea(defaultStationShape(20, 20, 'x'));
    expect(area).toEqual({ x0: 15, x1: 25, y0: 16, y1: 24 });
    expect(inArea(area, 25, 24)).toBe(true);
    expect(inArea(area, 26, 20)).toBe(false);
  });

  it('nástupiště mimo dosah města nic negeneruje', () => {
    const town = makeTown(0, 20, 20);
    const game = emptyGame(64, [town]);
    addBuilding(game, town, 20, 22);
    const far = game.world.rail.addStation({ ...defaultStationShape(50, 50, 'x'), name: 'X', townId: 0 });
    expect(game.passengers.townsInReach(far)).toHaveLength(0);
  });
});

describe('růst měst', () => {
  const grownTown = (served: boolean): number => {
    const town = makeTown(0, 32, 32, 1000);
    const game = emptyGame(64, [town]);
    // Dost kapacity, aby růst neomezila
    for (let i = 0; i < 40; i++) addBuilding(game, town, 10 + (i % 20), 5 + Math.floor(i / 20));
    town.served = served;
    growTown(game.world.map, town, 1951, game.rng);
    return town.population;
  };

  it('obsluhované město roste rychleji', () => {
    expect(grownTown(false)).toBe(Math.round(1000 * (1 + TOWN_GROWTH_BASE)));
    expect(grownTown(true)).toBe(Math.round(1000 * (1 + TOWN_GROWTH_SERVED)));
  });

  it('populace nepřeroste kapacitu budov', () => {
    const town = makeTown(0, 32, 32, 1000);
    const game = emptyGame(64, [town]);
    // Kolem města voda, není kam stavět
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) game.world.map.set(x, y, 1);
    addBuilding(game, town, 32, 32);
    growTown(game.world.map, town, 1951, game.rng);
    expect(town.population).toBe(townCapacity(town));
  });
});
