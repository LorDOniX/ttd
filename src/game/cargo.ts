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
}

// Místo u nástupiště (vagony mimo něj nenakládají), celková kapacita a rychlost pro hodnocení stanice
export interface Hold {
  atPlatform: number;
  capacity: number;
  speed: number;
}
