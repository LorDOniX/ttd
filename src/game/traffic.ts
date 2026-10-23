import type { CityCar } from './cityTraffic';
import { vehiclePoint, type RoadVehicle } from './roadVehicles';
import type { GameMap } from '../world/map';
import type { Town } from '../world/town';

export interface TrafficHotspot {
  x: number;
  y: number;
  townName: string;
  vehicles: number;
  waiting: number;
  score: number;
}

export function collectTrafficHotspots(
  map: GameMap,
  towns: readonly Pick<Town, 'id' | 'name'>[],
  cityCars: readonly CityCar[],
  roadVehicles: readonly Pick<RoadVehicle, 'state' | 'path' | 'pos'>[],
): TrafficHotspot[] {
  const townNames = new Map(towns.map((town) => [town.id, town.name]));
  const hotspots = new Map<number, TrafficHotspot>();
  const addVehicle = (path: RoadVehicle['path'], pos: number, waitSeconds = 0): void => {
    if (path.length === 0) return;
    const point = vehiclePoint(path, pos);
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (!map.isRoad(x, y)) return;
    const index = y * map.width + x;
    let hotspot = hotspots.get(index);
    if (!hotspot) {
      const townId = map.getOwner(x, y);
      hotspot = {
        x,
        y,
        townName: townNames.get(townId) ?? 'Silnice',
        vehicles: 0,
        waiting: 0,
        score: 0,
      };
      hotspots.set(index, hotspot);
    }
    hotspot.vehicles++;
    if (waitSeconds > 0.5) hotspot.waiting++;
    hotspot.score += 1 + Math.min(4, waitSeconds);
  };

  for (const car of cityCars) addVehicle(car.path, car.pos, car.stuckSeconds);
  for (const vehicle of roadVehicles) {
    if (vehicle.state === 'running') addVehicle(vehicle.path, vehicle.pos);
  }

  return [...hotspots.values()].sort((a, b) => b.score - a.score || b.vehicles - a.vehicles || a.y - b.y || a.x - b.x);
}
