import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_BUILDING_DOWN,
  AUTHORITY_RATING_INITIAL,
  AUTHORITY_STATION_SERVED,
  AUTHORITY_STATION_UNSERVED,
  AUTHORITY_TREE_DOWN,
  AUTHORITY_TREE_UP,
  STATUE_COST,
  STATUE_STATION_BONUS,
} from './balance';
import { ratingLabel } from './authority';
import { parseSave, restoreGame, serializeGame } from './save';
import { advertise } from './townActions';
import { addBuilding, emptyGame, makeTown } from '../test/fixtures';
import { TileType } from '../world/map';
import { defaultStationShape } from '../world/rail';

function townGame() {
  const town = makeTown(0, 20, 20);
  const game = emptyGame(64, [town]);
  game.money = 10_000_000;
  addBuilding(game, town, 20, 22);
  for (let x = 14; x <= 26; x++) game.world.map.set(x, 20, TileType.Road);
  for (let x = 14; x <= 26; x++) game.world.map.setOwner(x, 20, town.id);
  return { game, town };
}

describe('místní úřad', () => {
  it('stupně hodnocení a obvod města', () => {
    const { game, town } = townGame();
    expect(ratingLabel(-500)).toBe('Hrozné');
    expect(ratingLabel(0)).toBe('Špatné');
    expect(ratingLabel(500)).toBe('Velmi dobré');
    expect(ratingLabel(1000)).toBe('Výjimečné');
    expect(game.authority.rating(town)).toBe(AUTHORITY_RATING_INITIAL);
    expect(game.authority.townAt(22, 21)).toBe(town);
    expect(game.authority.townAt(60, 60)).toBeUndefined();
  });

  it('kácení a bourání hodnocení snižuje, růst města ne', () => {
    const { game, town } = townGame();
    const { map } = game.world;
    map.set(18, 18, TileType.Trees);
    map.set(19, 18, TileType.Trees);
    expect(game.construction.demolish([{ x: 18, y: 18 }])).toBeNull();
    expect(game.authority.rating(town)).toBe(AUTHORITY_RATING_INITIAL + AUTHORITY_TREE_DOWN);
    // Stavba koleje přes les také kácí
    game.world.rail.addPiece(19, 18, 0);
    expect(game.authority.rating(town)).toBe(AUTHORITY_RATING_INITIAL + 2 * AUTHORITY_TREE_DOWN);
    // Strom pokácený městem (růst) se nepočítá
    map.set(17, 18, TileType.Trees);
    game.authority.quietly(() => map.set(17, 18, TileType.Building));
    expect(game.authority.rating(town)).toBe(AUTHORITY_RATING_INITIAL + 2 * AUTHORITY_TREE_DOWN);
    expect(game.construction.demolish([{ x: 20, y: 22 }])).toBeNull();
    expect(game.authority.rating(town)).toBe(
      AUTHORITY_RATING_INITIAL + 2 * AUTHORITY_TREE_DOWN + AUTHORITY_BUILDING_DOWN,
    );
  });

  it('při špatném hodnocení město nepovolí stavbu stanice ani demolici svého majetku', () => {
    const { game, town } = townGame();
    game.authority.change(town, -800);
    expect(game.authority.rating(town)).toBe(-300);
    expect(game.construction.buildStation({ ...defaultStationShape(22, 24, 'x') })).toContain('Místní úřad');
    expect(game.construction.demolishPlan([{ x: 20, y: 22 }]).blocked).toContain('odmítá povolit demolici budovy');
    expect(game.construction.demolishPlan([{ x: 15, y: 20 }]).blocked).toContain('demolici silnice');
    // Daleko od města úřad nerozhoduje
    expect(game.construction.buildStation({ ...defaultStationShape(55, 55, 'x') })).toBeNull();
  });

  it('měsíčně: obsluhovaná stanice zvedne, opuštěná sníží', () => {
    const { game, town } = townGame();
    const { rail } = game.world;
    const served = rail.addStation({ ...defaultStationShape(22, 24, 'x'), name: 'A', townId: 0 });
    rail.addStation({ ...defaultStationShape(17, 24, 'x'), name: 'B', townId: 0 });
    served.ratings.passengers.lastVisit = game.clock.now;
    game.clock.events.emit('month', game.clock.date);
    expect(game.authority.rating(town)).toBe(
      AUTHORITY_RATING_INITIAL + AUTHORITY_STATION_SERVED + AUTHORITY_STATION_UNSERVED,
    );
  });

  it('výsadba stromů zvedne hodnocení jen do stropu', () => {
    const { game, town } = townGame();
    game.authority.change(town, -400);
    expect(
      game.construction.plantTrees([
        { x: 18, y: 18 },
        { x: 18, y: 19 },
        { x: 18, y: 20 },
      ]),
    ).toBeNull();
    // Na silnici se nesází
    expect(game.world.map.get(18, 20)).toBe(TileType.Road);
    expect(game.world.map.get(18, 18)).toBe(TileType.Trees);
    expect(game.authority.rating(town)).toBe(100 + 2 * AUTHORITY_TREE_UP);
    game.authority.change(town, 200);
    game.construction.plantTrees([{ x: 30, y: 18 }]);
    expect(game.authority.rating(town)).toBe(314);
  });

  it('socha: stojí u silnice, zvedne hodnocení stanic, uložení ji zachová', () => {
    const { game, town } = townGame();
    const money = game.money;
    expect(game.authority.buildStatue(town)).toBeNull();
    expect(money - game.money).toBe(STATUE_COST);
    const spot = game.authority.statues.get(town.id)!;
    expect(game.world.map.get(spot.x, spot.y)).toBe(TileType.Statue);
    expect(game.authority.buildStatue(town)).toContain('už vaše socha stojí');
    const station = game.world.rail.addStation({ ...defaultStationShape(22, 24, 'x'), name: 'A', townId: 0 });
    expect(game.authority.stationBonus(station)).toBe(STATUE_STATION_BONUS);
    // Socha se zbourat nedá
    expect(game.construction.demolishPlan([spot]).tiles).toEqual([]);
    game.authority.change(town, -100);
    const restored = restoreGame(parseSave(JSON.stringify(serializeGame(game, 'u'))));
    expect(restored.authority.rating(restored.world.towns[0])).toBe(AUTHORITY_RATING_INITIAL - 100);
    expect(restored.authority.statues.get(town.id)).toEqual(spot);
  });

  it('střední reklama zasáhne i stanici v okolí, kam město nesahá', () => {
    const { game, town } = townGame();
    const far = game.world.rail.addStation({ ...defaultStationShape(30, 28, 'x'), name: 'Daleko', townId: 0 });
    far.ratings.passengers.rating = 0.3;
    expect(advertise(game, town, 'small')).toContain('nemáte žádnou stanici');
    expect(advertise(game, town, 'medium')).toBeNull();
    expect(far.ratings.passengers.rating).toBeCloseTo(0.55);
  });
});
