// Vyvážení hry: ceny, výdělky, cestující a růst měst na jednom místě

export const START_MONEY = 1_000_000;

// Stavby
export const TRACK_PIECE_COST = 5_000;
export const PLATFORM_TILE_COST = 25_000;
export const STATION_LENGTH = 3;
export const DEPOT_COST = 50_000;

// Vlaky: rychlost v dlaždicích za herní den, provoz za rok
export interface TrainModel {
  id: string;
  name: string;
  model: string;
  year: number;
  price: number;
  speed: number;
  runningCost: number;
}

export const TRAIN_MODELS: readonly TrainModel[] = [
  { id: 'steam', name: 'Parní lokomotiva', model: 'train-locomotive-a', year: 1950, price: 250_000, speed: 3.0, runningCost: 30_000 },
  { id: 'steam-express', name: 'Parní rychlík', model: 'train-locomotive-passenger-a', year: 1962, price: 300_000, speed: 3.6, runningCost: 37_500 },
  { id: 'diesel', name: 'Motorová', model: 'train-diesel-a', year: 1974, price: 360_000, speed: 4.3, runningCost: 47_000 },
  { id: 'diesel-box', name: 'Motorová skříňová', model: 'train-diesel-box-a', year: 1984, price: 432_000, speed: 5.2, runningCost: 59_000 },
  { id: 'electric', name: 'Elektrická', model: 'train-electric-square-a', year: 1994, price: 518_000, speed: 6.2, runningCost: 73_000 },
  { id: 'electric-double', name: 'Elektrická patrová', model: 'train-electric-double-a', year: 2003, price: 622_000, speed: 7.5, runningCost: 92_000 },
  { id: 'electric-city', name: 'Městská jednotka', model: 'train-electric-city-a', year: 2012, price: 746_000, speed: 9.0, runningCost: 114_000 },
  { id: 'bullet', name: 'Rychlovlak', model: 'train-electric-bullet-a', year: 2022, price: 896_000, speed: 10.8, runningCost: 143_000 },
];

export const WAGON_PRICE = 50_000;
export const WAGON_CAPACITY = 30;
export const WAGON_RUNNING_COST = 4_000;
// Lokomotiva a 5 vagonů po půl dlaždici vyplní nástupiště 1×3
export const MAX_WAGONS = 5;

// Sazba za cestujícího a ujetou dlaždici podle doby přepravy
export const FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 30, rate: 10 },
  { maxDays: 60, rate: 5 },
  { maxDays: Infinity, rate: 2 },
];

// Cestující
export const PASSENGERS_MONTHLY_SHARE = 0.03;
export const PASSENGERS_MAX_WAITING_MONTHS = 3;
export const STATION_CATCHMENT_RADIUS = 4;

// Města
export const TOWN_POPULATION = {
  city: { min: 1000, max: 5000 },
  village: { min: 100, max: 1000 },
} as const;
export const TOWN_GROWTH_BASE = 0.02;
export const TOWN_GROWTH_SERVED = 0.05;
export const BUILDING_CAPACITY = { house: 12, low: 25, office: 40, skyscraper: 150 } as const;
export const SKYSCRAPER_YEAR = 2010;
// Pravděpodobnost, že se budova v centru během roku přestaví na mrakodrap
export const REDEVELOP_CHANCE = 0.12;
