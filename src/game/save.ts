import { COAL_PRODUCTION, RATING_START, STATION_LENGTH } from './balance';
import { Game, emptyYear, type YearRecord, type YearStats } from './game';
import type { GameDate } from './clock';
import type { Train } from './trains';
import type { World } from '../world/generator';
import { INDUSTRY_NAMES, INDUSTRY_SIZE, type Industry } from '../world/industry';
import { GameMap } from '../world/map';
import { RailNetwork, type Depot, type Station } from '../world/rail';
import type { Town } from '../world/town';

// 2: úvěr, historie let a rozpad výdajů; 3: hodnocení nástupišť; 4: stáří vlaků; 5: návěstidla; 6: průmysl;
// 7: nákladní doprava uhlí; 8: čekání na plné naložení
const SAVE_VERSION = 8;
// Důl ze staršího uložení nemá těžbu, dostane střední hodnotu
const DEFAULT_MINE_PRODUCTION = Math.round((COAL_PRODUCTION.min + COAL_PRODUCTION.max) / 2);
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
  };
  clock: { date: GameDate; day: number; dayProgress: number };
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
    },
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
    kind in INDUSTRY_NAMES &&
    typeof name === 'string' &&
    inside(x, width) &&
    inside(y, height) &&
    Number.isInteger(rotation)
  );
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function restoreIndustry(industry: Industry): Industry {
  const production = industry.kind === 'coal-mine' ? DEFAULT_MINE_PRODUCTION : 0;
  return {
    ...industry,
    production: finiteOr(industry.production, production),
    transported: finiteOr(industry.transported, 0),
    lastTransported: finiteOr(industry.lastTransported, 0),
  };
}

// Kontrola struktury souboru; data pochází od uživatele, proto se neověřené nepoužijí
export function parseSave(text: string): SaveData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platný JSON.');
  }
  if (!isObject(data) || ![1, 2, 3, 4, 5, 6, 7, SAVE_VERSION].includes(data.version as number)) {
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
      coal: finiteOr(s.coal, 0),
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
      .map(restoreIndustry),
  };
  const game = new Game(world);
  game.companyName = data.game.companyName;
  game.money = data.game.money;
  game.loan = data.game.loan;
  // Přepravené uhlí starší uložení nezná
  game.thisYear = { ...data.game.thisYear, coal: finiteOr(data.game.thisYear.coal, 0) };
  game.history = data.game.history.map((y) => ({ ...y, coal: finiteOr(y.coal, 0) }));
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
      cargo: t.cargo === 'coal' ? ('coal' as const) : ('passengers' as const),
      fullLoad: Array.isArray(t.fullLoad) ? t.fullLoad.filter((id) => Number.isInteger(id)) : [],
    })),
  );
  game.fleet.nextId = data.fleet.nextId;
  return game;
}
