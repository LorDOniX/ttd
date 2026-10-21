import { FREIGHT_MAX_WAITING_MONTHS, WAGON_CAPACITY } from './balance';
import { CARGOS, FREIGHT_TYPES, TOWN_ACCEPTS, type FreightType } from './cargo';
import { formatMoney, type Game } from './game';
import { catchmentArea, fare, type Area } from './passengers';
import { inflowFactor } from './rating';
import { trainModel, wagonsAtStation, type Train } from './trains';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type Industry } from '../world/industry';
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

// Nákladní doprava: závody vyrábějí na obsluhovaná nástupiště, jiné závody náklad vykupují
export class Freight {
  constructor(private readonly game: Game) {
    game.clock.events.on('day', () => this.produce());
    game.clock.events.on('month', () => {
      for (const industry of game.world.industries) {
        industry.lastTransported = industry.transported;
        industry.transported = 0;
        industry.lastReceived = industry.received;
        industry.received = 0;
        const type = INDUSTRY_TYPES[industry.kind];
        // Zpracovatel vyrobí tolik, kolik mu minulý měsíc dovezli
        if (type.produces && !type.production) industry.production = industry.lastReceived;
      }
    });
  }

  industriesInReach(station: Station): Industry[] {
    const area = catchmentArea(station);
    return this.game.world.industries.filter((i) => overlaps(area, i));
  }

  // Druhy nákladu, které závody v dosahu nástupiště vyrábějí
  produced(station: Station): FreightType[] {
    const types = this.industriesInReach(station).map((i) => INDUSTRY_TYPES[i.kind].produces);
    return FREIGHT_TYPES.filter((type) => types.includes(type));
  }

  // Druhy nákladu, které nástupiště vykupuje díky závodům a městům v dosahu
  accepted(station: Station): FreightType[] {
    const types = this.industriesInReach(station).flatMap((i) => INDUSTRY_TYPES[i.kind].accepts);
    if (this.game.passengers.townsInReach(station).length > 0) types.push(...TOWN_ACCEPTS);
    return FREIGHT_TYPES.filter((type) => types.includes(type));
  }

  // Náklad se na nástupiště sváží, jen když ho tam odváží některý vlak s vagony na tento náklad
  pickupStations(industry: Industry): Station[] {
    const type = INDUSTRY_TYPES[industry.kind].produces;
    if (!type) return [];
    const served = new Set(this.game.fleet.trains.filter((t) => t.cargo === type).flatMap((t) => t.orders ?? []));
    return this.game.world.rail.stations.filter(
      (s) => served.has(s.id) && this.industriesInReach(s).includes(industry),
    );
  }

  // Vyloží náklad, pokud ho nástupiště vykupuje, a naloží čekající; loadOnly jen doplní
  exchange(train: Train, station: Station, type: FreightType, loadOnly = false): void {
    const { game } = this;
    const spec = CARGOS[type];
    const atPlatform = wagonsAtStation(train, station) * WAGON_CAPACITY;
    let unloaded = 0;
    const accepted = this.accepted(station).includes(type);
    if (!loadOnly && train.passengers > 0 && train.boardedStation !== station.id && accepted) {
      unloaded = Math.min(train.passengers, atPlatform);
      train.passengers -= unloaded;
      if (unloaded > 0) {
        const days = game.clock.now - train.boardedAt;
        const income = fare(unloaded, train.tiles, days, spec.fareTiers);
        game.earn(income);
        game.events.emit('income', income, station.x + 0.5, station.y + 0.5);
        game.thisYear.freight[type] += unloaded;
        train.income += income;
        // Dodávku dostane první závod v dosahu, který ji přijímá (zboží pro město žádný)
        const consumer = this.industriesInReach(station).find((i) => INDUSTRY_TYPES[i.kind].accepts.includes(type));
        if (consumer) consumer.received += unloaded;
        game.news(
          `${train.name} přivezl ${unloaded} ${spec.unit} do stanice ${station.name}: ` +
            `${train.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}.`,
        );
      }
    }

    const free = unloaded > 0 ? atPlatform : Math.max(0, atPlatform - train.passengers);
    const stock = station.freight[type];
    const loading = Math.min(free, train.wagons * WAGON_CAPACITY - train.passengers, Math.floor(stock));
    const staying = train.passengers;
    if (loading > 0 || staying === 0) {
      const total = staying + loading;
      train.boardedAt = total > 0 ? (staying * train.boardedAt + loading * game.clock.now) / total : game.clock.now;
      train.tiles = total > 0 ? Math.round((staying * train.tiles) / total) : 0;
      train.passengers = total;
      station.freight[type] = stock - loading;
      train.boardedStation = station.id;
    }
    station.lastVisit = game.clock.now;
    station.lastSpeed = trainModel(train).speed;
    game.events.emit('stationsChanged');
  }

  private produce(): void {
    for (const industry of this.game.world.industries) {
      const type = INDUSTRY_TYPES[industry.kind].produces;
      if (!type) continue;
      const stations = this.pickupStations(industry);
      if (stations.length === 0) continue;
      const daily = industry.production / DAYS_PER_MONTH / stations.length;
      const max = industry.production * FREIGHT_MAX_WAITING_MONTHS;
      for (const station of stations) {
        const amount = daily * inflowFactor(station.rating);
        const added = Math.max(0, Math.min(amount, max - station.freight[type]));
        station.freight[type] += added;
        industry.transported += added;
      }
    }
  }
}
