import * as THREE from 'three';
import { loadModel } from '../assets';
import { CARGOS } from '../game/cargo';
import type { CityCar } from '../game/cityTraffic';
import { roadVehicleModel, vehiclePoint, type RoadFleet, type RoadVehicle } from '../game/roadVehicles';
import type { GameMap } from '../world/map';
import { inView } from './camera';
import { BRIDGE_DECK } from './rail';

// Modely z car kitu jsou dlouhé ~3 jednotky podél +Z (předek), kola stojí na y = 0
const SCALE = 0.13;
const ROAD_TOP = 0.01;
// Jízda vpravo: posun od osy silnice kolmo ke směru jízdy

interface VehicleView {
  modelId: string;
  playerId: number | null;
  group: THREE.Group;
  // Náklad na korbě, viditelný jen naložený
  load: THREE.Object3D | null;
}

// Náklad na korbu valníku v souřadnicích modelu (korba za kabinou, -1,3 až 0,2 podél Z)
function flatbedLoad(color: string, kind: 'pile' | 'logs' | 'plates'): THREE.Object3D {
  const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const load = new THREE.Group();
  const bed = 0.62;
  if (kind === 'pile') {
    const pile = new THREE.Mesh(new THREE.SphereGeometry(0.6, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), material);
    pile.scale.set(1, 0.85, 1.25);
    pile.position.set(0, bed + 0.08, -0.55);
    load.add(pile);
  } else if (kind === 'logs') {
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.5, 6), material);
      log.rotation.x = Math.PI / 2;
      const row = i < 3 ? 0 : 1;
      const col = row === 0 ? i - 1 : i - 3.5;
      log.position.set(col * 0.36, bed + 0.17 + row * 0.3, -0.55);
      load.add(log);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 1.4), material);
      plate.position.set(0, bed + 0.12 + i * 0.11, -0.55);
      load.add(plate);
    }
  }
  return load;
}

const FLATBED_LOADS: Partial<Record<string, 'pile' | 'logs' | 'plates'>> = {
  coal: 'pile',
  grain: 'pile',
  'iron-ore': 'pile',
  wood: 'logs',
  steel: 'plates',
};

// Autobusy a nákladní auta na silnicích; v garáži nejsou vidět
export class RoadVehiclesView {
  readonly object = new THREE.Group();
  private readonly views = new Map<string, VehicleView>();

  constructor(
    private readonly fleet: RoadFleet,
    private readonly map: GameMap,
  ) {}

  // Auta mimo záběr se skryjí, aby je vykreslování vůbec neprocházelo
  update(frustum: THREE.Frustum, cityCars: readonly CityCar[] = []): void {
    const alive = new Set([
      ...this.fleet.vehicles.map((vehicle) => `player:${vehicle.id}`),
      ...cityCars.map((car) => `city:${car.id}`),
    ]);
    for (const [key, view] of this.views) {
      if (!alive.has(key)) {
        this.object.remove(view.group);
        this.views.delete(key);
      }
    }
    for (const vehicle of this.fleet.vehicles) {
      const key = `player:${vehicle.id}`;
      const modelId = roadVehicleModel(vehicle).model;
      let view = this.views.get(key);
      if (!view || view.modelId !== modelId) {
        if (view) this.object.remove(view.group);
        view = this.createView(key, modelId, vehicle.id, vehicle);
        this.views.set(key, view);
        this.object.add(view.group);
      }
      view.group.visible = vehicle.state !== 'depot' && vehicle.path.length > 0;
      if (!view.group.visible) continue;
      this.place(vehicle.path, vehicle.pos, view);
      const { x, y, z } = view.group.position;
      view.group.visible = inView(frustum, x, y, z, 0.3);
    }
    for (const car of cityCars) {
      const key = `city:${car.id}`;
      let view = this.views.get(key);
      if (!view || view.modelId !== car.model) {
        if (view) this.object.remove(view.group);
        view = this.createView(key, car.model, null);
        this.views.set(key, view);
        this.object.add(view.group);
      }
      view.group.visible = true;
      this.place(car.path, car.pos, view);
      const { x, y, z } = view.group.position;
      view.group.visible = inView(frustum, x, y, z, 0.3);
    }
  }

  // Id auta, které paprsek zasáhne jako první
  pick(raycaster: THREE.Raycaster): number | null {
    for (const hit of raycaster.intersectObject(this.object, true)) {
      for (const view of this.views.values()) {
        const id = view.playerId;
        if (id === null) continue;
        if (!view.group.visible) continue;
        let o: THREE.Object3D | null = hit.object;
        while (o && o !== view.group) o = o.parent;
        if (o) return id;
      }
    }
    return null;
  }

  private createView(key: string, modelId: string, playerId: number | null, vehicle?: RoadVehicle): VehicleView {
    const model = vehicle ? roadVehicleModel(vehicle) : null;
    const view: VehicleView = { modelId, playerId, group: new THREE.Group(), load: null };
    view.group.scale.setScalar(SCALE);
    void loadModel('car kit', modelId).then((object) => {
      if (this.views.get(key) !== view) return;
      // Popelářský vůz slouží jako cisterna, odpadky na střeše nepatří k ropě
      const trash = object.getObjectByName('trash');
      if (trash) trash.visible = false;
      view.group.add(object);
      const kind = model && FLATBED_LOADS[model.cargo];
      if (model && kind) {
        view.load = flatbedLoad(CARGOS[model.cargo].color, kind);
        view.group.add(view.load);
      }
    });
    return view;
  }

  private place(path: RoadVehicle['path'], pos: number, view: VehicleView): void {
    const { x, y, dx, dy } = vehiclePoint(path, pos);
    const length = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / length, dy / length];
    // Pozice už zahrnuje jízdní pruh; na mostě auto jede po mostovce
    const lift = this.map.roadBridgeAxis(Math.floor(x), Math.floor(y)) ? BRIDGE_DECK : 0;
    view.group.position.set(x, ROAD_TOP + lift, y);
    view.group.rotation.y = Math.atan2(ux, uy);
    if (view.load && view.playerId !== null) {
      const vehicle = this.fleet.vehicles.find((candidate) => candidate.id === view.playerId);
      view.load.visible = (vehicle?.passengers ?? 0) > 0;
    }
  }
}
