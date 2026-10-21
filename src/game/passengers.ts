import {
  FARE_TIERS,
  PASSENGERS_MAX_WAITING_MONTHS,
  PASSENGERS_MONTHLY_SHARE,
  STATION_CATCHMENT_RADIUS,
  WAGON_CAPACITY,
} from './balance';
import { formatMoney, type Game } from './game';
import { inflowFactor, leaveShare, updateRating } from './rating';
import { trainModel, wagonsAtStation, type Train } from './trains';
import { TileType } from '../world/map';
import { stationTiles, type Station, type StationShape } from '../world/rail';
import type { Town } from '../world/town';

const DAYS_PER_MONTH = 30;

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Obdélník dosahu nástupiště včetně okrajů (může přesahovat mapu)
export function catchmentArea(station: StationShape): Area {
  const r = STATION_CATCHMENT_RADIUS;
  const tiles = stationTiles(station);
  return {
    x0: Math.min(...tiles.map((t) => t.x)) - r,
    x1: Math.max(...tiles.map((t) => t.x)) + r,
    y0: Math.min(...tiles.map((t) => t.y)) - r,
    y1: Math.max(...tiles.map((t) => t.y)) + r,
  };
}

export function inArea(area: Area, x: number, y: number): boolean {
  return x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;
}

export function fare(amount: number, tiles: number, days: number, tiers = FARE_TIERS): number {
  const tier = tiers.find((t) => days <= t.maxDays)!;
  return Math.round(amount * tiles * tier.rate);
}

// Cestující: vznikají ve městech u nástupišť, vlaky je vozí a dostávají za ně zaplaceno
export class Passengers {
  // Dosah se mění jen se změnou mapy (stavba, budovy), proto je platný do další změny
  private readonly reachCache = new Map<number, Town[]>();
  private reachVersion = -1;

  constructor(private readonly game: Game) {
    game.clock.events.on('day', () => this.generate());
  }

  // Města, jejichž zástavba leží v dosahu nástupiště
  townsInReach(station: Station): Town[] {
    const { map, towns } = this.game.world;
    if (this.reachVersion !== map.changeCursor) {
      this.reachCache.clear();
      this.reachVersion = map.changeCursor;
    }
    const cached = this.reachCache.get(station.id);
    if (cached) return cached;

    const found = new Set<number>();
    const { x0, x1, y0, y1 } = catchmentArea(station);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (map.isType(x, y, TileType.Building)) found.add(map.getOwner(x, y));
      }
    }
    const result = [...found].map((id) => towns[id]);
    this.reachCache.set(station.id, result);
    return result;
  }

  // Měsíční příliv cestujících na nástupiště; město se dělí mezi všechna svá nástupiště
  monthlyPassengers(station: Station): number {
    const stations = this.game.world.rail.stations;
    return this.townsInReach(station).reduce((sum, town) => {
      const sharing = stations.filter((s) => this.townsInReach(s).includes(town)).length;
      return sum + (town.population * PASSENGERS_MONTHLY_SHARE) / sharing;
    }, 0);
  }

  // Skutečný měsíční příliv po započtení hodnocení nástupiště
  inflow(station: Station): number {
    return this.monthlyPassengers(station) * inflowFactor(station.rating);
  }

  // Vyloží cestující z jiného nástupiště, zaplatí za ně a naloží čekající.
  // Vystupuje a nastupuje se jen ve vagonech, které stojí na nástupišti; loadOnly jen doplní (čekání na plné naložení).
  exchange(train: Train, station: Station, loadOnly = false): void {
    const { game } = this;
    const atPlatform = wagonsAtStation(train, station) * WAGON_CAPACITY;
    let unloaded = 0;
    if (!loadOnly && train.passengers > 0 && train.boardedStation !== station.id) {
      unloaded = Math.min(train.passengers, atPlatform);
      train.passengers -= unloaded;
      const stayed = train.passengers > 0 ? ` (${train.passengers} nevystoupilo z vagonů mimo nástupiště)` : '';
      if (unloaded > 0) {
        const days = game.clock.now - train.boardedAt;
        const income = fare(unloaded, train.tiles, days);
        game.earn(income);
        game.events.emit('income', income, station.x + 0.5, station.y + 0.5);
        game.thisYear.passengers += unloaded;
        train.income += income;
        game.news(
          `${train.name} přivezl ${unloaded} cestujících do stanice ${station.name}: ` +
            `${train.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}${stayed}.`,
        );
      } else {
        game.news(`${train.name} stojí ve stanici ${station.name} mimo nástupiště${stayed}.`);
      }
    }

    // Vagony u nástupiště se vyprázdnily, pokud se vystupovalo; jinak jsou obsazené nejdřív ony
    const free = unloaded > 0 ? atPlatform : Math.max(0, atPlatform - train.passengers);
    const capacity = train.wagons * WAGON_CAPACITY;
    const boarding = Math.min(free, capacity - train.passengers, Math.floor(station.waiting));
    const staying = train.passengers;
    if (boarding > 0 || staying === 0) {
      // Kdo nevystoupil, jede dál; jeho cesta se započte poměrně do společné jízdenky
      const total = staying + boarding;
      train.boardedAt = total > 0 ? (staying * train.boardedAt + boarding * game.clock.now) / total : game.clock.now;
      train.tiles = total > 0 ? Math.round((staying * train.tiles) / total) : 0;
      train.passengers = total;
      station.waiting -= boarding;
      train.boardedStation = station.id;
    }
    for (const town of this.townsInReach(station)) town.served = true;
    station.lastVisit = game.clock.now;
    station.lastSpeed = trainModel(train).speed;
    game.events.emit('stationsChanged');
  }

  private generate(): void {
    const now = this.game.clock.now;
    for (const station of this.game.world.rail.stations) {
      updateRating(station, now);
      const monthly = this.inflow(station);
      const max = monthly * PASSENGERS_MAX_WAITING_MONTHS;
      const waiting = Math.min(max, station.waiting + monthly / DAYS_PER_MONTH);
      station.waiting = waiting * (1 - leaveShare(station.rating));
    }
    this.game.events.emit('stationsChanged');
  }
}
