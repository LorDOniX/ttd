import { LOAN_INTEREST, LOAN_STEP, MAINTENANCE_RATE, MAX_LOAN, START_MONEY } from './balance';
import { CARGOS, FREIGHT_TYPES, emptyFreight, type FreightStock } from './cargo';
import { Construction, infrastructureValue } from './construction';
import { Emitter } from './emitter';
import { GameClock, formatDate, type GameDate } from './clock';
import { Freight } from './freight';
import { companyValue, performance, performanceScore, performanceTitle } from './company';
import { IndustryLife } from './industryLife';
import { Passengers } from './passengers';
import { Fleet } from './trains';
import type { World } from '../world/generator';
import { Rng } from '../world/rng';
import { growTown } from '../world/town';

export const DEFAULT_COMPANY_NAME = 'Moje dopravní společnost';
const MAX_NEWS_LOG = 200;

export interface NewsItem {
  date: GameDate;
  text: string;
  // Místo na mapě, které se zprávy týká (střed dlaždice)
  at?: { x: number; y: number };
}

export type ExpenseKind = 'construction' | 'vehicles' | 'running' | 'maintenance' | 'interest';

export const EXPENSE_KINDS: readonly ExpenseKind[] = ['construction', 'vehicles', 'running', 'maintenance', 'interest'];

export interface YearStats {
  income: number;
  expenses: number;
  passengers: number;
  // Přepravený náklad v tunách podle druhu
  freight: FreightStock;
  costs: Record<ExpenseKind, number>;
}

export interface YearRecord extends YearStats {
  year: number;
}

export function emptyYear(): YearStats {
  return {
    income: 0,
    expenses: 0,
    passengers: 0,
    freight: emptyFreight(),
    costs: { construction: 0, vehicles: 0, running: 0, maintenance: 0, interest: 0 },
  };
}

type GameEvents = {
  money: [number];
  news: [string];
  company: [string];
  townsChanged: [];
  railChanged: [];
  roadsChanged: [];
  trainsChanged: [];
  stationsChanged: [];
  // Závod vznikl nebo zanikl
  industriesChanged: [];
  treesChanged: [];
  // Výdělek za přepravu a místo, kde vznikl
  income: [number, number, number];
  // Výsledek demolice a její střed: kladná částka se vrátila, záporná se zaplatila
  demolished: [number, number, number];
  outOfMoney: [];
};

export function formatMoney(amount: number): string {
  return amount.toLocaleString('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  });
}

// Pohled kamery: střed na mapě, přiblížení a natočení po 90°
export interface ViewState {
  x: number;
  z: number;
  zoom: number;
  rotation: number;
}

// Stav rozehrané hry nezávislý na vykreslování
export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly clock = new GameClock();
  readonly construction = new Construction(this);
  readonly fleet: Fleet;
  readonly passengers: Passengers;
  readonly freight: Freight;
  readonly industryLife: IndustryLife;
  readonly rng: Rng;
  companyName = DEFAULT_COMPANY_NAME;
  // Staré vlaky se samy pošlou do depa na obnovu
  autoRenew = false;
  money = START_MONEY;
  loan = 0;
  thisYear: YearStats = emptyYear();
  // Uzavřené roky od nejstaršího
  history: YearRecord[] = [];
  // Poslední zprávy od nejstarší; neukládají se
  readonly newsLog: NewsItem[] = [];
  // Pohled kamery k uložení; null = výchozí u největšího města
  view: ViewState | null = null;
  // Cena staveb pro údržbu; počítá se z celé mapy, proto jen po změně kolejí
  private infrastructure: number | null = null;

  constructor(readonly world: World) {
    // Vlastní proud náhody pro průběh hry, oddělený od generování mapy
    this.rng = new Rng(world.seed ^ 0x5bd1e995);
    this.fleet = new Fleet(this);
    this.passengers = new Passengers(this);
    this.freight = new Freight(this);
    // Až po Freight, aby měsíční změny viděly uzavřený odvoz
    this.industryLife = new IndustryLife(this);
    this.clock.events.on('month', () => this.payMonthly());
    this.events.on('railChanged', () => (this.infrastructure = null));
    this.clock.events.on('year', (year) => this.onYearEnd(year));
    this.clock.events.on('end', () =>
      this.news(`${formatDate(this.clock.date)}: konec hry. Konečný stav účtu ${formatMoney(this.money)}.`),
    );
  }

  get lastYear(): YearRecord | null {
    return this.history.at(-1) ?? null;
  }

  // Měsíční splátka úroku z aktuálního úvěru
  get monthlyInterest(): number {
    return Math.round((this.loan * LOAN_INTEREST) / 12);
  }

  get monthlyMaintenance(): number {
    this.infrastructure ??= infrastructureValue(this.world);
    return Math.round((this.infrastructure * MAINTENANCE_RATE) / 12);
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

  spend(amount: number, kind: ExpenseKind): void {
    this.money -= amount;
    this.thisYear.expenses += amount;
    this.thisYear.costs[kind] += amount;
    this.events.emit('money', this.money);
  }

  // Vrácené peníze (např. z demolice) snižují výdaje, nejsou příjmem
  refund(amount: number, kind: ExpenseKind): void {
    this.spend(-amount, kind);
  }

  // Úvěr není příjem ani výdaj, mění jen stav účtu
  borrow(): string | null {
    if (this.loan + LOAN_STEP > MAX_LOAN) return `Úvěr může být nejvýš ${formatMoney(MAX_LOAN)}.`;
    this.loan += LOAN_STEP;
    this.money += LOAN_STEP;
    this.events.emit('money', this.money);
    return null;
  }

  repay(): string | null {
    if (this.loan < LOAN_STEP) return 'Žádný úvěr nemáte.';
    if (this.money < LOAN_STEP) return `Na splátku chybí peníze (${formatMoney(LOAN_STEP)}).`;
    this.loan -= LOAN_STEP;
    this.money -= LOAN_STEP;
    this.events.emit('money', this.money);
    return null;
  }

  news(text: string, at?: { x: number; y: number }): void {
    this.newsLog.push({ date: this.clock.date, text, at: at && { x: at.x, y: at.y } });
    if (this.newsLog.length > MAX_NEWS_LOG) this.newsLog.shift();
    this.events.emit('news', text);
  }

  setCompanyName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.companyName) return;
    this.companyName = trimmed;
    this.events.emit('company', trimmed);
  }

  // Platby za uplynulý měsíc; prosinec se započítá ještě do končícího roku
  private payMonthly(): void {
    const interest = this.monthlyInterest;
    const maintenance = this.monthlyMaintenance;
    if (interest > 0) this.spend(interest, 'interest');
    if (maintenance > 0) this.spend(maintenance, 'maintenance');
  }

  private onYearEnd(year: number): void {
    const { income, expenses, passengers, freight } = this.thisYear;
    const freightText = FREIGHT_TYPES.filter((type) => freight[type] > 0)
      .map((type) => ` a ${Math.round(freight[type]).toLocaleString('cs-CZ')} ${CARGOS[type].unit}`)
      .join('');
    this.news(
      `Rok ${year} skončil – přepraveno ${passengers.toLocaleString('cs-CZ')} cestujících${freightText}, ` +
        `příjmy ${formatMoney(income)}, výdaje ${formatMoney(expenses)}, zisk ${formatMoney(income - expenses)}.`,
    );
    this.history.push({ year, ...this.thisYear });
    this.thisYear = emptyYear();
    const score = performanceScore(performance(this));
    this.news(
      `Hodnocení společnosti za rok ${year}: ${score} / 1000 – ${performanceTitle(score)}, ` +
        `hodnota ${formatMoney(companyValue(this))}.`,
    );

    for (const town of this.world.towns) {
      growTown(this.world.map, town, year + 1, this.rng);
      town.served = false;
    }
    this.events.emit('townsChanged');
  }
}
