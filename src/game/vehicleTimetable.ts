import { timetableDays } from './trains';

// Časy jízdního řádu aut, letadel a lodí (u vlaků jsou ve volbách příkazů): plánovaná doba jízdy k zastávce
// a stání na ní, naměřené doby, zpoždění a automatické vyplňování jako v OpenTTD
export interface TimetableEntry {
  travel?: number;
  wait?: number;
}

export interface Timetabled {
  orders: number[] | null;
  // Časy po řadě k příkazům (stejné indexy jako orders)
  timetable?: TimetableEntry[];
  departedAt?: number;
  lastTravel?: (number | null)[];
  lateness?: number;
  autofill?: boolean;
}

export function timetableEntry(vehicle: Timetabled, index: number): TimetableEntry {
  return vehicle.timetable?.[index] ?? {};
}

function cleanEntry(entry: TimetableEntry): TimetableEntry {
  const clean: TimetableEntry = {};
  const travel = timetableDays(entry.travel);
  const wait = timetableDays(entry.wait);
  if (travel !== undefined) clean.travel = travel;
  if (wait !== undefined) clean.wait = wait;
  return clean;
}

// Bez jediného údaje se časy nevedou vůbec (kratší uložení)
function compact(list: TimetableEntry[]): TimetableEntry[] | undefined {
  return list.some((e) => e.travel !== undefined || e.wait !== undefined) ? list : undefined;
}

// Plánovaná doba jízdy nebo stání u příkazu; null smaže
export function setTimetableEntry(
  vehicle: Timetabled,
  index: number,
  patch: { travel?: number | null; wait?: number | null },
): void {
  const orders = vehicle.orders ?? [];
  if (index < 0 || index >= orders.length) return;
  const list = orders.map((_, i) => ({ ...timetableEntry(vehicle, i) }));
  if (patch.travel !== undefined) list[index].travel = patch.travel ?? undefined;
  if (patch.wait !== undefined) list[index].wait = patch.wait ?? undefined;
  vehicle.timetable = compact(list.map(cleanEntry));
}

export function clearVehicleTimetable(vehicle: Timetabled): void {
  vehicle.timetable = undefined;
  vehicle.lateness = undefined;
}

// Vozidlo vyjelo k dalšímu příkazu: od teď se měří doba jízdy
export function departed(vehicle: Timetabled, now: number): void {
  vehicle.departedAt = now;
}

// Příjezd k příkazu index: zapíše naměřenou dobu jízdy (s automatickým vyplňováním i do plánu) a zpoždění.
// Vrací, kolik dní má vozidlo počkat: o kolik přijelo dřív, nejméně však plánované stání (minus wait, které už stojí)
export function arrived(vehicle: Timetabled, index: number, now: number): { early: number; wait: number } {
  const orders = vehicle.orders ?? [];
  const wait = timetableEntry(vehicle, index).wait ?? 0;
  if (vehicle.departedAt === undefined || index < 0 || index >= orders.length) return { early: 0, wait };
  const measured = Math.round((now - vehicle.departedAt) * 10) / 10;
  vehicle.departedAt = undefined;
  const last = orders.map((_, i) => vehicle.lastTravel?.[i] ?? null);
  last[index] = measured;
  vehicle.lastTravel = last;
  if (vehicle.autofill) setTimetableEntry(vehicle, index, { travel: measured });
  const planned = timetableEntry(vehicle, index).travel;
  if (planned === undefined) return { early: 0, wait };
  const lateness = Math.round((measured - planned) * 10) / 10;
  vehicle.lateness = Math.max(0, lateness);
  return { early: Math.max(0, -lateness), wait };
}

// Po změně řádu zůstanou časy u příkazů, které v řádu zůstaly (podle zastávky a pořadí)
export function remapTimetable(vehicle: Timetabled, before: readonly number[], after: readonly number[]): void {
  if (before.length === after.length && before.every((id, i) => id === after[i])) return;
  vehicle.lastTravel = undefined;
  vehicle.lateness = undefined;
  if (!vehicle.timetable) return;
  const used = new Set<number>();
  const list = after.map((id) => {
    const i = before.findIndex((b, k) => b === id && !used.has(k));
    if (i < 0) return {};
    used.add(i);
    return { ...timetableEntry(vehicle, i) };
  });
  vehicle.timetable = compact(list);
}

// Časy z uložení: jen platné údaje, nejvýš tolik, kolik je příkazů
export function restoreTimetable(value: unknown, orders: number): TimetableEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = Array.from({ length: orders }, (_, i) =>
    typeof value[i] === 'object' && value[i] !== null ? cleanEntry(value[i] as TimetableEntry) : {},
  );
  return compact(list);
}
