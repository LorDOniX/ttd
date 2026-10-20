import { STATION_LENGTH } from '../game/balance';
import { GameMap, TileType, type TilePos } from './map';

export enum Edge {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}

export type Axis = 'x' | 'y';

export const EDGE_DELTA: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// Středy hran v lokálních souřadnicích dlaždice
export const EDGE_MID: readonly [number, number][] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];

export function opposite(edge: Edge): Edge {
  return (edge + 2) % 4;
}

// Kus koleje spojuje středy dvou hran dlaždice; rohové kusy tvoří zatáčky i diagonály
export const PIECES: readonly [Edge, Edge][] = [
  [Edge.N, Edge.S],
  [Edge.W, Edge.E],
  [Edge.N, Edge.E],
  [Edge.E, Edge.S],
  [Edge.S, Edge.W],
  [Edge.W, Edge.N],
];

export function isCorner(piece: number): boolean {
  return piece >= 2;
}

export function pieceLength(piece: number): number {
  return isCorner(piece) ? Math.SQRT1_2 : 1;
}

export function axisPiece(axis: Axis): number {
  return axis === 'x' ? 1 : 0;
}

// Směr jízdy 0..7: 0 = +x, dál po krocích 45° k +y
export function heading(from: Edge, to: Edge): number {
  const [ax, ay] = EDGE_MID[from];
  const [bx, by] = EDGE_MID[to];
  return (Math.round(Math.atan2(by - ay, bx - ax) / (Math.PI / 4)) + 8) % 8;
}

// Vlak smí mezi kusy zatočit nejvýš o 45°
export function turnAllowed(h1: number, h2: number): boolean {
  const d = Math.abs(h1 - h2) % 8;
  return Math.min(d, 8 - d) <= 1;
}

export interface Station {
  id: number;
  name: string;
  x: number;
  y: number;
  axis: Axis;
  townId: number;
}

export interface Depot {
  id: number;
  x: number;
  y: number;
  entrance: Edge;
}

export function stationTiles(x: number, y: number, axis: Axis): TilePos[] {
  const half = Math.floor(STATION_LENGTH / 2);
  return Array.from({ length: STATION_LENGTH }, (_, i) =>
    axis === 'x' ? { x: x - half + i, y } : { x, y: y - half + i },
  );
}

// Koleje, nástupiště a depa hráče
export class RailNetwork {
  // Bitová maska kusů koleje na každé dlaždici
  readonly pieces: Uint8Array;
  readonly stations: Station[] = [];
  readonly depots: Depot[] = [];

  constructor(readonly map: GameMap) {
    this.pieces = new Uint8Array(map.width * map.height);
  }

  mask(x: number, y: number): number {
    return this.pieces[y * this.map.width + x];
  }

  has(x: number, y: number, piece: number): boolean {
    return this.map.inBounds(x, y) && (this.mask(x, y) & (1 << piece)) !== 0;
  }

  canPlace(x: number, y: number, piece: number): boolean {
    if (!this.map.inBounds(x, y)) return false;
    switch (this.map.get(x, y)) {
      case TileType.Grass:
      case TileType.Rail:
        return true;
      case TileType.Station:
      case TileType.Depot:
        return this.has(x, y, piece);
      default:
        return false;
    }
  }

  addPiece(x: number, y: number, piece: number): void {
    this.pieces[y * this.map.width + x] |= 1 << piece;
    if (this.map.get(x, y) === TileType.Grass) this.map.set(x, y, TileType.Rail);
  }

  canPlaceStation(x: number, y: number, axis: Axis): boolean {
    const bit = 1 << axisPiece(axis);
    return stationTiles(x, y, axis).every(
      (t) =>
        this.map.isType(t.x, t.y, TileType.Grass) ||
        (this.map.isType(t.x, t.y, TileType.Rail) && (this.mask(t.x, t.y) | bit) === bit),
    );
  }

  addStation(station: Omit<Station, 'id'>): Station {
    const created = { ...station, id: this.stations.length };
    for (const t of stationTiles(station.x, station.y, station.axis)) {
      this.map.set(t.x, t.y, TileType.Station);
      this.pieces[t.y * this.map.width + t.x] = 1 << axisPiece(station.axis);
    }
    this.stations.push(created);
    return created;
  }

  canPlaceDepot(x: number, y: number): boolean {
    return this.map.isType(x, y, TileType.Grass);
  }

  addDepot(x: number, y: number, entrance: Edge): Depot {
    const depot = { id: this.depots.length, x, y, entrance };
    this.map.set(x, y, TileType.Depot);
    this.pieces[y * this.map.width + x] = 1 << axisPiece(entrance % 2 === 0 ? 'y' : 'x');
    this.depots.push(depot);
    return depot;
  }

  depotAt(x: number, y: number): Depot | undefined {
    return this.depots.find((d) => d.x === x && d.y === y);
  }
}
