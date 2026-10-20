export enum TileType {
  Grass = 0,
  Water = 1,
  Road = 2,
  Building = 3,
}

export interface TilePos {
  x: number;
  y: number;
}

export const NO_OWNER = -1;

// Dlaždice (x, y) zabírá ve světě čtverec [x, x+1] × [y, y+1] v rovině XZ
export class GameMap {
  readonly tiles: Uint8Array;
  // Id města, kterému dlaždice patří, jinak NO_OWNER
  readonly owner: Int16Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.tiles = new Uint8Array(width * height);
    this.owner = new Int16Array(width * height).fill(NO_OWNER);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): TileType {
    return this.tiles[y * this.width + x];
  }

  set(x: number, y: number, type: TileType): void {
    this.tiles[y * this.width + x] = type;
  }

  getOwner(x: number, y: number): number {
    return this.owner[y * this.width + x];
  }

  setOwner(x: number, y: number, townId: number): void {
    this.owner[y * this.width + x] = townId;
  }

  isType(x: number, y: number, type: TileType): boolean {
    return this.inBounds(x, y) && this.get(x, y) === type;
  }
}
