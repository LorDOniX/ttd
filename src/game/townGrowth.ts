import {
  TOWN_ACTIVE_STATION_DAYS,
  TOWN_GROWTH_BASE,
  TOWN_GROWTH_MAX_STATIONS,
  TOWN_GROWTH_PER_STATION,
  TOWN_SUPPLY_BONUS,
} from './balance';
import type { Cargo } from './cargo';
import type { Game } from './game';
import type { Station } from '../world/rail';
import { growTownBy, townCapacity, type Town, type TownSupply } from '../world/town';

// Náklad, který městu pomáhá růst
export const TOWN_SUPPLY_CARGOS = ['passengers', 'mail', 'food', 'goods'] as const;
type SupplyCargo = (typeof TOWN_SUPPLY_CARGOS)[number];

export function emptySupply(): TownSupply {
  return { passengers: 0, mail: 0, food: 0, goods: 0 };
}

function isSupplyCargo(cargo: Cargo): cargo is SupplyCargo {
  return (TOWN_SUPPLY_CARGOS as readonly string[]).includes(cargo);
}

// Růst měst jako v OpenTTD: rychleji roste město s více obsluhovanými stanicemi a s dovozem cestujících,
// pošty, potravin a zboží; bez obsluhy skoro stojí. Přírůstek se počítá každý měsíc
export class TownGrowth {
  // Testy s umělými městy (obyvatel víc než budov) růst vypínají; neukládá se
  enabled = true;

  constructor(private readonly game: Game) {
    game.clock.events.on('month', () => this.monthly());
  }

  // Doručený náklad na stanici se připíše městům v jejím dosahu podle jejich podílu
  recordDelivery(station: Station, cargo: Cargo, amount: number): void {
    if (!isSupplyCargo(cargo) || amount <= 0) return;
    const shares = this.game.passengers.townShares(station);
    let total = 0;
    for (const share of shares.values()) total += share;
    if (total <= 0) return;
    for (const [town, share] of shares) {
      const supplied = (town.supplied ??= emptySupply());
      supplied[cargo] += (amount * share) / total;
    }
  }

  // Stanice s městem v dosahu, kde v posledních dnech stavělo vozidlo
  activeStations(town: Town): number {
    const now = this.game.clock.now;
    return this.game.world.rail.primaries().filter((station) => {
      if (!this.game.passengers.townsInReach(station).includes(town)) return false;
      const lastVisit = Math.max(...Object.values(station.ratings).map((r) => r.lastVisit));
      return lastVisit >= 0 && now - lastVisit <= TOWN_ACTIVE_STATION_DAYS;
    }).length;
  }

  // Roční tempo růstu: základ, aktivní stanice a dovoz za minulý měsíc
  annualRate(town: Town): number {
    const stations = Math.min(TOWN_GROWTH_MAX_STATIONS, this.activeStations(town));
    let rate = TOWN_GROWTH_BASE + stations * TOWN_GROWTH_PER_STATION;
    if (stations === 0) return rate;
    const supply = town.lastSupplied ?? emptySupply();
    const thousands = Math.max(0.2, town.population / 1000);
    for (const cargo of TOWN_SUPPLY_CARGOS) {
      const { per1000, bonus } = TOWN_SUPPLY_BONUS[cargo];
      if (supply[cargo] / thousands >= per1000) rate += bonus;
    }
    return rate;
  }

  private monthly(): void {
    const { game } = this;
    let changed = false;
    game.authority.quietly(() => {
      for (const town of game.world.towns) {
        const rate = this.annualRate(town);
        town.lastSupplied = town.supplied ?? emptySupply();
        town.supplied = emptySupply();
        town.served = this.activeStations(town) > 0;
        if (!this.enabled) continue;
        const before = town.buildings.length;
        growTownBy(game.world.map, town, game.clock.date.year, game.rng, rate / 12);
        if (town.buildings.length !== before) changed = true;
      }
    });
    // Budovy se přestaví jen tehdy, když nějaké přibyly
    if (changed) game.events.emit('townsChanged');
  }

  // Kapacita budov pro přehled v okně města
  capacity(town: Town): number {
    return townCapacity(town);
  }
}
