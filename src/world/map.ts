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
  // Silniční most nad vodou, vede jen rovně podél osy X (západ–východ), resp. Y (sever–jih)
  RoadBridgeX = 13,
  RoadBridgeY = 14,
  // Plocha letiště: ranvej, pojezdová dráha, stání, terminál a hangár
  Airport = 15,
  // Nábřeží přístavu; lodě kotví na vodě před ním
  Port = 16,
}

// Vede silniční most podél osy přes hranu edge? Hrany V a Z (lichá čísla) leží na ose X
export function bridgeAlong(axis: 'x' | 'y', edge: number): boolean {
  return (edge % 2 === 1) === (axis === 'x');
}

// Výška terénu jako v OpenTTD: celá čísla v rozích dlaždic, sousední rohy se liší nejvýš o 1.
// Jedna úroveň je HEIGHT_STEP světových jednotek; voda leží na úrovni 0.
export const HEIGHT_STEP = 0.3;
export const MAX_HEIGHT = 12;

// Svah dlaždice: rovina, nakloněná rovina podél osy (kolej a silnice mohou vést do svahu), nebo jiný tvar
export type TileSlope =
  | { kind: 'flat'; level: number }
  // up = hrana (0 S, 1 V, 2 J, 3 Z), směrem ke které terén stoupá; level = nižší úroveň
  | { kind: 'incline'; level: number; up: 0 | 1 | 2 | 3 }
  | { kind: 'other'; level: number };

export interface TilePos {
  x: number;
  y: number;
}

export const NO_OWNER = -1;

// Delší log se zahodí a pozadu jdoucí čtenáři překreslí vše
const MAX_CHANGE_LOG = 65_536;

// Dlaždice (x, y) zabírá ve světě čtverec [x, x+1] × [y, y+1] v rovině XZ
export class GameMap {
  // Dlaždice pod železničními mosty (index y * šířka + x); spravuje je RailNetwork
  readonly bridged = new Set<number>();
  readonly tiles: Uint8Array;
  // Úrovně terénu v rozích dlaždic, (width + 1) × (height + 1), index cy * (width + 1) + cx
  readonly heights: Uint8Array;
  // Počítadlo změn výšek (pro mezipaměti odvozené z terénu)
  heightRevision = 0;
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
    this.heights = new Uint8Array((width + 1) * (height + 1));
  }

  // Úroveň rohu (cx, cy) v rozsahu 0..width × 0..height; mimo mapu 0
  cornerLevel(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx > this.width || cy > this.height) return 0;
    return this.heights[cy * (this.width + 1) + cx];
  }

  // Nastaví úroveň rohu a zaznamená změnu všech dlaždic, které roh sdílejí
  setCornerLevel(cx: number, cy: number, level: number): void {
    const i = cy * (this.width + 1) + cx;
    const value = Math.max(0, Math.min(MAX_HEIGHT, Math.round(level)));
    if (this.heights[i] === value) return;
    this.heights[i] = value;
    this.heightRevision++;
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ]) {
      if (this.inBounds(cx + dx, cy + dy)) this.record((cy + dy) * this.width + cx + dx);
    }
  }

  // Úrovně rohů dlaždice v pořadí SZ, SV, JV, JZ
  tileCorners(x: number, y: number): [number, number, number, number] {
    return [
      this.cornerLevel(x, y),
      this.cornerLevel(x + 1, y),
      this.cornerLevel(x + 1, y + 1),
      this.cornerLevel(x, y + 1),
    ];
  }

  // Nejnižší roh dlaždice
  tileLevel(x: number, y: number): number {
    return Math.min(...this.tileCorners(x, y));
  }

  isFlat(x: number, y: number): boolean {
    const [a, b, c, d] = this.tileCorners(x, y);
    return a === b && b === c && c === d;
  }

  slope(x: number, y: number): TileSlope {
    const [nw, ne, se, sw] = this.tileCorners(x, y);
    const level = Math.min(nw, ne, se, sw);
    if (nw === ne && ne === se && se === sw) return { kind: 'flat', level };
    const one = (a: number, b: number): boolean => a === b && Math.max(nw, ne, se, sw) === level + 1;
    if (one(nw, ne) && one(se, sw) && nw !== sw) return { kind: 'incline', level, up: nw > sw ? 0 : 2 };
    if (one(nw, sw) && one(ne, se) && nw !== ne) return { kind: 'incline', level, up: ne > nw ? 1 : 3 };
    return { kind: 'other', level };
  }

  // Světová výška spodku dlaždice (nejnižší roh); stavby stojí na rovných dlaždicích v této výšce
  elevation(x: number, y: number): number {
    return this.inBounds(x, y) ? this.tileLevel(x, y) * HEIGHT_STEP : 0;
  }

  // Světová výška terénu v bodě (fx, fy) mapy: dvě trojúhelníkové plochy dlaždice s úhlopříčkou SZ–JV,
  // stejně jako ve vykreslení terénu
  heightAt(fx: number, fy: number): number {
    const x = Math.max(0, Math.min(this.width - 1, Math.floor(fx)));
    const y = Math.max(0, Math.min(this.height - 1, Math.floor(fy)));
    const u = Math.max(0, Math.min(1, fx - x));
    const v = Math.max(0, Math.min(1, fy - y));
    const [nw, ne, se, sw] = this.tileCorners(x, y);
    const h = u >= v ? nw + (ne - nw) * u + (se - ne) * v : nw + (sw - nw) * v + (se - sw) * u;
    return h * HEIGHT_STEP;
  }

  // Nejvyšší úroveň mapy (pro výběr dlaždice myší)
  maxLevel(): number {
    let max = 0;
    for (const h of this.heights) if (h > max) max = h;
    return max;
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

  // Volná dlaždice pro stavbu: tráva nebo stromy a nad ní žádný most
  isFree(x: number, y: number): boolean {
    return this.isOpenGround(x, y) && !this.isBridged(x, y);
  }

  // Tráva nebo stromy, i pod mostem (koleje a silnice tam stavět jde)
  isOpenGround(x: number, y: number): boolean {
    return this.isType(x, y, TileType.Grass) || this.isType(x, y, TileType.Trees);
  }

  // Vede nad dlaždicí most? Pod ním zůstává, co tam je, ale nic vysokého se tam nestaví
  isBridged(x: number, y: number): boolean {
    return this.bridged.has(y * this.width + x);
  }

  isRoad(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const type = this.get(x, y);
    return (
      type === TileType.Road ||
      type === TileType.Crossing ||
      type === TileType.RoadStop ||
      type === TileType.RoadBridgeX ||
      type === TileType.RoadBridgeY
    );
  }

  // Osa silničního mostu na dlaždici, jinak null
  roadBridgeAxis(x: number, y: number): 'x' | 'y' | null {
    if (this.isType(x, y, TileType.RoadBridgeX)) return 'x';
    return this.isType(x, y, TileType.RoadBridgeY) ? 'y' : null;
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
