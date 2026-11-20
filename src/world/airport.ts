import { AIRPORT_TYPES, type AirportType } from '../game/balance';
import type { Axis, StationShape } from './rail';

// Bod letu: x, y na mapě v dlaždicích, z výška nad zemí
export interface AirPoint {
  x: number;
  y: number;
  z: number;
}

// Rozvržení letiště v místních souřadnicích: a podél ranveje (0..délka), c napříč (0..hloubka).
// Řada c = 0 je ranvej (vzlet i přistání ve směru +a), c = 1 pojezdová dráha, od c = 2 stání, terminál a hangár.
export const RUNWAY_C = 0.5;
export const TAXIWAY_C = 1.5;
export const STAND_C = 2.5;
// Výška letu, rychlost stoupání na dlaždici a bod, odkud letadlo klesá na ranvej
export const CRUISE_Z = 3.2;
export const CLIMB_PER_TILE = 0.35;
export const LIFTOFF_Z = 0.7;
export const APPROACH_DISTANCE = 4;
export const APPROACH_Z = 1.2;
export const HOLDING_RADIUS = 3;

export function airportShape(type: AirportType, x: number, y: number, axis: Axis): StationShape {
  const { length, depth } = AIRPORT_TYPES[type];
  return { x, y, axis, length, tracks: depth };
}

// Sloupce stání podél ranveje: hned za věží, každé stání má vlastní dlaždici
export function standColumns(type: AirportType): number[] {
  return Array.from({ length: AIRPORT_TYPES[type].stands }, (_, i) => i + 1);
}

// Hangár stojí na konci letiště (poslední sloupec), vrata k pojezdové dráze
export function hangarColumn(type: AirportType): number {
  return AIRPORT_TYPES[type].length - 1;
}

// Místní souřadnice → mapa. U osy y je letiště otočené o 90° (ne zrcadlené), aby šlo vykreslit rotací.
export function airportPoint(shape: StationShape, a: number, c: number, z = 0): AirPoint {
  const along0 = -Math.floor(shape.length / 2);
  const across0 = -Math.floor(shape.tracks / 2);
  if (shape.axis === 'x') return { x: shape.x + along0 + a, y: shape.y + across0 + c, z };
  return { x: shape.x + across0 + shape.tracks - c, y: shape.y + along0 + a, z };
}

// Jednotkový směr ranveje (+a) na mapě
export function runwayDirection(shape: StationShape): { x: number; y: number } {
  return shape.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

const local = (shape: StationShape, points: [number, number, number?][]): AirPoint[] =>
  points.map(([a, c, z]) => airportPoint(shape, a, c, z ?? 0));

// Vyčkávací místo před ranvejí, kde letadlo čeká na volnou ranvej
export function holdPoint(shape: StationShape): AirPoint {
  return airportPoint(shape, 0.5, TAXIWAY_C);
}

export function hangarPoint(shape: StationShape, type: AirportType): AirPoint {
  return airportPoint(shape, hangarColumn(type) + 0.5, STAND_C + 0.1);
}

export function standPoint(shape: StationShape, type: AirportType, stand: number): AirPoint {
  return airportPoint(shape, standColumns(type)[stand] + 0.5, STAND_C);
}

// Ze stání nebo z hangáru po pojezdové dráze k vyčkávacímu místu
export function taxiToRunway(shape: StationShape, type: AirportType, stand: number | null): AirPoint[] {
  const a = stand === null ? hangarColumn(type) + 0.5 : standColumns(type)[stand] + 0.5;
  const c = stand === null ? STAND_C + 0.1 : STAND_C;
  return local(shape, [
    [a, c],
    [a, TAXIWAY_C],
    [0.5, TAXIWAY_C],
  ]);
}

// Z vyčkávacího místa na ranvej, rozjezd a odlepení za koncem letiště
export function takeoffRoute(shape: StationShape): AirPoint[] {
  const { length } = shape;
  return local(shape, [
    [0.5, TAXIWAY_C],
    [0.5, RUNWAY_C],
    [length - 1.3, RUNWAY_C],
    [length + 1.2, RUNWAY_C, LIFTOFF_Z],
  ]);
}

// Bod na prodloužené ose ranveje, odkud letadlo přistává
export function approachPoint(shape: StationShape): AirPoint {
  return airportPoint(shape, -APPROACH_DISTANCE, RUNWAY_C, APPROACH_Z);
}

// Klesání na ranvej a dojezd na její konec
export function landingRoute(shape: StationShape): AirPoint[] {
  const { length } = shape;
  return local(shape, [
    [-APPROACH_DISTANCE, RUNWAY_C, APPROACH_Z],
    [0.8, RUNWAY_C],
    [length - 0.5, RUNWAY_C],
  ]);
}

// Z konce ranveje na stání, nebo do hangáru (stand = null)
export function taxiFromRunway(shape: StationShape, type: AirportType, stand: number | null): AirPoint[] {
  const { length } = shape;
  const a = stand === null ? hangarColumn(type) + 0.5 : standColumns(type)[stand] + 0.5;
  const c = stand === null ? STAND_C + 0.1 : STAND_C;
  return local(shape, [
    [length - 0.5, RUNWAY_C],
    [length - 0.5, TAXIWAY_C],
    [a, TAXIWAY_C],
    [a, c],
  ]);
}

// Kruh nad prodlouženou osou ranveje: začíná i končí v bodě přiblížení ve směru ranveje
export function holdingRoute(shape: StationShape): AirPoint[] {
  const points: AirPoint[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    const a = -APPROACH_DISTANCE + Math.cos(angle) * HOLDING_RADIUS;
    const c = RUNWAY_C - HOLDING_RADIUS - Math.sin(angle) * HOLDING_RADIUS;
    points.push(airportPoint(shape, a, c, APPROACH_Z));
  }
  return points;
}

// Let jako Bézierova křivka v rovině mapy: [start, řídicí, řídicí, cíl], výška podle profilu letu
export function flightRoute(
  from: AirPoint,
  fromDir: { x: number; y: number },
  to: AirPoint,
  toDir: { x: number; y: number },
): AirPoint[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.max(3, Math.min(20, distance / 3));
  return [
    from,
    { x: from.x + fromDir.x * k, y: from.y + fromDir.y * k, z: CRUISE_Z },
    { x: to.x - toDir.x * k, y: to.y - toDir.y * k, z: CRUISE_Z },
    to,
  ];
}

export interface RouteSample extends AirPoint {
  // Směr pohybu (jednotkový v rovině mapy) a stoupání na dlaždici
  dx: number;
  dy: number;
  climb: number;
}

interface Geometry {
  points: AirPoint[];
  // Vzdálenost od začátku k bodu points[i]
  distances: number[];
  length: number;
}

const geometryCache = new WeakMap<AirPoint[], Geometry>();

function bezier(p: AirPoint[], t: number): { x: number; y: number } {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
    y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y,
  };
}

// Lomená čára trasy; let se navzorkuje z křivky a výšku dostane z profilu
function geometry(route: AirPoint[], curve: boolean): Geometry {
  const cached = geometryCache.get(route);
  if (cached) return cached;
  let points = route;
  if (curve && route.length === 4) {
    const chord = Math.hypot(route[3].x - route[0].x, route[3].y - route[0].y);
    const steps = Math.max(16, Math.min(400, Math.ceil(chord * 2)));
    points = Array.from({ length: steps + 1 }, (_, i) => ({ ...bezier(route, i / steps), z: 0 }));
  }
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    distances.push(distances[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, curve ? 0 : b.z - a.z));
  }
  const length = distances[distances.length - 1];
  if (curve && route.length === 4) {
    const [z0, z1] = [route[0].z, route[3].z];
    points.forEach((p, i) => {
      const s = distances[i];
      p.z = Math.min(CRUISE_Z, z0 + s * CLIMB_PER_TILE, z1 + (length - s) * CLIMB_PER_TILE);
    });
  }
  const result = { points, distances, length };
  geometryCache.set(route, result);
  return result;
}

export function routeLength(route: AirPoint[], curve: boolean): number {
  return route.length < 2 ? 0 : geometry(route, curve).length;
}

// Poloha a směr ve vzdálenosti pos od začátku trasy
export function routePoint(route: AirPoint[], curve: boolean, pos: number): RouteSample {
  if (route.length === 0) return { x: 0, y: 0, z: 0, dx: 1, dy: 0, climb: 0 };
  if (route.length === 1) return { ...route[0], dx: 1, dy: 0, climb: 0 };
  const { points, distances, length } = geometry(route, curve);
  const s = Math.max(0, Math.min(length, pos));
  let i = 1;
  while (i < points.length - 1 && distances[i] < s) i++;
  // Nulové úseky (otočka na místě) přeskočí, aby směr nebyl nulový
  let a = points[i - 1];
  let b = points[i];
  for (let j = i; j < points.length - 1 && Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;) b = points[++j];
  // Na konci trasy bez dalšího pohybu platí směr posledního nenulového úseku
  for (let j = i - 1; j > 0 && Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;) a = points[--j];
  const span = distances[i] - distances[i - 1];
  const t = span > 0 ? (s - distances[i - 1]) / span : 0;
  const flat = Math.hypot(b.x - a.x, b.y - a.y);
  const point = points[i - 1];
  const next = points[i];
  if (flat < 1e-6) return { ...point, dx: 1, dy: 0, climb: 0 };
  return {
    x: point.x + (next.x - point.x) * t,
    y: point.y + (next.y - point.y) * t,
    z: point.z + (next.z - point.z) * t,
    dx: (b.x - a.x) / flat,
    dy: (b.y - a.y) / flat,
    climb: (b.z - a.z) / flat,
  };
}
