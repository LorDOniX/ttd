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

// Kolej přes silnici jen kolmo k rovné silnici, křižovatku křížit nelze
export function crossingPiece(roadAxis: 'x' | 'y' | 'junction' | 'none'): number | null {
  if (roadAxis === 'x') return axisPiece('y');
  if (roadAxis === 'y') return axisPiece('x');
  return null;
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
  // Čekající cestující (necelé číslo kvůli průběžnému přírůstku)
  waiting: number;
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
  // Id se nerecyklují, aby odkazy (např. trasy vlaků) po demolici neukazovaly jinam
  nextStationId = 0;
  nextDepotId = 0;

  constructor(readonly map: GameMap) {
    this.pieces = new Uint8Array(map.width * map.height);
  }

  mask(x: number, y: number): number {
    return this.pieces[y * this.map.width + x];
  }

  has(x: number, y: number, piece: number): boolean {
    return this.map.inBounds(x, y) && (this.mask(x, y) & (1 << piece)) !== 0;
  }

  pieceCount(x: number, y: number): number {
    return PIECES.filter((_, piece) => this.has(x, y, piece)).length;
  }

  canPlace(x: number, y: number, piece: number): boolean {
    if (!this.map.inBounds(x, y)) return false;
    switch (this.map.get(x, y)) {
      case TileType.Grass:
      case TileType.Trees:
      case TileType.Rail:
        return true;
      case TileType.Road:
        return piece === crossingPiece(this.map.roadAxis(x, y));
      // Most vede jen rovně
      case TileType.Water:
        return !isCorner(piece);
      case TileType.Station:
      case TileType.Depot:
      case TileType.Crossing:
      case TileType.Bridge:
        return this.has(x, y, piece);
      default:
        return false;
    }
  }

  addPiece(x: number, y: number, piece: number): void {
    this.pieces[y * this.map.width + x] |= 1 << piece;
    const type = this.map.get(x, y);
    if (this.map.isFree(x, y)) this.map.set(x, y, TileType.Rail);
    if (type === TileType.Road) this.map.set(x, y, TileType.Crossing);
    if (type === TileType.Water) this.map.set(x, y, TileType.Bridge);
  }

  // Odebere všechny kusy koleje z dlaždice
  removeTrack(x: number, y: number): void {
    this.pieces[y * this.map.width + x] = 0;
    const type = this.map.get(x, y);
    if (type === TileType.Rail) this.map.set(x, y, TileType.Grass);
    if (type === TileType.Crossing) this.map.set(x, y, TileType.Road);
    if (type === TileType.Bridge) this.map.set(x, y, TileType.Water);
  }

  canPlaceStation(x: number, y: number, axis: Axis): boolean {
    const bit = 1 << axisPiece(axis);
    return stationTiles(x, y, axis).every(
      (t) =>
        this.map.isFree(t.x, t.y) ||
        (this.map.isType(t.x, t.y, TileType.Rail) && (this.mask(t.x, t.y) | bit) === bit),
    );
  }

  addStation(station: Omit<Station, 'id' | 'waiting'>): Station {
    const created = { ...station, id: this.nextStationId++, waiting: 0 };
    for (const t of stationTiles(station.x, station.y, station.axis)) {
      this.map.set(t.x, t.y, TileType.Station);
      this.pieces[t.y * this.map.width + t.x] = 1 << axisPiece(station.axis);
    }
    this.stations.push(created);
    return created;
  }

  stationAt(x: number, y: number): Station | undefined {
    if (!this.map.isType(x, y, TileType.Station)) return undefined;
    return this.stations.find((s) => stationTiles(s.x, s.y, s.axis).some((t) => t.x === x && t.y === y));
  }

  removeStation(station: Station): void {
    for (const t of stationTiles(station.x, station.y, station.axis)) {
      this.map.set(t.x, t.y, TileType.Grass);
      this.pieces[t.y * this.map.width + t.x] = 0;
    }
    this.stations.splice(this.stations.indexOf(station), 1);
  }

  canPlaceDepot(x: number, y: number): boolean {
    return this.map.isFree(x, y);
  }

  addDepot(x: number, y: number, entrance: Edge): Depot {
    const depot = { id: this.nextDepotId++, x, y, entrance };
    this.map.set(x, y, TileType.Depot);
    this.pieces[y * this.map.width + x] = 1 << axisPiece(entrance % 2 === 0 ? 'y' : 'x');
    this.depots.push(depot);
    return depot;
  }

  removeDepot(depot: Depot): void {
    this.map.set(depot.x, depot.y, TileType.Grass);
    this.pieces[depot.y * this.map.width + depot.x] = 0;
    this.depots.splice(this.depots.indexOf(depot), 1);
  }

  depotAt(x: number, y: number): Depot | undefined {
    return this.depots.find((d) => d.x === x && d.y === y);
  }
}
