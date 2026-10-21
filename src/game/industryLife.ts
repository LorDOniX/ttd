import {
  INDUSTRY_CHANGE_CHANCE,
  INDUSTRY_CHANGE_FACTOR,
  INDUSTRY_GROWTH_CHANCE,
  INDUSTRY_IDLE_CLOSE_CHANCE,
  INDUSTRY_IDLE_YEARS,
  INDUSTRY_MAX_GROWTH,
  INDUSTRY_WELL_SERVED,
  NEW_INDUSTRY_CHANCE_PER_TILE,
} from './balance';
import type { Game } from './game';
import { INDUSTRY_TYPES, industryTiles, tryPlaceIndustry, type Industry, type IndustryKind } from '../world/industry';
import { TileType } from '../world/map';

const DAYS_PER_YEAR = 365;
const FOUND_ATTEMPTS = 60;

// Živý průmysl: výroba kolísá podle obsluhy, závody zanikají a vznikají nové
export class IndustryLife {
  constructor(private readonly game: Game) {
    game.clock.events.on('month', () => this.monthly());
  }

  private monthly(): void {
    // Kopie, protože zánik závod ze seznamu odebere
    for (const industry of this.game.world.industries.slice()) {
      const type = INDUSTRY_TYPES[industry.kind];
      if (type.production) this.changeProduction(industry);
      else if (type.produces) this.closeIfIdle(industry);
    }
    this.found();
  }

  // Těžba občas stoupne nebo klesne; z vytěženého závodu se stane zase louka
  private changeProduction(industry: Industry): void {
    const { game } = this;
    const range = INDUSTRY_TYPES[industry.kind].production;
    if (!range || !game.rng.chance(INDUSTRY_CHANGE_CHANCE)) return;
    const share = industry.production > 0 ? industry.lastTransported / industry.production : 0;
    const growth = share >= INDUSTRY_WELL_SERVED ? INDUSTRY_GROWTH_CHANCE.served : INDUSTRY_GROWTH_CHANCE.unserved;
    const grows = game.rng.chance(growth);
    const changed = grows ? industry.production * INDUSTRY_CHANGE_FACTOR : industry.production / INDUSTRY_CHANGE_FACTOR;
    if (changed < range.min / 2) {
      this.close(industry, `${industry.name}: zásoby jsou vyčerpané, závod se zavírá.`);
      return;
    }
    const production = Math.round(Math.min(changed, range.max * INDUSTRY_MAX_GROWTH));
    if (production === industry.production) return;
    industry.production = production;
    // O závodech, kam firma nejezdí, zprávy nechodí
    if (game.freight.pickupStations(industry).length === 0) return;
    game.news(`${industry.name}: výroba ${grows ? 'stoupla' : 'klesla'} na ${production} t měsíčně.`);
  }

  private closeIfIdle(industry: Industry): void {
    const idleDays = this.game.clock.day - industry.lastDelivery;
    if (idleDays < INDUSTRY_IDLE_YEARS * DAYS_PER_YEAR || !this.game.rng.chance(INDUSTRY_IDLE_CLOSE_CHANCE)) return;
    this.close(industry, `${industry.name}: bez dodávek surovin se závod zavírá.`);
  }

  private close(industry: Industry, text: string): void {
    const { world } = this.game;
    world.industries.splice(world.industries.indexOf(industry), 1);
    for (const t of industryTiles(industry)) world.map.set(t.x, t.y, TileType.Grass);
    this.game.news(text);
    this.game.events.emit('industriesChanged');
    this.game.events.emit('stationsChanged');
  }

  // Nový závod vybraného druhu; vzácnější druhy vznikají méně často
  private found(): void {
    const { game } = this;
    const { map, towns, industries } = game.world;
    if (!game.rng.chance(map.width * map.height * NEW_INDUSTRY_CHANCE_PER_TILE)) return;
    const kinds = Object.keys(INDUSTRY_TYPES) as IndustryKind[];
    const weights = kinds.map((kind) => 1 / INDUSTRY_TYPES[kind].tilesPerIndustry);
    let r = game.rng.next() * weights.reduce((a, b) => a + b, 0);
    const kind = kinds.find((_, i) => (r -= weights[i]) < 0) ?? kinds[0];
    for (let attempt = 0; attempt < FOUND_ATTEMPTS; attempt++) {
      const industry = tryPlaceIndustry(map, towns, industries, kind, game.rng, game.clock.day);
      if (!industry) continue;
      industries.push(industry);
      game.news(`Zahájen provoz: ${industry.name}.`);
      game.events.emit('industriesChanged');
      game.events.emit('stationsChanged');
      return;
    }
  }
}
