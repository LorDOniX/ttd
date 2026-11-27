import {
  AD_CAMPAIGN_COST,
  AD_LARGE,
  AD_MEDIUM,
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

// Reklamní kampaň jako v OpenTTD: malá ve stanicích s městem v dosahu, střední a velká i ve stanicích
// v okolí středu města (větší dosah, větší zvýšení hodnocení)
export type AdSize = 'small' | 'medium' | 'large';

export const AD_SIZES: Record<AdSize, { label: string; cost: number; radius: number; boost: number }> = {
  small: { label: 'Malá reklama', cost: AD_CAMPAIGN_COST, radius: 0, boost: AD_RATING_BOOST },
  medium: {
    label: 'Střední reklama',
    cost: AD_CAMPAIGN_COST * AD_MEDIUM.costFactor,
    radius: AD_MEDIUM.radius,
    boost: AD_MEDIUM.boost,
  },
  large: {
    label: 'Velká reklama',
    cost: AD_CAMPAIGN_COST * AD_LARGE.costFactor,
    radius: AD_LARGE.radius,
    boost: AD_LARGE.boost,
  },
};

export function advertise(game: Game, town: Town, size: AdSize = 'small'): string | null {
  const ad = AD_SIZES[size];
  if (game.money < ad.cost) return `Nedostatek peněz (${formatMoney(ad.cost)}).`;
  const stations = game.world.rail
    .primaries()
    .filter(
      (s) => game.passengers.townsInReach(s).includes(town) || Math.hypot(s.x - town.x, s.y - town.y) <= ad.radius,
    );
  if (stations.length === 0) return `Ve městě ${town.name} nemáte žádnou stanici.`;
  game.spend(ad.cost, 'construction');
  for (const station of stations) {
    for (const entry of Object.values(station.ratings)) entry.rating = Math.min(1, entry.rating + ad.boost);
  }
  game.news(`${ad.label} ve městě ${town.name} zvedla hodnocení ${stations.length} stanic.`, {
    x: town.x + 0.5,
    y: town.y + 0.5,
  });
  game.events.emit('stationsChanged');
  return null;
}

export function fundBuildings(game: Game, town: Town): string | null {
  const cost = fundBuildingsCost(town);
  if (game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
  game.spend(cost, 'construction');
  const before = town.buildings.length;
  town.population = Math.round(town.population * (1 + FUND_GROWTH));
  game.authority.quietly(() => expandTown(game.world.map, town, game.clock.date.year, game.rng));
  game.news(`${town.name}: financovaná výstavba přidala ${town.buildings.length - before} budov.`, {
    x: town.x + 0.5,
    y: town.y + 0.5,
  });
  game.events.emit('townsChanged');
  return null;
}
