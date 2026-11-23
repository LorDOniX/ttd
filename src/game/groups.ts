// Skupiny vozidel jako v OpenTTD: hráč si vozidla jednoho druhu rozdělí do pojmenovaných skupin
// (např. podle linky nebo oblasti) a vidí jejich počet a zisk dohromady

export type GroupKind = 'train' | 'road' | 'air' | 'water';

export const GROUP_KINDS: readonly GroupKind[] = ['train', 'road', 'air', 'water'];

export interface VehicleGroup {
  id: number;
  kind: GroupKind;
  name: string;
}

// Co skupina potřebuje od vozidla (vlak, auto, letadlo, loď)
export interface Groupable {
  name: string;
  income: number;
  costs: number;
  lastIncome: number;
  lastCosts: number;
  // Skupina; bez údaje vozidlo do žádné nepatří
  group?: number;
}

export interface GroupStats {
  count: number;
  profit: number;
  lastProfit: number;
}

export function groupStats(vehicles: readonly Groupable[]): GroupStats {
  return {
    count: vehicles.length,
    profit: vehicles.reduce((sum, v) => sum + v.income - v.costs, 0),
    lastProfit: vehicles.reduce((sum, v) => sum + v.lastIncome - v.lastCosts, 0),
  };
}

export const MAX_GROUP_NAME = 40;

export class VehicleGroups {
  list: VehicleGroup[] = [];
  nextId = 1;

  constructor(
    // Vozidla daného druhu (kvůli odebrání ze zrušené skupiny)
    private readonly vehiclesOf: (kind: GroupKind) => Groupable[],
    private readonly changed: () => void,
  ) {}

  of(kind: GroupKind): VehicleGroup[] {
    return this.list.filter((g) => g.kind === kind);
  }

  byId(id: number | undefined): VehicleGroup | undefined {
    return id === undefined ? undefined : this.list.find((g) => g.id === id);
  }

  // Nová skupina s volným jménem „Skupina N“; vrací ji
  create(kind: GroupKind, name?: string): VehicleGroup {
    const taken = new Set(this.of(kind).map((g) => g.name));
    let n = this.of(kind).length + 1;
    while (taken.has(`Skupina ${n}`)) n++;
    const group = { id: this.nextId++, kind, name: cleanName(name) || `Skupina ${n}` };
    this.list.push(group);
    this.changed();
    return group;
  }

  rename(group: VehicleGroup, name: string): string | null {
    const clean = cleanName(name);
    if (!clean) return 'Skupina potřebuje jméno.';
    group.name = clean;
    this.changed();
    return null;
  }

  // Zrušení skupiny; její vozidla zůstanou bez skupiny
  remove(group: VehicleGroup): void {
    for (const v of this.vehiclesOf(group.kind)) if (v.group === group.id) delete v.group;
    this.list.splice(this.list.indexOf(group), 1);
    this.changed();
  }

  // Přiřadí vozidlo do skupiny jeho druhu, nebo (null) ho ze skupiny vyjme
  assign(vehicle: Groupable, kind: GroupKind, groupId: number | null): string | null {
    if (groupId === null) {
      delete vehicle.group;
    } else {
      const group = this.byId(groupId);
      if (!group || group.kind !== kind) return 'Taková skupina neexistuje.';
      vehicle.group = group.id;
    }
    this.changed();
    return null;
  }

  members(group: VehicleGroup): Groupable[] {
    return this.vehiclesOf(group.kind).filter((v) => v.group === group.id);
  }

  // Obnova z uložení: neplatné skupiny se zahodí, vozidla z neexistujících skupin se vyjmou
  restore(value: unknown): void {
    const data = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    this.list = (Array.isArray(data.list) ? data.list : [])
      .filter(
        (g): g is VehicleGroup =>
          typeof g === 'object' &&
          g !== null &&
          Number.isInteger(g.id) &&
          GROUP_KINDS.includes(g.kind) &&
          typeof g.name === 'string',
      )
      .map((g) => ({ id: g.id, kind: g.kind, name: cleanName(g.name) || 'Skupina' }));
    this.nextId = Math.max(
      Number.isInteger(data.nextId) ? (data.nextId as number) : 1,
      ...this.list.map((g) => g.id + 1),
    );
    for (const kind of GROUP_KINDS) {
      for (const v of this.vehiclesOf(kind)) {
        if (v.group !== undefined && this.byId(v.group)?.kind !== kind) delete v.group;
      }
    }
  }

  serialize(): { list: VehicleGroup[]; nextId: number } {
    return { list: this.list, nextId: this.nextId };
  }
}

function cleanName(name: string | undefined): string {
  return (name ?? '').trim().slice(0, MAX_GROUP_NAME);
}
