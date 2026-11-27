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
  // Kapacita jednoho vagonu na tento náklad (jako v OpenTTD se liší podle nákladu)
  wagonCapacity: number;
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
    wagonCapacity: 30,
  },
  mail: {
    name: 'Pošta',
    unit: 't pošty',
    noun: 'pošta',
    genitive: 'pošty',
    fareTiers: MAIL_FARE_TIERS,
    wagonModels: ['train-carriage-box'],
    color: '#d94a4a',
    wagonCapacity: 20,
  },
  coal: {
    name: 'Uhlí',
    unit: 't uhlí',
    noun: 'uhlí',
    genitive: 'uhlí',
    fareTiers: COAL_FARE_TIERS,
    wagonModels: ['train-carriage-coal'],
    color: '#6b6b64',
    wagonCapacity: 30,
  },
  wood: {
    name: 'Dřevo',
    unit: 't dřeva',
    noun: 'dřevo',
    genitive: 'dřeva',
    fareTiers: WOOD_FARE_TIERS,
    wagonModels: ['train-carriage-wood'],
    color: '#8a5a2b',
    wagonCapacity: 30,
  },
  oil: {
    name: 'Ropa',
    unit: 't ropy',
    noun: 'ropa',
    genitive: 'ropy',
    fareTiers: OIL_FARE_TIERS,
    wagonModels: ['train-carriage-tank'],
    color: '#4b3f6b',
    wagonCapacity: 25,
  },
  'iron-ore': {
    name: 'Železná ruda',
    unit: 't rudy',
    noun: 'ruda',
    genitive: 'rudy',
    fareTiers: IRON_ORE_FARE_TIERS,
    wagonModels: ['train-carriage-dirt'],
    color: '#a0522d',
    wagonCapacity: 30,
  },
  steel: {
    name: 'Ocel',
    unit: 't oceli',
    noun: 'ocel',
    genitive: 'oceli',
    fareTiers: STEEL_FARE_TIERS,
    wagonModels: ['train-carriage-flatbed'],
    color: '#8fa3b5',
    wagonCapacity: 25,
  },
  goods: {
    name: 'Zboží',
    unit: 't zboží',
    noun: 'zboží',
    genitive: 'zboží',
    fareTiers: GOODS_FARE_TIERS,
    wagonModels: ['train-carriage-container-blue', 'train-carriage-container-red', 'train-carriage-container-green'],
    color: '#d9a441',
    wagonCapacity: 20,
  },
  grain: {
    name: 'Obilí',
    unit: 't obilí',
    noun: 'obilí',
    genitive: 'obilí',
    fareTiers: GRAIN_FARE_TIERS,
    wagonModels: ['train-carriage-dirt'],
    color: '#c49a3a',
    wagonCapacity: 30,
  },
  food: {
    name: 'Potraviny',
    unit: 't potravin',
    noun: 'potraviny',
    genitive: 'potravin',
    fareTiers: FOOD_FARE_TIERS,
    wagonModels: ['train-carriage-box', 'train-carriage-container-green'],
    color: '#d97745',
    wagonCapacity: 25,
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
  // Stanice, kde náklad na palubě poprvé nastoupil (i před překládkou); kvůli dotacím
  origin?: number;
  // Cargodist: kolik nákladu na palubě jede do které cílové stanice (id spojené stanice); zbytek cíl nemá
  dests?: Record<number, number>;
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
  // Stanice, kde náklad poprvé nastoupil (starší uložení ji nemají)
  origin?: number;
  // Cargodist: cílová stanice (id spojené stanice); bez údaje náklad cíl nemá
  dest?: number;
}

export type Transfers = Partial<Record<Cargo, TransferPacket[]>>;

// Cargodist: čerstvý náklad stanice podle klíče „další zastávka:cíl“
export type PlannedCargo = Partial<Record<Cargo, Record<string, number>>>;

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
  dest?: number,
): void {
  if (amount <= 0) return;
  const share = feederShare(carrier, amount);
  const transfers = (station.transfers ??= {});
  const list = (transfers[cargo] ??= []);
  list.push({
    amount,
    boardedAt: carrier.boardedAt,
    tiles: carrier.tiles,
    feeder: share + credit,
    origin: carrier.origin ?? carrier.boardedStation,
    ...(dest !== undefined ? { dest } : {}),
  });
  carrier.feeder = Math.max(0, (carrier.feeder ?? 0) - share);
  carrier.passengers -= amount;
  carrier.income += credit;
  if (dest !== undefined) removeDest(carrier, dest, amount);
  trimDests(carrier);
}

// Součet nákladu s cílem
export function destTotal(dests: Record<number, number> | undefined): number {
  let sum = 0;
  for (const amount of Object.values(dests ?? {})) sum += amount;
  return sum;
}

export function addDest(load: { dests?: Record<number, number> }, dest: number, amount: number): void {
  if (amount <= 0) return;
  const dests = (load.dests ??= {});
  dests[dest] = (dests[dest] ?? 0) + amount;
}

export function removeDest(load: { dests?: Record<number, number> }, dest: number, amount: number): void {
  if (!load.dests || load.dests[dest] === undefined) return;
  const left = load.dests[dest] - amount;
  if (left > 0) load.dests[dest] = left;
  else delete load.dests[dest];
}

// Náklad s cílem nesmí přesáhnout náklad na palubě (vyložený náklad bez cíle, zmenšená souprava):
// přebytek se ubere poměrně, celé jednotky
export function trimDests(load: { passengers: number; dests?: Record<number, number> }): void {
  if (!load.dests) return;
  const total = destTotal(load.dests);
  if (load.passengers <= 0 || total <= 0) {
    delete load.dests;
    return;
  }
  if (total <= load.passengers) return;
  const scaled = shareOut(
    Object.entries(load.dests).map(([dest, amount]) => ({ dest: Number(dest), amount })),
    load.passengers,
  );
  load.dests = {};
  for (const { dest, amount } of scaled) if (amount > 0) load.dests[dest] = amount;
}

// Rozdělí celé jednotky total poměrně k množstvím (metoda největších zbytků), nikomu nedá víc, než má
export function shareOut<T extends { amount: number }>(items: readonly T[], total: number): T[] {
  const sum = items.reduce((s, i) => s + Math.max(0, i.amount), 0);
  const count = Math.max(0, Math.floor(Math.min(total, sum)));
  if (sum <= 0 || count <= 0) return items.map((i) => ({ ...i, amount: 0 }));
  const exact = items.map((i) => (Math.max(0, i.amount) * count) / sum);
  const result = items.map((i, k) => ({ ...i, amount: Math.floor(exact[k]) }));
  let left = count - result.reduce((s, i) => s + i.amount, 0);
  const order = exact.map((x, k) => ({ k, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest);
  for (const { k } of order) {
    if (left <= 0) break;
    if (result[k].amount + 1 > Math.ceil(items[k].amount)) continue;
    result[k].amount++;
    left--;
  }
  return result;
}

// Přidá náklad na palubu; stáří a ujeté dlaždice se průměrují podle množství
function merge(carrier: Carrier, amount: number, boardedAt: number, tiles: number): void {
  const total = carrier.passengers + amount;
  carrier.boardedAt = (carrier.passengers * carrier.boardedAt + amount * boardedAt) / total;
  carrier.tiles = Math.round((carrier.passengers * carrier.tiles + amount * tiles) / total);
  carrier.passengers = total;
}

// Cargodist: co smí při nakládce nastoupit do vozidla podle jeho další zastávky
export interface LoadRoute {
  // Smí balík z překládky s tímto cílem nastoupit?
  boards(dest: number | undefined): boolean;
  // Čerstvý náklad, který smí nastoupit, podle cíle (undefined = bez cíle); s cílem nastupuje poměrně
  // dřív než ten bez cíle
  fresh: { dest?: number; amount: number }[];
}

// Naloží nejdřív náklad z překládky (i s jeho historií), pak nový ze stanice (nejvýš fresh jednotek).
// S cargodistem (route) jen náklad, který jede přes další zastávku vozidla; cíle se zapíšou na palubu.
// Vrací počet naložených jednotek z překládky a nových a nový náklad podle cíle.
export function loadCargo(
  carrier: Carrier,
  station: TransferStation & { id: number },
  cargo: Cargo,
  room: number,
  fresh: number,
  now: number,
  route?: LoadRoute,
): { transferred: number; fresh: number; taken: { dest?: number; amount: number }[] } {
  if (carrier.passengers <= 0) {
    carrier.passengers = 0;
    carrier.boardedAt = now;
    carrier.tiles = 0;
    carrier.feeder = 0;
    carrier.origin = undefined;
    delete carrier.dests;
  }
  let left = Math.max(0, room);
  let transferred = 0;
  const list = station.transfers?.[cargo];
  for (let i = 0; list && i < list.length && left > 0;) {
    const packet = list[i];
    if (route && !route.boards(packet.dest)) {
      i++;
      continue;
    }
    const n = Math.min(left, packet.amount);
    const part = (packet.feeder * n) / packet.amount;
    merge(carrier, n, packet.boardedAt, packet.tiles);
    carrier.origin ??= packet.origin ?? station.id;
    carrier.feeder = (carrier.feeder ?? 0) + part;
    if (packet.dest !== undefined) addDest(carrier, packet.dest, n);
    packet.feeder -= part;
    packet.amount -= n;
    left -= n;
    transferred += n;
    if (packet.amount <= 0) list.splice(i, 1);
  }
  const taken: { dest?: number; amount: number }[] = [];
  if (route) {
    const destined = route.fresh.filter((f) => f.dest !== undefined);
    const free = route.fresh.filter((f) => f.dest === undefined).reduce((sum, f) => sum + f.amount, 0);
    for (const item of shareOut(destined, left)) {
      if (item.amount <= 0) continue;
      taken.push(item);
      left -= item.amount;
    }
    const rest = Math.max(0, Math.min(left, Math.floor(free)));
    if (rest > 0) {
      taken.push({ amount: rest });
      left -= rest;
    }
  } else {
    const boarding = Math.max(0, Math.min(left, Math.floor(fresh)));
    if (boarding > 0) taken.push({ amount: boarding });
  }
  const boarding = taken.reduce((sum, t) => sum + t.amount, 0);
  if (boarding > 0) {
    merge(carrier, boarding, now, 0);
    carrier.origin ??= station.id;
    for (const t of taken) if (t.dest !== undefined) addDest(carrier, t.dest, t.amount);
  }
  if (transferred + boarding > 0 || carrier.passengers === 0) carrier.boardedStation = station.id;
  return { transferred, fresh: boarding, taken };
}

// Co se na stanici vyloží: doručí (zaplatí) a přeloží podle cíle (undefined = bez cíle)
export interface UnloadPlan {
  deliver: number;
  transfers: { dest?: number; amount: number }[];
}

// Cargodist: náklad na palubě podle cesty – doručit tady, zůstat (jede dál s vozidlem), přeložit jinam,
// a náklad bez cíle (i ten, jehož cíl už není dosažitelný)
export interface DestSplit {
  deliver: number;
  keep: Map<number, number>;
  transfers: Map<number, number>;
  undestined: number;
}

// Plán vykládky jako v OpenTTD. Ručně (split chybí): na příkaz „překládka“ se náklad přeloží, jinak se doručí,
// kde ho stanice přijímá; „vyložit vše“ nepřijímaný náklad přeloží. S cargodistem se doručí náklad s cílem
// tady (a bez cíle, kde se přijímá), přeloží náklad, který pokračuje jinou linkou, a zbytek jede dál;
// „vyložit vše“ přeloží i ten, „překládka“ přeloží všechno. Nejvýš atPlatform jednotek, doručení napřed.
export function planUnload(
  carrier: Carrier,
  atPlatform: number,
  unload: ExchangeOptions['unload'],
  accepted: boolean,
  here: number,
  split?: DestSplit,
): UnloadPlan {
  const plan: UnloadPlan = { deliver: 0, transfers: [] };
  if (unload === 'none' || carrier.passengers <= 0) return plan;
  let budget = Math.max(0, Math.min(atPlatform, carrier.passengers));
  const transfer = (amount: number, dest?: number): void => {
    const n = Math.min(budget, amount);
    if (n <= 0) return;
    plan.transfers.push({ ...(dest !== undefined && dest !== here ? { dest } : {}), amount: n });
    budget -= n;
  };
  if (!split) {
    if (unload === 'transfer' || (unload === 'unload' && !accepted)) transfer(budget);
    else if (accepted) plan.deliver = budget;
    return plan;
  }
  if (unload === 'transfer') {
    for (const [dest, amount] of [...split.keep, ...split.transfers]) transfer(amount, dest);
    transfer(split.deliver + split.undestined);
    return plan;
  }
  plan.deliver = Math.min(budget, split.deliver + (accepted ? split.undestined : 0));
  budget -= plan.deliver;
  for (const [dest, amount] of split.transfers) transfer(amount, dest);
  if (unload === 'unload') {
    for (const [dest, amount] of split.keep) transfer(amount, dest);
    if (!accepted) transfer(split.undestined);
  }
  return plan;
}

// Místo u nástupiště (vagony mimo něj nenakládají), celková kapacita a rychlost pro hodnocení stanice
export interface Hold {
  atPlatform: number;
  capacity: number;
  speed: number;
  // Další zastávka vozidla podle řádu (id stanice); cargodist podle ní vybírá náklad
  next?: number;
  // Předchozí zastávka (id stanice), odkud vozidlo přijelo; kvůli vytížení spojení
  prev?: number;
}

// Další zastávka v řádu po stanici current, u které vozidlo stojí (řád aut, letadel a lodí jsou jen stanice)
export function nextOrderStop(orders: readonly number[] | null, target: number, current: number): number | undefined {
  if (!orders || orders.length === 0) return undefined;
  const at = orders[target] === current ? target : orders.indexOf(current);
  return at < 0 ? undefined : orders[(at + 1) % orders.length];
}

// Předchozí zastávka v řádu před stanicí current, u které vozidlo stojí
export function prevOrderStop(orders: readonly number[] | null, target: number, current: number): number | undefined {
  if (!orders || orders.length === 0) return undefined;
  const at = orders[target] === current ? target : orders.indexOf(current);
  return at < 0 ? undefined : orders[(at - 1 + orders.length) % orders.length];
}
