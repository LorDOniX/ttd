import {
  CARGO_DIST_DISTANCE_SCALE,
  CARGO_DIST_OVERLOAD_PENALTY,
  CARGO_DIST_ROUNDS,
  CARGO_DIST_STOP_DAYS,
} from './balance';
import {
  destTotal,
  trimDests,
  type Cargo,
  type Carrier,
  type DestSplit,
  type LoadRoute,
  type TransferPacket,
} from './cargo';
import { cargoCapacity, consistCargos, wagonCapacity } from './consist';
import type { Game } from './game';
import { inflowFactor } from './rating';
import { aircraftCapacity, aircraftCargo, aircraftModel } from './aircraft';
import { roadVehicleModel, vehicleCapacity, vehicleCargo } from './roadVehicles';
import { shipCapacity, shipCargo, shipModel } from './ships';
import { isSpecialOrder, orderFlags, refitLoadStops, trainModel, type Train } from './trains';
import { MinHeap } from '../world/heap';
import { INDUSTRY_TYPES } from '../world/industry';
import { poolId, type RailNetwork, type Station } from '../world/rail';

const DAYS_PER_MONTH = 30;

// Distribuce nákladu jako v OpenTTD: ručně (náklad jede, kam ho vozidlo doveze), asymetricky (cíl je
// stanice, která náklad přijímá) a symetricky (cestující a pošta jezdí tam i zpět)
export type DistributionMode = 'manual' | 'asymmetric' | 'symmetric';

export interface DistributionSettings {
  passengers: DistributionMode;
  mail: DistributionMode;
  // Ostatní náklad symetricky nejde (zboží se nevrací)
  freight: Exclude<DistributionMode, 'symmetric'>;
}

export type DistributionClass = keyof DistributionSettings;

export const DISTRIBUTION_CLASSES: readonly DistributionClass[] = ['passengers', 'mail', 'freight'];

export const DISTRIBUTION_CLASS_LABELS: Record<DistributionClass, string> = {
  passengers: 'Cestující',
  mail: 'Pošta',
  freight: 'Ostatní náklad',
};

export const DISTRIBUTION_LABELS: Record<DistributionMode, string> = {
  manual: 'Ručně',
  asymmetric: 'Asymetricky',
  symmetric: 'Symetricky',
};

// Volby, které třída nákladu nabízí
export function distributionModes(kind: DistributionClass): readonly DistributionMode[] {
  return kind === 'freight' ? ['manual', 'asymmetric'] : ['manual', 'asymmetric', 'symmetric'];
}

// Starší uložení a testy: všechno ručně, tedy beze změny chování
export function manualDistribution(): DistributionSettings {
  return { passengers: 'manual', mail: 'manual', freight: 'manual' };
}

// Nová hra: cestující a pošta symetricky, ostatní náklad ručně
export function newGameDistribution(): DistributionSettings {
  return { passengers: 'symmetric', mail: 'symmetric', freight: 'manual' };
}

export function distributionClass(cargo: Cargo): DistributionClass {
  return cargo === 'passengers' || cargo === 'mail' ? cargo : 'freight';
}

export function distributionOf(settings: DistributionSettings, cargo: Cargo): DistributionMode {
  return settings[distributionClass(cargo)];
}

// Ověří nastavení z uložení; neplatné volby jsou ručně
export function parseDistribution(value: unknown): DistributionSettings {
  const settings = manualDistribution();
  if (typeof value !== 'object' || value === null) return settings;
  const data = value as Record<string, unknown>;
  for (const kind of DISTRIBUTION_CLASSES) {
    const mode = data[kind];
    if (typeof mode === 'string' && (distributionModes(kind) as readonly string[]).includes(mode)) {
      (settings as unknown as Record<string, DistributionMode>)[kind] = mode as DistributionMode;
    }
  }
  return settings;
}

// Linka vozidla pro jeden druh nákladu: zastávky po řadě (spojené stanice), kapacita a rychlost
export interface CargoRoute {
  cargo: Cargo;
  // Id spojených stanic (hlavních částí) v pořadí řádu; řád se objíždí dokola
  stops: number[];
  // Souřadnice zastávek (části, kam vozidlo jede) pro délku kola
  points: { x: number; y: number }[];
  capacity: number;
  // Dlaždice za den
  speed: number;
}

// Spojení dvou stanic v grafu linek: kapacita za měsíc a vzdálenost v dlaždicích
export interface Link {
  from: number;
  to: number;
  capacity: number;
  distance: number;
}

// Graf linek jednoho druhu nákladu: z → do → spojení
export type LinkGraph = Map<number, Map<number, Link>>;

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Zastávky řádu jako spojené stanice; po sobě jdoucí části téže stanice splynou
function routeStops(rail: RailNetwork, ids: readonly number[]): { stops: number[]; points: Station[] } {
  const stops: number[] = [];
  const points: Station[] = [];
  for (const id of ids) {
    const station = rail.stations.find((s) => s.id === id);
    if (!station) continue;
    const pool = poolId(station);
    if (stops.length > 0 && stops[stops.length - 1] === pool) continue;
    stops.push(pool);
    points.push(station);
  }
  while (stops.length > 1 && stops[0] === stops[stops.length - 1]) {
    stops.pop();
    points.pop();
  }
  return { stops, points };
}

// Zastávky vlaku, kde se nakládá a vykládá: bez dep, průjezdných bodů a průjezdů bez zastavení
function trainStops(train: Train, cargo: Cargo): number[] {
  const orders = train.orders ?? [];
  const refit = !consistCargos(train).includes(cargo);
  const allowed = refit ? new Set(refitLoadStops(train, cargo)) : null;
  return orders.filter((id, i) => {
    const flags = orderFlags(train, i);
    if (isSpecialOrder(flags) || flags.via) return false;
    return !allowed || allowed.has(id);
  });
}

// Linky všech vozidel v provozu (stojící v depu se nepočítají) pro každý druh nákladu, který vezou
export function vehicleRoutes(game: Game): CargoRoute[] {
  const { rail } = game.world;
  const routes: CargoRoute[] = [];
  const add = (cargo: Cargo, ids: readonly number[], capacity: number, speed: number): void => {
    const { stops, points } = routeStops(rail, ids);
    if (stops.length < 2 || capacity <= 0) return;
    routes.push({ cargo, stops, points, capacity, speed });
  };
  for (const train of game.fleet.trains) {
    if (!train.orders || train.state === 'depot') continue;
    const speed = trainModel(train).speed;
    const refits = (train.orderFlags ?? []).flatMap((f) => (f.refit ? [f.refit] : []));
    for (const cargo of new Set([...consistCargos(train), ...refits])) {
      // Po přestavbě v řádu vezou náklad všechny vagony
      const capacity = cargoCapacity(train, cargo) || train.wagons * wagonCapacity(cargo);
      add(cargo, trainStops(train, cargo), capacity, speed);
    }
  }
  for (const vehicle of game.roadFleet.vehicles) {
    if (!vehicle.orders || vehicle.state === 'depot') continue;
    add(vehicleCargo(vehicle), vehicle.orders, vehicleCapacity(vehicle), roadVehicleModel(vehicle).speed);
  }
  for (const plane of game.airFleet.aircraft) {
    if (!plane.orders || plane.state === 'hangar') continue;
    add(aircraftCargo(plane), plane.orders, aircraftCapacity(plane), aircraftModel(plane).speed);
  }
  for (const ship of game.shipFleet.ships) {
    if (!ship.orders || ship.state === 'depot') continue;
    add(shipCargo(ship), ship.orders, shipCapacity(ship), shipModel(ship).speed);
  }
  return routes;
}

// Kolikrát za měsíc vozidlo objede řád: jízda celého kola a stání na každé zastávce
export function tripsPerMonth(route: CargoRoute): number {
  let tiles = 0;
  route.points.forEach((p, i) => (tiles += distance(p, route.points[(i + 1) % route.points.length])));
  const days = tiles / Math.max(0.1, route.speed) + route.stops.length * CARGO_DIST_STOP_DAYS;
  return DAYS_PER_MONTH / Math.max(1, days);
}

// Graf linek jednoho druhu nákladu: každá dvojice po sobě jdoucích zastávek je spojení, kapacity linek
// se sčítají
export function buildLinkGraph(routes: readonly CargoRoute[], cargo: Cargo): LinkGraph {
  const graph: LinkGraph = new Map();
  for (const route of routes) {
    if (route.cargo !== cargo) continue;
    const monthly = route.capacity * tripsPerMonth(route);
    route.stops.forEach((from, i) => {
      const j = (i + 1) % route.stops.length;
      const to = route.stops[j];
      if (from === to) return;
      const links = graph.get(from) ?? new Map<number, Link>();
      graph.set(from, links);
      const link = links.get(to);
      if (link) link.capacity += monthly;
      else links.set(to, { from, to, capacity: monthly, distance: distance(route.points[i], route.points[j]) });
    });
  }
  return graph;
}

// Spojení grafu jako seznam (pro okno stanice a testy)
export function graphLinks(graph: LinkGraph): Link[] {
  return [...graph.values()].flatMap((links) => [...links.values()]);
}

// Nabídka a cíle pro výpočet poptávky jednoho druhu nákladu
export interface DemandInput {
  // Měsíční nabídka stanice (hlavní části)
  supply: ReadonlyMap<number, number>;
  // Stanice, které náklad přijímají (smí být cílem)
  accepts: ReadonlySet<number>;
  // Poloha stanice pro vliv vzdálenosti
  positions: ReadonlyMap<number, { x: number; y: number }>;
}

// Poptávka: zdroj → cíl → měsíční množství
export type Demand = Map<number, Map<number, number>>;

// Toky: stanice → cíl → další zastávka → měsíční množství
export type Flows = Map<number, Map<number, Map<number, number>>>;

// Stanice dosažitelné ze stanice po grafu
export function reachable(graph: LinkGraph, from: number): Set<number> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const to of graph.get(at)?.keys() ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  seen.delete(from);
  return seen;
}

// Poptávka jako v OpenTTD: nabídka zdroje se rozdělí mezi dosažitelné cíle, které náklad přijímají.
// Symetricky podle nabídky cíle (velká města přitahují víc cestujících), asymetricky rovným dílem;
// vzdálenost váhu cíle snižuje
export function computeDemand(graph: LinkGraph, input: DemandInput, mode: DistributionMode): Demand {
  const demand: Demand = new Map();
  if (mode === 'manual') return demand;
  for (const [source, supply] of input.supply) {
    if (supply <= 0 || !graph.has(source)) continue;
    const from = input.positions.get(source);
    const weights = new Map<number, number>();
    for (const dest of reachable(graph, source)) {
      if (!input.accepts.has(dest)) continue;
      const base = mode === 'symmetric' ? (input.supply.get(dest) ?? 0) : 1;
      const to = input.positions.get(dest);
      const d = from && to ? distance(from, to) : 0;
      const weight = base / (1 + d / CARGO_DIST_DISTANCE_SCALE);
      if (weight > 0) weights.set(dest, weight);
    }
    const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
    if (total <= 0) continue;
    demand.set(source, new Map([...weights].map(([dest, w]) => [dest, (supply * w) / total])));
  }
  return demand;
}

// Nejkratší cesty ze stanice; cena spojení je délka, přetížené spojení se prodraží
function shortestTree(graph: LinkGraph, from: number, load?: ReadonlyMap<Link, number>): Map<number, number> {
  const cost = new Map<number, number>([[from, 0]]);
  const previous = new Map<number, number>();
  const ids = new Map<number, number>();
  const nodes: number[] = [];
  const index = (node: number): number => {
    let i = ids.get(node);
    if (i === undefined) {
      i = nodes.length;
      ids.set(node, i);
      nodes.push(node);
    }
    return i;
  };
  const heap = new MinHeap();
  heap.push(index(from), 0);
  const done = new Set<number>();
  while (heap.size > 0) {
    const at = nodes[heap.pop()];
    if (done.has(at)) continue;
    done.add(at);
    for (const link of graph.get(at)?.values() ?? []) {
      const used = load?.get(link) ?? 0;
      const over = link.capacity > 0 ? used / link.capacity : 1;
      const step = Math.max(1, link.distance) * (1 + CARGO_DIST_OVERLOAD_PENALTY * Math.max(0, over - 1) + 0.01 * over);
      const next = cost.get(at)! + step;
      if (next < (cost.get(link.to) ?? Infinity)) {
        cost.set(link.to, next);
        previous.set(link.to, at);
        heap.push(index(link.to), next);
      }
    }
  }
  return previous;
}

// Cesta ze stromu nejkratších cest: zdroj, …, cíl (prázdná, když cíl není dosažitelný)
function treePath(previous: ReadonlyMap<number, number>, from: number, to: number): number[] {
  const path = [to];
  let at = to;
  while (at !== from) {
    const prev = previous.get(at);
    if (prev === undefined) return [];
    path.push(prev);
    at = prev;
  }
  return path.reverse();
}

// Další zastávka po nejkratší cestě ze stanice k cíli, nebo undefined (cíl je nedosažitelný)
export function shortestNextHop(graph: LinkGraph, from: number, to: number): number | undefined {
  if (from === to) return undefined;
  const path = treePath(shortestTree(graph, from), from, to);
  return path.length > 1 ? path[1] : undefined;
}

// Toky jako zjednodušený multikomoditní tok v OpenTTD: poptávka se rozkládá po dávkách po nejkratších
// cestách a každá dávka vidí zatížení spojení předchozími, takže přetížené spojení si náklad najde objížďku
export function computeFlows(graph: LinkGraph, demand: Demand): Flows {
  const flows: Flows = new Map();
  const load = new Map<Link, number>();
  const add = (station: number, dest: number, next: number, amount: number): void => {
    const byDest = flows.get(station) ?? new Map<number, Map<number, number>>();
    flows.set(station, byDest);
    const byNext = byDest.get(dest) ?? new Map<number, number>();
    byDest.set(dest, byNext);
    byNext.set(next, (byNext.get(next) ?? 0) + amount);
  };
  for (let round = 0; round < CARGO_DIST_ROUNDS; round++) {
    for (const [source, dests] of demand) {
      const previous = shortestTree(graph, source, load);
      for (const [dest, amount] of dests) {
        const path = treePath(previous, source, dest);
        if (path.length < 2) continue;
        const part = amount / CARGO_DIST_ROUNDS;
        for (let i = 0; i + 1 < path.length; i++) {
          add(path[i], dest, path[i + 1], part);
          const link = graph.get(path[i])!.get(path[i + 1])!;
          load.set(link, (load.get(link) ?? 0) + part);
        }
      }
    }
  }
  return flows;
}

// Poptávka a toky jednoho druhu nákladu; platí pro graf s daným klíčem (seznamem spojení)
interface CargoPlan {
  key: string;
  demand: Demand;
  flows: Flows;
}

function graphKey(graph: LinkGraph): string {
  return graphLinks(graph)
    .map((l) => `${l.from}>${l.to}`)
    .sort()
    .join(',');
}

// Distribuce nákladu: graf linek, poptávka a toky pro druhy nákladu, které se nerozvážejí ručně.
// Graf se staví znovu po změně vozidel a řádů; poptávka a toky každý měsíc a po změně spojení
export class CargoDist {
  settings: DistributionSettings = manualDistribution();
  private graphs: Map<Cargo, LinkGraph> | null = null;
  private plans = new Map<Cargo, CargoPlan>();

  constructor(private readonly game: Game) {
    const invalidate = (): void => {
      this.graphs = null;
    };
    for (const event of [
      'trainsChanged',
      'vehiclesChanged',
      'aircraftChanged',
      'shipsChanged',
      'railChanged',
    ] as const) {
      game.events.on(event, invalidate);
    }
    game.clock.events.on('month', () => {
      this.graphs = null;
      this.plans.clear();
      this.dropUnreachable();
    });
  }

  mode(cargo: Cargo): DistributionMode {
    return distributionOf(this.settings, cargo);
  }

  // Rozváží se náklad podle cílů?
  enabled(cargo: Cargo): boolean {
    return this.mode(cargo) !== 'manual';
  }

  setMode(kind: DistributionClass, mode: DistributionMode): void {
    if (!distributionModes(kind).includes(mode)) return;
    (this.settings as unknown as Record<string, DistributionMode>)[kind] = mode;
    this.graphs = null;
    this.plans.clear();
    // Ručně se čerstvý náklad nerozděluje: plán stanic se zahodí (náklad zůstane, jen bez cíle)
    if (mode === 'manual') {
      for (const station of this.game.world.rail.primaries()) {
        for (const cargo of Object.keys(station.planned ?? {}) as Cargo[]) {
          if (distributionClass(cargo) === kind) delete station.planned![cargo];
        }
      }
    }
    this.game.events.emit('stationsChanged');
  }

  // Náklad z překládek, jehož cíl už po síti není dosažitelný, ztratí cíl (nastoupí do čehokoli
  // a doručí se jako dosud)
  private dropUnreachable(): void {
    for (const station of this.game.world.rail.primaries()) {
      for (const [cargo, packets] of Object.entries(station.transfers ?? {}) as [Cargo, TransferPacket[]][]) {
        if (!this.enabled(cargo)) continue;
        for (const packet of packets) {
          if (packet.dest !== undefined && this.nextHops(station, cargo, packet.dest).size === 0) delete packet.dest;
        }
      }
    }
  }

  // Graf linek druhu nákladu (i při ruční distribuci, kvůli přehledu)
  graph(cargo: Cargo): LinkGraph {
    if (!this.graphs) {
      const routes = vehicleRoutes(this.game);
      this.graphs = new Map();
      for (const c of new Set(routes.map((r) => r.cargo))) this.graphs.set(c, buildLinkGraph(routes, c));
    }
    return this.graphs.get(cargo) ?? new Map();
  }

  // Spojení ze stanice (hlavní části) pro daný náklad
  linksFrom(station: Station, cargo: Cargo): Link[] {
    return [...(this.graph(cargo).get(poolId(station))?.values() ?? [])];
  }

  // Měsíční nabídka stanice: cestující a pošta z měst v dosahu, náklad z obsluhovaných závodů
  supply(station: Station, cargo: Cargo): number {
    const { game } = this;
    const primary = game.world.rail.primaryOf(station);
    const factor = inflowFactor(primary.ratings[cargo].rating);
    if (cargo === 'passengers') return game.passengers.inflow(primary);
    if (cargo === 'mail') return game.freight.monthlyMail(primary) * factor;
    let sum = 0;
    for (const industry of game.freight.industriesInReach(primary)) {
      if (INDUSTRY_TYPES[industry.kind].produces !== cargo) continue;
      const pickup = game.freight.pickupStations(industry);
      if (pickup.some((s) => s.id === primary.id)) sum += (industry.production / pickup.length) * factor;
    }
    return sum;
  }

  // Smí být stanice cílem nákladu? Cestující jedou do měst, ostatní náklad tam, kde se vykupuje
  accepts(station: Station, cargo: Cargo): boolean {
    const primary = this.game.world.rail.primaryOf(station);
    if (cargo === 'passengers') return this.game.passengers.townsInReach(primary).length > 0;
    return this.game.freight.accepted(primary).includes(cargo);
  }

  private plan(cargo: Cargo): CargoPlan {
    const graph = this.graph(cargo);
    // Klíč i s volbou distribuce: nastavení jde přiřadit i přímo (načtení hry)
    const key = `${this.mode(cargo)}|${graphKey(graph)}`;
    const cached = this.plans.get(cargo);
    if (cached && cached.key === key) return cached;
    const { rail } = this.game.world;
    const supply = new Map<number, number>();
    const accepts = new Set<number>();
    const positions = new Map<number, { x: number; y: number }>();
    const nodes = new Set([...graph.keys(), ...graphLinks(graph).map((l) => l.to)]);
    for (const id of nodes) {
      const station = rail.stations.find((s) => s.id === id);
      if (!station) continue;
      supply.set(id, this.supply(station, cargo));
      if (this.accepts(station, cargo)) accepts.add(id);
      positions.set(id, { x: station.x, y: station.y });
    }
    const demand = computeDemand(graph, { supply, accepts, positions }, this.mode(cargo));
    const plan = { key, demand, flows: computeFlows(graph, demand) };
    this.plans.set(cargo, plan);
    return plan;
  }

  // Měsíční poptávka ze stanice podle cíle (prázdná při ruční distribuci)
  demandFrom(station: Station, cargo: Cargo): Map<number, number> {
    if (!this.enabled(cargo)) return new Map();
    return this.plan(cargo).demand.get(poolId(station)) ?? new Map();
  }

  // Plánované toky přes stanici: cíl → další zastávka → měsíční množství
  flowsAt(station: Station, cargo: Cargo): Map<number, Map<number, number>> {
    if (!this.enabled(cargo)) return new Map();
    return this.plan(cargo).flows.get(poolId(station)) ?? new Map();
  }

  // Podíly dalších zastávek pro náklad ze stanice k cíli: podle toků, jinak nejkratší cesta;
  // prázdné, když cíl není po síti dosažitelný
  nextHops(station: Station, cargo: Cargo, dest: number): Map<number, number> {
    const from = poolId(station);
    if (from === dest) return new Map();
    const planned = this.flowsAt(station, cargo).get(dest);
    const total = planned ? [...planned.values()].reduce((sum, v) => sum + v, 0) : 0;
    if (planned && total > 0) return new Map([...planned].map(([next, v]) => [next, v / total]));
    const next = shortestNextHop(this.graph(cargo), from, dest);
    return next === undefined ? new Map() : new Map([[next, 1]]);
  }

  // Id spojené stanice podle id části (undefined, když stanice neexistuje)
  poolOf(id: number | undefined): number | undefined {
    if (id === undefined) return undefined;
    const station = this.game.world.rail.stations.find((s) => s.id === id);
    return station ? poolId(station) : undefined;
  }

  // Nový čerstvý náklad na stanici: rozdělí se podle poptávky mezi cíle a podle toků mezi další zastávky.
  // Bez cílů (nikam nevede spojení) zůstane bez cíle
  addFresh(station: Station, cargo: Cargo, amount: number): void {
    if (amount <= 0 || !this.enabled(cargo)) return;
    const demand = this.demandFrom(station, cargo);
    let total = 0;
    for (const v of demand.values()) total += v;
    if (total <= 0) return;
    const planned = ((station.planned ??= {})[cargo] ??= {});
    for (const [dest, d] of demand) {
      for (const [next, share] of this.nextHops(station, cargo, dest)) {
        const key = `${next}:${dest}`;
        planned[key] = (planned[key] ?? 0) + (amount * d * share) / total;
      }
    }
  }

  // Čerstvý náklad podle cíle srovnaný s celkem na stanici (odchod nespokojených ho zmenšuje poměrně)
  // a přesměrovaný po změně sítě: náklad, jehož další zastávka už k cíli nevede, dostane novou;
  // k nedosažitelnému cíli ztratí cíl
  private fitPlanned(station: Station, cargo: Cargo, total: number): Record<string, number> {
    const planned = ((station.planned ??= {})[cargo] ??= {});
    const entries = Object.entries(planned);
    let sum = 0;
    for (const [, v] of entries) sum += v;
    const scale = sum > total && sum > 0 ? Math.max(0, total) / sum : 1;
    for (const [key, value] of entries) {
      const amount = value * scale;
      const [next, dest] = key.split(':').map(Number);
      const hops = this.nextHops(station, cargo, dest);
      if (amount <= 1e-6 || hops.size === 0) {
        delete planned[key];
        continue;
      }
      if (hops.has(next)) {
        planned[key] = amount;
        continue;
      }
      delete planned[key];
      for (const [hop, share] of hops) {
        const k = `${hop}:${dest}`;
        planned[k] = (planned[k] ?? 0) + amount * share;
      }
    }
    return planned;
  }

  // Co smí nastoupit do vozidla, které odtud jede na zastávku next (id stanice); undefined = ručně
  boardingRoute(station: Station, cargo: Cargo, next: number | undefined, total: number): LoadRoute | undefined {
    if (!this.enabled(cargo)) return undefined;
    const planned = this.fitPlanned(station, cargo, total);
    const hop = this.poolOf(next);
    const fresh: { dest?: number; amount: number }[] = [];
    let destined = 0;
    for (const [key, amount] of Object.entries(planned)) {
      destined += amount;
      const [n, dest] = key.split(':').map(Number);
      if (hop !== undefined && n === hop) fresh.push({ dest, amount });
    }
    fresh.push({ amount: Math.max(0, total - destined) });
    return {
      // Balík z překládky nastoupí, když jede přes další zastávku vozidla; k nedosažitelnému cíli kamkoli
      boards: (dest) => {
        if (dest === undefined) return true;
        const hops = this.nextHops(station, cargo, dest);
        return hops.size === 0 || (hop !== undefined && hops.has(hop));
      },
      fresh,
    };
  }

  // Odebere naložený čerstvý náklad s cílem z plánu stanice
  consumeFresh(station: Station, cargo: Cargo, next: number | undefined, taken: { dest?: number; amount: number }[]) {
    const planned = station.planned?.[cargo];
    const hop = this.poolOf(next);
    if (!planned || hop === undefined) return;
    for (const t of taken) {
      if (t.dest === undefined) continue;
      const key = `${hop}:${t.dest}`;
      const left = (planned[key] ?? 0) - t.amount;
      if (left > 1e-6) planned[key] = left;
      else delete planned[key];
    }
  }

  // Náklad na palubě vozidla, které stojí na stanici a pojede na next: doručit, nechat, přeložit, bez cíle.
  // Cíle, které už nejsou dosažitelné (nebo cíl náklad přestal přijímat), se z paluby smažou
  split(station: Station, cargo: Cargo, carrier: Carrier, next: number | undefined): DestSplit | undefined {
    if (!this.enabled(cargo)) return undefined;
    trimDests(carrier);
    const here = poolId(station);
    const hop = this.poolOf(next);
    const result: DestSplit = { deliver: 0, keep: new Map(), transfers: new Map(), undestined: 0 };
    for (const [key, amount] of Object.entries(carrier.dests ?? {})) {
      const dest = Number(key);
      if (dest === here) {
        if (this.accepts(station, cargo)) result.deliver += amount;
        else delete carrier.dests![dest];
        continue;
      }
      const hops = this.nextHops(station, cargo, dest);
      if (hops.size === 0) delete carrier.dests![dest];
      else if (hop !== undefined && hops.has(hop)) result.keep.set(dest, amount);
      else result.transfers.set(dest, amount);
    }
    trimDests(carrier);
    result.undestined = Math.max(0, carrier.passengers - destTotal(carrier.dests));
    return result;
  }

  // Jméno stanice podle id spojené stanice
  stationName(id: number): string {
    return this.game.world.rail.stations.find((s) => s.id === id)?.name ?? `stanice ${id}`;
  }

  // Čekající náklad podle cíle (čerstvý i z překládek) a hlavní další zastávka; dest undefined = bez cíle
  waitingByDest(station: Station, cargo: Cargo, fresh: number): { dest?: number; next?: number; amount: number }[] {
    const byDest = new Map<number | undefined, number>();
    const add = (dest: number | undefined, amount: number): void => {
      if (amount > 0) byDest.set(dest, (byDest.get(dest) ?? 0) + amount);
    };
    const planned = Object.entries(station.planned?.[cargo] ?? {});
    let sum = 0;
    for (const [, v] of planned) sum += v;
    const scale = sum > fresh && sum > 0 ? fresh / sum : 1;
    for (const [key, v] of planned) add(Number(key.split(':')[1]), v * scale);
    add(undefined, fresh - Math.min(fresh, sum));
    for (const packet of station.transfers?.[cargo] ?? []) add(packet.dest, packet.amount);
    return [...byDest]
      .map(([dest, amount]) => {
        if (dest === undefined) return { amount };
        const hops = [...this.nextHops(station, cargo, dest)].sort((x, y) => y[1] - x[1]);
        return { dest, next: hops[0]?.[0], amount };
      })
      .sort((x, y) => (x.dest === undefined ? 1 : y.dest === undefined ? -1 : y.amount - x.amount));
  }

  // „B 12 · C 5 přes B · bez cíle 3“
  waitingText(station: Station, cargo: Cargo, fresh: number): string {
    const parts = this.waitingByDest(station, cargo, fresh)
      .filter((w) => Math.floor(w.amount) > 0)
      .map((w) => {
        const amount = Math.floor(w.amount);
        if (w.dest === undefined) return `bez cíle ${amount}`;
        const via = w.next !== undefined && w.next !== w.dest ? ` přes ${this.stationName(w.next)}` : '';
        return `${this.stationName(w.dest)} ${amount}${via}`;
      });
    return parts.length > 0 ? parts.join(' · ') : 'nic nečeká';
  }

  // Náklad na palubě podle cíle: „B 20 · C 10 · bez cíle 5“, nebo null (bez cílů)
  loadText(load: { passengers: number; dests?: Record<number, number> }): string | null {
    const dests = Object.entries(load.dests ?? {}).filter(([, n]) => n > 0);
    if (dests.length === 0 || load.passengers <= 0) return null;
    const parts = dests.sort((x, y) => y[1] - x[1]).map(([dest, n]) => `${this.stationName(Number(dest))} ${n}`);
    const rest = load.passengers - destTotal(load.dests);
    if (rest > 0) parts.push(`bez cíle ${rest}`);
    return parts.join(' · ');
  }
}
