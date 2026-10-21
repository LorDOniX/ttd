import { STATION_LENGTH } from '../game/balance';
import { emptyFreight, newRatings, type Cargo, type CargoRating, type FreightStock } from '../game/cargo';
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

// Obdélník nástupiště: střed (x, y), délka podél osy a počet kolejí vedle sebe
export interface StationShape {
  x: number;
  y: number;
  axis: Axis;
  length: number;
  tracks: number;
}

export interface Station extends StationShape {
  id: number;
  name: string;
  townId: number;
  // Čekající cestující (necelé číslo kvůli průběžnému přírůstku)
  waiting: number;
  // Náklad připravený k odvozu v tunách podle druhu
  freight: FreightStock;
  // Hodnocení zvlášť pro každý druh nákladu jako v OpenTTD
  ratings: Record<Cargo, CargoRating>;
  // Zastávka aut na silnici; bez údaje železniční nástupiště
  kind?: 'road';
}

export interface Depot {
  id: number;
  x: number;
  y: number;
  entrance: Edge;
}

export function defaultStationShape(x: number, y: number, axis: Axis): StationShape {
  return { x, y, axis, length: STATION_LENGTH, tracks: 1 };
}

export function stationTiles(shape: StationShape): TilePos[] {
  const along0 = -Math.floor(shape.length / 2);
  const across0 = -Math.floor(shape.tracks / 2);
  const tiles: TilePos[] = [];
  for (let a = 0; a < shape.length; a++) {
    for (let c = 0; c < shape.tracks; c++) {
      tiles.push(
        shape.axis === 'x'
          ? { x: shape.x + along0 + a, y: shape.y + across0 + c }
          : { x: shape.x + across0 + c, y: shape.y + along0 + a },
      );
    }
  }
  return tiles;
}

// Koleje, nástupiště a depa hráče
export class RailNetwork {
  // Bitová maska kusů koleje na každé dlaždici
  readonly pieces: Uint8Array;
  readonly stations: Station[] = [];
  readonly depots: Depot[] = [];
  // Garáže aut; id sdílí s depy, aby byla jednoznačná
  readonly roadDepots: Depot[] = [];
  // Dlaždice s návěstidlem (index y * šířka + x); dělí trať na úseky, před kterými vlak smí čekat
  readonly signals = new Set<number>();
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
    this.signals.delete(y * this.map.width + x);
    const type = this.map.get(x, y);
    if (type === TileType.Rail) this.map.set(x, y, TileType.Grass);
    if (type === TileType.Crossing) this.map.set(x, y, TileType.Road);
    if (type === TileType.Bridge) this.map.set(x, y, TileType.Water);
  }

  canPlaceStation(shape: StationShape): boolean {
    const bit = 1 << axisPiece(shape.axis);
    return stationTiles(shape).every(
      (t) =>
        this.map.isFree(t.x, t.y) ||
        (this.map.isType(t.x, t.y, TileType.Rail) && (this.mask(t.x, t.y) | bit) === bit),
    );
  }

  addStation(station: Omit<Station, 'id' | 'waiting' | 'freight' | 'ratings'>): Station {
    const created = {
      ...station,
      id: this.nextStationId++,
      waiting: 0,
      freight: emptyFreight(),
      ratings: newRatings(),
    };
    for (const t of stationTiles(station)) {
      this.map.set(t.x, t.y, TileType.Station);
      this.pieces[t.y * this.map.width + t.x] = 1 << axisPiece(station.axis);
    }
    this.stations.push(created);
    return created;
  }

  stationAt(x: number, y: number): Station | undefined {
    if (!this.map.isType(x, y, TileType.Station) && !this.map.isType(x, y, TileType.RoadStop)) return undefined;
    return this.stations.find((s) => stationTiles(s).some((t) => t.x === x && t.y === y));
  }

  removeStation(station: Station): void {
    for (const t of stationTiles(station)) {
      // Ze zastávky aut zůstane silnice i s vlastníkem
      this.map.set(t.x, t.y, station.kind === 'road' ? TileType.Road : TileType.Grass);
      this.pieces[t.y * this.map.width + t.x] = 0;
    }
    this.stations.splice(this.stations.indexOf(station), 1);
  }

  // Zastávka aut jde na rovnou silnici bez křižovatky; vrací směr silnice
  roadStopAxis(x: number, y: number): Axis | null {
    if (!this.map.isType(x, y, TileType.Road)) return null;
    const axis = this.map.roadAxis(x, y);
    return axis === 'x' || axis === 'y' ? axis : null;
  }

  addRoadStop(x: number, y: number, axis: Axis, name: string, townId: number): Station {
    const stop: Station = {
      x,
      y,
      axis,
      length: 1,
      tracks: 1,
      kind: 'road',
      name,
      townId,
      id: this.nextStationId++,
      waiting: 0,
      freight: emptyFreight(),
      ratings: newRatings(),
    };
    this.map.set(x, y, TileType.RoadStop);
    this.stations.push(stop);
    return stop;
  }

  addRoadDepot(x: number, y: number, entrance: Edge): Depot {
    const depot = { id: this.nextDepotId++, x, y, entrance };
    this.map.set(x, y, TileType.RoadDepot);
    this.roadDepots.push(depot);
    return depot;
  }

  removeRoadDepot(depot: Depot): void {
    this.map.set(depot.x, depot.y, TileType.Grass);
    this.roadDepots.splice(this.roadDepots.indexOf(depot), 1);
  }

  roadDepotAt(x: number, y: number): Depot | undefined {
    return this.roadDepots.find((d) => d.x === x && d.y === y);
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

  hasSignal(x: number, y: number): boolean {
    return this.signals.has(y * this.map.width + x);
  }

  // Návěstidlo jen na samostatnou kolej bez výhybky – čekající vlak tak neblokuje křížení
  canPlaceSignal(x: number, y: number): boolean {
    return this.map.isType(x, y, TileType.Rail) && this.pieceCount(x, y) === 1 && !this.hasSignal(x, y);
  }

  addSignal(x: number, y: number): void {
    this.signals.add(y * this.map.width + x);
  }

  removeSignal(x: number, y: number): void {
    this.signals.delete(y * this.map.width + x);
  }
}
