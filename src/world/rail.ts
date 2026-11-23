import { STATION_LENGTH, type AirportType } from '../game/balance';
import {
  emptyFreight,
  newRatings,
  type Cargo,
  type CargoRating,
  type FreightStock,
  type Transfers,
} from '../game/cargo';
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
  // Náklad z překládek, který čeká na další vozidlo (starší uložení ho nemají)
  transfers?: Transfers;
  // Zastávka aut na silnici nebo letiště; bez údaje železniční nástupiště
  kind?: 'road' | 'air' | 'water';
  // Velikost letiště (jen u kind 'air')
  airport?: AirportType;
  // Strana nábřeží k vodě (jen u kind 'water')
  dock?: Edge;
  // Část spojené stanice jako v OpenTTD: id hlavní části, se kterou sdílí jméno, náklad a hodnocení
  joinedTo?: number;
}

// Id spojené stanice (hlavní části); samostatná stanice je sama sobě hlavní částí
export function poolId(station: Station): number {
  return station.joinedTo ?? station.id;
}

// Části sdílí s hlavní částí stejné objekty nákladu a hodnocení; čekající cestující a jméno čtou přes ni
function linkPart(part: Station, owner: Station): void {
  owner.transfers ??= {};
  part.joinedTo = owner.id;
  part.freight = owner.freight;
  part.ratings = owner.ratings;
  part.transfers = owner.transfers;
  for (const key of ['waiting', 'name', 'townId'] as const) {
    Object.defineProperty(part, key, {
      get: () => owner[key],
      set: (value) => ((owner as unknown as Record<string, unknown>)[key] = value),
      enumerable: true,
      configurable: true,
    });
  }
}

// Zruší propojení části: vlastní kopie sdíleného stavu
function unlinkPart(part: Station): void {
  for (const key of ['waiting', 'name', 'townId'] as const) {
    const value = part[key];
    Object.defineProperty(part, key, { value, writable: true, enumerable: true, configurable: true });
  }
  delete part.joinedTo;
}

export interface Depot {
  id: number;
  x: number;
  y: number;
  entrance: Edge;
}

// Průjezdný bod jako v OpenTTD: značka na rovné koleji, přes kterou lze vlak v řádu poslat (nezastaví)
export interface Waypoint {
  id: number;
  x: number;
  y: number;
  axis: Axis;
  name: string;
  waypoint: true;
}

// Druhy kolejí jako v OpenTTD: každý je samostatná síť se svými vlaky
export enum RailType {
  Rail = 0,
  Monorail = 1,
  Maglev = 2,
}

export const RAIL_TYPE_NAMES: Record<RailType, string> = {
  [RailType.Rail]: 'železnice',
  [RailType.Monorail]: 'jednokolejka',
  [RailType.Maglev]: 'maglev',
};

// Železniční most nad čímkoli (kolejí, silnicí, vodou, trávou): nájezd A na (x, y), pole mostu ve směru dir
// a za ním nájezd B. Nájezdy jsou rovné koleje na souši, pole je ve výšce a pod ním zůstává, co tam je.
export interface RailBridge {
  id: number;
  x: number;
  y: number;
  dir: Edge;
  // Počet polí mezi nájezdy
  span: number;
}

// Nejdelší most (polí mezi nájezdy)
export const MAX_BRIDGE_SPAN = 16;

export function bridgeAxis(bridge: RailBridge): Axis {
  return bridge.dir % 2 === 1 ? 'x' : 'y';
}

// Nájezd B na druhém konci mostu
export function bridgeEnd(bridge: RailBridge): TilePos {
  const [dx, dy] = EDGE_DELTA[bridge.dir];
  return { x: bridge.x + (bridge.span + 1) * dx, y: bridge.y + (bridge.span + 1) * dy };
}

// Dlaždice pod polem mostu (bez nájezdů)
export function bridgeSpanTiles(bridge: RailBridge): TilePos[] {
  const [dx, dy] = EDGE_DELTA[bridge.dir];
  return Array.from({ length: bridge.span }, (_, i) => ({ x: bridge.x + (i + 1) * dx, y: bridge.y + (i + 1) * dy }));
}

// Pod mostem nemůže stát nic vysokého; koleje, silnice a voda tam zůstat smějí
const UNDER_BRIDGE_FORBIDDEN = [
  TileType.Building,
  TileType.Industry,
  TileType.Station,
  TileType.Depot,
  TileType.RoadStop,
  TileType.RoadDepot,
  TileType.Airport,
  TileType.Port,
];

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
  // Počítadlo změn kolejí (pro mezipaměti odvozené z kolejí)
  revision = 0;
  readonly stations: Station[] = [];
  readonly depots: Depot[] = [];
  // Garáže aut; id sdílí s depy, aby byla jednoznačná
  readonly roadDepots: Depot[] = [];
  // Dlaždice s návěstidlem (index y * šířka + x); dělí trať na úseky, před kterými vlak smí čekat
  readonly signals = new Set<number>();
  // Jednosměrná návěstidla: dlaždice → hrana, kterou vlak smí dlaždici opustit; bez záznamu obousměrné
  readonly signalDirs = new Map<number, Edge>();
  // Mosty nad kolejemi, silnicemi, vodou i trávou
  readonly bridges: RailBridge[] = [];
  // Silniční mosty stejného tvaru: nájezdy jsou silnice (TileType.Road), pole ve výšce nad čímkoli
  readonly roadBridges: RailBridge[] = [];
  // Id se nerecyklují, aby odkazy (např. trasy vlaků) po demolici neukazovaly jinam
  nextStationId = 0;
  nextDepotId = 0;
  nextBridgeId = 0;
  // Průjezdné body na rovné koleji
  readonly waypoints: Waypoint[] = [];
  nextWaypointId = 0;

  // Elektrizovaná trať (trolejové vedení) jako druh koleje v OpenTTD: 1 = celá dlaždice s kolejí, nástupištěm
  // nebo depem je pod vedením; elektrické lokomotivy jezdí jen tudy
  readonly electrified: Uint8Array;
  // Druh koleje na dlaždici s kolejí (RailType): železnice, jednokolejka, maglev – oddělené sítě jako v OpenTTD
  readonly railType: Uint8Array;
  // Druh koleje, který se právě staví: nová kolej ho dostane a navázat jde jen na kolej stejného druhu
  buildType: RailType = RailType.Rail;

  constructor(readonly map: GameMap) {
    this.pieces = new Uint8Array(map.width * map.height);
    this.electrified = new Uint8Array(map.width * map.height);
    this.railType = new Uint8Array(map.width * map.height);
  }

  // Druh koleje na dlaždici (bez koleje železnice)
  railTypeAt(x: number, y: number): RailType {
    return this.map.inBounds(x, y) ? (this.railType[y * this.map.width + x] as RailType) : RailType.Rail;
  }

  isElectrified(x: number, y: number): boolean {
    return this.map.inBounds(x, y) && this.electrified[y * this.map.width + x] === 1;
  }

  setElectrified(x: number, y: number, on: boolean): void {
    const i = y * this.map.width + x;
    if ((this.electrified[i] === 1) === on) return;
    this.electrified[i] = on ? 1 : 0;
    this.revision++;
  }

  // Dlaždice s kolejí, kterou jde elektrizovat (trať, přejezd, nájezd mostu, nástupiště, depo)
  hasTrack(x: number, y: number): boolean {
    return this.map.inBounds(x, y) && this.pieces[y * this.map.width + x] !== 0;
  }

  // Projede tu elektrická lokomotiva? Pole mostu má vedení podle nájezdu
  electricPassable(x: number, y: number): boolean {
    if (this.isElectrified(x, y)) return true;
    if (!this.map.isBridged(x, y) || this.hasTrack(x, y)) return false;
    const bridge = this.bridges.find((b) => bridgeSpanTiles(b).some((t) => t.x === x && t.y === y));
    return bridge !== undefined && this.isElectrified(bridge.x, bridge.y);
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
    // Na dlaždici s kolejí jiného druhu nic nového nepřibude (sítě se nemíchají)
    if (this.mask(x, y) !== 0 && this.railTypeAt(x, y) !== this.buildType) return false;
    // Na nájezdu mostu jen kolej ve směru mostu (bez výhybky)
    const head = this.bridgeAtHead(x, y);
    if (head) return piece === axisPiece(bridgeAxis(head));
    // Přes nájezd silničního mostu kolej nevede
    if (this.roadBridgeAtHead(x, y)) return false;
    // Na průjezdném bodu jen jeho rovná kolej (bez výhybky)
    const waypoint = this.waypointAt(x, y);
    if (waypoint) return piece === axisPiece(waypoint.axis);
    switch (this.map.get(x, y)) {
      case TileType.Grass:
      case TileType.Trees:
      case TileType.Rail:
        return true;
      case TileType.Road:
        return piece === crossingPiece(this.map.roadAxis(x, y));
      // Most vede jen rovně
      case TileType.Water:
        return !isCorner(piece) && !this.isBerth(x, y);
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
    if (this.pieces[y * this.map.width + x] === 0) this.railType[y * this.map.width + x] = this.buildType;
    this.pieces[y * this.map.width + x] |= 1 << piece;
    this.revision++;
    const type = this.map.get(x, y);
    if (this.map.isOpenGround(x, y)) this.map.set(x, y, TileType.Rail);
    if (type === TileType.Road) this.map.set(x, y, TileType.Crossing);
    if (type === TileType.Water) this.map.set(x, y, TileType.Bridge);
  }

  // Odebere jeden kus koleje; bez posledního kusu se z dlaždice stane zase tráva, silnice nebo voda
  removePiece(x: number, y: number, piece: number): void {
    const i = y * this.map.width + x;
    this.pieces[i] &= ~(1 << piece);
    this.revision++;
    if (this.pieces[i] === 0) this.removeTrack(x, y);
  }

  // Odebere všechny kusy koleje z dlaždice
  removeTrack(x: number, y: number): void {
    this.pieces[y * this.map.width + x] = 0;
    this.railType[y * this.map.width + x] = RailType.Rail;
    this.revision++;
    this.signals.delete(y * this.map.width + x);
    this.signalDirs.delete(y * this.map.width + x);
    this.electrified[y * this.map.width + x] = 0;
    const waypoint = this.waypointAt(x, y);
    if (waypoint) this.waypoints.splice(this.waypoints.indexOf(waypoint), 1);
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
        (this.map.isType(t.x, t.y, TileType.Rail) &&
          (this.mask(t.x, t.y) | bit) === bit &&
          this.railTypeAt(t.x, t.y) === this.buildType &&
          !this.map.isBridged(t.x, t.y) &&
          !this.bridgeAtHead(t.x, t.y)),
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
      const i = t.y * this.map.width + t.x;
      if (this.pieces[i] === 0) this.railType[i] = this.buildType;
      this.pieces[t.y * this.map.width + t.x] = 1 << axisPiece(station.axis);
      this.revision++;
    }
    this.stations.push(created);
    return created;
  }

  stationAt(x: number, y: number): Station | undefined {
    const type = this.map.inBounds(x, y) ? this.map.get(x, y) : null;
    if (
      type !== TileType.Station &&
      type !== TileType.RoadStop &&
      type !== TileType.Airport &&
      type !== TileType.Port
    ) {
      return undefined;
    }
    return this.stations.find((s) => stationTiles(s).some((t) => t.x === x && t.y === y));
  }

  // Hlavní část spojené stanice (nebo stanice sama)
  primaryOf(station: Station): Station {
    if (station.joinedTo === undefined) return station;
    return this.stations.find((s) => s.id === station.joinedTo) ?? station;
  }

  // Všechny části spojené stanice, hlavní první
  membersOf(station: Station): Station[] {
    const id = poolId(station);
    const primary = this.stations.find((s) => s.id === id);
    return [...(primary ? [primary] : []), ...this.stations.filter((s) => s.joinedTo === id && s !== primary)];
  }

  // Stanice tak, jak je vidí hráč: jen hlavní části
  primaries(): Station[] {
    return this.stations.filter((s) => s.joinedTo === undefined);
  }

  // Části, které tvar sdílí s dosahem: u postavené stanice celá spojená stanice, jinak tvar sám
  catchmentParts<T extends StationShape>(shape: T): (T | Station)[] {
    return 'id' in shape && this.stations.includes(shape as unknown as Station)
      ? this.membersOf(shape as unknown as Station)
      : [shape];
  }

  // Připojí novou část k existující stanici
  join(part: Station, station: Station): void {
    const owner = this.primaryOf(station);
    if (owner === part) return;
    linkPart(part, owner);
  }

  // Po načtení uložené hry: obnoví sdílení stavu částí; část bez hlavní části se osamostatní
  relinkStations(): void {
    for (const s of this.stations) {
      if (s.joinedTo === undefined) continue;
      const owner = this.stations.find((o) => o.id === s.joinedTo && o.joinedTo === undefined);
      if (owner) linkPart(s, owner);
      else delete s.joinedTo;
    }
  }

  removeStation(station: Station): void {
    // Zbouráním hlavní části převezme stanici (jméno, náklad, hodnocení) další její část
    if (station.joinedTo === undefined) {
      const [, heir, ...rest] = this.membersOf(station);
      if (heir) {
        unlinkPart(heir);
        heir.freight = station.freight;
        heir.ratings = station.ratings;
        heir.transfers = station.transfers;
        for (const s of rest) linkPart(s, heir);
      }
    }
    for (const t of stationTiles(station)) {
      // Ze zastávky aut zůstane silnice i s vlastníkem
      this.map.set(t.x, t.y, station.kind === 'road' ? TileType.Road : TileType.Grass);
      this.pieces[t.y * this.map.width + t.x] = 0;
      this.electrified[t.y * this.map.width + t.x] = 0;
      this.railType[t.y * this.map.width + t.x] = RailType.Rail;
      this.revision++;
    }
    this.stations.splice(this.stations.indexOf(station), 1);
  }

  // Zastávka aut jde na rovnou silnici bez křižovatky; vrací směr silnice
  roadStopAxis(x: number, y: number): Axis | null {
    if (!this.map.isType(x, y, TileType.Road) || this.roadBridgeAtHead(x, y)) return null;
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

  // Letiště zabere obdélník volné země (tráva, les)
  canPlaceAirport(shape: StationShape): boolean {
    return stationTiles(shape).every((t) => this.map.isFree(t.x, t.y));
  }

  addAirport(shape: StationShape, type: AirportType, name: string, townId: number): Station {
    const airport: Station = {
      ...shape,
      kind: 'air',
      airport: type,
      name,
      townId,
      id: this.nextStationId++,
      waiting: 0,
      freight: emptyFreight(),
      ratings: newRatings(),
    };
    for (const t of stationTiles(shape)) this.map.set(t.x, t.y, TileType.Airport);
    this.stations.push(airport);
    return airport;
  }

  // Přístav: nábřeží na souši, kotviště před ním zůstávají vodou
  addPort(shape: StationShape & { dock: Edge }, name: string, townId: number): Station {
    const port: Station = {
      ...shape,
      kind: 'water',
      name,
      townId,
      id: this.nextStationId++,
      waiting: 0,
      freight: emptyFreight(),
      ratings: newRatings(),
    };
    for (const t of stationTiles(shape)) this.map.set(t.x, t.y, TileType.Port);
    this.stations.push(port);
    return port;
  }

  ports(): Station[] {
    return this.stations.filter((s) => s.kind === 'water');
  }

  // Kotviště přístavu: voda, přes kterou nevede most ani silnice
  isBerth(x: number, y: number): boolean {
    for (const s of this.stations) {
      if (s.kind !== 'water' || s.dock === undefined) continue;
      const [dx, dy] = EDGE_DELTA[s.dock];
      if (stationTiles(s).some((t) => t.x + dx === x && t.y + dy === y)) return true;
    }
    return false;
  }

  airports(): Station[] {
    return this.stations.filter((s) => s.kind === 'air');
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
    this.railType[y * this.map.width + x] = this.buildType;
    this.pieces[y * this.map.width + x] = 1 << axisPiece(entrance % 2 === 0 ? 'y' : 'x');
    this.revision++;
    this.depots.push(depot);
    return depot;
  }

  removeDepot(depot: Depot): void {
    this.electrified[depot.y * this.map.width + depot.x] = 0;
    this.railType[depot.y * this.map.width + depot.x] = RailType.Rail;
    this.map.set(depot.x, depot.y, TileType.Grass);
    this.pieces[depot.y * this.map.width + depot.x] = 0;
    this.revision++;
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
    return (
      this.map.isType(x, y, TileType.Rail) &&
      this.pieceCount(x, y) === 1 &&
      !this.hasSignal(x, y) &&
      !this.bridgeAtHead(x, y) &&
      !this.waypointAt(x, y)
    );
  }

  waypointAt(x: number, y: number): Waypoint | undefined {
    return this.waypoints.find((w) => w.x === x && w.y === y);
  }

  // Průjezdný bod jde jen na rovnou kolej bez výhybky, návěstidla a mostu; vrací její osu
  waypointAxis(x: number, y: number): Axis | null {
    if (!this.map.isType(x, y, TileType.Rail) || this.pieceCount(x, y) !== 1) return null;
    if (this.hasSignal(x, y) || this.bridgeAtHead(x, y) || this.waypointAt(x, y)) return null;
    const mask = this.mask(x, y);
    if (mask === 1 << axisPiece('x')) return 'x';
    if (mask === 1 << axisPiece('y')) return 'y';
    return null;
  }

  addWaypoint(x: number, y: number, name: string): Waypoint | null {
    const axis = this.waypointAxis(x, y);
    if (!axis) return null;
    const waypoint: Waypoint = { id: this.nextWaypointId++, x, y, axis, name, waypoint: true };
    this.waypoints.push(waypoint);
    this.revision++;
    return waypoint;
  }

  removeWaypoint(waypoint: Waypoint): void {
    const i = this.waypoints.indexOf(waypoint);
    if (i < 0) return;
    this.waypoints.splice(i, 1);
    this.revision++;
  }

  // Most s nájezdem na (x, y), nebo undefined
  bridgeAtHead(x: number, y: number): RailBridge | undefined {
    return this.bridges.find((b) => {
      const end = bridgeEnd(b);
      return (b.x === x && b.y === y) || (end.x === x && end.y === y);
    });
  }

  // Most, na který se z nájezdu (x, y) vjíždí hranou dir
  bridgeFrom(x: number, y: number, dir: Edge): RailBridge | undefined {
    return this.bridges.find((b) => {
      if (b.x === x && b.y === y) return b.dir === dir;
      const end = bridgeEnd(b);
      return end.x === x && end.y === y && opposite(b.dir) === dir;
    });
  }

  // Nájezd kteréhokoli mostu (železničního i silničního)?
  anyBridgeHead(x: number, y: number): boolean {
    return this.bridgeAtHead(x, y) !== undefined || this.roadBridgeAtHead(x, y) !== undefined;
  }

  // Silniční most s nájezdem na (x, y), nebo undefined
  roadBridgeAtHead(x: number, y: number): RailBridge | undefined {
    if (this.roadBridges.length === 0) return undefined;
    return this.roadBridges.find((b) => {
      const end = bridgeEnd(b);
      return (b.x === x && b.y === y) || (end.x === x && end.y === y);
    });
  }

  // Hrana, kterou se z nájezdu (x, y) vjíždí na silniční most, nebo null
  roadBridgeExit(x: number, y: number): Edge | null {
    const bridge = this.roadBridgeAtHead(x, y);
    if (!bridge) return null;
    return bridge.x === x && bridge.y === y ? bridge.dir : opposite(bridge.dir);
  }

  // Silniční most, jehož pole vede nad (x, y), nebo undefined
  roadBridgeOver(x: number, y: number): RailBridge | undefined {
    if (this.roadBridges.length === 0 || !this.map.isBridged(x, y)) return undefined;
    return this.roadBridges.find((b) => bridgeSpanTiles(b).some((t) => t.x === x && t.y === y));
  }

  // Proč silniční most mezi nájezdy postavit nejde, nebo null. Nájezd je volná země nebo silnice
  // (bez křižovatky napříč mostu, zastávky a přejezdu); strict = false u načítání (silnice vedle mohly přibýt)
  roadBridgeProblem(x0: number, y0: number, x1: number, y1: number, strict = true): string | null {
    const shape = this.spanProblem(x0, y0, x1, y1);
    if (typeof shape === 'string') return shape;
    const axis = bridgeAxis(shape);
    for (const head of [{ x: x0, y: y0 }, bridgeEnd(shape)]) {
      if (!this.map.inBounds(head.x, head.y)) return 'Most musí stát celý na mapě.';
      if (this.map.isBridged(head.x, head.y) || this.anyBridgeHead(head.x, head.y)) return 'Mosty se nesmí křížit.';
      const road = this.map.isType(head.x, head.y, TileType.Road);
      if (!this.map.isFree(head.x, head.y) && !road) {
        return 'Nájezd silničního mostu musí být na volné zemi nebo na silnici.';
      }
      if (road && strict) {
        const across = axis === 'x' ? [Edge.N, Edge.S] : [Edge.E, Edge.W];
        if (across.some((e) => this.map.isRoad(head.x + EDGE_DELTA[e][0], head.y + EDGE_DELTA[e][1]))) {
          return 'Nájezd mostu nesmí být na křižovatce.';
        }
      }
    }
    return this.underSpanProblem(shape);
  }

  // Tvar mostu, nebo důvod, proč takový most nejde
  private spanProblem(x0: number, y0: number, x1: number, y1: number): RailBridge | string {
    if (x0 !== x1 && y0 !== y1) return 'Most vede jen rovně podél osy X nebo Y.';
    const span = Math.abs(x1 - x0) + Math.abs(y1 - y0) - 1;
    if (span < 1) return 'Most musí něco překlenout: táhněte aspoň přes 3 dlaždice.';
    if (span > MAX_BRIDGE_SPAN) return `Most může mít nejvýš ${MAX_BRIDGE_SPAN} polí.`;
    return this.bridgeShape(x0, y0, x1, y1);
  }

  private underSpanProblem(bridge: RailBridge): string | null {
    for (const t of bridgeSpanTiles(bridge)) {
      if (this.map.isBridged(t.x, t.y) || this.anyBridgeHead(t.x, t.y)) return 'Mosty se nesmí křížit.';
      if (UNDER_BRIDGE_FORBIDDEN.includes(this.map.get(t.x, t.y))) {
        return 'Pod mostem nesmí stát budovy, nástupiště, depa ani průmysl.';
      }
    }
    return null;
  }

  // Postaví silniční most (ověřený roadBridgeProblem): nájezdy se stanou silnicí
  addRoadBridge(x0: number, y0: number, x1: number, y1: number): RailBridge {
    const bridge = { ...this.bridgeShape(x0, y0, x1, y1), id: this.nextBridgeId++ };
    this.roadBridges.push(bridge);
    for (const head of [{ x: x0, y: y0 }, bridgeEnd(bridge)]) {
      if (this.map.isOpenGround(head.x, head.y)) this.map.set(head.x, head.y, TileType.Road);
    }
    for (const t of bridgeSpanTiles(bridge)) {
      this.map.bridged.add(t.y * this.map.width + t.x);
      if (this.map.isType(t.x, t.y, TileType.Trees)) this.map.set(t.x, t.y, TileType.Grass);
    }
    this.revision++;
    return bridge;
  }

  // Zboří silniční most; silnice na nájezdech zůstane
  removeRoadBridge(bridge: RailBridge): void {
    const index = this.roadBridges.indexOf(bridge);
    if (index < 0) return;
    this.roadBridges.splice(index, 1);
    for (const t of bridgeSpanTiles(bridge)) this.map.bridged.delete(t.y * this.map.width + t.x);
    this.revision++;
  }

  // Proč most mezi nájezdy (x0, y0) a (x1, y1) postavit nejde, nebo null
  bridgeProblem(x0: number, y0: number, x1: number, y1: number): string | null {
    if (x0 !== x1 && y0 !== y1) return 'Most vede jen rovně podél osy X nebo Y.';
    const span = Math.abs(x1 - x0) + Math.abs(y1 - y0) - 1;
    if (span < 1) return 'Most musí něco překlenout: táhněte aspoň přes 3 dlaždice.';
    if (span > MAX_BRIDGE_SPAN) return `Most může mít nejvýš ${MAX_BRIDGE_SPAN} polí.`;
    const bridge = this.bridgeShape(x0, y0, x1, y1);
    const axis = bridgeAxis(bridge);
    for (const head of [{ x: x0, y: y0 }, bridgeEnd(bridge)]) {
      if (!this.map.inBounds(head.x, head.y)) return 'Most musí stát celý na mapě.';
      if (this.map.isBridged(head.x, head.y) || this.anyBridgeHead(head.x, head.y)) return 'Mosty se nesmí křížit.';
      const type = this.map.get(head.x, head.y);
      const straight =
        type === TileType.Rail &&
        (this.mask(head.x, head.y) | (1 << axisPiece(axis))) === 1 << axisPiece(axis) &&
        this.railTypeAt(head.x, head.y) === this.buildType;
      if (!this.map.isFree(head.x, head.y) && !straight) {
        return 'Nájezd mostu musí být na volné zemi nebo na rovné koleji ve směru mostu.';
      }
    }
    return this.underSpanProblem(bridge);
  }

  private bridgeShape(x0: number, y0: number, x1: number, y1: number): RailBridge {
    const dir = x1 > x0 ? Edge.E : x1 < x0 ? Edge.W : y1 > y0 ? Edge.S : Edge.N;
    return { id: -1, x: x0, y: y0, dir, span: Math.abs(x1 - x0) + Math.abs(y1 - y0) - 1 };
  }

  // Postaví most (ověřený bridgeProblem): na nájezdech kolej ve směru mostu, pod polem se vykácí stromy
  addBridge(x0: number, y0: number, x1: number, y1: number): RailBridge {
    const bridge = { ...this.bridgeShape(x0, y0, x1, y1), id: this.nextBridgeId++ };
    this.bridges.push(bridge);
    const piece = axisPiece(bridgeAxis(bridge));
    for (const head of [{ x: x0, y: y0 }, bridgeEnd(bridge)]) {
      if (!this.has(head.x, head.y, piece)) this.addPiece(head.x, head.y, piece);
    }
    for (const t of bridgeSpanTiles(bridge)) {
      this.map.bridged.add(t.y * this.map.width + t.x);
      if (this.map.isType(t.x, t.y, TileType.Trees)) this.map.set(t.x, t.y, TileType.Grass);
    }
    this.revision++;
    return bridge;
  }

  // Zboří most i s kolejí na nájezdech
  removeBridge(bridge: RailBridge): void {
    const index = this.bridges.indexOf(bridge);
    if (index < 0) return;
    this.bridges.splice(index, 1);
    for (const t of bridgeSpanTiles(bridge)) this.map.bridged.delete(t.y * this.map.width + t.x);
    for (const head of [{ x: bridge.x, y: bridge.y }, bridgeEnd(bridge)]) this.removeTrack(head.x, head.y);
    this.revision++;
  }

  // dir = hrana, kterou smí vlak dlaždici opustit (jednosměrné návěstidlo), bez ní obousměrné
  addSignal(x: number, y: number, dir?: Edge): void {
    this.signals.add(y * this.map.width + x);
    this.setSignalDir(x, y, dir);
  }

  removeSignal(x: number, y: number): void {
    this.signals.delete(y * this.map.width + x);
    this.signalDirs.delete(y * this.map.width + x);
  }

  signalDir(x: number, y: number): Edge | undefined {
    return this.signalDirs.get(y * this.map.width + x);
  }

  setSignalDir(x: number, y: number, dir: Edge | undefined): void {
    const i = y * this.map.width + x;
    if (dir === undefined) this.signalDirs.delete(i);
    else this.signalDirs.set(i, dir);
    // Jednosměrka mění, kudy smějí vlaky jet
    this.revision++;
  }

  // Smí vlak projet kusem koleje ven hranou exit? Jednosměrné návěstidlo pustí po svém kusu jen po směru
  allowsExit(x: number, y: number, piece: number, exit: Edge): boolean {
    const dir = this.signalDirs.get(y * this.map.width + x);
    if (dir === undefined) return true;
    const [a, b] = PIECES[piece];
    return (a !== dir && b !== dir) || exit === dir;
  }
}
