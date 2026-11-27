import {
  INDUSTRY_CHANGE_CHANCE,
  INDUSTRY_CHANGE_FACTOR,
  INDUSTRY_HISTORY_MONTHS,
  SMOOTH_CHANGE_CHANCE,
  SMOOTH_CHANGE_MAX,
  SMOOTH_CHANGE_MIN,
  INDUSTRY_FUND_COST,
  INDUSTRY_GROWTH_CHANCE,
  INDUSTRY_IDLE_CLOSE_CHANCE,
  INDUSTRY_IDLE_YEARS,
  INDUSTRY_MAX_GROWTH,
  INDUSTRY_WELL_SERVED,
  NEW_INDUSTRY_CHANCE_PER_TILE,
} from './balance';
import type { Game } from './game';
import { formatMoney } from './game';
import {
  INDUSTRY_SIZE,
  INDUSTRY_TYPES,
  industrySiteProblem,
  industryTiles,
  placeIndustryAt,
  tryPlaceIndustry,
  type Industry,
  type IndustryKind,
} from '../world/industry';
import { TileType } from '../world/map';

const DAYS_PER_YEAR = 365;

// Změny výroby jako nastavení „Economy“ v OpenTTD: plynulá (malé změny každý měsíc), původní (skoky
// ×1,5 / ÷1,5) a zmrazená (výroba se nemění, závody nezanikají ani nevznikají)
export type EconomySetting = 'smooth' | 'original' | 'frozen';

export const ECONOMY_SETTINGS: readonly EconomySetting[] = ['smooth', 'original', 'frozen'];

export const ECONOMY_LABELS: Record<EconomySetting, string> = {
  smooth: 'Plynulá',
  original: 'Původní',
  frozen: 'Zmrazená',
};

export function isEconomySetting(value: unknown): value is EconomySetting {
  return typeof value === 'string' && (ECONOMY_SETTINGS as readonly string[]).includes(value);
}
const FOUND_ATTEMPTS = 60;

const centre = (industry: Industry): { x: number; y: number } => ({
  x: industry.x + INDUSTRY_SIZE / 2,
  y: industry.y + INDUSTRY_SIZE / 2,
});

// Živý průmysl: výroba kolísá podle obsluhy, závody zanikají a vznikají nové
export class IndustryLife {
  constructor(private readonly game: Game) {
    game.clock.events.on('month', () => this.monthly());
  }

  private monthly(): void {
    const { economy } = this.game;
    // Kopie, protože zánik závod ze seznamu odebere
    for (const industry of this.game.world.industries.slice()) {
      // Ohlášené uzavření proběhne měsíc po oznámení
      if (industry.closing) {
        this.close(industry, `${industry.name} ukončil provoz.`);
        continue;
      }
      this.record(industry);
      if (economy === 'frozen') continue;
      const type = INDUSTRY_TYPES[industry.kind];
      if (type.production) {
        if (economy === 'smooth') this.smoothChange(industry);
        else this.changeProduction(industry);
      } else if (type.produces) this.closeIfIdle(industry);
    }
    if (economy !== 'frozen') this.found();
  }

  // Výroba a odvoz uzavřeného měsíce do historie závodu (Freight už měsíc uzavřel)
  private record(industry: Industry): void {
    const type = INDUSTRY_TYPES[industry.kind];
    if (!type.produces) return;
    const history = [
      ...(industry.history ?? []),
      { production: industry.production, transported: industry.lastTransported },
    ];
    industry.history = history.slice(-INDUSTRY_HISTORY_MONTHS);
  }

  // Plynulá ekonomika (OpenTTD): s malou šancí každý měsíc výroba stoupne nebo klesne o 4–23 %;
  // dobře obsloužený závod (odvoz aspoň 60 %) spíš roste. Vyčerpaný závod ohlásí uzavření.
  private smoothChange(industry: Industry): void {
    const { game } = this;
    const range = INDUSTRY_TYPES[industry.kind].production;
    if (!range || !game.rng.chance(SMOOTH_CHANGE_CHANCE)) return;
    const share = industry.production > 0 ? industry.lastTransported / industry.production : 0;
    const grows = game.rng.chance(
      share >= INDUSTRY_WELL_SERVED ? INDUSTRY_GROWTH_CHANCE.served : INDUSTRY_GROWTH_CHANCE.unserved,
    );
    const percent = SMOOTH_CHANGE_MIN + game.rng.next() * (SMOOTH_CHANGE_MAX - SMOOTH_CHANGE_MIN);
    const step = Math.max(1, Math.round(industry.production * percent));
    const changed = industry.production + (grows ? step : -step);
    if (changed < range.min / 2) {
      this.announceClosure(industry, 'zásoby docházejí');
      return;
    }
    const production = Math.min(changed, Math.round(range.max * INDUSTRY_MAX_GROWTH));
    if (production === industry.production) return;
    industry.production = production;
    if (game.freight.pickupStations(industry).length === 0) return;
    game.news(
      `${industry.name}: výroba ${grows ? 'stoupla' : 'klesla'} o ${Math.round(percent * 100)} % na ${production} t měsíčně.`,
      centre(industry),
    );
  }

  // Závod ohlásí uzavření a zanikne na konci měsíce
  private announceClosure(industry: Industry, reason: string): void {
    if (industry.closing) return;
    industry.closing = true;
    this.game.news(`${industry.name} oznamuje brzké uzavření (${reason}).`, centre(industry));
    this.game.events.emit('industriesChanged');
  }

  // Původní ekonomika: těžba občas skokem stoupne nebo klesne; z vytěženého závodu se stane zase louka
  private changeProduction(industry: Industry): void {
    const { game } = this;
    const range = INDUSTRY_TYPES[industry.kind].production;
    if (!range || !game.rng.chance(INDUSTRY_CHANGE_CHANCE)) return;
    const share = industry.production > 0 ? industry.lastTransported / industry.production : 0;
    const growth = share >= INDUSTRY_WELL_SERVED ? INDUSTRY_GROWTH_CHANCE.served : INDUSTRY_GROWTH_CHANCE.unserved;
    const grows = game.rng.chance(growth);
    const changed = grows ? industry.production * INDUSTRY_CHANGE_FACTOR : industry.production / INDUSTRY_CHANGE_FACTOR;
    if (changed < range.min / 2) {
      this.announceClosure(industry, 'zásoby jsou vyčerpané');
      return;
    }
    const production = Math.round(Math.min(changed, range.max * INDUSTRY_MAX_GROWTH));
    if (production === industry.production) return;
    industry.production = production;
    // O závodech, kam firma nejezdí, zprávy nechodí
    if (game.freight.pickupStations(industry).length === 0) return;
    game.news(`${industry.name}: výroba ${grows ? 'stoupla' : 'klesla'} na ${production} t měsíčně.`, centre(industry));
  }

  private closeIfIdle(industry: Industry): void {
    const idleDays = this.game.clock.day - industry.lastDelivery;
    if (idleDays < INDUSTRY_IDLE_YEARS * DAYS_PER_YEAR || !this.game.rng.chance(INDUSTRY_IDLE_CLOSE_CHANCE)) return;
    this.announceClosure(industry, 'léta bez dodávek surovin');
  }

  private close(industry: Industry, text: string): void {
    const { world } = this.game;
    world.industries.splice(world.industries.indexOf(industry), 1);
    for (const t of industryTiles(industry)) world.map.set(t.x, t.y, TileType.Grass);
    this.game.news(text, centre(industry));
    this.game.events.emit('industriesChanged');
    this.game.events.emit('stationsChanged');
  }

  // Nový závod vybraného druhu; vzácnější druhy vznikají méně často
  private found(): void {
    const { game } = this;
    const { map, towns, industries } = game.world;
    const density = game.world.industryDensity ?? 1;
    if (!game.rng.chance(map.width * map.height * NEW_INDUSTRY_CHANCE_PER_TILE * density)) return;
    const kinds = Object.keys(INDUSTRY_TYPES) as IndustryKind[];
    const weights = kinds.map((kind) => 1 / INDUSTRY_TYPES[kind].tilesPerIndustry);
    let r = game.rng.next() * weights.reduce((a, b) => a + b, 0);
    const kind = kinds.find((_, i) => (r -= weights[i]) < 0) ?? kinds[0];
    for (let attempt = 0; attempt < FOUND_ATTEMPTS; attempt++) {
      const industry = game.authority.quietly(() =>
        tryPlaceIndustry(map, towns, industries, kind, game.rng, game.clock.day),
      );
      if (!industry) continue;
      industries.push(industry);
      game.news(`Zahájen provoz: ${industry.name}.`, centre(industry));
      game.events.emit('industriesChanged');
      game.events.emit('stationsChanged');
      return;
    }
  }

  // Hráčem založený závod s levým horním rohem (x, y); vrátí důvod, proč to nešlo
  fund(kind: IndustryKind, x: number, y: number, rotation: number): string | null {
    const { game } = this;
    const { map, towns, industries } = game.world;
    const problem = industrySiteProblem(map, towns, industries, kind, x, y);
    if (problem) return `${problem}.`;
    const cost = INDUSTRY_FUND_COST[kind];
    if (game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    const range = INDUSTRY_TYPES[kind].production;
    const production = range ? game.rng.int(range.min, range.max) : 0;
    const industry = placeIndustryAt(map, towns, industries, kind, x, y, rotation, production, game.clock.day);
    industries.push(industry);
    game.spend(cost, 'construction');
    game.news(`Firma založila závod: ${industry.name}.`, centre(industry));
    game.events.emit('industriesChanged');
    game.events.emit('stationsChanged');
    return null;
  }
}
