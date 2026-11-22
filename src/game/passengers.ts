import {
  FARE_TIERS,
  FEEDER_SHARE,
  PASSENGERS_BOOSTED_RESIDENTS,
  PASSENGERS_MAX_WAITING_MONTHS,
  PASSENGERS_MONTHLY_SHARE,
  STATION_CATCHMENT_RADIUS,
} from './balance';
import {
  CARGO_TYPES,
  feederShare,
  loadCargo,
  transferOut,
  type Carrier,
  type ExchangeOptions,
  type Hold,
} from './cargo';
import { formatMoney, type Game } from './game';
import { inflowFactor, leaveShare, recordVisit, updateRating } from './rating';
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

  // Města v dosahu místa pro nové nástupiště: podíl zastávky (bez dělení s ostatními nástupišti) a počet budov
  coverage(shape: StationShape): { shares: Map<Town, number>; buildings: number } {
    const { map, towns } = this.game.world;
    const area = catchmentArea(shape);
    const shares = new Map<Town, number>();
    let buildings = 0;
    for (const town of towns) {
      const capacity = townCapacity(town);
      for (const b of town.buildings) {
        if (!inArea(area, b.x, b.y) || !map.isType(b.x, b.y, TileType.Building)) continue;
        shares.set(town, (shares.get(town) ?? 0) + buildingCapacity(b.model) / capacity);
        buildings++;
      }
    }
    return { shares, buildings };
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
    for (const [town, share] of this.townShares(station)) {
      const travelling = town.population + Math.min(town.population, PASSENGERS_BOOSTED_RESIDENTS);
      sum += travelling * PASSENGERS_MONTHLY_SHARE * share;
    }
    return sum;
  }

  // Skutečný měsíční příliv po započtení hodnocení nástupiště
  inflow(station: Station): number {
    return this.monthlyPassengers(station) * inflowFactor(station.ratings.passengers.rating);
  }

  // Vyloží cestující z jiného nástupiště, zaplatí za ně a naloží čekající (nejdřív z překládky).
  // Vystupuje a nastupuje se jen ve vagonech, které stojí na nástupišti; loadOnly jen doplní (čekání na plné naložení).
  // Volby příkazu: překládka (cestující zůstanou na stanici, vozidlo dostane podíl), nevykládat, nenakládat.
  // Vrací počet vyložených a naložených cestujících.
  exchange(train: Carrier, hold: Hold, station: Station, loadOnly = false, options: ExchangeOptions = {}): number {
    const { game } = this;
    const { atPlatform } = hold;
    let unloaded = 0;
    if (!loadOnly && options.unload !== 'none' && train.passengers > 0 && train.boardedStation !== station.id) {
      unloaded = Math.min(train.passengers, atPlatform);
      const days = game.clock.now - train.boardedAt;
      if (options.unload === 'transfer') {
        if (unloaded > 0) {
          const credit = Math.round(fare(unloaded, train.tiles, days) * FEEDER_SHARE);
          transferOut(train, station, 'passengers', unloaded, credit);
          game.news(
            `${train.name} přeložil ${unloaded} cestujících ve stanici ${station.name} (podíl ${formatMoney(credit)}).`,
            station,
          );
        }
      } else if (unloaded > 0) {
        const share = feederShare(train, unloaded);
        train.feeder = Math.max(0, (train.feeder ?? 0) - share);
        train.passengers -= unloaded;
        const stayed = train.passengers > 0 ? ` (${train.passengers} nevystoupilo z vagonů mimo nástupiště)` : '';
        const income = fare(unloaded, train.tiles, days);
        game.earn(income);
        game.events.emit('income', income, station.x + 0.5, station.y + 0.5);
        game.thisYear.passengers += unloaded;
        // Podíl, který už dostala vozidla před překládkou, se od příjmu tohoto vozidla odečte
        train.income += income - share;
        game.news(
          `${train.name} přivezl ${unloaded} cestujících do stanice ${station.name}: ` +
            `${train.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}${stayed}.`,
          station,
        );
      } else {
        game.news(`${train.name} stojí ve stanici ${station.name} mimo nástupiště.`, station);
      }
    }

    // Vagony u nástupiště se vyprázdnily, pokud se vystupovalo; jinak jsou obsazené nejdřív ony
    const free = unloaded > 0 ? atPlatform : Math.max(0, atPlatform - train.passengers);
    let boarding = 0;
    if (options.load !== 'none') {
      // Kdo nevystoupil, jede dál; jeho cesta se započte poměrně do společné jízdenky
      const room = Math.min(free, hold.capacity - train.passengers);
      const loaded = loadCargo(train, station, 'passengers', room, station.waiting, game.clock.now);
      station.waiting -= loaded.fresh;
      boarding = loaded.transferred + loaded.fresh;
    }
    for (const town of this.townsInReach(station)) town.served = true;
    recordVisit(station, 'passengers', game.clock.now, hold.speed);
    game.events.emit('stationsChanged');
    return unloaded + boarding;
  }

  private generate(): void {
    const now = this.game.clock.now;
    for (const station of this.game.world.rail.stations) {
      for (const cargo of CARGO_TYPES) updateRating(station, cargo, now);
      const monthly = this.inflow(station);
      const max = monthly * PASSENGERS_MAX_WAITING_MONTHS;
      const waiting = Math.min(max, station.waiting + monthly / DAYS_PER_MONTH);
      station.waiting = waiting * (1 - leaveShare(station.ratings.passengers.rating));
    }
    this.game.events.emit('stationsChanged');
  }
}
