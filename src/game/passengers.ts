import {
  FARE_TIERS,
  PASSENGERS_MAX_WAITING_MONTHS,
  PASSENGERS_MONTHLY_SHARE,
  STATION_CATCHMENT_RADIUS,
  WAGON_CAPACITY,
} from './balance';
import { formatMoney, type Game } from './game';
import type { Train } from './trains';
import { TileType } from '../world/map';
import { stationTiles, type Station } from '../world/rail';
import type { Town } from '../world/town';

const DAYS_PER_MONTH = 30;

export function fare(passengers: number, tiles: number, days: number): number {
  const tier = FARE_TIERS.find((t) => days <= t.maxDays)!;
  return Math.round(passengers * tiles * tier.rate);
}

// Cestující: vznikají ve městech u nástupišť, vlaky je vozí a dostávají za ně zaplaceno
export class Passengers {
  constructor(private readonly game: Game) {
    game.clock.events.on('day', () => this.generate());
  }

  // Města, jejichž zástavba leží v dosahu nástupiště
  townsInReach(station: Station): Town[] {
    const { map, towns } = this.game.world;
    const r = STATION_CATCHMENT_RADIUS;
    const found = new Set<number>();
    const tiles = stationTiles(station.x, station.y, station.axis);
    const x0 = Math.min(...tiles.map((t) => t.x)) - r;
    const x1 = Math.max(...tiles.map((t) => t.x)) + r;
    const y0 = Math.min(...tiles.map((t) => t.y)) - r;
    const y1 = Math.max(...tiles.map((t) => t.y)) + r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (map.isType(x, y, TileType.Building)) found.add(map.getOwner(x, y));
      }
    }
    return [...found].map((id) => towns[id]);
  }

  // Měsíční příliv cestujících na nástupiště; město se dělí mezi všechna svá nástupiště
  monthlyPassengers(station: Station): number {
    const stations = this.game.world.rail.stations;
    return this.townsInReach(station).reduce((sum, town) => {
      const sharing = stations.filter((s) => this.townsInReach(s).includes(town)).length;
      return sum + (town.population * PASSENGERS_MONTHLY_SHARE) / sharing;
    }, 0);
  }

  // Vyloží cestující z jiného nástupiště, zaplatí za ně a naloží čekající
  exchange(train: Train, station: Station): void {
    const { game } = this;
    if (train.passengers > 0 && train.boardedStation !== station.id) {
      const days = game.clock.now - train.boardedAt;
      const income = fare(train.passengers, train.tiles, days);
      game.earn(income);
      game.events.emit('income', income, station.x + 0.5, station.y + 0.5);
      game.thisYear.passengers += train.passengers;
      train.income += income;
      game.news(
        `${train.name} přivezl ${train.passengers} cestujících do stanice ${station.name}: ` +
          `${train.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}.`,
      );
      train.passengers = 0;
    }

    const capacity = train.wagons * WAGON_CAPACITY;
    const boarding = Math.min(capacity - train.passengers, Math.floor(station.waiting));
    if (boarding > 0 || train.passengers === 0) {
      train.passengers += boarding;
      station.waiting -= boarding;
      train.boardedStation = station.id;
      train.boardedAt = game.clock.now;
      train.tiles = 0;
    }
    for (const town of this.townsInReach(station)) town.served = true;
    game.events.emit('stationsChanged');
  }

  private generate(): void {
    for (const station of this.game.world.rail.stations) {
      const monthly = this.monthlyPassengers(station);
      const max = monthly * PASSENGERS_MAX_WAITING_MONTHS;
      station.waiting = Math.min(max, station.waiting + monthly / DAYS_PER_MONTH);
    }
    this.game.events.emit('stationsChanged');
  }
}
