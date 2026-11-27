import { consistCargos } from './consist';
import { FREIGHT_MAX_WAITING_MONTHS, MAIL_PER_PASSENGER, TOWN_ACCEPTS_MIN_BUILDINGS } from './balance';
import {
  FREIGHT_TYPES,
  TOWN_ACCEPTS,
  loadCargo,
  planUnload,
  type Carrier,
  type ExchangeOptions,
  type FreightType,
  type Hold,
} from './cargo';
import type { Game } from './game';
import { catchmentArea, unloadCargo, type Area } from './passengers';
import { inflowFactor, recordVisit } from './rating';
import { aircraftCargo } from './aircraft';
import { vehicleCargo } from './roadVehicles';
import { refitLoadStops, stationOrders } from './trains';
import { shipCargo } from './ships';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type Industry } from '../world/industry';
import { poolId, type Station, type StationShape } from '../world/rail';

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

  // Závody v dosahu: u postavené stanice v dosahu kterékoli její části (každá má dosah podle druhu)
  industriesInReach(station: StationShape & Pick<Partial<Station>, 'kind' | 'airport'>): Industry[] {
    const areas = this.game.world.rail.catchmentParts(station).map((part) => catchmentArea(part));
    return this.game.world.industries.filter((i) => areas.some((area) => overlaps(area, i)));
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
    // Vlak s vagony na tento náklad, nebo s příkazem přestavby na něj (pak jen zastávky od přestavby dál)
    const trains = this.game.fleet.trains.flatMap((t) => {
      if (consistCargos(t).includes(type)) return stationOrders(t);
      return (t.orderFlags ?? []).some((f) => f.refit === type) ? refitLoadStops(t, type) : [];
    });
    const vehicles = this.game.roadFleet.vehicles
      .filter((v) => vehicleCargo(v) === type)
      .flatMap((v) => v.orders ?? []);
    const aircraft = this.game.airFleet.aircraft
      .filter((p) => aircraftCargo(p) === type)
      .flatMap((p) => p.orders ?? []);
    const ships = this.game.shipFleet.ships.filter((s) => shipCargo(s) === type).flatMap((s) => s.orders ?? []);
    return new Set([...trains, ...vehicles, ...aircraft, ...ships]);
  }

  pickupStations(industry: Industry): Station[] {
    const type = INDUSTRY_TYPES[industry.kind].produces;
    if (!type) return [];
    const served = this.servedBy(type);
    const { rail } = this.game.world;
    return rail
      .primaries()
      .filter((s) => rail.membersOf(s).some((m) => served.has(m.id)) && this.industriesInReach(s).includes(industry));
  }

  // Vyloží náklad, pokud ho nástupiště vykupuje, a naloží čekající (nejdřív z překládky); loadOnly jen doplní.
  // Volby příkazu: vyložit vše (nevykupovaný náklad zůstane na stanici jako překládka), překládka, nevykládat,
  // nenakládat. S cargodistem se vyloží náklad s cílem tady a náklad, který pokračuje jinou linkou, a naloží
  // jen náklad přes další zastávku vozidla. Vrací přeložené tuny.
  exchange(
    train: Carrier,
    hold: Hold,
    station: Station,
    type: FreightType,
    loadOnly = false,
    options: ExchangeOptions = {},
  ): number {
    const { game } = this;
    const { atPlatform } = hold;
    let unloaded = 0;
    if (!loadOnly) game.cargodist.recordTrip(type, hold.prev, station, train.passengers, hold.capacity);
    const accepted = this.accepted(station).includes(type);
    const split = !loadOnly && train.passengers > 0 ? game.cargodist.split(station, type, train, hold.next) : undefined;
    if (!loadOnly && options.unload !== 'none' && train.passengers > 0 && train.boardedStation !== station.id) {
      const plan = planUnload(train, atPlatform, options.unload, accepted, poolId(station), split);
      unloaded = unloadCargo(game, train, station, type, plan, !split, (n) => {
        game.thisYear.freight[type] += n;
        // Dodávku dostane první závod v dosahu, který ji přijímá (zboží pro město žádný)
        const consumer = this.industriesInReach(station).find((i) => INDUSTRY_TYPES[i.kind].accepts.includes(type));
        if (consumer) {
          consumer.received += n;
          consumer.lastDelivery = game.clock.day;
        }
      });
    }

    const free = split || unloaded === 0 ? Math.max(0, atPlatform - train.passengers) : atPlatform;
    let loading = 0;
    if (options.load !== 'none') {
      const room = Math.min(free, hold.capacity - train.passengers);
      const route = game.cargodist.boardingRoute(station, type, hold.next, station.freight[type]);
      const loaded = loadCargo(train, station, type, room, station.freight[type], game.clock.now, route);
      station.freight[type] -= loaded.fresh;
      if (route) game.cargodist.consumeFresh(station, type, hold.next, loaded.taken);
      loading = loaded.transferred + loaded.fresh;
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
        this.game.cargodist.addFresh(station, type, added);
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
    const { rail } = this.game.world;
    for (const station of rail.primaries()) {
      if (!rail.membersOf(station).some((m) => served.has(m.id))) continue;
      const monthly = this.monthlyMail(station);
      const amount = (monthly / DAYS_PER_MONTH) * inflowFactor(station.ratings.mail.rating);
      const max = monthly * FREIGHT_MAX_WAITING_MONTHS;
      const added = Math.max(0, Math.min(amount, max - station.freight.mail));
      station.freight.mail += added;
      this.game.cargodist.addFresh(station, 'mail', added);
    }
  }
}
