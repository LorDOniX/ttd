import { FREIGHT_MAX_WAITING_MONTHS, MAIL_PER_PASSENGER, TOWN_ACCEPTS_MIN_BUILDINGS } from './balance';
import { CARGOS, FREIGHT_TYPES, TOWN_ACCEPTS, type Carrier, type FreightType, type Hold } from './cargo';
import { formatMoney, type Game } from './game';
import { catchmentArea, fare, type Area } from './passengers';
import { inflowFactor, recordVisit } from './rating';
import { roadVehicleModel } from './roadVehicles';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type Industry } from '../world/industry';
import type { Station, StationShape } from '../world/rail';

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

  industriesInReach(station: StationShape): Industry[] {
    const area = catchmentArea(station);
    return this.game.world.industries.filter((i) => overlaps(area, i));
  }

  // Druhy nákladu, které závody v dosahu nástupiště vyrábějí
  produced(station: StationShape): FreightType[] {
    const types = this.industriesInReach(station).map((i) => INDUSTRY_TYPES[i.kind].produces);
    return FREIGHT_TYPES.filter((type) => types.includes(type));
  }

  // Druhy nákladu, které nástupiště vykupuje díky závodům a městům v dosahu
  accepted(station: Station): FreightType[] {
    return this.acceptedIn(station, this.game.passengers.buildingsInReach(station));
  }

  // Tototéž pro tvar nástupiště se zadaným počtem městských budov v dosahu (náhled stavby)
  acceptedIn(shape: StationShape, townBuildings: number): FreightType[] {
    const types = this.industriesInReach(shape).flatMap((i) => INDUSTRY_TYPES[i.kind].accepts);
    if (townBuildings >= TOWN_ACCEPTS_MIN_BUILDINGS) types.push(...TOWN_ACCEPTS);
    return FREIGHT_TYPES.filter((type) => types.includes(type));
  }

  // Náklad se na nástupiště sváží, jen když ho tam odváží některý vlak s vagony na tento náklad
  private servedBy(type: FreightType): Set<number> {
    const trains = this.game.fleet.trains.filter((t) => t.cargo === type).flatMap((t) => t.orders ?? []);
    const vehicles = this.game.roadFleet.vehicles
      .filter((v) => roadVehicleModel(v).cargo === type)
      .flatMap((v) => v.orders ?? []);
    return new Set([...trains, ...vehicles]);
  }

  pickupStations(industry: Industry): Station[] {
    const type = INDUSTRY_TYPES[industry.kind].produces;
    if (!type) return [];
    const served = this.servedBy(type);
    return this.game.world.rail.stations.filter(
      (s) => served.has(s.id) && this.industriesInReach(s).includes(industry),
    );
  }

  // Vyloží náklad, pokud ho nástupiště vykupuje, a naloží čekající; loadOnly jen doplní. Vrací přeložené tuny.
  exchange(train: Carrier, hold: Hold, station: Station, type: FreightType, loadOnly = false): number {
    const { game } = this;
    const spec = CARGOS[type];
    const { atPlatform } = hold;
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
        if (consumer) {
          consumer.received += unloaded;
          consumer.lastDelivery = game.clock.day;
        }
        game.news(
          `${train.name} přivezl ${unloaded} ${spec.unit} do stanice ${station.name}: ` +
            `${train.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}.`,
          station,
        );
      }
    }

    const free = unloaded > 0 ? atPlatform : Math.max(0, atPlatform - train.passengers);
    const stock = station.freight[type];
    const loading = Math.min(free, hold.capacity - train.passengers, Math.floor(stock));
    const staying = train.passengers;
    if (loading > 0 || staying === 0) {
      const total = staying + loading;
      train.boardedAt = total > 0 ? (staying * train.boardedAt + loading * game.clock.now) / total : game.clock.now;
      train.tiles = total > 0 ? Math.round((staying * train.tiles) / total) : 0;
      train.passengers = total;
      station.freight[type] = stock - loading;
      train.boardedStation = station.id;
    }
    recordVisit(station, type, game.clock.now, hold.speed);
    game.events.emit('stationsChanged');
    return unloaded + loading;
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
        const amount = daily * inflowFactor(station.ratings[type].rating);
        const added = Math.max(0, Math.min(amount, max - station.freight[type]));
        station.freight[type] += added;
        industry.transported += added;
      }
    }
    this.produceMail();
  }

  // Měsíční pošta z měst v dosahu nástupiště, dělená stejně jako cestující
  monthlyMail(station: Station): number {
    return this.game.passengers.monthlyPassengers(station) * MAIL_PER_PASSENGER;
  }

  private produceMail(): void {
    const served = this.servedBy('mail');
    for (const station of this.game.world.rail.stations) {
      if (!served.has(station.id)) continue;
      const monthly = this.monthlyMail(station);
      const amount = (monthly / DAYS_PER_MONTH) * inflowFactor(station.ratings.mail.rating);
      const max = monthly * FREIGHT_MAX_WAITING_MONTHS;
      station.freight.mail += Math.max(0, Math.min(amount, max - station.freight.mail));
    }
  }
}
