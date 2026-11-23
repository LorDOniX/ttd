import { CARGOS, type Cargo } from './cargo';

// Přestavba aut, lodí a letadel jako v OpenTTD: jen v depu (garáži, loděnici, hangáru), na náklad
// podobné povahy jako u modelu. Sypké substráty, kusové zboží, tekutiny; autobus a osobní loď přestavět nejde,
// letadlo jen mezi cestujícími a poštou.
const REFIT_CLASSES: readonly (readonly Cargo[])[] = [
  ['coal', 'iron-ore', 'grain', 'wood'],
  ['steel', 'goods', 'food', 'mail'],
  ['oil'],
];

export type RefitVehicle = 'road' | 'ship' | 'air';

// Na co jde vozidlo s nákladem modelu base přestavět (včetně base); jediná položka = přestavět nejde
export function refitOptions(kind: RefitVehicle, base: Cargo): Cargo[] {
  if (kind === 'air') return base === 'passengers' || base === 'mail' ? ['passengers', 'mail'] : [base];
  if (base === 'passengers') return [base];
  const group = REFIT_CLASSES.find((c) => c.includes(base));
  return group ? [base, ...group.filter((c) => c !== base)] : [base];
}

// Kapacita po přestavbě: v poměru kapacit vagonu (pošta a zboží zaberou víc místa než uhlí)
export function refitCapacity(capacity: number, base: Cargo, cargo: Cargo): number {
  if (cargo === base) return capacity;
  return Math.max(1, Math.round((capacity * CARGOS[cargo].wagonCapacity) / CARGOS[base].wagonCapacity));
}

// Cena přestavby: 5 % ceny vozidla (zaokrouhleno na tisíce, aspoň 2 000 Kč)
export function vehicleRefitCost(price: number): number {
  return Math.max(2000, Math.round((price * 0.05) / 1000) * 1000);
}
