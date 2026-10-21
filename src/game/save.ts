import { RATING_START, STATION_LENGTH } from './balance';
import { FREIGHT_TYPES, emptyFreight, isCargo, type FreightStock } from './cargo';
import { Game, emptyYear, type ViewState, type YearRecord, type YearStats } from './game';
import type { GameDate } from './clock';
import type { Job } from './construction';
import type { Train } from './trains';
import type { World } from '../world/generator';
import { INDUSTRY_SIZE, averageProduction, isIndustryKind, type Industry } from '../world/industry';
import { GameMap } from '../world/map';
import { RailNetwork, PIECES, type Depot, type Station } from '../world/rail';
import type { Town } from '../world/town';

// 2: úvěr, historie let a rozpad výdajů; 3: hodnocení nástupišť; 4: stáří vlaků; 5: návěstidla; 6: průmysl;
// 7: nákladní doprava uhlí; 8: čekání na plné naložení; 9: náklad podle druhů (dřív jen uhlí); 10: dodávky závodům;
// 11: den poslední dodávky (zánik závodů)
const SAVE_VERSION = 11;
const MAX_MAP_SIZE = 1024;

export interface SaveData {
  version: number;
  seed: number;
  seedText: string;
  map: { width: number; height: number; tiles: string; owner: string };
  towns: Town[];
  industries?: Industry[];
  rail: {
    pieces: string;
    stations: Station[];
    depots: Depot[];
    nextStationId: number;
    nextDepotId: number;
    signals?: number[];
  };
  fleet: { trains: Train[]; nextId: number };
  game: {
    companyName: string;
    money: number;
    loan: number;
    thisYear: YearStats;
    history: YearRecord[];
    rngState: number;
    autoRenew?: boolean;
  };
  clock: { date: GameDate; day: number; dayProgress: number };
  // Starší uložení pohled kamery ani rozpracovanou výstavbu nemají
  view?: ViewState;
  construction?: Job[];
}

// Verze 1 měla jen lonišní rok a výdaje bez rozpadu
interface GameV1 {
  companyName: string;
  money: number;
  thisYear: Omit<YearStats, 'costs'>;
  lastYear: Omit<YearStats, 'costs'> | null;
  rngState: number;
}

function migrateV1(game: GameV1, year: number): SaveData['game'] {
  const { lastYear, ...rest } = game;
  return {
    ...rest,
    loan: 0,
    thisYear: { ...emptyYear(), ...game.thisYear },
    history: lastYear ? [{ ...emptyYear(), ...lastYear, year: year - 1 }] : [],
  };
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decode(text: string, expectedBytes: number): Uint8Array {
  const binary = atob(text);
  if (binary.length !== expectedBytes) throw new Error('Poškozená data mapy.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function serializeGame(game: Game, seedText: string): SaveData {
  const { world, clock, fleet } = game;
  const { map, rail } = world;
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    seedText,
    map: {
      width: map.width,
      height: map.height,
      tiles: encode(map.tiles),
      owner: encode(new Uint8Array(map.owner.buffer)),
    },
    towns: world.towns,
    industries: world.industries,
    rail: {
      pieces: encode(rail.pieces),
      stations: rail.stations,
      depots: rail.depots,
      nextStationId: rail.nextStationId,
      nextDepotId: rail.nextDepotId,
      signals: [...rail.signals],
    },
    fleet: { trains: fleet.trains, nextId: fleet.nextId },
    game: {
      companyName: game.companyName,
      money: game.money,
      loan: game.loan,
      thisYear: game.thisYear,
      history: game.history,
      rngState: game.rng.state,
      autoRenew: game.autoRenew,
    },
    ...(game.view ? { view: game.view } : {}),
    ...(game.construction.busy ? { construction: [...game.construction.pending] } : {}),
    clock: { date: clock.date, day: clock.day, dayProgress: clock.dayProgress },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validIndustry(value: unknown, width: number, height: number): value is Industry {
  if (!isObject(value)) return false;
  const { kind, name, x, y, rotation } = value;
  const inside = (v: unknown, size: number): boolean =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) + INDUSTRY_SIZE <= size;
  return (
    typeof kind === 'string' &&
    isIndustryKind(kind) &&
    typeof name === 'string' &&
    inside(x, width) &&
    inside(y, height) &&
    Number.isInteger(rotation)
  );
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function restoreIndustry(industry: Industry, day: number): Industry {
  // Závod ze staršího uložení nemá těžbu, dostane střední hodnotu
  return {
    ...industry,
    production: finiteOr(industry.production, averageProduction(industry.kind)),
    transported: finiteOr(industry.transported, 0),
    lastTransported: finiteOr(industry.lastTransported, 0),
    received: finiteOr(industry.received, 0),
    lastReceived: finiteOr(industry.lastReceived, 0),
    // Starší uložení: lhůta bez dodávek běží až od načtení
    lastDelivery: finiteOr(industry.lastDelivery, day),
  };
}

// Zásoba nákladu podle druhu; verze 7–8 měly jen číslo `coal`
function restoreFreight(value: unknown, legacyCoal: unknown): FreightStock {
  const stock = emptyFreight();
  const saved = isObject(value) ? value : { coal: legacyCoal };
  for (const type of FREIGHT_TYPES) stock[type] = finiteOr(saved[type], 0);
  return stock;
}

const legacyCoal = (value: object): unknown => (value as { coal?: unknown }).coal;

// Kontrola struktury souboru; data pochází od uživatele, proto se neověřené nepoužijí
export function parseSave(text: string): SaveData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platný JSON.');
  }
  if (!isObject(data) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, SAVE_VERSION].includes(data.version as number)) {
    throw new Error('Nepodporovaná verze uložené hry.');
  }
  const { map, rail, fleet, game, clock } = data;
  if (!isObject(map) || !isObject(rail) || !isObject(fleet) || !isObject(game) || !isObject(clock)) {
    throw new Error('Neúplná uložená hra.');
  }
  const size = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_MAP_SIZE;
  if (!size(map.width) || !size(map.height)) throw new Error('Neplatná velikost mapy.');
  const strings = [map.tiles, map.owner, rail.pieces, game.companyName, data.seedText];
  const numbers = [data.seed, rail.nextStationId, rail.nextDepotId, fleet.nextId, game.money, game.rngState, clock.day, clock.dayProgress];
  const arrays = [data.towns, rail.stations, rail.depots, fleet.trains, rail.signals ?? [], data.industries ?? []];
  if (
    strings.some((s) => typeof s !== 'string') ||
    numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
    arrays.some((a) => !Array.isArray(a)) ||
    !isObject(clock.date) ||
    !isObject(game.thisYear)
  ) {
    throw new Error('Poškozená uložená hra.');
  }
  if (data.version === 1) {
    const year = Number(clock.date.year);
    return { ...data, version: SAVE_VERSION, game: migrateV1(game as unknown as GameV1, year) } as unknown as SaveData;
  }
  if (typeof game.loan !== 'number' || !Number.isFinite(game.loan) || !Array.isArray(game.history)) {
    throw new Error('Poškozená uložená hra.');
  }
  return data as unknown as SaveData;
}

export function restoreGame(data: SaveData): Game {
  const { width, height } = data.map;
  const map = new GameMap(width, height);
  map.tiles.set(decode(data.map.tiles, width * height));
  new Uint8Array(map.owner.buffer).set(decode(data.map.owner, width * height * 2));

  const rail = new RailNetwork(map);
  rail.pieces.set(decode(data.rail.pieces, width * height));
  // Starší uložení nezná velikost nástupišť (všechna byla 1×3) ani jejich hodnocení
  rail.stations.push(
    ...data.rail.stations.map((s) => ({
      ...s,
      length: s.length ?? STATION_LENGTH,
      tracks: s.tracks ?? 1,
      rating: s.rating ?? RATING_START,
      lastVisit: s.lastVisit ?? -1,
      lastSpeed: s.lastSpeed ?? 0,
      freight: restoreFreight(s.freight, legacyCoal(s)),
    })),
  );
  rail.depots.push(...data.rail.depots);
  rail.nextStationId = data.rail.nextStationId;
  rail.nextDepotId = data.rail.nextDepotId;
  // Starší uložení návěstidla nemá; neplatné indexy se zahodí
  for (const tile of data.rail.signals ?? []) {
    if (Number.isInteger(tile) && tile >= 0 && tile < width * height) rail.signals.add(tile);
  }

  const world: World = {
    seed: data.seed,
    map,
    towns: data.towns,
    rail,
    // Starší uložení průmysl nemá; cizí soubor může obsahovat nesmysly
    industries: (data.industries ?? [])
      .filter((i) => validIndustry(i, width, height))
      .map((i) => restoreIndustry(i, data.clock.day)),
  };
  const game = new Game(world);
  game.companyName = data.game.companyName;
  game.autoRenew = data.game.autoRenew === true;
  game.money = data.game.money;
  game.loan = data.game.loan;
  // Přepravený náklad starší uložení nezná nebo zná jen uhlí
  const year = <T extends YearStats>(y: T): T => ({ ...y, freight: restoreFreight(y.freight, legacyCoal(y)) });
  game.thisYear = year(data.game.thisYear);
  game.history = data.game.history.map(year);
  game.rng.state = data.game.rngState;
  game.clock.date = data.clock.date;
  game.clock.day = data.clock.day;
  game.clock.dayProgress = data.clock.dayProgress;
  // Starší uložení nezná stáří vlaků; nejstarší možný je vlak koupený na začátku hry
  game.fleet.trains.push(
    ...data.fleet.trains.map((t) => ({
      ...t,
      builtDay: t.builtDay ?? 0,
      agingWarned: t.agingWarned ?? false,
      renewing: t.renewing ?? false,
      cargo: isCargo(t.cargo) ? t.cargo : ('passengers' as const),
      fullLoad: Array.isArray(t.fullLoad) ? t.fullLoad.filter((id) => Number.isInteger(id)) : [],
    })),
  );
  game.fleet.nextId = data.fleet.nextId;
  game.view = validView(data.view);
  // Cizí soubor může obsahovat nesmysly; místo se před stavbou kontroluje znovu
  game.construction.restore((data.construction ?? []).filter((job) => validJob(job, width, height)));
  return game;
}

function validJob(job: unknown, width: number, height: number): job is Job {
  if (!isObject(job) || !isObject(job.step) || (job.kind !== 'track' && job.kind !== 'road')) return false;
  const { x, y, piece, isNew } = job.step;
  const below = (v: unknown, size: number): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < size;
  const pieceOk = job.kind === 'road' || below(piece, PIECES.length);
  return below(x, width) && below(y, height) && pieceOk && typeof isNew === 'boolean';
}

function validView(view: unknown): ViewState | null {
  if (!isObject(view)) return null;
  const { x, z, zoom, rotation } = view;
  const numbers = [x, z, zoom, rotation].every((n) => typeof n === 'number' && Number.isFinite(n));
  return numbers && Number.isInteger(rotation) ? (view as unknown as ViewState) : null;
}
