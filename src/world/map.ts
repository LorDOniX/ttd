export enum TileType {
  Grass = 0,
  Water = 1,
}

export interface TilePos {
  x: number;
  y: number;
}

// Dlaždice (x, y) zabírá ve světě čtverec [x, x+1] × [y, y+1] v rovině XZ
export class GameMap {
  readonly tiles: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.tiles = new Uint8Array(width * height);
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
}
