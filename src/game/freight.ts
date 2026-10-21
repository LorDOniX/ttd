import { COAL_FARE_TIERS, COAL_MAX_WAITING_MONTHS, WAGON_CAPACITY } from './balance';
import { formatMoney, type Game } from './game';
import { catchmentArea, fare, type Area } from './passengers';
import { inflowFactor } from './rating';
import { trainModel, wagonsAtStation, type Train } from './trains';
import { INDUSTRY_SIZE, type Industry, type IndustryKind } from '../world/industry';
import type { Station } from '../world/rail';

const DAYS_PER_MONTH = 30;

function overlaps(area: Area, industry: Industry): boolean {
  return (
    industry.x <= area.x1 &&
    industry.x + INDUSTRY_SIZE - 1 >= area.x0 &&
    industry.y <= area.y1 &&
    industry.y + INDUSTRY_SIZE - 1 >= area.y0
  );
}

// Nákladní doprava uhlí: doly ho těží na obsluhovaná nástupiště, elektrárny ho vykupují
export class Freight {
  constructor(private readonly game: Game) {
    game.clock.events.on('day', () => this.produce());
    game.clock.events.on('month', () => {
      for (const industry of game.world.industries) {
        industry.lastTransported = industry.transported;
        industry.transported = 0;
      }
    });
  }

  industriesInReach(station: Station, kind: IndustryKind): Industry[] {
    const area = catchmentArea(station);
    return this.game.world.industries.filter((i) => i.kind === kind && overlaps(area, i));
  }

  acceptsCoal(station: Station): boolean {
    return this.industriesInReach(station, 'power-station').length > 0;
  }

  // Uhlí se na nástupiště sváží, jen když ho obsluhuje některý vlak na uhlí
  pickupStations(mine: Industry): Station[] {
    const { rail } = this.game.world;
    const served = new Set(this.game.fleet.trains.filter((t) => t.cargo === 'coal').flatMap((t) => t.orders ?? []));
    return rail.stations.filter((s) => served.has(s.id) && this.industriesInReach(s, 'coal-mine').includes(mine));
  }

  // Vyloží uhlí, pokud nástupiště zásobuje elektrárnu, a naloží čekající; loadOnly jen doplní
  exchange(train: Train, station: Station, loadOnly = false): void {
    const { game } = this;
    const atPlatform = wagonsAtStation(train, station) * WAGON_CAPACITY;
    let unloaded = 0;
    if (!loadOnly && train.passengers > 0 && train.boardedStation !== station.id && this.acceptsCoal(station)) {
      unloaded = Math.min(train.passengers, atPlatform);
      train.passengers -= unloaded;
      if (unloaded > 0) {
        const days = game.clock.now - train.boardedAt;
        const income = fare(unloaded, train.tiles, days, COAL_FARE_TIERS);
        game.earn(income);
        game.events.emit('income', income, station.x + 0.5, station.y + 0.5);
        game.thisYear.coal += unloaded;
        train.income += income;
        game.news(
          `${train.name} přivezl ${unloaded} t uhlí do stanice ${station.name}: ` +
            `${train.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}.`,
        );
      }
    }

    const free = unloaded > 0 ? atPlatform : Math.max(0, atPlatform - train.passengers);
    const loading = Math.min(free, train.wagons * WAGON_CAPACITY - train.passengers, Math.floor(station.coal));
    const staying = train.passengers;
    if (loading > 0 || staying === 0) {
      const total = staying + loading;
      train.boardedAt = total > 0 ? (staying * train.boardedAt + loading * game.clock.now) / total : game.clock.now;
      train.tiles = total > 0 ? Math.round((staying * train.tiles) / total) : 0;
      train.passengers = total;
      station.coal -= loading;
      train.boardedStation = station.id;
    }
    station.lastVisit = game.clock.now;
    station.lastSpeed = trainModel(train).speed;
    game.events.emit('stationsChanged');
  }

  private produce(): void {
    for (const mine of this.game.world.industries) {
      if (mine.kind !== 'coal-mine') continue;
      const stations = this.pickupStations(mine);
      if (stations.length === 0) continue;
      const daily = mine.production / DAYS_PER_MONTH / stations.length;
      for (const station of stations) {
        const amount = daily * inflowFactor(station.rating);
        const max = mine.production * COAL_MAX_WAITING_MONTHS;
        const added = Math.max(0, Math.min(amount, max - station.coal));
        station.coal += added;
        mine.transported += added;
      }
    }
  }
}
