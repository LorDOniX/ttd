import * as THREE from 'three';
import { loadModel } from '../assets';
import { VEHICLE_LENGTH, WAGON_CAPACITY } from '../game/balance';
import { CARGOS } from '../game/cargo';
import { trainModel, type Fleet, type Train } from '../game/trains';
import { TileType, type GameMap } from '../world/map';
import { pointAt } from '../world/route';
import { inView } from './camera';
import { BRIDGE_DECK } from './rail';

// Modely z train kitu jsou dlouhé ~2,6 jednotky podél +Z
const SCALE = VEHICLE_LENGTH / 2.75;
const RAIL_TOP = 0.06;
// Vzdálenost podvozků od středu vozu
const BOGIE = 0.18;

interface TrainView {
  key: string;
  group: THREE.Group;
  vehicles: THREE.Object3D[];
  // Náklad každého vagonu (část modelu `cargo`), null u vagonů bez viditelného nákladu
  loads: (THREE.Object3D | null)[];
}

const PLATE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xc4ced8, flatShading: true });

// Plošina z kitu je prázdná, ocel na ní vezou tři vrstvy plechů
function addSteelLoad(wagon: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(wagon);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const load = new THREE.Group();
  load.name = 'cargo';
  // Výška obrysu zahrnuje i klanice, ložná plocha je zhruba v jeho polovině
  const floor = box.min.y + size.y * 0.42;
  const thickness = size.y * 0.07;
  for (let i = 0; i < 3; i++) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.6, thickness, size.z * 0.7), PLATE_MATERIAL);
    plate.position.set(center.x, floor + thickness * (i + 0.5), center.z + (i - 1) * size.z * 0.02);
    load.add(plate);
  }
  wagon.add(load);
}

function trainKey(train: Train): string {
  return `${train.modelId}:${train.wagons}:${train.cargo}`;
}

// Soupravy jedoucích vlaků; vozy sledují trasu vlaku za hlavou soupravy
export class TrainsView {
  readonly object = new THREE.Group();
  private readonly views = new Map<number, TrainView>();

  constructor(
    private readonly fleet: Fleet,
    private readonly map: GameMap,
  ) {}

  // Vozy mimo záběr se skryjí, aby je vykreslování vůbec neprocházelo
  update(frustum: THREE.Frustum): void {
    const alive = new Set(this.fleet.trains.map((t) => t.id));
    for (const [id, view] of this.views) {
      if (!alive.has(id)) {
        this.object.remove(view.group);
        this.views.delete(id);
      }
    }
    for (const train of this.fleet.trains) {
      let view = this.views.get(train.id);
      if (!view || view.key !== trainKey(train)) {
        if (view) this.object.remove(view.group);
        view = this.createView(train);
        this.views.set(train.id, view);
        this.object.add(view.group);
      }
      view.group.visible = train.state !== 'depot';
      if (view.group.visible) this.place(train, view, frustum);
    }
  }

  // Id vlaku, jehož viditelný vůz paprsek zasáhne jako první
  pick(raycaster: THREE.Raycaster): number | null {
    const isShown = (o: THREE.Object3D | null): boolean => !o || (o.visible && isShown(o.parent));
    for (const hit of raycaster.intersectObject(this.object, true)) {
      if (!isShown(hit.object)) continue;
      for (const [id, view] of this.views) {
        let o: THREE.Object3D | null = hit.object;
        while (o && o !== view.group) o = o.parent;
        if (o) return id;
      }
    }
    return null;
  }

  private createView(train: Train): TrainView {
    const model = trainModel(train);
    const view: TrainView = { key: trainKey(train), group: new THREE.Group(), vehicles: [], loads: [] };
    const wagonModels = CARGOS[train.cargo].wagonModels ?? [model.wagonModel];
    const names = [model.model, ...Array.from({ length: train.wagons }, (_, i) => wagonModels[i % wagonModels.length])];
    void Promise.all(names.map((n) => loadModel('train kit', n))).then((objects) => {
      const [, ...wagons] = objects;
      if (train.cargo === 'steel') wagons.forEach(addSteelLoad);
      for (const o of objects) {
        o.scale.setScalar(SCALE);
        view.group.add(o);
      }
      view.vehicles = objects;
      view.loads = wagons.map((w) => w.getObjectByName('cargo') ?? null);
    });
    return view;
  }

  private place(train: Train, view: TrainView, frustum: THREE.Frustum): void {
    // Vagony se plní od lokomotivy
    const loaded = Math.ceil(train.passengers / WAGON_CAPACITY);
    view.loads.forEach((load, i) => {
      if (load) load.visible = i < loaded;
    });
    const count = view.vehicles.length;
    for (let i = 0; i < count; i++) {
      // Lokomotiva jede vždy v čele, i po otočení ve stanici
      const vehicle = view.vehicles[i];
      const center = train.pos - (i + 0.5) * VEHICLE_LENGTH;
      const [fx, fz] = pointAt(train.path, center + BOGIE);
      const [bx, bz] = pointAt(train.path, center - BOGIE);
      const x = (fx + bx) / 2;
      const z = (fz + bz) / 2;
      const y = RAIL_TOP + (this.map.isType(Math.floor(x), Math.floor(z), TileType.Bridge) ? BRIDGE_DECK : 0);
      vehicle.position.set(x, y, z);
      vehicle.rotation.y = Math.atan2(fx - bx, fz - bz);
      // Vozy ještě (nebo už) v depu nejsou vidět
      vehicle.visible =
        center > 0 &&
        this.map.get(Math.floor(x), Math.floor(z)) !== TileType.Depot &&
        inView(frustum, x, y, z, VEHICLE_LENGTH);
    }
  }
}
