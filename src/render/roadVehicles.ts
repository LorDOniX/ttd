import * as THREE from 'three';
import { loadModel } from '../assets';
import { CARGOS } from '../game/cargo';
import type { CityCar } from '../game/cityTraffic';
import { roadVehicleModel, vehicleCargo, vehiclePoint, type RoadFleet, type RoadVehicle } from '../game/roadVehicles';
import type { GameMap } from '../world/map';
import { inView, type ViewFrustums } from './camera';
import { LIGHT_MARKER_MATERIAL, lightMarkerGeometry } from './nightLights';
import type { CabPose } from './firstPerson';
import { BRIDGE_DECK } from './rail';
import { BRIDGE_HEIGHT } from '../world/route';
import { roadElevation } from '../world/roadRoute';

// Modely z car kitu jsou dlouhé ~3 jednotky podél +Z (předek), kola stojí na y = 0
const SCALE = 0.13;
const ROAD_TOP = 0.01;
// Jízda vpravo: posun od osy silnice kolmo ke směru jízdy

interface VehicleView {
  modelId: string;
  // Náklad hráčova auta (po přestavbě se mění náklad na korbě)
  cargo?: string;
  playerId: number | null;
  cityCarId: number | null;
  group: THREE.Group;
  // Náklad na korbě, viditelný jen naložený
  load: THREE.Object3D | null;
  lights: THREE.Mesh;
  // Obrys modelu (výška střechy, vzdálenost čela od středu) pro pohled z kabiny
  cab: { height: number; front: number } | null;
  // Auto je tento snímek na silnici (ne v garáži)
  placed: boolean;
}

const VEHICLE_LIGHTS_GEOMETRY = lightMarkerGeometry(
  [-1, 1].flatMap((side) => [
    { size: [0.24, 0.14, 0.05], position: [side * 0.44, 0.34, 1.34], color: 0xffedba },
    { size: [0.2, 0.12, 0.05], position: [side * 0.44, 0.32, -1.34], color: 0xf04438 },
  ]),
);

function vehicleLightMarkers(): THREE.Mesh {
  const lights = new THREE.Mesh(VEHICLE_LIGHTS_GEOMETRY, LIGHT_MARKER_MATERIAL);
  lights.visible = false;
  return lights;
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
  // Auto, z jehož kabiny se hráč dívá (player:id nebo city:id); nevykresluje se, aby nezakrývalo výhled
  private cabKey: string | null = null;

  constructor(
    private readonly fleet: RoadFleet,
    private readonly map: GameMap,
  ) {}

  // Auta mimo záběr se skryjí, aby je vykreslování vůbec neprocházelo
  update(frustum: ViewFrustums, cityCars: readonly CityCar[] = [], night = false): void {
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
      if (!view || view.modelId !== modelId || view.cargo !== vehicleCargo(vehicle)) {
        if (view) this.object.remove(view.group);
        view = this.createView(key, modelId, vehicle.id, vehicle);
        this.views.set(key, view);
        this.object.add(view.group);
      }
      view.placed = vehicle.state !== 'depot' && vehicle.path.length > 0;
      view.group.visible = view.placed;
      view.lights.visible = false;
      if (!view.group.visible) continue;
      this.place(vehicle.path, vehicle.pos, view);
      const { x, y, z } = view.group.position;
      view.group.visible = key !== this.cabKey && inView(frustum, x, y, z, 0.3);
      view.lights.visible = night && view.group.visible;
    }
    for (const car of cityCars) {
      const key = `city:${car.id}`;
      let view = this.views.get(key);
      if (!view || view.modelId !== car.model) {
        if (view) this.object.remove(view.group);
        view = this.createView(key, car.model, null);
        view.cityCarId = car.id;
        this.views.set(key, view);
        this.object.add(view.group);
      }
      view.placed = true;
      this.place(car.path, car.pos, view);
      const { x, y, z } = view.group.position;
      view.group.visible = key !== this.cabKey && inView(frustum, x, y, z, 0.3);
      view.lights.visible = night && view.group.visible;
    }
  }

  setCabVehicle(key: string | null): void {
    this.cabKey = key;
  }

  // Poloha auta pro pohled z kabiny (klíč player:id nebo city:id); null, když je v garáži nebo není načtené
  cabPose(key: string): CabPose | null {
    const view = this.views.get(key);
    if (!view?.cab || !view.placed) return null;
    const { position, rotation } = view.group;
    return { x: position.x, y: position.y, z: position.z, heading: rotation.y, ...view.cab };
  }

  // Auto (hráčovo, nebo městské), které paprsek zasáhne jako první
  pick(raycaster: THREE.Raycaster): { playerId: number } | { cityCarId: number } | null {
    for (const hit of raycaster.intersectObject(this.object, true)) {
      for (const view of this.views.values()) {
        if (!view.group.visible) continue;
        let o: THREE.Object3D | null = hit.object;
        while (o && o !== view.group) o = o.parent;
        if (!o) continue;
        if (view.playerId !== null) return { playerId: view.playerId };
        if (view.cityCarId !== null) return { cityCarId: view.cityCarId };
      }
    }
    return null;
  }

  private createView(key: string, modelId: string, playerId: number | null, vehicle?: RoadVehicle): VehicleView {
    const cargo = vehicle ? vehicleCargo(vehicle) : null;
    const view: VehicleView = {
      modelId,
      cargo: cargo ?? undefined,
      playerId,
      cityCarId: null,
      group: new THREE.Group(),
      load: null,
      lights: vehicleLightMarkers(),
      cab: null,
      placed: false,
    };
    view.group.scale.setScalar(SCALE);
    view.group.add(view.lights);
    void loadModel('car kit', modelId).then((object) => {
      if (this.views.get(key) !== view) return;
      // Popelářský vůz slouží jako cisterna, odpadky na střeše nepatří k ropě
      const trash = object.getObjectByName('trash');
      if (trash) trash.visible = false;
      // Obrys v souřadnicích modelu (ještě bez rodiče), skupina auta ho zmenší o SCALE
      object.updateMatrixWorld(true);
      const box = new THREE.Box3();
      object.traverse((o) => {
        if (o instanceof THREE.Mesh && o.visible) box.expandByObject(o);
      });
      view.cab = { height: box.max.y * SCALE, front: box.max.z * SCALE };
      view.group.add(object);
      const kind = cargo && FLATBED_LOADS[cargo];
      if (cargo && kind) {
        view.load = flatbedLoad(CARGOS[cargo].color, kind);
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
    const height = roadElevation(path, pos);
    const lift =
      height > 0 ? height * BRIDGE_HEIGHT : this.map.roadBridgeAxis(Math.floor(x), Math.floor(y)) ? BRIDGE_DECK : 0;
    view.group.position.set(x, ROAD_TOP + lift, y);
    view.group.rotation.y = Math.atan2(ux, uy);
    // Na nájezdu silničního mostu se auto nakloní do stoupání
    const climb =
      height > 0 && height < 1 ? Math.atan(BRIDGE_HEIGHT) * Math.sign(roadElevation(path, pos + 0.05) - height) : 0;
    view.group.rotation.x = 0;
    if (climb !== 0) view.group.rotateX(-climb);
    if (view.load && view.playerId !== null) {
      const vehicle = this.fleet.vehicles.find((candidate) => candidate.id === view.playerId);
      view.load.visible = (vehicle?.passengers ?? 0) > 0;
    }
  }
}
