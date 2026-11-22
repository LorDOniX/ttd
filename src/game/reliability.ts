import {
  BREAKDOWN_DAYS,
  BREAKDOWN_RATE,
  OLD_VEHICLE_DECAY_FACTOR,
  REDUCED_BREAKDOWN_FACTOR,
  RELIABILITY_DECAY_PER_DAY,
} from './balance';

// Poruchy vozidel jako v nastavení OpenTTD: žádné, snížené, běžné
export type BreakdownSetting = 'none' | 'reduced' | 'normal';

export const BREAKDOWN_SETTINGS: readonly BreakdownSetting[] = ['none', 'reduced', 'normal'];

export const BREAKDOWN_LABELS: Record<BreakdownSetting, string> = {
  none: 'Žádné',
  reduced: 'Snížené',
  normal: 'Běžné',
};

export function isBreakdownSetting(value: unknown): value is BreakdownSetting {
  return typeof value === 'string' && (BREAKDOWN_SETTINGS as readonly string[]).includes(value);
}

// Údržba vozidla: spolehlivost klesá každý den, servis ji vrátí na maximum modelu
export interface Maintained {
  // 0–1
  reliability: number;
  // Herní den posledního servisu
  lastService: number;
  // Po kolika dnech má vozidlo jet na servis
  serviceInterval: number;
  // Zbývající dny opravy po poruše; 0 = jede
  brokenDays: number;
  // Počet poruch od posledního servisu
  breakdowns: number;
}

export function newMaintenance(maxReliability: number, now: number, interval: number): Maintained {
  return { reliability: maxReliability, lastService: now, serviceInterval: interval, brokenDays: 0, breakdowns: 0 };
}

// Opotřebení za uplynulé dny; vozidlo po životnosti se opotřebovává rychleji
export function wearOut(vehicle: Maintained, days: number, old: boolean): void {
  const rate = RELIABILITY_DECAY_PER_DAY * (old ? OLD_VEHICLE_DECAY_FACTOR : 1);
  vehicle.reliability = Math.max(0, vehicle.reliability - rate * days);
}

// Denní šance na poruchu: roste s druhou mocninou nespolehlivosti
export function breakdownChance(reliability: number, setting: BreakdownSetting): number {
  if (setting === 'none') return 0;
  const chance = BREAKDOWN_RATE * (1 - reliability) ** 2;
  return setting === 'reduced' ? chance * REDUCED_BREAKDOWN_FACTOR : chance;
}

// Zkusí poruchu za uplynulé dny; vrací true, když se vozidlo porouchalo
export function rollBreakdown(vehicle: Maintained, days: number, setting: BreakdownSetting, random: number): boolean {
  const chance = 1 - (1 - breakdownChance(vehicle.reliability, setting)) ** days;
  if (random >= chance) return false;
  vehicle.brokenDays = BREAKDOWN_DAYS;
  vehicle.breakdowns++;
  return true;
}

// Má vozidlo jet na servis? Bez poruch se servis nevyžaduje (jako volba v OpenTTD)
export function needsService(vehicle: Maintained, now: number, setting: BreakdownSetting): boolean {
  return setting !== 'none' && now - vehicle.lastService >= vehicle.serviceInterval;
}

export function service(vehicle: Maintained, maxReliability: number, now: number): void {
  vehicle.reliability = maxReliability;
  vehicle.lastService = now;
  vehicle.breakdowns = 0;
}
