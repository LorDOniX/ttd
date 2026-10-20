import { Emitter } from './emitter';

export const START_YEAR = 1950;
export const END_YEAR = 2050;
const REAL_MS_PER_YEAR = 15 * 60 * 1000;
// Delší výpadek (např. skrytý tab) nesmí přeskočit celé měsíce
const MAX_FRAME_MS = 250;

const MONTH_NAMES = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

export interface GameDate {
  year: number;
  month: number; // 0–11
  day: number; // 1–31
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export function formatDate(date: GameDate): string {
  return `${date.day}. ${MONTH_NAMES[date.month]} ${date.year}`;
}

type ClockEvents = {
  day: [GameDate];
  month: [GameDate];
  // Předává rok, který právě skončil
  year: [number];
  end: [];
  pause: [boolean];
};

// Herní kalendář: 1 rok = 15 minut reálného času
export class GameClock {
  readonly events = new Emitter<ClockEvents>();
  date: GameDate = { year: START_YEAR, month: 0, day: 1 };
  // Rozpracovaná část aktuálního dne 0..1
  dayProgress = 0;
  private _paused = false;

  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    this._paused = value;
    this.events.emit('pause', value);
  }

  get ended(): boolean {
    return this.date.year >= END_YEAR;
  }

  // Posune čas o reálných dtMs, vrací počet uplynulých herních dní (necelé číslo)
  tick(dtMs: number): number {
    if (this._paused || this.ended) return 0;
    const msPerDay = REAL_MS_PER_YEAR / daysInYear(this.date.year);
    const days = Math.min(dtMs, MAX_FRAME_MS) / msPerDay;
    this.dayProgress += days;
    while (this.dayProgress >= 1 && !this.ended) {
      this.dayProgress -= 1;
      this.advanceDay();
    }
    return days;
  }

  private advanceDay(): void {
    const d = this.date;
    if (d.day < daysInMonth(d.year, d.month)) {
      this.date = { ...d, day: d.day + 1 };
      this.events.emit('day', this.date);
      return;
    }
    const newYear = d.month === 11;
    this.date = newYear
      ? { year: d.year + 1, month: 0, day: 1 }
      : { year: d.year, month: d.month + 1, day: 1 };
    this.events.emit('day', this.date);
    this.events.emit('month', this.date);
    if (newYear) this.events.emit('year', d.year);
    if (this.ended) this.events.emit('end');
  }
}
