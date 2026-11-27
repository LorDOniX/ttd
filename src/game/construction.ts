import { applyTerraform, planTerraform, type TerraformMode, type TerraformPlan } from '../world/terraform';
import {
  AIRPORT_TYPES,
  BRIDGE_PIECE_COST,
  DEMOLISH_COST_PER_RESIDENT,
  DEMOLISH_REFUND,
  DEMOLISH_TOWN_ROAD_COST,
  DEMOLISH_TREES_COST,
  DEPOT_COST,
  ELECTRIFY_TILE_COST,
  PLATFORM_TILE_COST,
  PORT_COST,
  ROAD_BRIDGE_COST,
  ROAD_DEPOT_COST,
  ROAD_STOP_COST,
  ROAD_TILE_COST,
  SIGNAL_COST,
  STATION_SPREAD,
  TERRAFORM_CORNER_COST,
  TRACK_PIECE_COST,
  TREE_PLANT_COST,
  TUNNEL_PIECE_COST,
  WAYPOINT_COST,
  type AirportType,
  MAGLEV_COST_FACTOR,
  MONORAIL_COST_FACTOR,
} from './balance';
import { formatMoney, type Game } from './game';
import type { World } from '../world/generator';
import { NO_OWNER, TileType, type GameMap, type TilePos } from '../world/map';
import { airportShape } from '../world/airport';
import { canPlacePort, type PortShape } from '../world/port';
import {
  PIECES,
  RailType,
  axisPiece,
  bridgeAxis,
  bridgeEnd,
  bridgeSpanTiles,
  opposite,
  stationTiles,
  type Axis,
  type Edge,
  type RailBridge,
  type Station,
  type StationShape,
} from '../world/rail';
import { depotLinks, removableTile, type PathStep } from '../world/railPath';
import type { RoadStep } from '../world/roadPath';
import { buildingAt, buildingCapacity, demolishBuilding } from '../world/town';

// Rychlost postupné výstavby kolejí a silnic
const PIECES_PER_SECOND = 25;

export function stationCost(shape: StationShape & Pick<Station, 'kind' | 'airport'>): number {
  if (shape.kind === 'road') return ROAD_STOP_COST;
  if (shape.kind === 'air') return AIRPORT_TYPES[shape.airport ?? 'small'].cost;
  if (shape.kind === 'water') return PORT_COST;
  return PLATFORM_TILE_COST * shape.length * shape.tracks;
}

// Cena dílku koleje: přes vodu se staví most; jednokolejka a maglev jsou dražší
export function trackPieceCost(map: GameMap, x: number, y: number, railType: RailType = RailType.Rail): number {
  const type = map.get(x, y);
  const base = type === TileType.Water || type === TileType.Bridge ? BRIDGE_PIECE_COST : TRACK_PIECE_COST;
  return Math.round(base * railTypeCostFactor(railType));
}

export function railTypeCostFactor(type: RailType): number {
  return type === RailType.Monorail ? MONORAIL_COST_FACTOR : type === RailType.Maglev ? MAGLEV_COST_FACTOR : 1;
}

// Cena pole mostu (bez kolejí na nájezdech)
export function bridgeCost(span: number): number {
  return span * BRIDGE_PIECE_COST;
}

// Cena pole silničního mostu (bez silnice na nájezdech)
export function roadBridgeCost(span: number): number {
  return span * ROAD_BRIDGE_COST;
}

// Cena polí tunelu (bez kolejí a silnice v portálech)
export function tunnelCost(span: number): number {
  return span * TUNNEL_PIECE_COST;
}

// Cena polí mostu nebo tunelu
export function spanCost(bridge: RailBridge, road: boolean): number {
  return bridge.tunnel ? tunnelCost(bridge.span) : road ? roadBridgeCost(bridge.span) : bridgeCost(bridge.span);
}

// Cena nového dílku silnice: přes vodu se staví most
export function roadPieceCost(map: GameMap, x: number, y: number): number {
  return map.isType(x, y, TileType.Water) || map.roadBridgeAxis(x, y) ? ROAD_BRIDGE_COST : ROAD_TILE_COST;
}

// Cena všech kolejí, nástupišť a dep společnosti, ze které se počítá údržba
export function infrastructureValue(world: World): number {
  const { map, rail } = world;
  let value = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const type = map.get(x, y);
      if (type === TileType.Rail || type === TileType.Crossing || type === TileType.Bridge) {
        value += rail.pieceCount(x, y) * trackPieceCost(map, x, y, rail.railTypeAt(x, y));
      }
    }
  }
  for (const station of rail.stations) value += stationCost(station);
  for (const on of rail.electrified) value += on * ELECTRIFY_TILE_COST;
  for (const bridge of rail.bridges) value += spanCost(bridge, false);
  for (const bridge of rail.roadBridges) value += spanCost(bridge, true);
  return (
    value +
    rail.depots.length * DEPOT_COST +
    rail.roadDepots.length * ROAD_DEPOT_COST +
    rail.signals.size * SIGNAL_COST +
    rail.waypoints.length * WAYPOINT_COST
  );
}

// U koleje electric = elektrizovaná trať (trolejové vedení)
export type Job =
  { kind: 'track'; step: PathStep; electric?: boolean; type?: RailType } | { kind: 'road'; step: RoadStep };

export interface DemolishPlan {
  tiles: TilePos[];
  // Kladná částka se platí, záporná se vrací
  cost: number;
  // Důvod, proč demolici nelze provést (např. na koleji stojí vlak)
  blocked: string | null;
}

// Stavba a demolice za peníze společnosti
export class Construction {
  private queue: Job[] = [];
  private elapsed = 0;

  constructor(private readonly game: Game) {}

  get busy(): boolean {
    return this.queue.length > 0;
  }

  // Dosud nepostavené dílky; ukládají se s hrou a platí se až při stavbě
  get pending(): readonly Job[] {
    return this.queue;
  }

  restore(jobs: Job[]): void {
    this.queue = jobs;
    this.elapsed = 0;
  }

  // Kolej se staví v druhu koleje, který je právě vybraný (rail.buildType); elektrizovat jde jen železnici
  buildTrack(steps: PathStep[], electric = false): void {
    const type = this.game.world.rail.buildType;
    const wires = electric && type === RailType.Rail;
    this.queue.push(
      ...steps.map((step) => ({
        kind: 'track' as const,
        step,
        ...(wires ? { electric: true } : {}),
        ...(type !== RailType.Rail ? { type } : {}),
      })),
    );
  }

  // Úprava terénu (zvednout, snížit, srovnat); cena podle počtu změněných rohů i s dorovnaným okolím
  terraformPlan(corners: readonly TilePos[], mode: TerraformMode, target = 0): TerraformPlan & { cost: number } {
    const { map, rail } = this.game.world;
    const plan = planTerraform(map, corners, mode, target, (x, y) => rail.tunnelUnder(x, y) !== undefined);
    return { ...plan, cost: plan.levels.size * TERRAFORM_CORNER_COST };
  }

  terraform(corners: readonly TilePos[], mode: TerraformMode, target = 0): string | null {
    const plan = this.terraformPlan(corners, mode, target);
    if (plan.problem) return plan.problem;
    if (plan.levels.size === 0) return mode === 'level' ? 'Terén už je srovnaný.' : 'Terén se nezměnil.';
    if (this.game.money < plan.cost) return `Nedostatek peněz (${formatMoney(plan.cost)}).`;
    this.game.spend(plan.cost, 'construction');
    applyTerraform(this.game.world.map, plan);
    return null;
  }

  // Výsadba stromů jako v OpenTTD: na volnou rovnou i šikmou trávu (ne pod mosty); v obvodu města
  // zvedne hodnocení místního úřadu
  plantTreesPlan(area: readonly TilePos[]): { tiles: TilePos[]; cost: number } {
    const { map } = this.game.world;
    const tiles = area.filter(
      (t) => map.inBounds(t.x, t.y) && map.isType(t.x, t.y, TileType.Grass) && !map.isBridged(t.x, t.y),
    );
    return { tiles, cost: tiles.length * TREE_PLANT_COST };
  }

  plantTrees(area: readonly TilePos[]): string | null {
    const { tiles, cost } = this.plantTreesPlan(area);
    if (tiles.length === 0) return 'Stromy jde sázet jen na volnou trávu.';
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    this.game.spend(cost, 'construction');
    for (const t of tiles) {
      this.game.world.map.set(t.x, t.y, TileType.Trees);
      this.game.authority.treePlanted(t.x, t.y);
    }
    this.game.events.emit('treesChanged');
    return null;
  }

  buildRoad(steps: RoadStep[]): void {
    this.queue.push(...steps.map((step) => ({ kind: 'road' as const, step })));
  }

  // Stanice, ke kterým jde nová část na těchto dlaždicích připojit: celá spojená stanice se musí vejít
  // do obdélníku STATION_SPREAD × STATION_SPREAD (jako „station spread“ v OpenTTD); nejbližší první
  joinCandidates(tiles: readonly TilePos[]): Station[] {
    const { rail } = this.game.world;
    const distance = (station: Station): number =>
      Math.min(
        ...rail
          .membersOf(station)
          .flatMap((m) => stationTiles(m))
          .flatMap((a) => tiles.map((b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)))),
      );
    return rail
      .primaries()
      .filter((station) => {
        const all = [...rail.membersOf(station).flatMap((m) => stationTiles(m)), ...tiles];
        const xs = all.map((t) => t.x);
        const ys = all.map((t) => t.y);
        return Math.max(...xs) - Math.min(...xs) < STATION_SPREAD && Math.max(...ys) - Math.min(...ys) < STATION_SPREAD;
      })
      .sort((a, b) => distance(a) - distance(b));
  }

  // Stanice, jejíž část sousedí s dlaždicemi (i úhlopříčně); k ní se nová část připojí sama
  adjacentStation(tiles: readonly TilePos[]): Station | null {
    const near = (station: Station): boolean =>
      this.game.world.rail
        .membersOf(station)
        .flatMap((m) => stationTiles(m))
        .some((a) => tiles.some((b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1));
    return this.joinCandidates(tiles).find(near) ?? null;
  }

  // Ke které stanici se nová část připojí: undefined = k sousední (jinak samostatně), null = samostatně,
  // číslo = ke zvolené stanici (musí být v dosahu spojení); vrací stanici, null, nebo chybu
  private joinTarget(tiles: readonly TilePos[], join: number | null | undefined): Station | null | string {
    if (join === null) return null;
    if (join === undefined) return this.adjacentStation(tiles);
    const target = this.joinCandidates(tiles).find((s) => s.id === join);
    return (
      target ??
      `Ke stanici je to moc daleko (spojená stanice se musí vejít do ${STATION_SPREAD}×${STATION_SPREAD} polí).`
    );
  }

  // Jméno a město nové části: u připojené části podle stanice, jinak nové
  private partName(shape: StationShape, target: Station | null): { name: string; townId: number } {
    return target ? { name: target.name, townId: target.townId } : this.stationName(shape);
  }

  // Po postavení části: připojí ji ke stanici a ohlásí (built: „Postaveno nástupiště“, joined: „Nástupiště připojeno“)
  private finishPart(part: Station, target: Station | null, built: string, joined: string, at: TilePos): void {
    if (target) {
      this.game.world.rail.join(part, target);
      this.game.news(`${joined} ke stanici ${target.name}.`, at);
    } else {
      this.game.news(`${built} ${part.name}.`, at);
    }
    this.game.events.emit('railChanged');
    this.game.events.emit('stationsChanged');
  }

  // Vrací chybovou hlášku, nebo null při úspěchu
  buildStation(shape: StationShape, join?: number | null, wires = false): string | null {
    const { rail } = this.game.world;
    const electric = wires && rail.buildType === RailType.Rail;
    const cost = stationCost(shape) + (electric ? stationTiles(shape).length * ELECTRIFY_TILE_COST : 0);
    if (!this.game.world.map.allFlat(stationTiles(shape))) return 'Nástupiště potřebuje rovný terén.';
    if (!rail.canPlaceStation(shape)) return 'Sem nástupiště postavit nelze.';
    const refused = this.game.authority.refusal(shape.x, shape.y, 'povolit stavbu nástupiště');
    if (refused) return refused;
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    const target = this.joinTarget(stationTiles(shape), join);
    if (typeof target === 'string') return target;
    const { name, townId } = this.partName(shape, target);
    this.game.spend(cost, 'construction');
    const part = rail.addStation({ ...shape, name, townId });
    if (electric) for (const t of stationTiles(shape)) rail.setElectrified(t.x, t.y, true);
    this.finishPart(part, target, 'Postaveno nástupiště', 'Nástupiště připojeno', shape);
    return null;
  }

  // Průjezdná zastávka aut na rovné silnici; silnice zůstane městu, které ji vlastní
  buildRoadStop(x: number, y: number, join?: number | null): string | null {
    const { rail } = this.game.world;
    const axis = rail.roadStopAxis(x, y);
    if (!axis) return 'Zastávka aut jde jen na rovnou silnici bez křižovatky.';
    if (!this.game.world.map.isFlat(x, y)) return 'Zastávka aut potřebuje rovný terén.';
    const refused = this.game.authority.refusal(x, y, 'povolit stavbu zastávky');
    if (refused) return refused;
    if (this.game.money < ROAD_STOP_COST) return `Nedostatek peněz (${formatMoney(ROAD_STOP_COST)}).`;
    const target = this.joinTarget([{ x, y }], join);
    if (typeof target === 'string') return target;
    const { name, townId } = this.partName({ x, y, axis, length: 1, tracks: 1 }, target);
    this.game.spend(ROAD_STOP_COST, 'construction');
    const part = rail.addRoadStop(x, y, axis, name, townId);
    this.finishPart(part, target, 'Postavena zastávka aut', 'Zastávka aut připojena', { x, y });
    return null;
  }

  // Letiště se středem (x, y), ranvej podél osy
  buildAirport(type: AirportType, x: number, y: number, axis: Axis, join?: number | null): string | null {
    const { rail } = this.game.world;
    const spec = AIRPORT_TYPES[type];
    const shape = airportShape(type, x, y, axis);
    if (this.game.clock.date.year < spec.year) return `${spec.name} lze stavět až od roku ${spec.year}.`;
    if (!this.game.world.map.allFlat(stationTiles(shape))) return 'Letiště potřebuje rovný terén.';
    if (!rail.canPlaceAirport(shape)) return 'Letiště potřebuje volnou zemi bez staveb, silnic a vody.';
    const refused = this.game.authority.refusal(x, y, 'povolit stavbu letiště');
    if (refused) return refused;
    if (this.game.money < spec.cost) return `Nedostatek peněz (${formatMoney(spec.cost)}).`;
    const target = this.joinTarget(stationTiles(shape), join);
    if (typeof target === 'string') return target;
    const { name, townId } = this.partName(shape, target);
    this.game.spend(spec.cost, 'construction');
    const part = rail.addAirport(shape, type, name, townId);
    this.finishPart(part, target, 'Postaveno letiště', 'Letiště připojeno', shape);
    return null;
  }

  // Přístav na břehu: nábřeží na souši, kotviště na volné vodě před ním
  buildPort(shape: PortShape, join?: number | null): string | null {
    const { map, rail } = this.game.world;
    const quay = stationTiles(shape);
    if (quay.every((t) => map.inBounds(t.x, t.y)) && !map.allFlat(quay)) {
      return 'Přístav potřebuje rovný břeh.';
    }
    if (!canPlacePort(map, shape, (x, y) => rail.isBerth(x, y))) {
      return 'Přístav potřebuje dvě dlaždice volného břehu a před nimi volnou vodu.';
    }
    const refused = this.game.authority.refusal(shape.x, shape.y, 'povolit stavbu přístavu');
    if (refused) return refused;
    if (this.game.money < PORT_COST) return `Nedostatek peněz (${formatMoney(PORT_COST)}).`;
    const target = this.joinTarget(stationTiles(shape), join);
    if (typeof target === 'string') return target;
    const { name, townId } = this.partName(shape, target);
    this.game.spend(PORT_COST, 'construction');
    const part = rail.addPort(shape, name, townId);
    this.finishPart(part, target, 'Postaven přístav', 'Přístav připojen', shape);
    return null;
  }

  buildRoadDepot(x: number, y: number, entrance: Edge): string | null {
    const { map, rail } = this.game.world;
    if (!map.isFree(x, y)) return 'Garáž jde jen na volnou dlaždici vedle silnice.';
    if (!map.isFlat(x, y)) return 'Garáž potřebuje rovný terén.';
    if (this.game.money < ROAD_DEPOT_COST) return `Nedostatek peněz (${formatMoney(ROAD_DEPOT_COST)}).`;
    this.game.spend(ROAD_DEPOT_COST, 'construction');
    rail.addRoadDepot(x, y, entrance);
    this.game.events.emit('railChanged');
    return null;
  }

  // Jméno podle města s největším dílem v dosahu, jinak podle závodu v dosahu, nakonec nejbližšího města
  private stationName(shape: StationShape): { name: string; townId: number } {
    const { rail, towns } = this.game.world;
    const { x, y } = shape;
    const nearest = [...towns].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    const covered = [...this.game.passengers.coverage(shape).shares].sort((a, b) => b[1] - a[1])[0]?.[0];
    const industry = this.game.freight.industriesInReach(shape)[0];
    const town = covered ?? nearest;
    const base = covered ? covered.name : (industry?.name ?? nearest.name);
    const taken = new Set(rail.primaries().map((s) => s.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    return { name, townId: town.id };
  }

  // Průjezdný bod postaví na rovnou kolej, nebo existující odstraní (vrátí polovinu ceny)
  toggleWaypoint(x: number, y: number): string | null {
    const { rail, towns } = this.game.world;
    const existing = rail.waypointAt(x, y);
    if (existing) {
      const user = this.game.fleet.trains.find((t) =>
        (t.orders ?? []).some((id, i) => id === existing.id && t.orderFlags[i]?.waypoint),
      );
      if (user) return `Průjezdný bod ${existing.name} je v jízdním řádu vlaku ${user.name}.`;
      rail.removeWaypoint(existing);
      this.game.refund(WAYPOINT_COST * DEMOLISH_REFUND, 'construction');
      this.game.events.emit('railChanged');
      return null;
    }
    if (!rail.waypointAxis(x, y)) return 'Průjezdný bod jde jen na rovnou kolej bez výhybky, návěstidla a mostu.';
    if (!this.game.world.map.isFlat(x, y)) return 'Průjezdný bod potřebuje rovný terén.';
    if (this.game.money < WAYPOINT_COST) return `Nedostatek peněz (${formatMoney(WAYPOINT_COST)}).`;
    const town = [...towns].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    const base = town ? `${town.name} – bod` : 'Bod';
    const taken = new Set(rail.waypoints.map((w) => w.name));
    let n = 1;
    while (taken.has(`${base} ${n}`)) n++;
    this.game.spend(WAYPOINT_COST, 'construction');
    const waypoint = rail.addWaypoint(x, y, `${base} ${n}`)!;
    this.game.news(`Postaven průjezdný bod ${waypoint.name}.`, { x, y });
    this.game.events.emit('railChanged');
    return null;
  }

  // Návěstidlo postaví, nebo existující odstraní za polovinu ceny
  toggleSignal(x: number, y: number): string | null {
    const { rail } = this.game.world;
    if (rail.hasSignal(x, y)) {
      rail.removeSignal(x, y);
      this.game.refund(SIGNAL_COST * DEMOLISH_REFUND, 'construction');
    } else {
      if (!rail.canPlaceSignal(x, y)) return 'Návěstidlo jde jen na rovnou kolej bez výhybky.';
      if (this.game.money < SIGNAL_COST) return `Nedostatek peněz (${formatMoney(SIGNAL_COST)}).`;
      this.game.spend(SIGNAL_COST, 'construction');
      rail.addSignal(x, y);
    }
    this.game.events.emit('railChanged');
    return null;
  }

  // Cena depa i se spojkami na kolej vedoucí kolmo před vjezdem
  depotCost(x: number, y: number, entrance: Edge): { cost: number; links: PathStep[] } {
    const { map, rail } = this.game.world;
    const links = depotLinks(rail, x, y, entrance);
    return {
      cost: DEPOT_COST + links.reduce((sum, s) => sum + trackPieceCost(map, s.x, s.y, rail.buildType), 0),
      links,
    };
  }

  // Návěstidla podél tažení (nebo jedno kliknutím); dir = jednosměrné s hranou výjezdu, bez něj obousměrné.
  // Postaví, na co jsou peníze; vrací chybu, když nepostaví žádné
  buildSignals(items: { x: number; y: number; dir?: Edge }[]): string | null {
    const { rail } = this.game.world;
    const placeable = items.filter((s) => rail.canPlaceSignal(s.x, s.y));
    if (placeable.length === 0) return 'Návěstidlo jde jen na kolej bez výhybky, kde ještě žádné není.';
    let built = 0;
    for (const s of placeable) {
      if (this.game.money < SIGNAL_COST) break;
      this.game.spend(SIGNAL_COST, 'construction');
      rail.addSignal(s.x, s.y, s.dir);
      built++;
    }
    if (built > 0) this.game.events.emit('railChanged');
    return built === 0 ? `Nedostatek peněz (${formatMoney(SIGNAL_COST)}).` : null;
  }

  // Další směr návěstidla jako v OpenTTD: obousměrné → jedním směrem → druhým směrem → obousměrné
  cycleSignal(x: number, y: number): string | null {
    const { rail } = this.game.world;
    if (!rail.hasSignal(x, y)) return 'Tady žádné návěstidlo není.';
    const piece = PIECES.findIndex((_, p) => rail.has(x, y, p));
    if (piece < 0) return null;
    const [a, b] = PIECES[piece];
    const dir = rail.signalDir(x, y);
    rail.setSignalDir(x, y, dir === undefined ? b : dir === b ? a : undefined);
    this.game.events.emit('railChanged');
    return null;
  }

  removeSignal(x: number, y: number): string | null {
    const { rail } = this.game.world;
    if (!rail.hasSignal(x, y)) return 'Tady žádné návěstidlo není.';
    rail.removeSignal(x, y);
    this.game.refund(SIGNAL_COST * DEMOLISH_REFUND, 'construction');
    this.game.events.emit('railChanged');
    return null;
  }

  // Cena mostu mezi nájezdy (x0, y0) a (x1, y1): pole mostu a nové koleje na nájezdech
  bridgePlan(x0: number, y0: number, x1: number, y1: number): { cost: number; problem: string | null; span: number } {
    const { rail } = this.game.world;
    const problem = rail.bridgeProblem(x0, y0, x1, y1);
    const span = Math.max(0, Math.abs(x1 - x0) + Math.abs(y1 - y0) - 1);
    const axis = x0 !== x1 ? 'x' : 'y';
    const piece = axisPiece(axis);
    const heads = [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ].filter((h) => !rail.has(h.x, h.y, piece)).length;
    return { cost: bridgeCost(span) + heads * TRACK_PIECE_COST, problem, span };
  }

  // Most jako v OpenTTD: přes koleje, silnice, vodu i souš; nájezdy dostanou kolej ve směru mostu
  buildBridge(x0: number, y0: number, x1: number, y1: number): string | null {
    const { cost, problem } = this.bridgePlan(x0, y0, x1, y1);
    if (problem) return problem;
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    this.game.spend(cost, 'construction');
    this.game.world.rail.addBridge(x0, y0, x1, y1);
    this.game.events.emit('railChanged');
    return null;
  }

  // Cena silničního mostu: pole mostu a nová silnice na nájezdech z volné země
  roadBridgePlan(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { cost: number; problem: string | null; span: number } {
    const { map, rail } = this.game.world;
    const problem = rail.roadBridgeProblem(x0, y0, x1, y1);
    const span = Math.max(0, Math.abs(x1 - x0) + Math.abs(y1 - y0) - 1);
    const heads = [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ].filter((h) => map.isOpenGround(h.x, h.y)).length;
    return { cost: roadBridgeCost(span) + heads * ROAD_TILE_COST, problem, span };
  }

  // Tunel od portálu (x, y) k protějšímu svahu: cena polí tunelu a nové koleje (silnice) v portálech
  tunnelPlan(x: number, y: number, road: boolean): { cost: number; problem: string | null; tunnel: RailBridge | null } {
    const { map, rail } = this.game.world;
    const shape = rail.tunnelShape(x, y, road);
    if (typeof shape === 'string') return { cost: 0, problem: shape, tunnel: null };
    const heads = [shape, bridgeEnd(shape)];
    const piece = axisPiece(bridgeAxis(shape));
    const fresh = road
      ? heads.filter((h) => map.isOpenGround(h.x, h.y)).length * ROAD_TILE_COST
      : heads.filter((h) => !rail.has(h.x, h.y, piece)).length * TRACK_PIECE_COST * railTypeCostFactor(rail.buildType);
    return { cost: tunnelCost(shape.span) + fresh, problem: null, tunnel: shape };
  }

  buildTunnel(x: number, y: number, road = false): string | null {
    const { cost, problem } = this.tunnelPlan(x, y, road);
    if (problem) return problem;
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    this.game.spend(cost, 'construction');
    if (road) this.game.world.rail.addRoadTunnel(x, y);
    else this.game.world.rail.addTunnel(x, y);
    this.game.events.emit('railChanged');
    if (road) this.game.events.emit('roadsChanged');
    return null;
  }

  // Silniční most jako v OpenTTD: přes koleje, silnice, vodu i souš; provoz pod ním zůstane
  buildRoadBridge(x0: number, y0: number, x1: number, y1: number): string | null {
    const { cost, problem } = this.roadBridgePlan(x0, y0, x1, y1);
    if (problem) return problem;
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    this.game.spend(cost, 'construction');
    this.game.world.rail.addRoadBridge(x0, y0, x1, y1);
    this.game.events.emit('railChanged');
    this.game.events.emit('roadsChanged');
    return null;
  }

  // Vlak na mostě (nebo s rezervací přes něj) brání demolici
  private bridgeBlocker(bridge: RailBridge): string | null {
    const { fleet } = this.game;
    const [first] = bridgeSpanTiles(bridge);
    const key = fleet.reservations.segmentKey({
      x: first.x,
      y: first.y,
      piece: 0,
      entry: opposite(bridge.dir),
      exit: bridge.dir,
      span: bridge.span,
    });
    const owner = fleet.trains.find((t) => fleet.reservations.holds(t, key));
    return owner ? `Na mostě je ${owner.name}.` : null;
  }

  buildDepot(x: number, y: number, entrance: Edge, electric = false): string | null {
    const { rail } = this.game.world;
    if (this.game.world.map.inBounds(x, y) && !this.game.world.map.isFlat(x, y)) return 'Depo potřebuje rovný terén.';
    if (!rail.canPlaceDepot(x, y)) return 'Sem depo postavit nelze.';
    const { links } = this.depotCost(x, y, entrance);
    const cost = this.depotCost(x, y, entrance).cost + (electric ? (1 + links.length) * ELECTRIFY_TILE_COST : 0);
    if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
    this.game.spend(cost, 'construction');
    rail.addDepot(x, y, entrance);
    if (electric) rail.setElectrified(x, y, true);
    // Depo se samo napojí na kolej před vjezdem
    for (const link of links) {
      rail.addPiece(link.x, link.y, link.piece);
      if (electric) rail.setElectrified(link.x, link.y, true);
    }
    this.game.events.emit('railChanged');
    return null;
  }

  // Kolik se vrátí za odebrané kusy koleje (a návěstidla na dlaždicích, které zůstanou bez koleje)
  trackRemovalRefund(steps: PathStep[]): number {
    const { map, rail } = this.game.world;
    let refund = 0;
    const left = new Map<string, number>();
    for (const s of steps) {
      if (!rail.has(s.x, s.y, s.piece)) continue;
      refund += trackPieceCost(map, s.x, s.y, rail.railTypeAt(s.x, s.y)) * DEMOLISH_REFUND;
      const key = `${s.x},${s.y}`;
      const remaining = (left.get(key) ?? rail.pieceCount(s.x, s.y)) - 1;
      left.set(key, remaining);
      if (remaining === 0 && rail.hasSignal(s.x, s.y)) refund += SIGNAL_COST * DEMOLISH_REFUND;
    }
    return refund;
  }

  // Odebere jednotlivé kusy koleje (autorail s Ctrl), nástupiště a depa nechá být
  removeTrack(steps: PathStep[]): string | null {
    const { rail } = this.game.world;
    const valid = steps.filter((s) => removableTile(rail, s.x, s.y) && rail.has(s.x, s.y, s.piece));
    if (valid.length === 0) return 'Není co odebrat.';
    for (const s of valid) {
      const blocker = this.game.fleet.demolitionBlocker(s.x, s.y);
      if (blocker) return blocker;
    }
    const refund = this.trackRemovalRefund(valid);
    // Ze stejné dlaždice ještě čekající stavba by kolej hned vrátila
    this.queue = this.queue.filter(
      (job) => job.kind !== 'track' || !valid.some((s) => s.x === job.step.x && s.y === job.step.y),
    );
    for (const s of valid) if (rail.has(s.x, s.y, s.piece)) rail.removePiece(s.x, s.y, s.piece);
    this.game.refund(refund, 'construction');
    const cx = valid.reduce((sum, t) => sum + t.x, 0) / valid.length + 0.5;
    const cz = valid.reduce((sum, t) => sum + t.y, 0) / valid.length + 0.5;
    this.game.events.emit('demolished', refund, cx, cz);
    this.game.events.emit('railChanged');
    return null;
  }

  demolishPlan(area: TilePos[]): DemolishPlan {
    const { map, rail, towns } = this.game.world;
    const tiles: TilePos[] = [];
    const stations = new Set<number>();
    const bridges = new Set<number>();
    let cost = 0;
    let blocked: string | null = null;

    for (const { x, y } of area) {
      if (!map.inBounds(x, y)) continue;
      const type = map.get(x, y);
      const railway = [TileType.Rail, TileType.Crossing, TileType.Bridge, TileType.Station, TileType.Depot].includes(
        type,
      );
      const roadway = [
        TileType.Road,
        TileType.Crossing,
        TileType.RoadStop,
        TileType.RoadDepot,
        TileType.RoadBridgeX,
        TileType.RoadBridgeY,
      ].includes(type);
      const airport = type === TileType.Airport ? rail.stationAt(x, y) : undefined;
      const port = type === TileType.Port ? rail.stationAt(x, y) : undefined;
      const blocker =
        (railway ? this.game.fleet.demolitionBlocker(x, y) : null) ??
        (roadway ? this.game.roadFleet.demolitionBlocker(x, y) : null) ??
        (airport ? this.game.airFleet.demolitionBlocker(airport) : null) ??
        (port ? this.game.shipFleet.demolitionBlocker(port) : null);
      if (blocker) {
        blocked ??= blocker;
        continue;
      }
      // Nájezd silničního mostu zboří most, silnice na nájezdech zůstane; auto na mostě demolici zablokuje
      const roadBridge = type === TileType.Road ? rail.roadBridgeAtHead(x, y) : undefined;
      if (roadBridge) {
        if (bridges.has(roadBridge.id)) continue;
        const car = this.game.roadFleet.onBridge(roadBridge);
        if (car) {
          blocked ??= `Na mostě je ${car.name}.`;
          continue;
        }
        bridges.add(roadBridge.id);
        cost -= spanCost(roadBridge, true) * DEMOLISH_REFUND;
        tiles.push({ x: roadBridge.x, y: roadBridge.y }, bridgeEnd(roadBridge));
        continue;
      }
      // Nájezd mostu zboří celý most (oba nájezdy); vlak na mostě demolici zablokuje
      const bridge = type === TileType.Rail ? rail.bridgeAtHead(x, y) : undefined;
      if (bridge) {
        if (bridges.has(bridge.id)) continue;
        const onBridge = this.bridgeBlocker(bridge);
        if (onBridge) {
          blocked ??= onBridge;
          continue;
        }
        bridges.add(bridge.id);
        cost -= spanCost(bridge, false) * DEMOLISH_REFUND + 2 * TRACK_PIECE_COST * DEMOLISH_REFUND;
        tiles.push({ x: bridge.x, y: bridge.y }, bridgeEnd(bridge));
        continue;
      }
      switch (type) {
        case TileType.Rail:
        case TileType.Crossing:
        case TileType.Bridge:
          cost -= rail.pieceCount(x, y) * trackPieceCost(map, x, y, rail.railTypeAt(x, y)) * DEMOLISH_REFUND;
          if (rail.hasSignal(x, y)) cost -= SIGNAL_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.Station:
        case TileType.Airport:
        case TileType.Port: {
          const station = rail.stationAt(x, y);
          if (!station || stations.has(station.id)) break;
          stations.add(station.id);
          cost -= stationCost(station) * DEMOLISH_REFUND;
          tiles.push(...stationTiles(station));
          break;
        }
        case TileType.Depot:
          cost -= DEPOT_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.RoadStop: {
          const stop = rail.stationAt(x, y);
          if (stop) cost -= ROAD_STOP_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        }
        case TileType.RoadDepot:
          cost -= ROAD_DEPOT_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.Road: {
          const townRoad = map.getOwner(x, y) !== NO_OWNER;
          const refused = townRoad ? this.game.authority.refusal(x, y, 'povolit demolici silnice') : null;
          if (refused) {
            blocked ??= refused;
            break;
          }
          cost += townRoad ? DEMOLISH_TOWN_ROAD_COST : -ROAD_TILE_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        }
        case TileType.RoadBridgeX:
        case TileType.RoadBridgeY:
          cost -= ROAD_BRIDGE_COST * DEMOLISH_REFUND;
          tiles.push({ x, y });
          break;
        case TileType.Building: {
          const building = buildingAt(towns[map.getOwner(x, y)], x, y);
          if (!building) break;
          const refused = this.game.authority.refusal(x, y, 'povolit demolici budovy');
          if (refused) {
            blocked ??= refused;
            break;
          }
          cost += buildingCapacity(building.model) * DEMOLISH_COST_PER_RESIDENT;
          tiles.push({ x, y });
          break;
        }
        case TileType.Trees:
          cost += DEMOLISH_TREES_COST;
          tiles.push({ x, y });
          break;
      }
    }
    return { tiles, cost, blocked };
  }

  demolish(area: TilePos[]): string | null {
    const plan = this.demolishPlan(area);
    if (plan.blocked) return plan.blocked;
    if (plan.tiles.length === 0) return null;
    if (plan.cost > this.game.money) return `Nedostatek peněz na demolici (${formatMoney(plan.cost)}).`;

    const { map, rail, towns } = this.game.world;
    let railChanged = false;
    let roadsChanged = false;
    let townsChanged = false;
    let treesChanged = false;

    // Silniční mosty napřed: jejich nájezdy (silnice) zůstanou
    const keep = new Set<number>();
    for (const { x, y } of plan.tiles) {
      const bridge = map.isType(x, y, TileType.Road) ? rail.roadBridgeAtHead(x, y) : undefined;
      if (!bridge) continue;
      for (const head of [{ x: bridge.x, y: bridge.y }, bridgeEnd(bridge)]) keep.add(head.y * map.width + head.x);
      rail.removeRoadBridge(bridge);
      railChanged = true;
      roadsChanged = true;
    }
    for (const { x, y } of plan.tiles) {
      if (keep.has(y * map.width + x)) continue;
      switch (map.get(x, y)) {
        case TileType.Trees:
          map.set(x, y, TileType.Grass);
          treesChanged = true;
          break;
        case TileType.Rail:
        case TileType.Crossing:
        case TileType.Bridge: {
          const bridge = rail.bridgeAtHead(x, y);
          if (bridge) rail.removeBridge(bridge);
          else rail.removeTrack(x, y);
          railChanged = true;
          break;
        }
        case TileType.Station:
        case TileType.Airport:
        case TileType.Port: {
          const station = rail.stationAt(x, y);
          if (station) rail.removeStation(station);
          railChanged = true;
          break;
        }
        case TileType.Depot: {
          const depot = rail.depotAt(x, y);
          if (depot) rail.removeDepot(depot);
          railChanged = true;
          break;
        }
        // Zbouráním zastávky zůstane silnice
        case TileType.RoadStop: {
          const stop = rail.stationAt(x, y);
          if (stop) rail.removeStation(stop);
          railChanged = true;
          break;
        }
        case TileType.RoadDepot: {
          const depot = rail.roadDepotAt(x, y);
          if (depot) rail.removeRoadDepot(depot);
          railChanged = true;
          break;
        }
        case TileType.Road:
          if (map.getOwner(x, y) !== NO_OWNER) this.game.authority.townRoadDemolished(x, y);
          map.set(x, y, TileType.Grass);
          map.setOwner(x, y, NO_OWNER);
          roadsChanged = true;
          break;
        // Zbouráním mostu se obnoví voda
        case TileType.RoadBridgeX:
        case TileType.RoadBridgeY:
          map.set(x, y, TileType.Water);
          roadsChanged = true;
          break;
        case TileType.Building: {
          const town = towns[map.getOwner(x, y)];
          const building = buildingAt(town, x, y);
          if (building) {
            demolishBuilding(map, town, building);
            this.game.authority.buildingDemolished(x, y);
          }
          townsChanged = true;
          break;
        }
      }
    }

    if (plan.cost > 0) this.game.spend(plan.cost, 'construction');
    else this.game.refund(-plan.cost, 'construction');
    if (plan.cost !== 0) {
      const cx = plan.tiles.reduce((sum, t) => sum + t.x, 0) / plan.tiles.length + 0.5;
      const cz = plan.tiles.reduce((sum, t) => sum + t.y, 0) / plan.tiles.length + 0.5;
      this.game.events.emit('demolished', -plan.cost, cx, cz);
    }
    if (railChanged) this.game.events.emit('railChanged');
    if (roadsChanged) this.game.events.emit('roadsChanged');
    if (townsChanged) this.game.events.emit('townsChanged');
    if (treesChanged) this.game.events.emit('treesChanged');
    return null;
  }

  update(dtMs: number): void {
    if (this.queue.length === 0 || this.game.clock.paused) return;
    this.elapsed += dtMs;
    const interval = 1000 / PIECES_PER_SECOND;
    let railChanged = false;
    let roadsChanged = false;

    const { rail } = this.game.world;
    // Výběr druhu koleje v nástrojích se stavbou z fronty nemění
    const selected = rail.buildType;
    while (this.elapsed >= interval && this.queue.length > 0) {
      const job = this.queue[0];
      rail.buildType = job.kind === 'track' ? (job.type ?? RailType.Rail) : selected;
      // Hotové nebo mezitím zabrané místo (např. růstem města) se přeskočí
      if (!(job.kind === 'track' ? this.trackPlaceable(job.step, job.electric) : this.roadPlaceable(job.step))) {
        this.queue.shift();
        continue;
      }
      const { map } = this.game.world;
      const cost = job.kind === 'track' ? this.trackJobCost(job) : roadPieceCost(map, job.step.x, job.step.y);
      if (this.game.money < cost) {
        this.queue = [];
        this.game.events.emit('outOfMoney');
        break;
      }
      this.queue.shift();
      this.elapsed -= interval;
      this.game.spend(cost, 'construction');
      if (job.kind === 'track') {
        if (!rail.has(job.step.x, job.step.y, job.step.piece)) rail.addPiece(job.step.x, job.step.y, job.step.piece);
        if (job.electric) rail.setElectrified(job.step.x, job.step.y, true);
        railChanged = true;
      } else {
        this.placeRoad(job.step);
        roadsChanged = true;
      }
    }
    rail.buildType = selected;
    if (this.queue.length === 0) this.elapsed = 0;
    if (railChanged) this.game.events.emit('railChanged');
    if (roadsChanged) this.game.events.emit('roadsChanged');
  }

  // Nový kus koleje, nebo u elektrizované stavby existující kolej bez trolejí (dostane vedení)
  private trackPlaceable(step: PathStep, electric = false): boolean {
    const { rail } = this.game.world;
    if (rail.has(step.x, step.y, step.piece)) return electric && !rail.isElectrified(step.x, step.y);
    return rail.canPlace(step.x, step.y, step.piece);
  }

  private trackJobCost(job: { step: PathStep; electric?: boolean; type?: RailType }): number {
    const { map, rail } = this.game.world;
    const { x, y, piece } = job.step;
    const track = rail.has(x, y, piece) ? 0 : trackPieceCost(map, x, y, job.type);
    return track + (job.electric && !rail.isElectrified(x, y) ? ELECTRIFY_TILE_COST : 0);
  }

  // Elektrizace jako převod druhu koleje v OpenTTD: na dlaždicích s kolejí natáhne trolejové vedení,
  // s remove ho odstraní (vrátí polovinu ceny). Vrací chybu, nebo null.
  electrify(tiles: readonly TilePos[], remove = false): string | null {
    const { rail } = this.game.world;
    // Trolejové vedení jen na železnici (jednokolejka a maglev ho nepotřebují)
    const targets = tiles.filter(
      (t) =>
        rail.hasTrack(t.x, t.y) &&
        rail.railTypeAt(t.x, t.y) === RailType.Rail &&
        rail.isElectrified(t.x, t.y) === remove,
    );
    if (targets.length === 0) return remove ? 'Tady trolejové vedení není.' : 'Tady není kolej bez trolejí.';
    if (remove) {
      const blocker = this.game.fleet.electricBlocker(targets);
      if (blocker) return blocker;
      for (const t of targets) rail.setElectrified(t.x, t.y, false);
      this.game.refund(targets.length * ELECTRIFY_TILE_COST * DEMOLISH_REFUND, 'construction');
    } else {
      const cost = targets.length * ELECTRIFY_TILE_COST;
      if (this.game.money < cost) return `Nedostatek peněz (${formatMoney(cost)}).`;
      this.game.spend(cost, 'construction');
      for (const t of targets) rail.setElectrified(t.x, t.y, true);
    }
    this.game.events.emit('railChanged');
    return null;
  }

  electrifyCost(tiles: readonly TilePos[], remove = false): { count: number; cost: number } {
    const { rail } = this.game.world;
    const count = tiles.filter(
      (t) =>
        rail.hasTrack(t.x, t.y) &&
        rail.railTypeAt(t.x, t.y) === RailType.Rail &&
        rail.isElectrified(t.x, t.y) === remove,
    ).length;
    return { count, cost: count * ELECTRIFY_TILE_COST * (remove ? -DEMOLISH_REFUND : 1) };
  }

  private roadPlaceable(step: RoadStep): boolean {
    const { map, rail } = this.game.world;
    const type = map.get(step.x, step.y);
    if (map.isOpenGround(step.x, step.y)) return true;
    if (type === TileType.Water) return step.axis !== undefined && !rail.isBerth(step.x, step.y);
    // Přejezd jen přes samotnou rovnou kolej
    const mask = rail.mask(step.x, step.y);
    return type === TileType.Rail && (mask === 1 || mask === 2);
  }

  private placeRoad(step: RoadStep): void {
    const { map } = this.game.world;
    const type = map.get(step.x, step.y);
    if (type === TileType.Water)
      map.set(step.x, step.y, step.axis === 'x' ? TileType.RoadBridgeX : TileType.RoadBridgeY);
    else map.set(step.x, step.y, type === TileType.Rail ? TileType.Crossing : TileType.Road);
  }
}
