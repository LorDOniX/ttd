import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { loadModel } from '../assets';
import { INDUSTRY_SIZE, type Industry, type IndustryKind } from '../world/industry';

const COAL = 0x2b2927;
const STEEL = 0x7a3b2a;
const DARK_STEEL = 0x3a3a3c;
const BELT = 0x6b6b64;

const materials = new Map<number, THREE.MeshLambertMaterial>();
function material(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materials.set(color, m);
  }
  return m;
}

// Model z Kenney City Kit (Industrial) zmenšený na daný půdorys, dnem na zemi se středem v (x, z)
async function kenney(name: string, footprint: number, x: number, z: number, rotation = 0): Promise<THREE.Object3D> {
  const model = await loadModel('city kit industrial', name);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = footprint / Math.max(size.x, size.z);
  const inner = new THREE.Group();
  model.position.set(-center.x, -box.min.y, -center.z);
  inner.add(model);
  inner.scale.setScalar(scale);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.position.set(x, 0, z);
  outer.rotation.y = rotation;
  return outer;
}

function mesh(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  return new THREE.Mesh(geometry, material(color));
}

// Kužel sypaného uhlí
function coalPile(radius: number, height: number, x: number, z: number): THREE.Object3D {
  const pile = mesh(new THREE.ConeGeometry(radius, height, 7), COAL);
  pile.position.set(x, height / 2, z);
  return pile;
}

// Trám mezi dvěma body
function beam(from: THREE.Vector3, to: THREE.Vector3, thickness: number, color: number): THREE.Mesh {
  const length = from.distanceTo(to);
  const b = mesh(new THREE.BoxGeometry(thickness, length, thickness), color);
  b.position.copy(from).add(to).multiplyScalar(0.5);
  b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return b;
}

// Těžní věž: zužující se příhradová konstrukce s lanovnicí a šikmou vzpěrou
function headframe(x: number, z: number): THREE.Object3D {
  const group = new THREE.Group();
  const height = 1.5;
  const base = 0.28;
  const top = 0.1;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (k: number, y: number, half: number): THREE.Vector3 =>
    new THREE.Vector3(corners[k][0] * half, y, corners[k][1] * half);
  const halfAt = (y: number): number => base + (top - base) * (y / height);
  for (let k = 0; k < 4; k++) {
    group.add(beam(at(k, 0, base), at(k, height, top), 0.04, STEEL));
    // Vodorovná patra
    for (const y of [0.45, 0.9, height])
      group.add(beam(at(k, y, halfAt(y)), at((k + 1) % 4, y, halfAt(y)), 0.025, STEEL));
  }
  // Vzpěra k budově strojovny
  group.add(beam(new THREE.Vector3(0.75, 0, 0), new THREE.Vector3(0.05, height * 0.95, 0), 0.05, STEEL));
  for (const side of [-0.06, 0.06]) {
    const wheel = mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), DARK_STEEL);
    wheel.position.set(0, height + 0.1, side);
    group.add(wheel);
  }
  group.position.set(x, 0, z);
  return group;
}

// Pásový dopravník ze země nahoru
function conveyor(from: THREE.Vector3, to: THREE.Vector3): THREE.Object3D {
  return beam(from, to, 0.08, BELT);
}

// Rozvržení areálu 3×3 kolem jeho středu
const LAYOUTS: Record<IndustryKind, () => Promise<THREE.Object3D>[]> = {
  'coal-mine': () => [
    Promise.resolve(headframe(-0.7, -0.75)),
    kenney('building-k', 1.25, 0.75, -0.7),
    kenney('building-n', 0.8, 0.85, 0.75, Math.PI),
    Promise.resolve(coalPile(0.5, 0.42, -0.75, 0.75)),
    Promise.resolve(coalPile(0.32, 0.28, 0.05, 1.0)),
    Promise.resolve(conveyor(new THREE.Vector3(-0.75, 0.35, 0.55), new THREE.Vector3(-0.7, 0.9, -0.5))),
  ],
  'power-station': () => [
    kenney('chimney-large', 1.0, -0.9, -0.9),
    kenney('chimney-large', 0.85, 0.2, -1.0),
    kenney('chimney-basic', 0.3, 1.15, -0.95),
    kenney('building-e', 1.4, 0.55, 0.55, Math.PI / 2),
    kenney('detail-tank-large', 0.7, -0.95, 0.8),
    Promise.resolve(coalPile(0.35, 0.3, -0.15, 1.05)),
  ],
};

// Průmyslové areály složené z modelů Kenney a jednoduchých těles, s popiskem názvu
export class IndustriesView {
  readonly object = new THREE.Group();

  async build(industries: readonly Industry[]): Promise<void> {
    const groups = await Promise.all(
      industries.map(async (industry) => {
        const group = new THREE.Group();
        group.add(...(await Promise.all(LAYOUTS[industry.kind]())));
        const half = INDUSTRY_SIZE / 2;
        group.position.set(industry.x + half, 0, industry.y + half);
        group.rotation.y = (industry.rotation * Math.PI) / 2;

        const el = document.createElement('div');
        el.className = 'industry-label';
        el.textContent = industry.name;
        const label = new CSS2DObject(el);
        label.position.set(industry.x + half, 2.2, industry.y + half);
        return [group, label];
      }),
    );
    this.object.add(...groups.flat());
  }
}
