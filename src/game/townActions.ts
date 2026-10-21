import {
  AD_CAMPAIGN_COST,
  AD_RATING_BOOST,
  FUND_BUILDINGS_BASE,
  FUND_BUILDINGS_PER_RESIDENT,
  FUND_GROWTH,
} from './balance';
import { formatMoney, type Game } from './game';
import { expandTown, type Town } from '../world/town';

// Akce společnosti ve městě jako v OpenTTD: reklama zvedne hodnocení stanic, financování výstavby růst
export function fundBuildingsCost(town: Town): number {
  return FUND_BUILDINGS_BASE + FUND_BUILDINGS_PER_RESIDENT * town.population;
}

export function advertise(game: Game, town: Town): string | null {
  if (game.money < AD_CAMPAIGN_COST) return `Nedostatek peněz (${formatMoney(AD_CAMPAIGN_COST)}).`;
  const stations = game.world.rail.stations.filter((s) => game.passengers.townsInReach(s).includes(town));
  if (stations.length === 0) return `Ve městě ${town.name} nemáte žádné nástupiště.`;
  game.spend(AD_CAMPAIGN_COST, 'construction');
  for (const station of stations) station.rating = Math.min(1, station.rating + AD_RATING_BOOST);
  game.news(`Reklamní kampaň ve městě ${town.name} zvedla hodnocení stanic.`, { x: town.x + 0.5, y: town.y + 0.5 });
  game.events.emit('stationsChanged');
  return null;
}

export function fundBuildings(game: Game, town: Town): string | null {
  const cost = fundBuildingsCost(town);
  if (game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
  game.spend(cost, 'construction');
  const before = town.buildings.length;
  town.population = Math.round(town.population * (1 + FUND_GROWTH));
  expandTown(game.world.map, town, game.clock.date.year, game.rng);
  game.news(`${town.name}: financovaná výstavba přidala ${town.buildings.length - before} budov.`, {
    x: town.x + 0.5,
    y: town.y + 0.5,
  });
  game.events.emit('townsChanged');
  return null;
}
