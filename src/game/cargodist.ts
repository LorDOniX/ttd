import { CARGO_DIST_STOP_DAYS } from './balance';
import type { Cargo } from './cargo';
import { cargoCapacity, consistCargos, wagonCapacity } from './consist';
import type { Game } from './game';
import { aircraftCapacity, aircraftCargo, aircraftModel } from './aircraft';
import { roadVehicleModel, vehicleCapacity, vehicleCargo } from './roadVehicles';
import { shipCapacity, shipCargo, shipModel } from './ships';
import { isSpecialOrder, orderFlags, refitLoadStops, trainModel, type Train } from './trains';
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

// Distribuce nákladu: graf linek pro druhy nákladu, které se nerozvážejí ručně
export class CargoDist {
  settings: DistributionSettings = manualDistribution();
  private graphs: Map<Cargo, LinkGraph> | null = null;

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
    game.clock.events.on('month', invalidate);
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
    this.game.events.emit('stationsChanged');
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
}
