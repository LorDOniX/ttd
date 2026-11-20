import * as THREE from 'three';
import { loadModel } from '../assets';
import { shipModel, type Ship, type ShipFleet } from '../game/ships';
import { inView } from './camera';
import type { CabPose } from './firstPerson';
import { WATER_DEPTH } from './terrain';

// Modely z watercraft kitu mají předek na +Z a dno na y = 0; sjednotí se na délku v dlaždicích
const MODEL_LENGTH: Record<string, number> = {
  'ship-ocean-liner-small': 0.85,
  'ship-ocean-liner': 1.05,
  'ship-cargo-a': 0.85,
  'ship-cargo-b': 0.85,
  'ship-cargo-c': 0.85,
};
// Ponor: trup sedí kousek pod hladinou
const DRAFT = 0.025;
// Rychlost natáčení lodi za směrem plavby (radiány za sekundu)
const TURN_RATE = 2.5;

export async function normalizedShip(name: string, length = MODEL_LENGTH[name] ?? 0.85): Promise<THREE.Group> {
  const object = await loadModel('watercraft kit', name);
  const holder = new THREE.Group();
  holder.add(object);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -box.min.y, -center.z);
  holder.scale.setScalar(length / box.getSize(new THREE.Vector3()).z);
  return holder;
}

interface ShipView {
  modelId: string;
  group: THREE.Group;
  yaw: number | null;
  cab: { height: number; front: number };
  placed: boolean;
}

// Lodě na vodě; v loděnici nejsou vidět. Směr se plynule natáčí, na kotvišti se mírně houpou.
export class ShipsView {
  readonly object = new THREE.Group();
  private readonly views = new Map<number, ShipView>();
  private cabId: number | null = null;

  constructor(private readonly fleet: ShipFleet) {}

  update(frustum: THREE.Frustum, seconds: number, dt: number): void {
    const alive = new Set(this.fleet.ships.map((s) => s.id));
    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.object.remove(view.group);
      this.views.delete(id);
    }
    for (const ship of this.fleet.ships) {
      const modelId = shipModel(ship).model;
      let view = this.views.get(ship.id);
      if (!view || view.modelId !== modelId) {
        if (view) this.object.remove(view.group);
        view = this.createView(ship.id, modelId);
        this.views.set(ship.id, view);
        this.object.add(view.group);
      }
      this.place(ship, view, frustum, seconds, dt);
    }
  }

  setCabShip(id: number | null): void {
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

  private createView(id: number, modelId: string): ShipView {
    const length = MODEL_LENGTH[modelId] ?? 0.85;
    const view: ShipView = {
      modelId,
      group: new THREE.Group(),
      yaw: null,
      cab: { height: length * 0.35, front: length * 0.2 },
      placed: false,
    };
    view.group.rotation.order = 'YXZ';
    void normalizedShip(modelId).then((holder) => {
      if (this.views.get(id) === view) view.group.add(holder);
    });
    return view;
  }

  private place(ship: Ship, view: ShipView, frustum: THREE.Frustum, seconds: number, dt: number): void {
    const sample = ship.state === 'depot' ? null : this.fleet.sample(ship);
    view.placed = sample !== null;
    if (!sample) {
      view.group.visible = false;
      view.yaw = null;
      return;
    }
    const target = Math.atan2(sample.dx, sample.dy);
    if (view.yaw === null) view.yaw = target;
    else {
      const delta = Math.atan2(Math.sin(target - view.yaw), Math.cos(target - view.yaw));
      const step = TURN_RATE * Math.min(dt, 0.1);
      view.yaw += Math.max(-step, Math.min(step, delta));
    }
    const bob = Math.sin(seconds * 1.7 + ship.id) * 0.004;
    view.group.position.set(sample.x, -WATER_DEPTH - DRAFT + bob, sample.y);
    view.group.rotation.y = view.yaw;
    view.group.rotation.z = Math.sin(seconds * 1.3 + ship.id * 2) * 0.02;
    view.group.visible = ship.id !== this.cabId && inView(frustum, sample.x, 0, sample.y, 0.7);
  }
}
