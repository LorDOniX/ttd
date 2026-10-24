import { serializeGame, type SaveData } from './save';
import type { Game } from './game';

// Předání volby z úvodní obrazovky do hry přes reload stránky
const LAUNCH_KEY = 'ttd-launch';
// Automatické uložení pro tlačítko Pokračovat
const AUTOSAVE_KEY = 'ttd-autosave';

export type WaterAmount = 'low' | 'normal' | 'high';
export type TownAmount = 'few' | 'normal' | 'many';
export type IndustryAmount = 'few' | 'normal' | 'many';

export interface NewGameOptions {
  seedText: string;
  size: 128 | 256 | 512;
  water: WaterAmount;
  towns: TownAmount;
  industries: IndustryAmount;
}

export type LaunchIntent = { mode: 'new'; options: NewGameOptions } | { mode: 'load'; save: string };

export function launch(intent: LaunchIntent): void {
  sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(intent));
  location.assign(location.pathname);
}

export function takeLaunchIntent(): LaunchIntent | null {
  const text = sessionStorage.getItem(LAUNCH_KEY);
  sessionStorage.removeItem(LAUNCH_KEY);
  if (!text) return null;
  try {
    return JSON.parse(text) as LaunchIntent;
  } catch {
    return null;
  }
}

export function returnToTitle(): void {
  location.assign(location.pathname);
}

export function writeAutosave(game: Game, seedText: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeGame(game, seedText)));
  } catch {
    // Plné úložiště (velká mapa) nesmí shodit hru; pokračování pak jen nebude k dispozici
  }
}

export function readAutosave(): string | null {
  return localStorage.getItem(AUTOSAVE_KEY);
}

// Krátký popis automatického uložení pro úvodní obrazovku
export function describeSave(data: SaveData): string {
  const { date } = data.clock;
  return `${data.game.companyName}, ${date.day}. ${date.month + 1}. ${date.year}`;
}
