import type { Station } from '../world/rail';

// Výběr zastávky kliknutím do mapy jako „Jet do“ v OpenTTD: okno řádu výběr zapne,
// hra pak kliknutí na stanici (dlaždici nebo popisek) předá sem místo otevření okna
export interface StationPick {
  // Okno, které výběr zapnulo (při zavření okna se výběr zruší)
  owner: string;
  // Text v liště nad mapou, např. „Vlak 1: klikněte na nástupiště“
  prompt: string;
  // null = stanici přidá, jinak důvod odmítnutí
  pick: (station: Station) => string | null;
  // Odmítnutá stanice nebo klik mimo stanici
  reject: (reason: string) => void;
}

let active: StationPick | null = null;
const listeners = new Set<(pick: StationPick | null) => void>();

function notify(): void {
  for (const listener of listeners) listener(active);
}

export function startStationPick(pick: StationPick): void {
  active = pick;
  notify();
}

export function stopStationPick(owner?: string): void {
  if (!active || (owner !== undefined && active.owner !== owner)) return;
  active = null;
  notify();
}

export function stationPick(): StationPick | null {
  return active;
}

export function onStationPickChange(listener: (pick: StationPick | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Klik do mapy během výběru; výběr zůstane zapnutý, aby šlo přidat víc zastávek po sobě
export function pickStationAt(station: Station | undefined): void {
  if (!active) return;
  if (!station) {
    active.reject('Tady žádná stanice není.');
    return;
  }
  const error = active.pick(station);
  if (error) active.reject(error);
}
