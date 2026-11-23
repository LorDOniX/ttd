import {
  SUBSIDY_DEFAULT_MULTIPLIER,
  SUBSIDY_DURATION_MONTHS,
  SUBSIDY_MAX_DISTANCE,
  SUBSIDY_MAX_OFFERS,
  SUBSIDY_MAX_TRANSPORTED,
  SUBSIDY_MIN_DISTANCE,
  SUBSIDY_MIN_POPULATION,
  SUBSIDY_MULTIPLIERS,
  SUBSIDY_OFFER_CHANCE,
  SUBSIDY_OFFER_MONTHS,
} from './balance';
import { CARGOS, TOWN_ACCEPTS, isCargo, type Cargo, type FreightType } from './cargo';
import { formatDate, type GameDate } from './clock';
import { formatMoney, type Game } from './game';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type Industry } from '../world/industry';
import type { Station } from '../world/rail';
import { Rng } from '../world/rng';
import type { Town } from '../world/town';

// Zdroj nebo cíl dotace: město, nebo závod
export interface SubsidyEnd {
  kind: 'town' | 'industry';
  id: number;
}

export interface Subsidy {
  id: number;
  cargo: Cargo;
  from: SubsidyEnd;
  to: SubsidyEnd;
  // Nabídka, nebo udělená dotace platí do začátku tohoto měsíce (rok × 12 + měsíc)
  until: number;
  awarded: boolean;
}

export type SubsidyMultiplier = (typeof SUBSIDY_MULTIPLIERS)[number];

export function isSubsidyMultiplier(value: unknown): value is SubsidyMultiplier {
  return SUBSIDY_MULTIPLIERS.includes(value as SubsidyMultiplier);
}

export function monthIndex(date: GameDate): number {
  return date.year * 12 + date.month;
}

// První den měsíce s pořadím index
export function monthStart(index: number): GameDate {
  return { year: Math.floor(index / 12), month: index % 12, day: 1 };
}

function sameEnd(a: SubsidyEnd, b: SubsidyEnd): boolean {
  return a.kind === b.kind && a.id === b.id;
}

// Celé hodnoty: 4 → „4“, 1,5 → „1,5“
export function multiplierText(multiplier: number): string {
  return `×${multiplier.toLocaleString('cs-CZ')}`;
}

// Dotace jako v OpenTTD: obec nabízí příplatek za přepravu určitého nákladu ze zdroje do cíle.
// První dodávka ze stanice u zdroje na stanici u cíle dotaci získá a po dobu dotace se za ni platí násobek.
export class Subsidies {
  list: Subsidy[] = [];
  nextId = 1;
  multiplier: SubsidyMultiplier = SUBSIDY_DEFAULT_MULTIPLIER;
  // Vlastní proud náhody, aby nabídky neměnily ostatní náhodu hry
  readonly rng: Rng;

  constructor(private readonly game: Game) {
    this.rng = new Rng(game.world.seed ^ 0x2f6b9d31);
    game.clock.events.on('month', () => this.monthly());
  }

  get offers(): Subsidy[] {
    return this.list.filter((s) => !s.awarded);
  }

  get awarded(): Subsidy[] {
    return this.list.filter((s) => s.awarded);
  }

  town(id: number): Town | undefined {
    return this.game.world.towns.find((t) => t.id === id);
  }

  industry(id: number): Industry | undefined {
    return this.game.world.industries.find((i) => i.id === id);
  }

  endName(end: SubsidyEnd): string {
    return (end.kind === 'town' ? this.town(end.id)?.name : this.industry(end.id)?.name) ?? '?';
  }

  // Střed zdroje nebo cíle na mapě
  endPosition(end: SubsidyEnd): { x: number; y: number } | null {
    if (end.kind === 'town') {
      const town = this.town(end.id);
      return town ? { x: town.x + 0.5, y: town.y + 0.5 } : null;
    }
    const industry = this.industry(end.id);
    return industry ? { x: industry.x + INDUSTRY_SIZE / 2, y: industry.y + INDUSTRY_SIZE / 2 } : null;
  }

  // „Přeprava uhlí z Dolu Kladno do Elektrárny Brno“ bez skloňování názvů: „Přeprava uhlí: Důl → Elektrárna“
  describe(subsidy: Subsidy): string {
    return `Přeprava ${CARGOS[subsidy.cargo].genitive}: ${this.endName(subsidy.from)} → ${this.endName(subsidy.to)}`;
  }

  untilText(subsidy: Subsidy): string {
    return formatDate(monthStart(subsidy.until));
  }

  // Leží zdroj nebo cíl v dosahu stanice?
  covers(station: Station, end: SubsidyEnd): boolean {
    if (end.kind === 'town') return this.game.passengers.townsInReach(station).some((t) => t.id === end.id);
    return this.game.freight.industriesInReach(station).some((i) => i.id === end.id);
  }

  // Příplatek za dodávku nákladu naloženého na stanici originId a vyloženého na stanici station.
  // První dodávka dotaci udělí (a už se jí platí). Vrací částku navíc k základnímu jízdnému.
  bonus(cargo: Cargo, originId: number, station: Station, income: number): number {
    if (income <= 0) return 0;
    const origin = this.game.world.rail.stations.find((s) => s.id === originId);
    if (!origin || origin.id === station.id) return 0;
    const subsidy = this.list.find(
      (s) => s.cargo === cargo && this.covers(origin, s.from) && this.covers(station, s.to),
    );
    if (!subsidy) return 0;
    if (!subsidy.awarded) {
      subsidy.awarded = true;
      subsidy.until = monthIndex(this.game.clock.date) + SUBSIDY_DURATION_MONTHS;
      this.game.news(
        `Dotace udělena: ${this.describe(subsidy)}. ${this.game.companyName} dostane ` +
          `${multiplierText(this.multiplier)} jízdného do ${this.untilText(subsidy)}.`,
        this.endPosition(subsidy.to) ?? station,
      );
      this.game.events.emit('subsidiesChanged');
    }
    return Math.round(income * (this.multiplier - 1));
  }

  private monthly(): void {
    const now = monthIndex(this.game.clock.date);
    let changed = false;
    for (const subsidy of [...this.list]) {
      const gone = !this.endPosition(subsidy.from) || !this.endPosition(subsidy.to);
      if (!gone && subsidy.until > now) continue;
      this.list.splice(this.list.indexOf(subsidy), 1);
      changed = true;
      const text = this.describe(subsidy);
      if (gone) this.game.news(`Dotace zrušena (zdroj nebo cíl zanikl): ${text}.`);
      else if (subsidy.awarded) this.game.news(`Dotace skončila: ${text}.`, this.endPosition(subsidy.to) ?? undefined);
      else this.game.news(`Nabídka dotace vypršela: ${text}.`, this.endPosition(subsidy.from) ?? undefined);
    }
    if (this.offers.length < SUBSIDY_MAX_OFFERS && this.rng.chance(SUBSIDY_OFFER_CHANCE))
      changed = this.offer() || changed;
    if (changed) this.game.events.emit('subsidiesChanged');
  }

  // Zkusí vytvořit novou nabídku; vrací, zda se povedlo
  offer(): boolean {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = this.rng.chance(0.4) ? this.townCandidate() : this.freightCandidate();
      if (!candidate) continue;
      const duplicate = this.list.some(
        (s) => s.cargo === candidate.cargo && sameEnd(s.from, candidate.from) && sameEnd(s.to, candidate.to),
      );
      if (duplicate) continue;
      const subsidy: Subsidy = {
        id: this.nextId++,
        ...candidate,
        until: monthIndex(this.game.clock.date) + SUBSIDY_OFFER_MONTHS,
        awarded: false,
      };
      this.list.push(subsidy);
      this.game.news(
        `Nabídka dotace: ${this.describe(subsidy)}. Kdo první doveze, dostane ${multiplierText(this.multiplier)} ` +
          `jízdného na ${SUBSIDY_DURATION_MONTHS / 12} rok. Nabídka platí do ${this.untilText(subsidy)}.`,
        this.endPosition(subsidy.from) ?? undefined,
      );
      return true;
    }
    return false;
  }

  private inRange(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    return distance >= SUBSIDY_MIN_DISTANCE && distance <= SUBSIDY_MAX_DISTANCE;
  }

  // Cestující nebo pošta mezi dvěma většími městy
  private townCandidate(): Omit<Subsidy, 'id' | 'until' | 'awarded'> | null {
    const towns = this.game.world.towns.filter((t) => t.population >= SUBSIDY_MIN_POPULATION);
    if (towns.length < 2) return null;
    const from = this.rng.pick(towns);
    const targets = towns.filter((t) => t !== from && this.inRange(t, from));
    if (targets.length === 0) return null;
    const to = this.rng.pick(targets);
    const cargo: Cargo = this.rng.chance(0.75) ? 'passengers' : 'mail';
    return { cargo, from: { kind: 'town', id: from.id }, to: { kind: 'town', id: to.id } };
  }

  // Náklad ze závodu, odkud se zatím odváží málo, do závodu nebo města, které ho vykupuje
  private freightCandidate(): Omit<Subsidy, 'id' | 'until' | 'awarded'> | null {
    const { industries, towns } = this.game.world;
    const sources = industries.filter((i) => {
      const produces = INDUSTRY_TYPES[i.kind].produces;
      return produces && i.production > 0 && i.lastTransported / i.production <= SUBSIDY_MAX_TRANSPORTED;
    });
    if (sources.length === 0) return null;
    const from = this.rng.pick(sources);
    const cargo = INDUSTRY_TYPES[from.kind].produces as FreightType;
    const at = this.endPosition({ kind: 'industry', id: from.id })!;
    const targets: SubsidyEnd[] = [
      ...industries
        .filter((i) => i !== from && INDUSTRY_TYPES[i.kind].accepts.includes(cargo))
        .filter((i) => this.inRange(this.endPosition({ kind: 'industry', id: i.id })!, at))
        .map((i): SubsidyEnd => ({ kind: 'industry', id: i.id })),
      ...(TOWN_ACCEPTS.includes(cargo)
        ? towns
            .filter((t) => t.population >= SUBSIDY_MIN_POPULATION && this.inRange(t, at))
            .map((t): SubsidyEnd => ({ kind: 'town', id: t.id }))
        : []),
    ];
    if (targets.length === 0) return null;
    return { cargo, from: { kind: 'industry', id: from.id }, to: this.rng.pick(targets) };
  }

  // Obnova z uložení; neplatné položky se zahodí
  restore(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    const data = value as Record<string, unknown>;
    const validEnd = (end: unknown): end is SubsidyEnd =>
      typeof end === 'object' &&
      end !== null &&
      ((end as SubsidyEnd).kind === 'town' || (end as SubsidyEnd).kind === 'industry') &&
      Number.isInteger((end as SubsidyEnd).id);
    this.list = (Array.isArray(data.list) ? data.list : [])
      .filter(
        (s): s is Subsidy =>
          typeof s === 'object' &&
          s !== null &&
          Number.isInteger(s.id) &&
          isCargo(s.cargo) &&
          validEnd(s.from) &&
          validEnd(s.to) &&
          Number.isInteger(s.until) &&
          typeof s.awarded === 'boolean',
      )
      .map((s) => ({
        id: s.id,
        cargo: s.cargo,
        from: { ...s.from },
        to: { ...s.to },
        until: s.until,
        awarded: s.awarded,
      }));
    this.nextId = Math.max(
      Number.isInteger(data.nextId) ? (data.nextId as number) : 1,
      ...this.list.map((s) => s.id + 1),
    );
    if (isSubsidyMultiplier(data.multiplier)) this.multiplier = data.multiplier;
    if (Number.isInteger(data.rngState)) this.rng.state = (data.rngState as number) >>> 0;
  }

  serialize(): { list: Subsidy[]; nextId: number; multiplier: SubsidyMultiplier; rngState: number } {
    return { list: this.list, nextId: this.nextId, multiplier: this.multiplier, rngState: this.rng.state };
  }
}

// Text částky příplatku do zprávy o dodávce
export function bonusText(bonus: number): string {
  return bonus > 0 ? ` (z toho dotace ${formatMoney(bonus)})` : '';
}
