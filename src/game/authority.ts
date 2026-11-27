import {
  AUTHORITY_BUILDING_DOWN,
  AUTHORITY_PERMIT,
  AUTHORITY_RATING_INITIAL,
  AUTHORITY_RATING_MAX,
  AUTHORITY_RATING_MIN,
  AUTHORITY_ROAD_DOWN,
  AUTHORITY_SERVED_DAYS,
  AUTHORITY_STATION_SERVED,
  AUTHORITY_STATION_UNSERVED,
  AUTHORITY_TREE_DOWN,
  AUTHORITY_TREE_UP,
  AUTHORITY_TREE_UP_MAX,
  AUTHORITY_ZONE_MARGIN,
  STATUE_COST,
  STATUE_STATION_BONUS,
} from './balance';
import { formatMoney, type Game } from './game';
import { TileType, type TilePos } from '../world/map';
import type { Town } from '../world/town';

// Stupně hodnocení jako v OpenTTD
export const AUTHORITY_TIERS: readonly { max: number; label: string }[] = [
  { max: -400, label: 'Hrozné' },
  { max: -200, label: 'Velmi špatné' },
  { max: 0, label: 'Špatné' },
  { max: 200, label: 'Průměrné' },
  { max: 400, label: 'Dobré' },
  { max: 600, label: 'Velmi dobré' },
  { max: 800, label: 'Vynikající' },
  { max: Infinity, label: 'Výjimečné' },
];

export function ratingLabel(rating: number): string {
  return AUTHORITY_TIERS.find((t) => rating <= t.max)!.label;
}

// Poloměr obvodu města (dlaždice od středu)
export function zoneRadius(town: Town): number {
  return town.radius * Math.max(1, ...town.shape) + AUTHORITY_ZONE_MARGIN;
}

// Místní úřad jako v OpenTTD: každé město hodnotí společnost podle toho, co v jeho obvodu dělá
export class LocalAuthority {
  private readonly ratings = new Map<number, number>();
  // Sochy společnosti: město → dlaždice
  readonly statues = new Map<number, TilePos>();
  // Změny mapy, za které společnost nemůže (růst měst, zakládání průmyslu hrou)
  private quiet = 0;

  constructor(private readonly game: Game) {
    game.world.map.onTreesCleared = (x, y) => {
      if (this.quiet === 0) this.change(this.townAt(x, y), AUTHORITY_TREE_DOWN);
    };
    game.clock.events.on('month', () => this.monthly());
  }

  rating(town: Town): number {
    return this.ratings.get(town.id) ?? AUTHORITY_RATING_INITIAL;
  }

  // Město, do jehož obvodu dlaždice patří (nejbližší střed), nebo undefined
  townAt(x: number, y: number): Town | undefined {
    let best: Town | undefined;
    let bestDistance = Infinity;
    for (const town of this.game.world.towns) {
      const d = Math.hypot(town.x - x, town.y - y);
      if (d <= zoneRadius(town) && d < bestDistance) {
        best = town;
        bestDistance = d;
      }
    }
    return best;
  }

  // Změní hodnocení v mezích; floor/ceiling omezují změnu jako v OpenTTD (výsadba nezvedne nad strop)
  change(town: Town | undefined, delta: number, ceiling = AUTHORITY_RATING_MAX): void {
    if (!town || delta === 0) return;
    const now = this.rating(town);
    const next =
      delta > 0 ? Math.max(now, Math.min(ceiling, now + delta)) : Math.max(AUTHORITY_RATING_MIN, now + delta);
    if (next === now) return;
    this.ratings.set(town.id, next);
    this.game.events.emit('townsChanged');
  }

  // Provede změny mapy bez vlivu na hodnocení (růst města, hra sama)
  quietly<T>(run: () => T): T {
    this.quiet++;
    try {
      return run();
    } finally {
      this.quiet--;
    }
  }

  // Proč místní úřad akci na dlaždici odmítne (hodnocení pod hranicí), nebo null
  refusal(x: number, y: number, what: string): string | null {
    const town = this.townAt(x, y);
    if (!town || this.rating(town) > AUTHORITY_PERMIT) return null;
    return `Místní úřad města ${town.name} odmítá ${what}: hodnocení společnosti je ${ratingLabel(this.rating(town)).toLowerCase()}.`;
  }

  buildingDemolished(x: number, y: number): void {
    this.change(this.townAt(x, y), AUTHORITY_BUILDING_DOWN);
  }

  townRoadDemolished(x: number, y: number): void {
    this.change(this.townAt(x, y), AUTHORITY_ROAD_DOWN);
  }

  treePlanted(x: number, y: number): void {
    this.change(this.townAt(x, y), AUTHORITY_TREE_UP, AUTHORITY_TREE_UP_MAX);
  }

  // Měsíčně: každá stanice v obvodu města podle toho, jestli ji vozidla obsluhují
  private monthly(): void {
    const now = this.game.clock.now;
    for (const station of this.game.world.rail.primaries()) {
      const town = this.townAt(station.x, station.y);
      if (!town) continue;
      const lastVisit = Math.max(...Object.values(station.ratings).map((r) => r.lastVisit));
      const served = lastVisit >= 0 && now - lastVisit <= AUTHORITY_SERVED_DAYS;
      this.change(town, served ? AUTHORITY_STATION_SERVED : AUTHORITY_STATION_UNSERVED);
    }
  }

  // Bonus hodnocení stanic ve městě se sochou společnosti
  stationBonus(station: { x: number; y: number }): number {
    const town = this.townAt(station.x, station.y);
    return town && this.statues.has(town.id) ? STATUE_STATION_BONUS : 0;
  }

  // Postaví sochu na volné rovné trávě co nejblíž středu města; vrací chybu, nebo null
  buildStatue(town: Town): string | null {
    const { game } = this;
    const { map } = game.world;
    if (this.statues.has(town.id)) return `Ve městě ${town.name} už vaše socha stojí.`;
    if (game.money < STATUE_COST) return `Nedostatek peněz (${formatMoney(STATUE_COST)}).`;
    const radius = Math.ceil(zoneRadius(town));
    let spot: TilePos | null = null;
    let best = Infinity;
    for (let y = town.y - radius; y <= town.y + radius; y++) {
      for (let x = town.x - radius; x <= town.x + radius; x++) {
        if (!map.inBounds(x, y) || !map.isType(x, y, TileType.Grass) || map.isBridged(x, y) || !map.isFlat(x, y))
          continue;
        // U silnice, aby socha stála ve městě a ne na poli
        const byRoad = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => map.inBounds(x + dx, y + dy) && map.isType(x + dx, y + dy, TileType.Road));
        const d = Math.hypot(x - town.x, y - town.y) + (byRoad ? 0 : 100);
        if (d < best) {
          best = d;
          spot = { x, y };
        }
      }
    }
    if (!spot) return `Ve městě ${town.name} není pro sochu volné místo.`;
    game.spend(STATUE_COST, 'construction');
    map.set(spot.x, spot.y, TileType.Statue);
    map.setOwner(spot.x, spot.y, town.id);
    this.statues.set(town.id, spot);
    game.news(`Ve městě ${town.name} stojí socha společnosti ${game.companyName}.`, {
      x: spot.x + 0.5,
      y: spot.y + 0.5,
    });
    game.events.emit('townsChanged');
    return null;
  }

  serialize(): { ratings: Record<number, number>; statues: Record<number, TilePos> } {
    return { ratings: Object.fromEntries(this.ratings), statues: Object.fromEntries(this.statues) };
  }

  restore(value: unknown): void {
    this.ratings.clear();
    this.statues.clear();
    if (typeof value !== 'object' || value === null) return;
    const data = value as { ratings?: unknown; statues?: unknown };
    const towns = new Set(this.game.world.towns.map((t) => t.id));
    if (typeof data.ratings === 'object' && data.ratings !== null) {
      for (const [id, rating] of Object.entries(data.ratings)) {
        if (towns.has(Number(id)) && typeof rating === 'number' && Number.isFinite(rating)) {
          this.ratings.set(Number(id), Math.max(AUTHORITY_RATING_MIN, Math.min(AUTHORITY_RATING_MAX, rating)));
        }
      }
    }
    // Socha platí jen tam, kde na mapě opravdu stojí
    if (typeof data.statues === 'object' && data.statues !== null) {
      const { map } = this.game.world;
      for (const [id, tile] of Object.entries(data.statues as Record<string, unknown>)) {
        const t = tile as Partial<TilePos> | null;
        if (!towns.has(Number(id)) || !t || !Number.isInteger(t.x) || !Number.isInteger(t.y)) continue;
        if (map.inBounds(t.x!, t.y!) && map.isType(t.x!, t.y!, TileType.Statue)) {
          this.statues.set(Number(id), { x: t.x!, y: t.y! });
        }
      }
    }
  }
}
