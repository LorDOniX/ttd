import { START_MONEY } from './balance';
import { Construction } from './construction';
import { Emitter } from './emitter';
import { GameClock, formatDate } from './clock';
import { Fleet } from './trains';
import type { World } from '../world/generator';
import { Rng } from '../world/rng';
import { growTown } from '../world/town';

export const DEFAULT_COMPANY_NAME = 'Moje dopravní společnost';

export interface YearStats {
  income: number;
  expenses: number;
}

type GameEvents = {
  money: [number];
  news: [string];
  company: [string];
  townsChanged: [];
  railChanged: [];
  roadsChanged: [];
  trainsChanged: [];
  outOfMoney: [];
};

export function formatMoney(amount: number): string {
  return amount.toLocaleString('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  });
}

// Stav rozehrané hry nezávislý na vykreslování
export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly clock = new GameClock();
  readonly construction = new Construction(this);
  readonly fleet: Fleet;
  readonly rng: Rng;
  companyName = DEFAULT_COMPANY_NAME;
  money = START_MONEY;
  thisYear: YearStats = { income: 0, expenses: 0 };
  lastYear: YearStats | null = null;

  constructor(readonly world: World) {
    // Vlastní proud náhody pro průběh hry, oddělený od generování mapy
    this.rng = new Rng(world.seed ^ 0x5bd1e995);
    this.fleet = new Fleet(this);
    this.clock.events.on('year', (year) => this.onYearEnd(year));
    this.clock.events.on('end', () =>
      this.news(`${formatDate(this.clock.date)}: konec hry. Konečný stav účtu ${formatMoney(this.money)}.`),
    );
  }

  update(dtMs: number): void {
    this.fleet.update(this.clock.tick(dtMs));
    this.construction.update(dtMs);
  }

  earn(amount: number): void {
    this.money += amount;
    this.thisYear.income += amount;
    this.events.emit('money', this.money);
  }

  spend(amount: number): void {
    this.money -= amount;
    this.thisYear.expenses += amount;
    this.events.emit('money', this.money);
  }

  // Vrácené peníze (např. z demolice) snižují výdaje, nejsou příjmem
  refund(amount: number): void {
    this.spend(-amount);
  }

  news(text: string): void {
    this.events.emit('news', text);
  }

  setCompanyName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.companyName) return;
    this.companyName = trimmed;
    this.events.emit('company', trimmed);
  }

  private onYearEnd(year: number): void {
    const { income, expenses } = this.thisYear;
    this.news(
      `Rok ${year} skončil – příjmy ${formatMoney(income)}, výdaje ${formatMoney(expenses)}, ` +
        `zisk ${formatMoney(income - expenses)}.`,
    );
    this.lastYear = this.thisYear;
    this.thisYear = { income: 0, expenses: 0 };

    for (const town of this.world.towns) growTown(this.world.map, town, year + 1, this.rng);
    this.events.emit('townsChanged');
  }
}
