import * as THREE from 'three';
import { freezeStatic } from './staticObjects';
import type { TrafficLightJunction, TrafficLights } from '../game/trafficLights';

const BASE_Y = 0.025;
const POLE_HEIGHT = 0.36;
const LIGHT_GRAY = 0xc4c8cc;
const HOUSING_GRAY = 0x41474d;
const RED = 0xf04438;
const GREEN = 0x35c759;
const DARK_RED = 0x310d0b;
const DARK_GREEN = 0x0a2812;

interface SignalHead {
  axis: 'x' | 'y';
  red: THREE.Mesh;
  green: THREE.Mesh;
}

interface SignalPlacement {
  group: THREE.Group;
  heads: SignalHead[];
}

interface SignalModel extends SignalPlacement {
  x: number;
  y: number;
}

function bulb(material: THREE.Material, x: number, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), material);
  mesh.position.set(x, y, 0.06);
  return mesh;
}

function makeSignal(x: number, z: number): SignalPlacement {
  const group = new THREE.Group();
  group.position.set(x, BASE_Y, z);
  const metal = new THREE.MeshLambertMaterial({ color: LIGHT_GRAY });
  const poleHeight = POLE_HEIGHT - 0.02;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, poleHeight, 6), metal);
  pole.position.y = poleHeight / 2;
  group.add(pole);

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.105, 0.16, 0.105),
    new THREE.MeshLambertMaterial({ color: HOUSING_GRAY }),
  );
  housing.position.y = POLE_HEIGHT - 0.08;
  group.add(housing);
  const heads: SignalHead[] = [];
  for (let side = 0; side < 4; side++) {
    const axis = side % 2 === 0 ? 'y' : 'x';
    const head = new THREE.Group();
    head.position.y = housing.position.y;
    head.rotation.y = (side * Math.PI) / 2;
    const red = bulb(new THREE.MeshLambertMaterial({ color: RED, emissive: 0x000000 }), 0, 0.04);
    const green = bulb(new THREE.MeshLambertMaterial({ color: GREEN, emissive: 0x000000 }), 0, -0.04);
    head.add(red, green);
    group.add(head);
    heads.push({ axis, red, green });
  }
  return { group, heads };
}

export class TrafficLightsView {
  readonly object = new THREE.Group();
  private readonly models = new Map<string, SignalModel[]>();

  sync(junctions: readonly TrafficLightJunction[]): void {
    const active = new Set(junctions.map(({ x, y }) => `${x},${y}`));
    for (const [key, models] of this.models) {
      if (active.has(key)) continue;
      for (const model of models) this.object.remove(model.group);
      this.models.delete(key);
    }
    for (const junction of junctions) {
      const key = `${junction.x},${junction.y}`;
      if (this.models.has(key)) continue;
      const models = this.makeJunction(junction);
      this.models.set(key, models);
      for (const model of models) {
        freezeStatic(model.group);
        this.object.add(model.group);
      }
    }
  }

  update(controller: TrafficLights): void {
    for (const models of this.models.values()) {
      const phase = controller.greenAxis(models[0].x, models[0].y);
      for (const model of models) {
        for (const head of model.heads) {
          const active = phase === head.axis;
          const redMaterial = head.red.material as THREE.MeshLambertMaterial;
          const greenMaterial = head.green.material as THREE.MeshLambertMaterial;
          redMaterial.color.setHex(active ? DARK_RED : RED);
          greenMaterial.color.setHex(active ? GREEN : DARK_GREEN);
          redMaterial.emissive.setHex(active ? 0x000000 : 0x9e1710);
          greenMaterial.emissive.setHex(active ? 0x146b2a : 0x000000);
        }
      }
    }
  }

  private makeJunction(junction: TrafficLightJunction): SignalModel[] {
    const { x, y } = junction;
    const inset = 0.1;
    const signals = [
      makeSignal(x + inset, y + inset),
      makeSignal(x + 1 - inset, y + 1 - inset),
      makeSignal(x + 1 - inset, y + inset),
      makeSignal(x + inset, y + 1 - inset),
    ];
    return signals.map((signal) => ({ ...signal, x, y }));
  }
}
