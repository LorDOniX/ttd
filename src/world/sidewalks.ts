import { GameMap, NO_OWNER, TileType } from './map';
import { EDGE_DELTA, Edge } from './rail';

// Napojení silnice na dlaždici (x, y) přes hranu edge
export type RoadConnects = (x: number, y: number, edge: Edge) => boolean;

// Šířka chodníku od okraje dlaždice; chodci chodí jeho středem, tedy ve vzdálenosti WALK_INSET od okraje
export const SIDEWALK_WIDTH = 0.2;
export const WALK_INSET = SIDEWALK_WIDTH / 2;

// Rohy dlaždice v pořadí SZ, SV, JV, JZ (S = y-1); hrana e spojuje rohy e a e+1
const CORNERS: readonly [number, number][] = [
  [WALK_INSET, WALK_INSET],
  [1 - WALK_INSET, WALK_INSET],
  [1 - WALK_INSET, 1 - WALK_INSET],
  [WALK_INSET, 1 - WALK_INSET],
];

// Uzel chůze: roh dlaždice, číslovaný index dlaždice * 4 + roh
export type SidewalkNode = number;

export interface SidewalkStep {
  to: SidewalkNode;
  // Přechod přes vozovku po zebře na křižovatce
  crossing: boolean;
}

// Město, jehož silnice na dlaždici má chodníky, jinak NO_OWNER; přejezdy chodníky nemají
export function sidewalkTown(map: GameMap, x: number, y: number): number {
  if (!map.isType(x, y, TileType.Road) && !map.isType(x, y, TileType.RoadStop)) return NO_OWNER;
  return map.getOwner(x, y);
}

export function connectionCount(connects: RoadConnects, x: number, y: number): number {
  let count = 0;
  for (let edge = Edge.N; edge <= Edge.W; edge++) if (connects(x, y, edge)) count++;
  return count;
}

// Zebry jsou jen na křižovatkách městských silnic
export function hasCrosswalks(map: GameMap, connects: RoadConnects, x: number, y: number): boolean {
  return sidewalkTown(map, x, y) !== NO_OWNER && connectionCount(connects, x, y) >= 3;
}

// Bod uzlu ve světě (osa Y mapy je osa Z scény)
export function nodePoint(map: GameMap, node: SidewalkNode): { x: number; y: number } {
  const tile = node >> 2;
  const [cx, cy] = CORNERS[node & 3];
  return { x: (tile % map.width) + cx, y: Math.floor(tile / map.width) + cy };
}

// Kroky z rohu dlaždice: podél chodníku k sousednímu rohu, přes hranu na chodník sousední dlaždice
// téhož města a na křižovatce po zebře na druhou stranu silnice
export function sidewalkSteps(map: GameMap, connects: RoadConnects, node: SidewalkNode): SidewalkStep[] {
  const tile = node >> 2;
  const corner = node & 3;
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  const town = sidewalkTown(map, x, y);
  if (town === NO_OWNER) return [];
  const junction = connectionCount(connects, x, y) >= 3;
  const steps: SidewalkStep[] = [];
  for (const edge of [corner, (corner + 3) % 4] as Edge[]) {
    const other = edge === corner ? (corner + 1) % 4 : edge;
    if (!connects(x, y, edge)) {
      steps.push({ to: tile * 4 + other, crossing: false });
      continue;
    }
    if (junction) steps.push({ to: tile * 4 + other, crossing: true });
    const nx = x + EDGE_DELTA[edge][0];
    const ny = y + EDGE_DELTA[edge][1];
    if (sidewalkTown(map, nx, ny) !== town) continue;
    // Přes severní a jižní hranu se roh zrcadlí svisle, přes východní a západní vodorovně
    const mirrored = edge === Edge.N || edge === Edge.S ? 3 - corner : corner ^ 1;
    steps.push({ to: (ny * map.width + nx) * 4 + mirrored, crossing: false });
  }
  return steps;
}
