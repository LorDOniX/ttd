import { Game, type YearStats } from './game';
import type { GameDate } from './clock';
import type { Train } from './trains';
import type { World } from '../world/generator';
import { GameMap } from '../world/map';
import { RailNetwork, type Depot, type Station } from '../world/rail';
import type { Town } from '../world/town';

const SAVE_VERSION = 1;
const MAX_MAP_SIZE = 1024;
export const PENDING_LOAD_KEY = 'ttd-pending-load';

export interface SaveData {
  version: number;
  seed: number;
  seedText: string;
  map: { width: number; height: number; tiles: string; owner: string };
  towns: Town[];
  rail: { pieces: string; stations: Station[]; depots: Depot[]; nextStationId: number; nextDepotId: number };
  fleet: { trains: Train[]; nextId: number };
  game: { companyName: string; money: number; thisYear: YearStats; lastYear: YearStats | null; rngState: number };
  clock: { date: GameDate; day: number; dayProgress: number };
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
    rail: {
      pieces: encode(rail.pieces),
      stations: rail.stations,
      depots: rail.depots,
      nextStationId: rail.nextStationId,
      nextDepotId: rail.nextDepotId,
    },
    fleet: { trains: fleet.trains, nextId: fleet.nextId },
    game: {
      companyName: game.companyName,
      money: game.money,
      thisYear: game.thisYear,
      lastYear: game.lastYear,
      rngState: game.rng.state,
    },
    clock: { date: clock.date, day: clock.day, dayProgress: clock.dayProgress },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Kontrola struktury souboru; data pochází od uživatele, proto se neověřené nepoužijí
export function parseSave(text: string): SaveData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platný JSON.');
  }
  if (!isObject(data) || data.version !== SAVE_VERSION) throw new Error('Nepodporovaná verze uložené hry.');
  const { map, rail, fleet, game, clock } = data;
  if (!isObject(map) || !isObject(rail) || !isObject(fleet) || !isObject(game) || !isObject(clock)) {
    throw new Error('Neúplná uložená hra.');
  }
  const size = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_MAP_SIZE;
  if (!size(map.width) || !size(map.height)) throw new Error('Neplatná velikost mapy.');
  const strings = [map.tiles, map.owner, rail.pieces, game.companyName, data.seedText];
  const numbers = [data.seed, rail.nextStationId, rail.nextDepotId, fleet.nextId, game.money, game.rngState, clock.day, clock.dayProgress];
  const arrays = [data.towns, rail.stations, rail.depots, fleet.trains];
  if (
    strings.some((s) => typeof s !== 'string') ||
    numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
    arrays.some((a) => !Array.isArray(a)) ||
    !isObject(clock.date) ||
    !isObject(game.thisYear)
  ) {
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
  rail.stations.push(...data.rail.stations);
  rail.depots.push(...data.rail.depots);
  rail.nextStationId = data.rail.nextStationId;
  rail.nextDepotId = data.rail.nextDepotId;

  const world: World = { seed: data.seed, map, towns: data.towns, rail };
  const game = new Game(world);
  game.companyName = data.game.companyName;
  game.money = data.game.money;
  game.thisYear = data.game.thisYear;
  game.lastYear = data.game.lastYear;
  game.rng.state = data.game.rngState;
  game.clock.date = data.clock.date;
  game.clock.day = data.clock.day;
  game.clock.dayProgress = data.clock.dayProgress;
  game.fleet.trains.push(...data.fleet.trains);
  game.fleet.nextId = data.fleet.nextId;
  return game;
}
