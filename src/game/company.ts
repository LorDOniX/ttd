import { CARGO_TYPES } from './cargo';
import type { Game, YearStats } from './game';
import { sellPrice } from './trains';

// Hodnota společnosti jako v OpenTTD: peníze bez úvěru a prodejní cena vlaků
export function companyValue(game: Game): number {
  const today = game.clock.day;
  const vehicles = game.fleet.trains.reduce((sum, t) => sum + sellPrice(t, today), 0);
  return game.money - game.loan + vehicles;
}

export interface PerformancePart {
  label: string;
  value: string;
  points: number;
}

const PART_MAX = 200;
// Hranice pro plný počet bodů v každé části hodnocení
const FULL_STATIONS = 10;
const FULL_DELIVERED = 20_000;
const FULL_BALANCE = 5_000_000;
const SERVED_WITHIN_DAYS = 30;

const share = (value: number, full: number): number => Math.round(PART_MAX * Math.max(0, Math.min(1, value / full)));

function delivered(stats: YearStats): number {
  return stats.passengers + Object.values(stats.freight).reduce((a, b) => a + b, 0);
}

// Hodnocení společnosti 0–1000 z pěti částí po 200 bodech, počítané z posledního uzavřeného roku
export function performance(game: Game): PerformancePart[] {
  const year = game.lastYear ?? game.thisYear;
  const now = game.clock.now;
  const trains = game.fleet.trains;
  const profitable = trains.filter((t) => t.lastIncome > t.lastCosts).length;
  const stations = game.world.rail.stations.filter((s) =>
    CARGO_TYPES.some((c) => s.ratings[c].lastVisit >= 0 && now - s.ratings[c].lastVisit <= SERVED_WITHIN_DAYS),
  ).length;
  const amount = delivered(year);
  const types = (year.passengers > 0 ? 1 : 0) + Object.values(year.freight).filter((v) => v > 0).length;
  const balance = game.money - game.loan;
  return [
    {
      label: 'Ziskové vlaky',
      value: `${profitable} z ${trains.length}`,
      points: trains.length > 0 ? share(profitable, trains.length) : 0,
    },
    { label: 'Obsluhované stanice', value: String(stations), points: share(stations, FULL_STATIONS) },
    {
      label: 'Přepraveno za rok',
      value: Math.round(amount).toLocaleString('cs-CZ'),
      points: share(amount, FULL_DELIVERED),
    },
    { label: 'Druhy nákladu', value: `${types} z ${CARGO_TYPES.length}`, points: share(types, CARGO_TYPES.length) },
    {
      label: 'Peníze bez úvěru',
      value: balance.toLocaleString('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }),
      points: share(balance, FULL_BALANCE),
    },
  ];
}

const TITLES: readonly { min: number; title: string }[] = [
  { min: 800, title: 'Magnát' },
  { min: 600, title: 'Průmyslník' },
  { min: 400, title: 'Manažer' },
  { min: 200, title: 'Podnikatel' },
  { min: 0, title: 'Začátečník' },
];

export function performanceTitle(score: number): string {
  return TITLES.find((t) => score >= t.min)!.title;
}

export function performanceScore(parts: readonly PerformancePart[]): number {
  return parts.reduce((sum, p) => sum + p.points, 0);
}
