import {
  COAL_FARE_TIERS,
  FARE_TIERS,
  GOODS_FARE_TIERS,
  IRON_ORE_FARE_TIERS,
  OIL_FARE_TIERS,
  STEEL_FARE_TIERS,
  WOOD_FARE_TIERS,
} from './balance';

// Druhy nákladu: přidání dalšího je položka v FREIGHT_TYPES, CARGOS a v INDUSTRY_TYPES (kdo ho vyrábí a přijímá)
export type FreightType = 'coal' | 'wood' | 'oil' | 'iron-ore' | 'steel' | 'goods';
export type Cargo = 'passengers' | FreightType;

export const FREIGHT_TYPES: readonly FreightType[] = ['coal', 'wood', 'oil', 'iron-ore', 'steel', 'goods'];
// Co vykupuje nástupiště s městem v dosahu
export const TOWN_ACCEPTS: readonly FreightType[] = ['goods'];

export interface CargoSpec {
  name: string;
  // Za počtem: „12 cestujících“, „60 t uhlí“
  unit: string;
  // Malými písmeny do vět: „ruda 12 t“, „výkup rudy“
  noun: string;
  genitive: string;
  fareTiers: readonly { maxDays: number; rate: number }[];
  // Model vagonu z train kitu; null = osobní vagon podle lokomotivy
  wagonModel: string | null;
  color: string;
}

export const CARGOS: Record<Cargo, CargoSpec> = {
  passengers: {
    name: 'Cestující',
    unit: 'cestujících',
    noun: 'cestující',
    genitive: 'cestujících',
    fareTiers: FARE_TIERS,
    wagonModel: null,
    color: '#5a8fd9',
  },
  coal: {
    name: 'Uhlí',
    unit: 't uhlí',
    noun: 'uhlí',
    genitive: 'uhlí',
    fareTiers: COAL_FARE_TIERS,
    wagonModel: 'train-carriage-coal',
    color: '#6b6b64',
  },
  wood: {
    name: 'Dřevo',
    unit: 't dřeva',
    noun: 'dřevo',
    genitive: 'dřeva',
    fareTiers: WOOD_FARE_TIERS,
    wagonModel: 'train-carriage-wood',
    color: '#8a5a2b',
  },
  oil: {
    name: 'Ropa',
    unit: 't ropy',
    noun: 'ropa',
    genitive: 'ropy',
    fareTiers: OIL_FARE_TIERS,
    wagonModel: 'train-carriage-tank',
    color: '#4b3f6b',
  },
  'iron-ore': {
    name: 'Železná ruda',
    unit: 't rudy',
    noun: 'ruda',
    genitive: 'rudy',
    fareTiers: IRON_ORE_FARE_TIERS,
    wagonModel: 'train-carriage-dirt',
    color: '#a0522d',
  },
  steel: {
    name: 'Ocel',
    unit: 't oceli',
    noun: 'ocel',
    genitive: 'oceli',
    fareTiers: STEEL_FARE_TIERS,
    wagonModel: 'train-carriage-flatbed',
    color: '#8fa3b5',
  },
  goods: {
    name: 'Zboží',
    unit: 't zboží',
    noun: 'zboží',
    genitive: 'zboží',
    fareTiers: GOODS_FARE_TIERS,
    wagonModel: 'train-carriage-box',
    color: '#d9a441',
  },
};

export type FreightStock = Record<FreightType, number>;

export function emptyFreight(): FreightStock {
  return Object.fromEntries(FREIGHT_TYPES.map((type) => [type, 0])) as FreightStock;
}

export function isCargo(value: unknown): value is Cargo {
  return typeof value === 'string' && value in CARGOS;
}

export function isFreight(cargo: Cargo): cargo is FreightType {
  return cargo !== 'passengers';
}
