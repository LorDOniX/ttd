import * as THREE from 'three';
import { loadModel } from '../assets';
import { VEHICLE_LENGTH } from '../game/balance';
import { CARGOS } from '../game/cargo';
import { trainModel, type Fleet, type Train } from '../game/trains';
import { TileType, type GameMap } from '../world/map';
import { pointAt } from '../world/route';
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

  update(): void {
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
      if (view.group.visible) this.place(train, view);
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
    const view: TrainView = { key: trainKey(train), group: new THREE.Group(), vehicles: [] };
    const wagonModel = CARGOS[train.cargo].wagonModel ?? model.wagonModel;
    const names = [model.model, ...Array.from({ length: train.wagons }, () => wagonModel)];
    void Promise.all(names.map((n) => loadModel('train kit', n))).then((objects) => {
      for (const o of objects) {
        o.scale.setScalar(SCALE);
        view.group.add(o);
      }
      view.vehicles = objects;
    });
    return view;
  }

  private place(train: Train, view: TrainView): void {
    const count = view.vehicles.length;
    for (let i = 0; i < count; i++) {
      // Po otočení směru jízdy je lokomotiva na konci soupravy
      const vehicle = view.vehicles[train.flipped ? count - 1 - i : i];
      const center = train.pos - (i + 0.5) * VEHICLE_LENGTH;
      const [fx, fz] = pointAt(train.path, center + BOGIE);
      const [bx, bz] = pointAt(train.path, center - BOGIE);
      const x = (fx + bx) / 2;
      const z = (fz + bz) / 2;
      vehicle.position.set(x, RAIL_TOP + (this.map.isType(Math.floor(x), Math.floor(z), TileType.Bridge) ? BRIDGE_DECK : 0), z);
      vehicle.rotation.y = Math.atan2(fx - bx, fz - bz) + (train.flipped ? Math.PI : 0);
      // Vozy ještě (nebo už) v depu nejsou vidět
      vehicle.visible = center > 0 && this.map.get(Math.floor(x), Math.floor(z)) !== TileType.Depot;
    }
  }
}
