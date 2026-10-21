import { COAL_FARE_TIERS, FARE_TIERS } from './balance';

// Druhy nákladu: přidání dalšího je položka v FREIGHT_TYPES, CARGOS a v INDUSTRY_TYPES (kdo ho vyrábí a přijímá)
export type FreightType = 'coal';
export type Cargo = 'passengers' | FreightType;

export const FREIGHT_TYPES: readonly FreightType[] = ['coal'];

export interface CargoSpec {
  name: string;
  // Za počtem: „12 cestujících“, „60 t uhlí“
  unit: string;
  // Malými písmeny do vět: „výkup uhlí“
  noun: string;
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
    fareTiers: FARE_TIERS,
    wagonModel: null,
    color: '#5a8fd9',
  },
  coal: {
    name: 'Uhlí',
    unit: 't uhlí',
    noun: 'uhlí',
    fareTiers: COAL_FARE_TIERS,
    wagonModel: 'train-carriage-coal',
    color: '#6b6b64',
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
