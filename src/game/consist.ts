import { CARGOS, trimDests, type Cargo } from './cargo';

// Náklad jedné skupiny vagonů na palubě: kolik, odkud a kdy naložen, kolik dlaždic ujel
export interface CargoLoad {
  passengers: number;
  boardedStation: number;
  boardedAt: number;
  tiles: number;
  feeder?: number;
  origin?: number;
  // Cargodist: náklad podle cílové stanice
  dests?: Record<number, number>;
}

// Náklad vagonů s jiným nákladem, než veze první vagon
export interface CargoHold extends CargoLoad {
  cargo: Cargo;
}

// Souprava jako v OpenTTD: každý vagon má svůj náklad. Náklad prvního vagonu (cargo) se vede přímo ve vlaku,
// ostatní druhy v holds; wagonCargo je jen u smíšené soupravy (jinak vezou všechny vagony cargo)
export interface Consist extends CargoLoad {
  wagons: number;
  cargo: Cargo;
  wagonCargo?: Cargo[];
  holds?: CargoHold[];
}

export function wagonCapacity(cargo: Cargo): number {
  return CARGOS[cargo].wagonCapacity;
}

// Náklad každého vagonu od lokomotivy
export function wagonCargos(train: Consist): Cargo[] {
  if (train.wagonCargo && train.wagonCargo.length === train.wagons) return [...train.wagonCargo];
  return Array.from({ length: train.wagons }, () => train.cargo);
}

// Druhy nákladu soupravy, první je náklad prvního vagonu
export function consistCargos(train: Consist): Cargo[] {
  const list = wagonCargos(train);
  return list.length === 0 ? [] : [...new Set(list)];
}

export function isMixed(train: Consist): boolean {
  return wagonCargos(train).some((c) => c !== train.cargo);
}

export function wagonCount(train: Consist, cargo: Cargo): number {
  return wagonCargos(train).filter((c) => c === cargo).length;
}

export function cargoCapacity(train: Consist, cargo: Cargo): number {
  return wagonCount(train, cargo) * wagonCapacity(cargo);
}

// Stav nákladu daného druhu (u prvního druhu je to vlak sám), nebo undefined
export function loadState(train: Consist, cargo: Cargo): CargoLoad | undefined {
  if (cargo === train.cargo) return train;
  return train.holds?.find((h) => h.cargo === cargo);
}

export function loadOf(train: Consist, cargo: Cargo): number {
  return loadState(train, cargo)?.passengers ?? 0;
}

// Všechen náklad na palubě
export function totalLoad(train: Consist): number {
  return train.passengers + (train.holds ?? []).reduce((sum, h) => sum + h.passengers, 0);
}

function emptyLoad(): CargoLoad {
  return { passengers: 0, boardedStation: -1, boardedAt: 0, tiles: 0 };
}

function copyLoad(from: CargoLoad): CargoLoad {
  return {
    passengers: from.passengers,
    boardedStation: from.boardedStation,
    boardedAt: from.boardedAt,
    tiles: from.tiles,
    feeder: from.feeder,
    origin: from.origin,
    ...(from.dests ? { dests: { ...from.dests } } : {}),
  };
}

// Nastaví vagony soupravy (náklad každého vagonu od lokomotivy). Náklad druhů, které zůstaly, se zachová
// (nejvýš do nové kapacity), náklad odpojených či přestavěných vagonů propadne.
export function setConsist(train: Consist, list: readonly Cargo[]): void {
  const states = new Map<Cargo, CargoLoad>([[train.cargo, copyLoad(train)]]);
  for (const hold of train.holds ?? []) states.set(hold.cargo, copyLoad(hold));
  const primary = list[0] ?? train.cargo;
  const stateFor = (cargo: Cargo): CargoLoad => {
    const state = states.get(cargo) ?? emptyLoad();
    const room = list.filter((c) => c === cargo).length * wagonCapacity(cargo);
    state.passengers = Math.max(0, Math.min(state.passengers, room));
    if (state.passengers === 0) state.feeder = 0;
    trimDests(state);
    return state;
  };
  const main = stateFor(primary);
  train.cargo = primary;
  train.wagons = list.length;
  train.passengers = main.passengers;
  train.boardedStation = main.boardedStation;
  train.boardedAt = main.boardedAt;
  train.tiles = main.tiles;
  train.feeder = main.feeder;
  train.origin = main.origin;
  if (main.dests) train.dests = main.dests;
  else delete train.dests;
  const others = [...new Set(list)].filter((c) => c !== primary);
  train.holds = others.length > 0 ? others.map((cargo) => ({ cargo, ...stateFor(cargo) })) : undefined;
  train.wagonCargo = others.length > 0 ? [...list] : undefined;
}

// Kolik vagonů každého druhu stojí u nástupiště, když u něj stojí prvních count vagonů
export function wagonsAtPlatform(train: Consist, count: number): Map<Cargo, number> {
  const result = new Map<Cargo, number>();
  for (const cargo of wagonCargos(train).slice(0, count)) result.set(cargo, (result.get(cargo) ?? 0) + 1);
  return result;
}
