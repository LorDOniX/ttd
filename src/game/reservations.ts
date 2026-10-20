import type { Train } from './trains';
import { segmentIndexAt, segmentLength } from '../world/route';

// Rezervace kolejí před vlaky: vlak smí vjet jen na dlaždice, které drží sám.
// Úsek se rezervuje celý najednou – do nejbližšího místa, kde lze bezpečně čekat, jinak až do cíle.
export class Reservations {
  // Dlaždice → id vlaku, který ji drží
  private readonly owners = new Map<number, number>();
  private readonly held = new Map<number, Set<number>>();
  // Index kusu trasy, po který (bez něj) má vlak rezervováno
  private readonly reach = new Map<number, number>();

  constructor(
    private readonly width: number,
    private readonly isWaitPoint: (x: number, y: number) => boolean,
  ) {}

  has(train: Train): boolean {
    return this.reach.has(train.id);
  }

  ownerAt(x: number, y: number): number | undefined {
    return this.owners.get(y * this.width + x);
  }

  blocks(train: Train, x: number, y: number): boolean {
    const owner = this.ownerAt(x, y);
    return owner !== undefined && owner !== train.id;
  }

  fullyReserved(train: Train): boolean {
    return (this.reach.get(train.id) ?? 0) >= train.path.length;
  }

  // Po změně trasy drží vlak jen kusy pod sebou
  reset(train: Train, tail: number): void {
    // Hlava stojící přesně na hranici kusů patří ještě k předchozímu kusu
    this.reach.set(train.id, segmentIndexAt(train.path, Math.max(0, train.pos - 1e-6)) + 1);
    this.sync(train, tail);
  }

  release(train: Train): void {
    for (const tile of this.held.get(train.id) ?? []) {
      if (this.owners.get(tile) === train.id) this.owners.delete(tile);
    }
    this.held.delete(train.id);
    this.reach.delete(train.id);
  }

  // Drží kusy od konce vlaku po rezervovaný konec, dlaždice za vlakem uvolní
  sync(train: Train, tail: number): void {
    const end = this.reach.get(train.id) ?? 0;
    const wanted = new Set<number>();
    for (let i = segmentIndexAt(train.path, Math.max(0, tail)); i < end; i++) {
      wanted.add(this.key(train, i));
    }
    const held = this.held.get(train.id) ?? new Set<number>();
    for (const tile of held) {
      if (!wanted.has(tile) && this.owners.get(tile) === train.id) this.owners.delete(tile);
    }
    const next = new Set<number>();
    for (const tile of wanted) {
      // Cizí dlaždici pod vlakem (např. ze staršího uložení) nepřebírá
      if (!this.owners.has(tile)) this.owners.set(tile, train.id);
      if (this.owners.get(tile) === train.id) next.add(tile);
    }
    this.held.set(train.id, next);
  }

  // Zkusí zarezervovat další úsek; vrací false, když je obsazený nebo už není kam
  extend(train: Train): boolean {
    const { path } = train;
    const start = this.reach.get(train.id) ?? 0;
    if (start >= path.length) return false;
    let end = start;
    while (end < path.length - 1 && !this.isWaitPoint(path[end].x, path[end].y)) end++;
    for (let i = start; i <= end; i++) {
      if (this.blocks(train, path[i].x, path[i].y)) return false;
    }
    const held = this.held.get(train.id) ?? new Set<number>();
    for (let i = start; i <= end; i++) {
      const tile = this.key(train, i);
      this.owners.set(tile, train.id);
      held.add(tile);
    }
    this.held.set(train.id, held);
    this.reach.set(train.id, end + 1);
    return true;
  }

  // Vzdálenost od začátku trasy, kam smí dojet hlava vlaku
  limit(train: Train): number {
    const end = this.reach.get(train.id) ?? 0;
    let d = 0;
    for (let i = 0; i < end && i < train.path.length; i++) d += segmentLength(train.path[i]);
    return d;
  }

  private key(train: Train, index: number): number {
    const s = train.path[index];
    return s.y * this.width + s.x;
  }
}
