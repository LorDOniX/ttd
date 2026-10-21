import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { loadModel, type Kit } from '../assets';
import { INDUSTRY_SIZE, type Industry, type IndustryKind } from '../world/industry';

const COAL = 0x2b2927;
const ORE = 0x8a4a32;
const STEEL = 0x7a3b2a;
const DARK_STEEL = 0x3a3a3c;
const BELT = 0x6b6b64;
const LOG = 0x7a5232;
const LOG_END = 0xc79a62;
const LUMBER = 0xd8b483;
const TANK = 0xd9d4c7;
const PLATE = 0x9aa4ad;

const materials = new Map<number, THREE.MeshLambertMaterial>();
function material(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materials.set(color, m);
  }
  return m;
}

// Model z Kenney City Kitu zmenšený na daný půdorys, dnem na zemi se středem v (x, z)
async function kenney(
  name: string,
  footprint: number,
  x: number,
  z: number,
  rotation = 0,
  kit: Kit = 'city kit industrial',
): Promise<THREE.Object3D> {
  const model = await loadModel(kit, name);
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

// Kužel sypaného uhlí nebo rudy
function pile(radius: number, height: number, x: number, z: number, color = COAL): THREE.Object3D {
  const pile = mesh(new THREE.ConeGeometry(radius, height, 7), color);
  pile.position.set(x, height / 2, z);
  return pile;
}

function box(w: number, h: number, d: number, x: number, z: number, color: number, y = 0): THREE.Mesh {
  const b = mesh(new THREE.BoxGeometry(w, h, d), color);
  b.position.set(x, y + h / 2, z);
  return b;
}

// Svislý válec stojící na zemi
function cylinder(radius: number, height: number, x: number, z: number, color: number): THREE.Mesh {
  const c = mesh(new THREE.CylinderGeometry(radius, radius, height, 12), color);
  c.position.set(x, height / 2, z);
  return c;
}

// Hranice klát: řady ležících válců, směrem nahoru jich ubývá
function logPile(x: number, z: number, rotation = 0): THREE.Object3D {
  const group = new THREE.Group();
  const r = 0.06;
  const geometry = new THREE.CylinderGeometry(r, r, 0.7, 7);
  geometry.rotateZ(Math.PI / 2);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const log = new THREE.Mesh(geometry, [material(LOG), material(LOG_END), material(LOG_END)]);
      log.position.set(0, r + row * r * 1.7, (i - (3 - row) / 2) * r * 2);
      group.add(log);
    }
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

// Pařez po pokáceném stromu
function stump(x: number, z: number): THREE.Object3D {
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 7), [
    material(LOG),
    material(LOG_END),
    material(LOG),
  ]);
  s.position.set(x, 0.05, z);
  return s;
}

// Stoh řeziva nebo ocelových plechů
function stack(x: number, z: number, color: number, layers = 4): THREE.Object3D {
  const group = new THREE.Group();
  for (let i = 0; i < layers; i++) group.add(box(0.5, 0.05, 0.3, 0, 0, color, i * 0.065));
  group.position.set(x, 0, z);
  return group;
}

// Nádrž s klenutou střechou
function tank(radius: number, height: number, x: number, z: number): THREE.Object3D {
  const group = new THREE.Group();
  group.add(cylinder(radius, height, 0, 0, TANK));
  const roof = mesh(new THREE.SphereGeometry(radius, 12, 4, 0, Math.PI * 2, 0, Math.PI / 6), TANK);
  roof.position.y = height - radius * Math.cos(Math.PI / 6);
  group.add(roof);
  group.position.set(x, 0, z);
  return group;
}

// Rektífikační kolona s ochozy
function column(radius: number, height: number, x: number, z: number): THREE.Object3D {
  const group = new THREE.Group();
  group.add(cylinder(radius, height, 0, 0, PLATE));
  for (let y = height * 0.3; y < height; y += height * 0.3) {
    const ring = mesh(new THREE.CylinderGeometry(radius * 1.5, radius * 1.5, 0.025, 12), DARK_STEEL);
    ring.position.y = y;
    group.add(ring);
  }
  group.position.set(x, 0, z);
  return group;
}

// Čerpací kozlík: kozlina s kyvadlovým vahadlem a hlavou nad vrtem
function pumpjack(x: number, z: number, rotation = 0): THREE.Object3D {
  const group = new THREE.Group();
  group.add(box(0.7, 0.05, 0.22, 0, 0, DARK_STEEL));
  for (const side of [-0.07, 0.07]) {
    group.add(beam(new THREE.Vector3(-0.12, 0.05, side), new THREE.Vector3(0, 0.42, 0), 0.03, STEEL));
    group.add(beam(new THREE.Vector3(0.12, 0.05, side), new THREE.Vector3(0, 0.42, 0), 0.03, STEEL));
  }
  const walking = box(0.62, 0.06, 0.06, 0.04, 0, COAL, 0.42);
  walking.rotation.z = -0.15;
  group.add(walking);
  group.add(box(0.06, 0.16, 0.08, 0.34, 0, COAL, 0.34));
  group.add(beam(new THREE.Vector3(0.34, 0.34, 0), new THREE.Vector3(0.34, 0.05, 0), 0.015, DARK_STEEL));
  group.add(box(0.16, 0.12, 0.16, -0.24, 0, BELT, 0.05));
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  group.scale.setScalar(1.3);
  return group;
}

// Vrtná věž: štíhlý jehlan z trubek
function derrick(x: number, z: number): THREE.Object3D {
  const group = new THREE.Group();
  const top = new THREE.Vector3(0, 1.3, 0);
  for (const [cx, cz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    group.add(beam(new THREE.Vector3(cx * 0.18, 0, cz * 0.18), top, 0.03, STEEL));
  }
  group.add(box(0.36, 0.03, 0.36, 0, 0, DARK_STEEL, 0.35));
  group.position.set(x, 0, z);
  return group;
}

// Vysoká pec: válec se zuženým hrdlem a šikmým zavážecím můstkem
function blastFurnace(x: number, z: number): THREE.Object3D {
  const group = new THREE.Group();
  group.add(cylinder(0.3, 0.9, 0, 0, STEEL));
  const neck = mesh(new THREE.CylinderGeometry(0.12, 0.3, 0.35, 12), DARK_STEEL);
  neck.position.y = 0.9 + 0.175;
  group.add(neck);
  group.add(cylinder(0.05, 1.6, 0, 0, DARK_STEEL));
  group.add(beam(new THREE.Vector3(0.75, 0, 0.3), new THREE.Vector3(0.1, 1.2, 0), 0.08, BELT));
  group.position.set(x, 0, z);
  return group;
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
const now = (object: THREE.Object3D): Promise<THREE.Object3D> => Promise.resolve(object);
const tree = (name: string, size: number, x: number, z: number): Promise<THREE.Object3D> =>
  kenney(name, size, x, z, x * 7 + z, 'city kit suburban');

const LAYOUTS: Record<IndustryKind, () => Promise<THREE.Object3D>[]> = {
  'coal-mine': () => [
    now(headframe(-0.7, -0.75)),
    kenney('building-k', 1.25, 0.75, -0.7),
    kenney('building-n', 0.8, 0.85, 0.75, Math.PI),
    now(pile(0.5, 0.42, -0.75, 0.75)),
    now(pile(0.32, 0.28, 0.05, 1.0)),
    now(conveyor(new THREE.Vector3(-0.75, 0.35, 0.55), new THREE.Vector3(-0.7, 0.9, -0.5))),
  ],
  'power-station': () => [
    kenney('chimney-large', 1.0, -0.9, -0.9),
    kenney('chimney-large', 0.85, 0.2, -1.0),
    kenney('chimney-basic', 0.3, 1.15, -0.95),
    kenney('building-e', 1.4, 0.55, 0.55, Math.PI / 2),
    kenney('detail-tank-large', 0.7, -0.95, 0.8),
    now(pile(0.35, 0.3, -0.15, 1.05)),
  ],
  forest: () => [
    ...[
      [-1.05, -1.05, 0.6],
      [-0.2, -1.15, 0.5],
      [0.8, -1.0, 0.65],
    ].map(([x, z, size], i) => tree(i === 1 ? 'tree-small' : 'tree-large', size, x, z)),
    ...[
      [-0.6, -0.4],
      [0.3, -0.55],
      [1.1, -0.3],
      [-1.15, -0.25],
    ].map(([x, z]) => now(stump(x, z))),
    // Skládka klád v řadách
    ...[-0.85, 0, 0.85].flatMap((x) => [now(logPile(x, 0.25, Math.PI / 2)), now(logPile(x, 0.95, Math.PI / 2))]),
  ],
  sawmill: () => [
    kenney('building-c', 1.4, -0.5, -0.55),
    kenney('chimney-small', 0.3, 0.75, -1.05),
    now(logPile(0.75, -0.3)),
    now(logPile(0.75, 0.3)),
    now(logPile(-1.0, 0.85, Math.PI / 2)),
    now(stack(-0.3, 0.75, LUMBER)),
    now(stack(0.35, 1.0, LUMBER, 3)),
  ],
  'oil-wells': () => [
    now(pumpjack(-0.8, -0.8)),
    now(pumpjack(0.7, -0.6, Math.PI / 3)),
    now(pumpjack(-0.6, 0.8, -Math.PI / 4)),
    now(derrick(0.75, 0.8)),
    now(tank(0.25, 0.4, 0.05, 0.1)),
  ],
  refinery: () => [
    now(tank(0.42, 0.55, -0.85, 0.85)),
    now(tank(0.42, 0.55, 0.15, 0.95)),
    now(column(0.12, 1.5, -0.2, -0.9)),
    now(column(0.09, 1.1, 0.15, -0.75)),
    kenney('chimney-medium', 0.4, -0.95, -0.85),
    kenney('building-b', 0.9, 0.85, -0.45, Math.PI / 2),
    now(beam(new THREE.Vector3(-0.2, 0.3, -0.9), new THREE.Vector3(-0.85, 0.3, 0.85), 0.04, DARK_STEEL)),
  ],
  'iron-mine': () => [
    now(headframe(0.7, -0.75)),
    kenney('building-m', 1.2, -0.7, -0.7),
    now(pile(0.5, 0.42, 0.75, 0.75, ORE)),
    now(pile(0.35, 0.3, -0.1, 0.95, ORE)),
    now(pile(0.25, 0.2, -0.85, 0.6, ORE)),
    now(conveyor(new THREE.Vector3(0.75, 0.35, 0.55), new THREE.Vector3(0.7, 0.9, -0.5))),
  ],
  'steel-mill': () => [
    kenney('building-f', 1.4, 0.5, -0.5),
    now(blastFurnace(-0.8, -0.6)),
    kenney('chimney-large', 0.6, -0.95, 0.4),
    kenney('chimney-medium', 0.45, -0.4, 0.55),
    now(stack(0.4, 0.75, PLATE)),
    now(stack(0.95, 1.05, PLATE, 3)),
  ],
  factory: () => [
    kenney('building-g', 1.6, -0.35, -0.45),
    kenney('chimney-medium', 0.45, 0.95, -1.0),
    kenney('water-tower', 0.5, 1.0, -0.2),
    kenney('shipping-container-a', 0.55, -0.9, 0.95),
    kenney('shipping-container-b', 0.55, -0.25, 1.0),
    kenney('shipping-container-c', 0.55, 0.45, 0.95, Math.PI / 2),
  ],
};

// Průmyslové areály složené z modelů Kenney a jednoduchých těles, s popiskem názvu
export class IndustriesView {
  readonly object = new THREE.Group();
  private readonly views = new Map<number, { area: THREE.Object3D; label: CSS2DObject }>();

  // Doplní nově založené závody a odebere zaniklé
  async sync(industries: readonly Industry[]): Promise<void> {
    const ids = new Set(industries.map((i) => i.id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      // Popisek musí odejít sám, jinak jeho element zůstane v DOM
      this.object.remove(view.area, view.label);
      this.views.delete(id);
    }
    const added = industries.filter((i) => !this.views.has(i.id));
    for (const industry of added) this.views.set(industry.id, { area: new THREE.Group(), label: this.label(industry) });
    await Promise.all(added.map((industry) => this.build(industry)));
  }

  private label(industry: Industry): CSS2DObject {
    const el = document.createElement('div');
    el.className = 'industry-label';
    el.textContent = industry.name;
    const label = new CSS2DObject(el);
    const half = INDUSTRY_SIZE / 2;
    label.position.set(industry.x + half, 2.2, industry.y + half);
    return label;
  }

  private async build(industry: Industry): Promise<void> {
    const parts = await Promise.all(LAYOUTS[industry.kind]());
    const view = this.views.get(industry.id);
    // Mezitím mohl závod zaniknout
    if (!view) return;
    const { area, label } = view;
    area.add(...parts);
    const half = INDUSTRY_SIZE / 2;
    area.position.set(industry.x + half, 0, industry.y + half);
    area.rotation.y = (industry.rotation * Math.PI) / 2;
    this.object.add(area, label);
  }
}
