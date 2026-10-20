import { TRAIN_MODELS } from '../game/balance';
import { Game } from '../game/game';
import type { Train } from '../game/trains';
import { GameMap, TileType } from '../world/map';
import {
  Edge,
  PIECES,
  RailNetwork,
  defaultStationShape,
  heading,
  opposite,
  turnAllowed,
  EDGE_DELTA,
} from '../world/rail';
import type { Depot, Station } from '../world/rail';
import { findTrackPath, type PathStep } from '../world/railPath';
import type { Town } from '../world/town';

export function makeTown(id: number, x: number, y: number, population = 3000): Town {
  return {
    id,
    name: `Město ${id}`,
    kind: 'city',
    x,
    y,
    population,
    radius: 3,
    shape: [1],
    buildings: [],
    served: false,
  };
}

export function emptyGame(size = 64, towns: Town[] = []): Game {
  const map = new GameMap(size, size);
  return new Game({ seed: 1, map, towns, rail: new RailNetwork(map) });
}

// Budova města na dlaždici (x, y), aby bylo nástupiště v dosahu
export function addBuilding(game: Game, town: Town, x: number, y: number, model = 'building-a'): void {
  game.world.map.set(x, y, TileType.Building);
  game.world.map.setOwner(x, y, town.id);
  town.buildings.push({ x, y, model, rotation: 0 });
}

// Okamžitě položí trasu kolejí (bez placení a postupné výstavby)
export function layTrack(game: Game, from: { x: number; y: number }, to: { x: number; y: number }): PathStep[] {
  const path = findTrackPath(game.world.rail, from, to);
  if (!path) throw new Error(`Trasa ${from.x},${from.y} → ${to.x},${to.y} nenalezena`);
  for (const step of path) game.world.rail.addPiece(step.x, step.y, step.piece);
  return path;
}

export interface Line {
  game: Game;
  a: Station;
  b: Station;
  depot: Depot;
  townA: Town;
  townB: Town;
}

// Dvě města s nástupišti 1×3 spojenými kolejí a depem za západním koncem A
export function buildLine(): Line {
  const townA = makeTown(0, 10, 14);
  const townB = makeTown(1, 40, 24);
  const game = emptyGame(64, [townA, townB]);
  addBuilding(game, townA, 10, 12);
  addBuilding(game, townB, 40, 22);
  const { rail } = game.world;
  const a = rail.addStation({ ...defaultStationShape(10, 10, 'x'), name: 'A', townId: 0 });
  const b = rail.addStation({ ...defaultStationShape(40, 20, 'x'), name: 'B', townId: 1 });
  layTrack(game, { x: 12, y: 10 }, { x: 38, y: 20 });
  const depot = rail.addDepot(8, 10, Edge.E);
  return { game, a, b, depot, townA, townB };
}

export function buyTrain(game: Game, depot: Depot, wagons = 2): Train {
  game.fleet.buy(depot, TRAIN_MODELS[0]);
  const train = game.fleet.trains[game.fleet.trains.length - 1];
  for (let i = 0; i < wagons; i++) game.fleet.addWagon(train);
  return train;
}

// Ověří, že na sebe kusy trasy navazují a vlak nikde nezatáčí o víc než 45°
export function assertContinuous(path: PathStep[]): void {
  let prevExit: Edge | null = null;
  let prevHeading: number | null = null;
  path.forEach((step, i) => {
    const [a, b] = PIECES[step.piece];
    let entry: Edge;
    if (i === 0) {
      const next = path[1];
      const out = [a, b].find(
        (e) => next && step.x + EDGE_DELTA[e][0] === next.x && step.y + EDGE_DELTA[e][1] === next.y,
      );
      entry = out === a ? b : a;
    } else {
      const prev = path[i - 1];
      const moved = EDGE_DELTA.findIndex(([dx, dy]) => step.x - prev.x === dx && step.y - prev.y === dy);
      if (moved !== prevExit) throw new Error(`Trasa je přerušená u kroku ${i}`);
      entry = opposite(moved);
      if (entry !== a && entry !== b) throw new Error(`Kus u kroku ${i} nenavazuje`);
    }
    const exit = entry === a ? b : a;
    const h = heading(entry, exit);
    if (prevHeading !== null && !turnAllowed(prevHeading, h)) throw new Error(`Ostrá zatáčka u kroku ${i}`);
    prevExit = exit;
    prevHeading = h;
  });
}

// Posune hru o daný počet herních dní
export function runDays(game: Game, days: number): void {
  const msPerDay = (15 * 60 * 1000) / 365;
  const steps = Math.ceil((days * msPerDay) / 200);
  for (let i = 0; i < steps; i++) game.update(200);
}
