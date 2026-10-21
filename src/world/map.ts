export enum TileType {
  Grass = 0,
  Water = 1,
  Road = 2,
  Building = 3,
  Rail = 4,
  Station = 5,
  Depot = 6,
  // Silnice křížená rovnou kolejí
  Crossing = 7,
  // Tráva se stromy; stavba stromy sama vykácí
  Trees = 8,
  // Železniční most nad vodou
  Bridge = 9,
  // Areál dolu, elektrárny apod.
  Industry = 10,
  // Průjezdná zastávka aut na rovné silnici
  RoadStop = 11,
  // Garáž aut s vjezdem z jedné strany
  RoadDepot = 12,
}

export interface TilePos {
  x: number;
  y: number;
}

export const NO_OWNER = -1;

// Delší log se zahodí a pozadu jdoucí čtenáři překreslí vše
const MAX_CHANGE_LOG = 65_536;

// Dlaždice (x, y) zabírá ve světě čtverec [x, x+1] × [y, y+1] v rovině XZ
export class GameMap {
  readonly tiles: Uint8Array;
  // Id města, kterému dlaždice patří, jinak NO_OWNER
  readonly owner: Int16Array;
  // Indexy změněných dlaždic, aby vykreslování nemuselo procházet celou mapu
  private changeLog: number[] = [];
  private logStart = 0;

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
    const i = y * this.width + x;
    if (this.tiles[i] === type) return;
    this.tiles[i] = type;
    this.record(i);
  }

  getOwner(x: number, y: number): number {
    return this.owner[y * this.width + x];
  }

  setOwner(x: number, y: number, townId: number): void {
    const i = y * this.width + x;
    if (this.owner[i] === townId) return;
    this.owner[i] = townId;
    this.record(i);
  }

  // Pozice konce logu změn; čtenář si ji pamatuje jako kurzor
  get changeCursor(): number {
    return this.logStart + this.changeLog.length;
  }

  // Změněné dlaždice od kurzoru; null = log se mezitím zahodil a je třeba překreslit vše
  changesSince(cursor: number): number[] | null {
    if (cursor < this.logStart) return null;
    return this.changeLog.slice(cursor - this.logStart);
  }

  private record(index: number): void {
    this.changeLog.push(index);
    if (this.changeLog.length > MAX_CHANGE_LOG) {
      this.logStart += this.changeLog.length;
      this.changeLog = [];
    }
  }

  isType(x: number, y: number, type: TileType): boolean {
    return this.inBounds(x, y) && this.get(x, y) === type;
  }

  // Volná dlaždice pro stavbu: tráva nebo stromy
  isFree(x: number, y: number): boolean {
    return this.isType(x, y, TileType.Grass) || this.isType(x, y, TileType.Trees);
  }

  isRoad(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const type = this.get(x, y);
    return type === TileType.Road || type === TileType.Crossing || type === TileType.RoadStop;
  }

  // Směr silnice podle napojení na sousední silnice
  roadAxis(x: number, y: number): 'x' | 'y' | 'junction' | 'none' {
    const ns = this.isRoad(x, y - 1) || this.isRoad(x, y + 1);
    const ew = this.isRoad(x - 1, y) || this.isRoad(x + 1, y);
    if (ns && ew) return 'junction';
    return ns ? 'y' : ew ? 'x' : 'none';
  }
}

// Čte změny mapy od posledního čtení; každá vrstva má vlastního čtenáře
export class MapChanges {
  private cursor: number;

  constructor(private readonly map: GameMap) {
    this.cursor = map.changeCursor;
  }

  take(): number[] | null {
    const changes = this.map.changesSince(this.cursor);
    this.cursor = this.map.changeCursor;
    return changes;
  }
}
