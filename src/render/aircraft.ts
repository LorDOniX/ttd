import * as THREE from 'three';
import { loadModel } from '../assets';
import { aircraftModel, type AirFleet, type Aircraft } from '../game/aircraft';
import { inView } from './camera';
import type { CabPose } from './firstPerson';

// Modely letadel mají různé měřítko i natočení: při načtení se sjednotí na délku v dlaždicích,
// předek na +Z a kola na y = 0 (airplane-1 má předek na +X)
const MODEL_LENGTH: Record<string, number> = {
  'airplane-1': 0.62,
  'airplane-2': 0.78,
  'airplane-3': 0.92,
  'airplane-4': 0.7,
};
const MODEL_YAW: Record<string, number> = { 'airplane-1': -Math.PI / 2 };
const GROUND_LIFT = 0.012;
// Náklon v zatáčce při kroužení
const HOLDING_BANK = 0.35;
const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});
const SHADOW_GEOMETRY = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);

// Model sjednocený na délku length: nezávislý klon ve skupině, kterou lze natáčet kolem středu
export async function normalizedAircraft(name: string, length = MODEL_LENGTH[name] ?? 0.8): Promise<THREE.Group> {
  const object = await loadModel('airplanes', name);
  const holder = new THREE.Group();
  holder.add(object);
  object.rotation.y = MODEL_YAW[name] ?? 0;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -box.min.y, -center.z);
  const size = box.getSize(new THREE.Vector3());
  holder.scale.setScalar(length / size.z);
  return holder;
}

interface AircraftView {
  modelId: string;
  group: THREE.Group;
  shadow: THREE.Mesh;
  // Výška kabiny a vzdálenost kokpitu od středu pro pohled z kokpitu
  cab: { height: number; front: number };
  placed: boolean;
}

// Letadla na letištích a ve vzduchu se stínem na zemi; v hangáru nejsou vidět
export class AircraftView3D {
  readonly object = new THREE.Group();
  private readonly views = new Map<number, AircraftView>();
  private cabId: number | null = null;

  constructor(private readonly fleet: AirFleet) {}

  update(frustum: THREE.Frustum): void {
    const alive = new Set(this.fleet.aircraft.map((p) => p.id));
    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.object.remove(view.group, view.shadow);
      this.views.delete(id);
    }
    for (const plane of this.fleet.aircraft) {
      const modelId = aircraftModel(plane).model;
      let view = this.views.get(plane.id);
      if (!view || view.modelId !== modelId) {
        if (view) this.object.remove(view.group, view.shadow);
        view = this.createView(plane.id, modelId);
        this.views.set(plane.id, view);
        this.object.add(view.group, view.shadow);
      }
      this.place(plane, view, frustum);
    }
  }

  setCabAircraft(id: number | null): void {
    this.cabId = id;
  }

  cabPose(id: number): CabPose | null {
    const view = this.views.get(id);
    if (!view || !view.placed) return null;
    const { position, rotation } = view.group;
    return { x: position.x, y: position.y, z: position.z, heading: rotation.y, ...view.cab };
  }

  pick(raycaster: THREE.Raycaster): number | null {
    for (const hit of raycaster.intersectObject(this.object, true)) {
      for (const [id, view] of this.views) {
        if (!view.group.visible) continue;
        let o: THREE.Object3D | null = hit.object;
        while (o && o !== view.group) o = o.parent;
        if (o) return id;
      }
    }
    return null;
  }

  private createView(id: number, modelId: string): AircraftView {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    const shadow = new THREE.Mesh(SHADOW_GEOMETRY, SHADOW_MATERIAL);
    shadow.renderOrder = 1;
    const length = MODEL_LENGTH[modelId] ?? 0.8;
    shadow.scale.setScalar(length);
    const view: AircraftView = {
      modelId,
      group,
      shadow,
      cab: { height: length * 0.18, front: length * 0.8 },
      placed: false,
    };
    void normalizedAircraft(modelId).then((holder) => {
      if (this.views.get(id) !== view) return;
      group.add(holder);
    });
    return view;
  }

  private place(plane: Aircraft, view: AircraftView, frustum: THREE.Frustum): void {
    const sample = plane.state === 'hangar' ? null : this.fleet.sample(plane);
    view.placed = sample !== null;
    if (!sample) {
      view.group.visible = false;
      view.shadow.visible = false;
      return;
    }
    const { x, y, z, dx, dy, climb } = sample;
    view.group.position.set(x, z + GROUND_LIFT, y);
    view.group.rotation.y = Math.atan2(dx, dy);
    view.group.rotation.x = -Math.atan(climb);
    view.group.rotation.z = plane.state === 'holding' ? -HOLDING_BANK : 0;
    const visible = inView(frustum, x, z, y, 1) || inView(frustum, x, 0, y, 1);
    view.group.visible = visible && plane.id !== this.cabId;
    // Stín jen ve vzduchu, s výškou se zmenšuje a slábne
    view.shadow.visible = visible && z > 0.05;
    view.shadow.position.set(x, 0.015, y);
    const fade = 1 / (1 + z * 0.25);
    view.shadow.scale.setScalar((MODEL_LENGTH[view.modelId] ?? 0.8) * fade);
  }
}
