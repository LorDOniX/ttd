// Vyvážení hry: ceny, výdělky, cestující a růst měst na jednom místě

export const START_MONEY = 1_000_000;

// Stavby
export const TRACK_PIECE_COST = 5_000;
export const PLATFORM_TILE_COST = 25_000;
export const STATION_LENGTH = 3;
export const DEPOT_COST = 50_000;
export const ROAD_TILE_COST = 3_000;

// Demolice: stavby hráče vrací část ceny, majetek měst se platí
export const DEMOLISH_REFUND = 0.5;
export const DEMOLISH_COST_PER_RESIDENT = 500;
export const DEMOLISH_TOWN_ROAD_COST = 2_500;

// Vlaky: rychlost v dlaždicích za herní den, provoz za rok; model a vagon z train kitu
export interface TrainModel {
  id: string;
  name: string;
  model: string;
  wagonModel: string;
  year: number;
  price: number;
  speed: number;
  runningCost: number;
}

export const TRAIN_MODELS: readonly TrainModel[] = [
  { id: 'steam', name: 'Parní lokomotiva', model: 'train-locomotive-a', wagonModel: 'train-locomotive-passenger-a', year: 1950, price: 250_000, speed: 3.0, runningCost: 30_000 },
  { id: 'steam-express', name: 'Parní rychlík', model: 'train-locomotive-c', wagonModel: 'train-locomotive-passenger-b', year: 1962, price: 300_000, speed: 3.6, runningCost: 37_500 },
  { id: 'diesel', name: 'Motorová', model: 'train-diesel-a', wagonModel: 'train-locomotive-passenger-b', year: 1974, price: 360_000, speed: 4.3, runningCost: 47_000 },
  { id: 'diesel-box', name: 'Motorová skříňová', model: 'train-diesel-box-a', wagonModel: 'train-diesel-box-b', year: 1984, price: 432_000, speed: 5.2, runningCost: 59_000 },
  { id: 'electric', name: 'Elektrická', model: 'train-electric-square-a', wagonModel: 'train-electric-square-b', year: 1994, price: 518_000, speed: 6.2, runningCost: 73_000 },
  { id: 'electric-double', name: 'Elektrická patrová', model: 'train-electric-double-a', wagonModel: 'train-electric-double-b', year: 2003, price: 622_000, speed: 7.5, runningCost: 92_000 },
  { id: 'electric-city', name: 'Městská jednotka', model: 'train-electric-city-a', wagonModel: 'train-electric-city-b', year: 2012, price: 746_000, speed: 9.0, runningCost: 114_000 },
  { id: 'bullet', name: 'Rychlovlak', model: 'train-electric-bullet-a', wagonModel: 'train-electric-bullet-b', year: 2022, price: 896_000, speed: 10.8, runningCost: 143_000 },
];

export const WAGON_PRICE = 50_000;
export const WAGON_CAPACITY = 30;
export const WAGON_RUNNING_COST = 4_000;
// Lokomotiva a 5 vagonů po půl dlaždici vyplní nástupiště 1×3
export const MAX_WAGONS = 5;
export const VEHICLE_LENGTH = 0.5;
// Prodej vlaku nebo vagonu vrací část kupní ceny
export const TRAIN_SELL_REFUND = 0.5;
// Staniční pobyt na vykložení a naložení
export const TRAIN_LOADING_DAYS = 2;

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
