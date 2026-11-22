import {
  COAL_FARE_TIERS,
  FARE_TIERS,
  FOOD_FARE_TIERS,
  GRAIN_FARE_TIERS,
  GOODS_FARE_TIERS,
  IRON_ORE_FARE_TIERS,
  MAIL_FARE_TIERS,
  OIL_FARE_TIERS,
  RATING_START,
  STEEL_FARE_TIERS,
  WOOD_FARE_TIERS,
} from './balance';

// Druhy nákladu: přidání dalšího je položka v FREIGHT_TYPES, CARGOS a v INDUSTRY_TYPES (kdo ho vyrábí a přijímá)
export type FreightType = 'mail' | 'coal' | 'wood' | 'oil' | 'iron-ore' | 'steel' | 'goods' | 'grain' | 'food';
export type Cargo = 'passengers' | FreightType;

export const FREIGHT_TYPES: readonly FreightType[] = [
  'mail',
  'coal',
  'wood',
  'oil',
  'iron-ore',
  'steel',
  'goods',
  'grain',
  'food',
];
// Co vykupuje nástupiště s dostatkem městské zástavby v dosahu; pošta ve městech i vzniká
export const TOWN_ACCEPTS: readonly FreightType[] = ['mail', 'goods', 'food'];

export interface CargoSpec {
  name: string;
  // Za počtem: „12 cestujících“, „60 t uhlí“
  unit: string;
  // Malými písmeny do vět: „ruda 12 t“, „výkup rudy“
  noun: string;
  genitive: string;
  fareTiers: readonly { maxDays: number; rate: number }[];
  // Modely vagonů z train kitu, střídají se po řadě; null = osobní vagon podle lokomotivy
  wagonModels: readonly string[] | null;
  color: string;
}

export const CARGOS: Record<Cargo, CargoSpec> = {
  passengers: {
    name: 'Cestující',
    unit: 'cestujících',
    noun: 'cestující',
    genitive: 'cestujících',
    fareTiers: FARE_TIERS,
    wagonModels: null,
    color: '#5a8fd9',
  },
  mail: {
    name: 'Pošta',
    unit: 't pošty',
    noun: 'pošta',
    genitive: 'pošty',
    fareTiers: MAIL_FARE_TIERS,
    wagonModels: ['train-carriage-box'],
    color: '#d94a4a',
  },
  coal: {
    name: 'Uhlí',
    unit: 't uhlí',
    noun: 'uhlí',
    genitive: 'uhlí',
    fareTiers: COAL_FARE_TIERS,
    wagonModels: ['train-carriage-coal'],
    color: '#6b6b64',
  },
  wood: {
    name: 'Dřevo',
    unit: 't dřeva',
    noun: 'dřevo',
    genitive: 'dřeva',
    fareTiers: WOOD_FARE_TIERS,
    wagonModels: ['train-carriage-wood'],
    color: '#8a5a2b',
  },
  oil: {
    name: 'Ropa',
    unit: 't ropy',
    noun: 'ropa',
    genitive: 'ropy',
    fareTiers: OIL_FARE_TIERS,
    wagonModels: ['train-carriage-tank'],
    color: '#4b3f6b',
  },
  'iron-ore': {
    name: 'Železná ruda',
    unit: 't rudy',
    noun: 'ruda',
    genitive: 'rudy',
    fareTiers: IRON_ORE_FARE_TIERS,
    wagonModels: ['train-carriage-dirt'],
    color: '#a0522d',
  },
  steel: {
    name: 'Ocel',
    unit: 't oceli',
    noun: 'ocel',
    genitive: 'oceli',
    fareTiers: STEEL_FARE_TIERS,
    wagonModels: ['train-carriage-flatbed'],
    color: '#8fa3b5',
  },
  goods: {
    name: 'Zboží',
    unit: 't zboží',
    noun: 'zboží',
    genitive: 'zboží',
    fareTiers: GOODS_FARE_TIERS,
    wagonModels: ['train-carriage-container-blue', 'train-carriage-container-red', 'train-carriage-container-green'],
    color: '#d9a441',
  },
  grain: {
    name: 'Obilí',
    unit: 't obilí',
    noun: 'obilí',
    genitive: 'obilí',
    fareTiers: GRAIN_FARE_TIERS,
    wagonModels: ['train-carriage-dirt'],
    color: '#c49a3a',
  },
  food: {
    name: 'Potraviny',
    unit: 't potravin',
    noun: 'potraviny',
    genitive: 'potravin',
    fareTiers: FOOD_FARE_TIERS,
    wagonModels: ['train-carriage-box', 'train-carriage-container-green'],
    color: '#d97745',
  },
};

export type FreightStock = Record<FreightType, number>;

// Hodnocení 0–1, herní den poslední návštěvy vlaku s tímto nákladem (−1 = nikdy) a jeho rychlost
export interface CargoRating {
  rating: number;
  lastVisit: number;
  lastSpeed: number;
}

export const CARGO_TYPES = Object.keys(CARGOS) as Cargo[];

export function newRatings(): Record<Cargo, CargoRating> {
  return Object.fromEntries(
    CARGO_TYPES.map((cargo) => [cargo, { rating: RATING_START, lastVisit: -1, lastSpeed: 0 }]),
  ) as Record<Cargo, CargoRating>;
}

export function emptyFreight(): FreightStock {
  return Object.fromEntries(FREIGHT_TYPES.map((type) => [type, 0])) as FreightStock;
}

export function isCargo(value: unknown): value is Cargo {
  return typeof value === 'string' && value in CARGOS;
}

export function isFreight(cargo: Cargo): cargo is FreightType {
  return cargo !== 'passengers';
}

// Vlak nebo auto při nakládce: náklad na palubě (passengers) a údaje pro výpočet jízdného
export interface Carrier {
  name: string;
  passengers: number;
  boardedStation: number;
  boardedAt: number;
  tiles: number;
  income: number;
  // Virtuální příjem z překládek, který náklad na palubě nese (při doručení se odečte od příjmu vozidla)
  feeder?: number;
}

// Volby vykládky a nakládky z příkazu jízdního řádu (jako v OpenTTD)
export interface ExchangeOptions {
  // Vyložit vše (i kde se náklad nevykupuje – zůstane na stanici), překládka, nevykládat
  unload?: 'unload' | 'transfer' | 'none';
  // Nenakládat
  load?: 'none';
}

// Náklad přeložený na stanici: čeká na další vozidlo i se svou historií (stáří, ujeté dlaždice, podíl)
export interface TransferPacket {
  amount: number;
  boardedAt: number;
  tiles: number;
  feeder: number;
}

export type Transfers = Partial<Record<Cargo, TransferPacket[]>>;

// Stanice s překládkou (všechny druhy stanic)
interface TransferStation {
  transfers?: Transfers;
}

// Kolik nákladu daného druhu čeká na stanici z překládky
export function transferWaiting(station: TransferStation, cargo: Cargo): number {
  return (station.transfers?.[cargo] ?? []).reduce((sum, p) => sum + p.amount, 0);
}

// Část virtuálního příjmu z překládek, kterou si odnáší amount jednotek nákladu na palubě
export function feederShare(carrier: Carrier, amount: number): number {
  const feeder = carrier.feeder ?? 0;
  if (feeder <= 0 || carrier.passengers <= 0) return 0;
  return (feeder * Math.min(amount, carrier.passengers)) / carrier.passengers;
}

// Překládka: náklad zůstane na stanici i s historií; vozidlo dostane virtuální podíl jízdného (credit),
// skutečné peníze přijdou až při doručení
export function transferOut(
  carrier: Carrier,
  station: TransferStation,
  cargo: Cargo,
  amount: number,
  credit: number,
): void {
  if (amount <= 0) return;
  const share = feederShare(carrier, amount);
  const transfers = (station.transfers ??= {});
  const list = (transfers[cargo] ??= []);
  list.push({ amount, boardedAt: carrier.boardedAt, tiles: carrier.tiles, feeder: share + credit });
  carrier.feeder = Math.max(0, (carrier.feeder ?? 0) - share);
  carrier.passengers -= amount;
  carrier.income += credit;
}

// Přidá náklad na palubu; stáří a ujeté dlaždice se průměrují podle množství
function merge(carrier: Carrier, amount: number, boardedAt: number, tiles: number): void {
  const total = carrier.passengers + amount;
  carrier.boardedAt = (carrier.passengers * carrier.boardedAt + amount * boardedAt) / total;
  carrier.tiles = Math.round((carrier.passengers * carrier.tiles + amount * tiles) / total);
  carrier.passengers = total;
}

// Naloží nejdřív náklad z překládky (i s jeho historií), pak nový ze stanice (nejvýš fresh jednotek).
// Vrací počet naložených jednotek z překládky a nových.
export function loadCargo(
  carrier: Carrier,
  station: TransferStation & { id: number },
  cargo: Cargo,
  room: number,
  fresh: number,
  now: number,
): { transferred: number; fresh: number } {
  if (carrier.passengers <= 0) {
    carrier.passengers = 0;
    carrier.boardedAt = now;
    carrier.tiles = 0;
    carrier.feeder = 0;
  }
  let left = Math.max(0, room);
  let transferred = 0;
  const list = station.transfers?.[cargo];
  while (list && list.length > 0 && left > 0) {
    const packet = list[0];
    const n = Math.min(left, packet.amount);
    const part = (packet.feeder * n) / packet.amount;
    merge(carrier, n, packet.boardedAt, packet.tiles);
    carrier.feeder = (carrier.feeder ?? 0) + part;
    packet.feeder -= part;
    packet.amount -= n;
    left -= n;
    transferred += n;
    if (packet.amount <= 0) list.shift();
  }
  const boarding = Math.max(0, Math.min(left, Math.floor(fresh)));
  if (boarding > 0) merge(carrier, boarding, now, 0);
  if (transferred + boarding > 0 || carrier.passengers === 0) carrier.boardedStation = station.id;
  return { transferred, fresh: boarding };
}

// Místo u nástupiště (vagony mimo něj nenakládají), celková kapacita a rychlost pro hodnocení stanice
export interface Hold {
  atPlatform: number;
  capacity: number;
  speed: number;
}
