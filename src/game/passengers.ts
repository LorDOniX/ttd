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
import { buildingCapacity, townCapacity, type Town } from '../world/town';

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
  // Dávka města pro každé nástupiště: podíl kapacity budov v dosahu, sdílené budovy dělené mezi nástupiště;
  // mění se jen se změnou mapy (stavba, budovy), proto platí do další změny
  private readonly shares = new Map<number, Map<Town, number>>();
  private readonly buildings = new Map<number, number>();
  private reachVersion = -1;

  constructor(private readonly game: Game) {
    game.clock.events.on('day', () => this.generate());
  }

  // Města, jejichž zástavba leží v dosahu nástupiště
  townsInReach(station: Station): Town[] {
    return [...this.townShares(station).keys()];
  }

  // Kolik dílů města (0–1) připadá na nástupiště
  townShares(station: Station): Map<Town, number> {
    this.refreshReach();
    return this.shares.get(station.id) ?? new Map();
  }

  // Počet budov měst v dosahu nástupiště
  buildingsInReach(station: Station): number {
    this.refreshReach();
    return this.buildings.get(station.id) ?? 0;
  }

  private refreshReach(): void {
    const { map } = this.game.world;
    if (this.reachVersion === map.changeCursor) return;
    this.computeReach();
    this.reachVersion = map.changeCursor;
  }

  private computeReach(): void {
    const { map, towns, rail } = this.game.world;
    const weights = new Map<number, { town: Town; weight: number }>();
    for (const town of towns) {
      const capacity = townCapacity(town);
      for (const b of town.buildings) {
        if (!map.isType(b.x, b.y, TileType.Building)) continue;
        weights.set(b.y * map.width + b.x, { town, weight: buildingCapacity(b.model) / capacity });
      }
    }
    const covered = rail.stations.map((station) => {
      const tiles: number[] = [];
      const { x0, x1, y0, y1 } = catchmentArea(station);
      for (let y = Math.max(0, y0); y <= Math.min(map.height - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(map.width - 1, x1); x++) {
          if (weights.has(y * map.width + x)) tiles.push(y * map.width + x);
        }
      }
      return tiles;
    });
    const stationsAt = new Map<number, number>();
    for (const tiles of covered) for (const t of tiles) stationsAt.set(t, (stationsAt.get(t) ?? 0) + 1);

    this.shares.clear();
    this.buildings.clear();
    rail.stations.forEach((station, i) => {
      const shares = new Map<Town, number>();
      for (const t of covered[i]) {
        const { town, weight } = weights.get(t)!;
        shares.set(town, (shares.get(town) ?? 0) + weight / stationsAt.get(t)!);
      }
      this.shares.set(station.id, shares);
      this.buildings.set(station.id, covered[i].length);
    });
  }

  // Měsíční příliv cestujících na nástupiště z části města v dosahu
  monthlyPassengers(station: Station): number {
    let sum = 0;
    for (const [town, share] of this.townShares(station)) sum += town.population * PASSENGERS_MONTHLY_SHARE * share;
    return sum;
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
