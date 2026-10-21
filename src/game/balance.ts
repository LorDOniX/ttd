// Vyvážení hry: ceny, výdělky, cestující a růst měst na jednom místě

export const START_MONEY = 1_000_000;

// Úvěr v bance: úrok se platí měsíčně
export const MAX_LOAN = 2_000_000;
export const LOAN_STEP = 100_000;
export const LOAN_INTEREST = 0.08;
// Roční údržba jako podíl ceny postavených kolejí, nástupišť a dep, platí se měsíčně
export const MAINTENANCE_RATE = 0.05;

// Stavby
export const TRACK_PIECE_COST = 5_000;
// Dílek koleje na mostě přes vodu
export const BRIDGE_PIECE_COST = 20_000;
export const PLATFORM_TILE_COST = 25_000;
export const STATION_LENGTH = 3;
// Největší nástupiště postavené tažením
export const MAX_STATION_LENGTH = 7;
export const MAX_STATION_TRACKS = 4;
export const DEPOT_COST = 50_000;
export const SIGNAL_COST = 5_000;
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
export const VEHICLE_LENGTH = 0.5;
// Lokomotiva a vagony po půl dlaždici: nejdelší vlak vyplní nejdelší nástupiště (1×3 pojme 5 vagonů);
// vagony, které přesahují nástupiště, nenakládají ani nevykládají
export const MAX_WAGONS = MAX_STATION_LENGTH / VEHICLE_LENGTH - 1;
// Prodej vlaku nebo vagonu vrací část kupní ceny; s věkem klesá lineárně až na TRAIN_MIN_SELL na konci životnosti
export const TRAIN_SELL_REFUND = 0.5;
export const TRAIN_MIN_SELL = 0.1;
export const TRAIN_LIFETIME_YEARS = 25;
// Provoz vlaku po životnosti je dražší
export const OLD_TRAIN_COST_FACTOR = 1.5;
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
// Prvních tolik obyvatel města cestuje dvakrát častěji: na začátku hry jsou města malá a osobní doprava
// by jinak za nákladem zůstávala daleko; velké město už bonus skoro nepozná
export const PASSENGERS_BOOSTED_RESIDENTS = 3_000;
export const PASSENGERS_MAX_WAITING_MONTHS = 3;
export const STATION_CATCHMENT_RADIUS = 4;

// Nákladní doprava: na nástupišti se drží nejvýš těžba za tolik měsíců
export const FREIGHT_MAX_WAITING_MONTHS = 3;
// Zboží vykupuje nástupiště s aspoň tolika budovami města v dosahu (centrum, ne okraj)
export const TOWN_ACCEPTS_MIN_BUILDINGS = 8;
// Sazby za tunu a dlaždici v poměru k cestujícím jako v OpenTTD: náklad jede jen jedním směrem a závod
// vyrobí méně, než město vypraví cestujících, proto platí skoro dvojnásobek; suroviny zlevňují pomalu
export const COAL_PRODUCTION = { min: 60, max: 150 } as const;
export const COAL_FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 60, rate: 18 },
  { maxDays: 120, rate: 12 },
  { maxDays: Infinity, rate: 7 },
];
// Další suroviny; zpracovatelské závody vyrábějí tolik, kolik jim minulý měsíc dovezli
export const WOOD_PRODUCTION = { min: 50, max: 130 } as const;
export const OIL_PRODUCTION = { min: 50, max: 130 } as const;
export const IRON_ORE_PRODUCTION = { min: 60, max: 150 } as const;
export const WOOD_FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 50, rate: 15 },
  { maxDays: 100, rate: 10 },
  { maxDays: Infinity, rate: 6 },
];
export const OIL_FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 45, rate: 14 },
  { maxDays: 90, rate: 9 },
  { maxDays: Infinity, rate: 5 },
];
export const IRON_ORE_FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 60, rate: 16 },
  { maxDays: 120, rate: 11 },
  { maxDays: Infinity, rate: 6 },
];
export const STEEL_FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 45, rate: 17 },
  { maxDays: 90, rate: 11 },
  { maxDays: Infinity, rate: 6 },
];
// Zboží vynáší nejvíc, ale rychle ztrácí cenu
export const GOODS_FARE_TIERS: readonly { maxDays: number; rate: number }[] = [
  { maxDays: 25, rate: 19 },
  { maxDays: 50, rate: 11 },
  { maxDays: Infinity, rate: 5 },
];

// Živý průmysl: měsíční šance na změnu výroby těžebního závodu; dobře obsloužený spíš roste
export const INDUSTRY_CHANGE_CHANCE = 0.04;
export const INDUSTRY_WELL_SERVED = 0.6;
export const INDUSTRY_GROWTH_CHANCE = { served: 0.67, unserved: 0.33 } as const;
export const INDUSTRY_CHANGE_FACTOR = 1.5;
// Výroba nejvýš tolikrát horní mez druhu; pod polovinou dolní meze závod zanikne
export const INDUSTRY_MAX_GROWTH = 4;
// Zpracovatel bez dodávek tolik let může každý měsíc s touto šancí zaniknout
export const INDUSTRY_IDLE_YEARS = 5;
export const INDUSTRY_IDLE_CLOSE_CHANCE = 0.05;
// Měsíční šance na založení nového závodu na dlaždici mapy (256×256 ≈ jednou za půl roku)
export const NEW_INDUSTRY_CHANCE_PER_TILE = 1 / 400_000;

// Hodnocení nástupiště 0–1 se denně posouvá k cílové hodnotě složené ze tří částí
export const RATING_START = 0.5;
export const RATING_DAILY_CHANGE = 0.01;
// Doba od posledního vlaku ve dnech
export const RATING_VISIT_TIERS: readonly { maxDays: number; points: number }[] = [
  { maxDays: 10, points: 0.4 },
  { maxDays: 20, points: 0.3 },
  { maxDays: 30, points: 0.2 },
  { maxDays: 45, points: 0.1 },
];
// Plné body za rychlost posledního vlaku od 10 dlaždic/den, pomalejší poměrně
export const RATING_SPEED_POINTS = 0.3;
export const RATING_SPEED_FULL = 10;
// Málo čekajících je dobře, přeplněné nástupiště hodnocení snižuje
export const RATING_WAITING_TIERS: readonly { max: number; points: number }[] = [
  { max: 50, points: 0.3 },
  { max: 150, points: 0.2 },
  { max: 300, points: 0.1 },
];
// Při hodnocení 0 odejde denně 2 % čekajících, od 50 % nikdo
export const RATING_MAX_DAILY_LEAVE = 0.02;

// Města
export const TOWN_POPULATION = {
  city: { min: 1000, max: 2000 },
  village: { min: 250, max: 750 },
} as const;
export const TOWN_GROWTH_BASE = 0.02;
export const TOWN_GROWTH_SERVED = 0.05;
export const BUILDING_CAPACITY = { house: 12, low: 25, office: 40, skyscraper: 150 } as const;
export const SKYSCRAPER_YEAR = 2010;
// Pravděpodobnost, že se budova v centru během roku přestaví na mrakodrap
export const REDEVELOP_CHANCE = 0.12;
