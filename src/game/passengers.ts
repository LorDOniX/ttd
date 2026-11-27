import {
  FARE_TIERS,
  FEEDER_SHARE,
  PASSENGERS_BOOSTED_RESIDENTS,
  PASSENGERS_MAX_WAITING_MONTHS,
  PASSENGERS_MONTHLY_SHARE,
  CATCHMENT_RADIUS,
} from './balance';
import {
  CARGOS,
  CARGO_TYPES,
  feederShare,
  loadCargo,
  planUnload,
  removeDest,
  transferOut,
  trimDests,
  type Cargo,
  type Carrier,
  type ExchangeOptions,
  type Hold,
  type UnloadPlan,
} from './cargo';
import { formatMoney, type Game } from './game';
import { bonusText } from './subsidies';
import { inflowFactor, leaveShare, recordVisit, updateRating } from './rating';
import { TileType } from '../world/map';
import { poolId, stationTiles, type Station, type StationShape } from '../world/rail';
import { buildingCapacity, townCapacity, type Town } from '../world/town';

const DAYS_PER_MONTH = 30;

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Obdélník dosahu nástupiště včetně okrajů (může přesahovat mapu)
export function catchmentArea(station: StationShape & Pick<Partial<Station>, 'kind' | 'airport'>): Area {
  const r = catchmentRadius(station);
  const tiles = stationTiles(station);
  return {
    x0: Math.min(...tiles.map((t) => t.x)) - r,
    x1: Math.max(...tiles.map((t) => t.x)) + r,
    y0: Math.min(...tiles.map((t) => t.y)) - r,
    y1: Math.max(...tiles.map((t) => t.y)) + r,
  };
}

// Dosah podle druhu stanice jako v OpenTTD (bez druhu železniční nástupiště)
export function catchmentRadius(station: Pick<Partial<Station>, 'kind' | 'airport'>): number {
  if (station.kind === 'air') return CATCHMENT_RADIUS[station.airport ?? 'small'];
  return CATCHMENT_RADIUS[station.kind ?? 'rail'];
}

export function inArea(area: Area, x: number, y: number): boolean {
  return x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;
}

export function fare(amount: number, tiles: number, days: number, tiers = FARE_TIERS): number {
  const tier = tiers.find((t) => days <= t.maxDays)!;
  return Math.round(amount * tiles * tier.rate);
}

// Provede plán vykládky: přeloží (vozidlo dostane podíl jízdného, náklad zůstane i s cílem na stanici)
// a doručí (zaplatí se jízdné i dotace; delivered započte statistiky). manual: hlásit cestující, kteří
// nevystoupili z vagonů mimo nástupiště. Vrací počet vyložených jednotek
export function unloadCargo(
  game: Game,
  carrier: Carrier,
  station: Station,
  cargo: Cargo,
  plan: UnloadPlan,
  manual: boolean,
  delivered: (amount: number) => void,
): number {
  const spec = CARGOS[cargo];
  const here = poolId(station);
  const days = game.clock.now - carrier.boardedAt;
  let moved = 0;
  let transferred = 0;
  let credits = 0;
  for (const t of plan.transfers) {
    if (t.amount <= 0) continue;
    const credit = Math.round(fare(t.amount, carrier.tiles, days, spec.fareTiers) * FEEDER_SHARE);
    // Náklad bez cíle zahrnuje i ten s cílem tady (příkaz překládky)
    if (t.dest === undefined) removeDest(carrier, here, t.amount);
    transferOut(carrier, station, cargo, t.amount, credit, t.dest);
    transferred += t.amount;
    credits += credit;
  }
  if (transferred > 0) {
    game.news(
      `${carrier.name} přeložil ${transferred} ${spec.unit} ve stanici ${station.name} (podíl ${formatMoney(credits)}).`,
      station,
    );
    moved += transferred;
  }
  const amount = Math.min(plan.deliver, carrier.passengers);
  if (amount > 0) {
    const share = feederShare(carrier, amount);
    carrier.feeder = Math.max(0, (carrier.feeder ?? 0) - share);
    carrier.passengers -= amount;
    removeDest(carrier, here, amount);
    trimDests(carrier);
    const base = fare(amount, carrier.tiles, days, spec.fareTiers);
    const bonus = game.subsidies.bonus(cargo, carrier.origin ?? carrier.boardedStation, station, base);
    const income = base + bonus;
    game.earn(income);
    game.events.emit('income', income, station.x + 0.5, station.y + 0.5);
    delivered(amount);
    game.townGrowth.recordDelivery(station, cargo, amount);
    // Podíl, který už dostala vozidla před překládkou, se od příjmu tohoto vozidla odečte
    carrier.income += income - share;
    const stayed =
      manual && cargo === 'passengers' && carrier.passengers > 0
        ? ` (${carrier.passengers} nevystoupilo z vagonů mimo nástupiště)`
        : '';
    game.news(
      `${carrier.name} přivezl ${amount} ${spec.unit} do stanice ${station.name}: ` +
        `${carrier.tiles} dlaždic za ${Math.round(days)} dní, +${formatMoney(income)}${bonusText(bonus)}${stayed}.`,
      station,
    );
    moved += amount;
  }
  return moved;
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
    return this.shares.get(poolId(station)) ?? new Map();
  }

  // Počet budov měst v dosahu nástupiště
  buildingsInReach(station: Station): number {
    this.refreshReach();
    return this.buildings.get(poolId(station)) ?? 0;
  }

  // Města v dosahu místa pro nové nástupiště: podíl zastávky (bez dělení s ostatními nástupišti) a počet budov
  coverage(shape: StationShape & Pick<Partial<Station>, 'kind' | 'airport'>): {
    shares: Map<Town, number>;
    buildings: number;
  } {
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
    // Spojená stanice má dosah jako sjednocení dosahů všech svých částí
    const pools = rail.primaries();
    const covered = pools.map((primary) => {
      const tiles = new Set<number>();
      for (const part of rail.membersOf(primary)) {
        const { x0, x1, y0, y1 } = catchmentArea(part);
        for (let y = Math.max(0, y0); y <= Math.min(map.height - 1, y1); y++) {
          for (let x = Math.max(0, x0); x <= Math.min(map.width - 1, x1); x++) {
            if (weights.has(y * map.width + x)) tiles.add(y * map.width + x);
          }
        }
      }
      return [...tiles];
    });
    const stationsAt = new Map<number, number>();
    for (const tiles of covered) for (const t of tiles) stationsAt.set(t, (stationsAt.get(t) ?? 0) + 1);

    this.shares.clear();
    this.buildings.clear();
    pools.forEach((station, i) => {
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
  // S cargodistem vystoupí jen cestující, kteří tu mají cíl nebo přestupují, a nastoupí jen ti, kdo jedou
  // přes další zastávku vozidla. Vrací počet vyložených a naložených cestujících.
  exchange(train: Carrier, hold: Hold, station: Station, loadOnly = false, options: ExchangeOptions = {}): number {
    const { game } = this;
    const { atPlatform } = hold;
    let unloaded = 0;
    if (!loadOnly) game.cargodist.recordTrip('passengers', hold.prev, station, train.passengers, hold.capacity);
    const split =
      !loadOnly && train.passengers > 0 ? game.cargodist.split(station, 'passengers', train, hold.next) : undefined;
    if (!loadOnly && options.unload !== 'none' && train.passengers > 0 && train.boardedStation !== station.id) {
      const plan = planUnload(train, atPlatform, options.unload, true, poolId(station), split);
      const empty = plan.deliver === 0 && plan.transfers.length === 0;
      if (empty && !split && options.unload !== 'transfer') {
        game.news(`${train.name} stojí ve stanici ${station.name} mimo nástupiště.`, station);
      }
      unloaded = unloadCargo(game, train, station, 'passengers', plan, !split, (n) => {
        game.thisYear.passengers += n;
      });
    }

    // Vagony u nástupiště se vyprázdnily, pokud se vystupovalo; jinak jsou obsazené nejdřív ony
    const free = split || unloaded === 0 ? Math.max(0, atPlatform - train.passengers) : atPlatform;
    let boarding = 0;
    if (options.load !== 'none') {
      // Kdo nevystoupil, jede dál; jeho cesta se započte poměrně do společné jízdenky
      const room = Math.min(free, hold.capacity - train.passengers);
      const route = game.cargodist.boardingRoute(station, 'passengers', hold.next, station.waiting);
      const loaded = loadCargo(train, station, 'passengers', room, station.waiting, game.clock.now, route);
      station.waiting -= loaded.fresh;
      if (route) game.cargodist.consumeFresh(station, 'passengers', hold.next, loaded.taken);
      boarding = loaded.transferred + loaded.fresh;
    }
    for (const town of this.townsInReach(station)) town.served = true;
    recordVisit(station, 'passengers', game.clock.now, hold.speed);
    game.events.emit('stationsChanged');
    return unloaded + boarding;
  }

  private generate(): void {
    const now = this.game.clock.now;
    for (const station of this.game.world.rail.primaries()) {
      const bonus = this.game.authority.stationBonus(station);
      for (const cargo of CARGO_TYPES) updateRating(station, cargo, now, bonus);
      const monthly = this.inflow(station);
      const max = monthly * PASSENGERS_MAX_WAITING_MONTHS;
      const waiting = Math.min(max, station.waiting + monthly / DAYS_PER_MONTH);
      this.game.cargodist.addFresh(station, 'passengers', waiting - station.waiting);
      station.waiting = waiting * (1 - leaveShare(station.ratings.passengers.rating));
    }
    this.game.events.emit('stationsChanged');
  }
}
