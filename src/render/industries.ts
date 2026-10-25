import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { loadModel, type Kit } from '../assets';
import type { Season } from '../game/seasons';
import { INDUSTRY_SIZE, type Industry, type IndustryKind } from '../world/industry';
import { createSnowRoofGeometry, SNOW_MATERIAL } from './buildings';
import { FLOODLIGHT_POOLS, industryFence, industryFloodlights, industryGround, setFloodlights } from './industryYard';
import { withLampLight } from './nightLights';
import { freezeStatic } from './staticObjects';
import { treeObject } from './trees';

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
let activeSeason: Season = 'summer';

function disposeSnow(object: THREE.Object3D): void {
  object.traverse((part) => {
    if (part.userData.snowRoof && part instanceof THREE.Mesh) part.geometry.dispose();
  });
}

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
  inner.updateMatrixWorld(true);
  const snowMeshes: THREE.Mesh[] = [];
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const geometry = createSnowRoofGeometry(part.geometry, part.matrixWorld);
    if (!geometry) return;
    const snow = new THREE.Mesh(geometry, SNOW_MATERIAL);
    snow.userData.snowRoof = true;
    snow.visible = activeSeason === 'winter';
    snowMeshes.push(snow);
  });
  const outer = new THREE.Group();
  outer.add(inner, ...snowMeshes);
  outer.position.set(x, 0, z);
  outer.rotation.y = rotation;
  outer.userData.modelHeight = size.y * scale;
  outer.userData.modelCenter = center;
  outer.userData.modelScale = scale;
  return outer;
}

function animated<T extends THREE.Object3D>(object: T, update: (seconds: number) => void): T {
  object.userData.updateAnimation = update;
  return object;
}

async function rotatingWindmill(x: number, z: number): Promise<THREE.Object3D> {
  const mill = await kenney('windmill', 0.8, x, z);
  const blades = mill.getObjectByName('blades');
  if (!blades) return mill;
  const startRotation = blades.rotation.x;
  return animated(mill, (seconds) => {
    blades.rotation.x = startRotation + seconds * 1.8;
  });
}

function smoke(): THREE.Group {
  const plume = new THREE.Group();
  const puffs = Array.from({ length: 4 }, (_, i) => {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x45494a, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    puff.renderOrder = 2;
    plume.add(puff);
    return { mesh: puff, phase: i / 4 };
  });
  return animated(plume, (seconds) => {
    for (const { mesh: puff, phase } of puffs) {
      const cycle = (seconds * 0.38 + phase) % 1;
      puff.position.set(Math.sin(seconds * 0.7 + phase * Math.PI * 2) * cycle * 0.11, cycle * 0.75, 0);
      puff.scale.setScalar(0.7 + cycle * 1.5);
      (puff.material as THREE.MeshBasicMaterial).opacity = (1 - cycle) * 0.42;
    }
  });
}

async function smokingChimney(name: string, footprint: number, x: number, z: number): Promise<THREE.Object3D> {
  const chimney = await kenney(name, footprint, x, z);
  const plume = smoke();
  plume.position.y = chimney.userData.modelHeight + 0.02;
  chimney.add(plume);
  return chimney;
}

async function smokingBuilding(
  name: string,
  footprint: number,
  x: number,
  z: number,
  chimneys: readonly [number, number][],
  rotation = 0,
): Promise<THREE.Object3D> {
  const building = await kenney(name, footprint, x, z, rotation);
  const center = building.userData.modelCenter as THREE.Vector3;
  const modelScale = building.userData.modelScale as number;
  for (const [chimneyX, chimneyZ] of chimneys) {
    const plume = smoke();
    plume.position.set(
      (chimneyX - center.x) * modelScale,
      building.userData.modelHeight + 0.02,
      (chimneyZ - center.z) * modelScale,
    );
    building.add(plume);
  }
  return building;
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
  const arm = new THREE.Group();
  arm.position.set(0, 0.42, 0);
  arm.add(mesh(new THREE.BoxGeometry(0.62, 0.06, 0.06), COAL));
  arm.children[arm.children.length - 1].position.set(0.04, 0.03, 0);
  arm.add(box(0.06, 0.16, 0.08, 0.34, 0, COAL, -0.08));
  arm.add(beam(new THREE.Vector3(0.34, -0.08, 0), new THREE.Vector3(0.34, -0.37, 0), 0.015, DARK_STEEL));
  group.add(animated(arm, (seconds) => (arm.rotation.z = -0.15 + Math.sin(seconds * 1.5) * 0.2)));
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
    const wheel = new THREE.Group();
    wheel.add(mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), DARK_STEEL));
    for (let i = 0; i < 4; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.018, 0.29, 0.025), STEEL);
      spoke.rotation.z = (i * Math.PI) / 4;
      wheel.add(spoke);
    }
    wheel.position.set(0, height + 0.1, side);
    group.add(animated(wheel, (seconds) => (wheel.rotation.z = seconds * 1.5)));
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
const tree = (model: string, scale: number, x: number, z: number): Promise<THREE.Object3D> =>
  treeObject(model, scale, x, z, x * 7 + z);
const crop = (name: string, size: number, x: number, z: number): Promise<THREE.Object3D> =>
  kenney(name, size, x, z, 0, 'nature kit');

const LAYOUTS: Record<IndustryKind, () => Promise<THREE.Object3D>[]> = {
  'coal-mine': () => [
    now(headframe(-0.7, -0.75)),
    smokingBuilding('building-k', 1.25, 0.75, -0.7, [[0.43, 0.2]]),
    smokingBuilding('building-n', 0.8, 0.85, 0.75, [[-0.18, 0.82]], Math.PI),
    now(pile(0.5, 0.42, -0.75, 0.75)),
    now(pile(0.32, 0.28, 0.05, 1.0)),
    now(conveyor(new THREE.Vector3(-0.75, 0.35, 0.55), new THREE.Vector3(-0.7, 0.9, -0.5))),
  ],
  'power-station': () => [
    smokingChimney('chimney-large', 1.0, -0.9, -0.9),
    smokingChimney('chimney-large', 0.85, 0.2, -1.0),
    smokingChimney('chimney-basic', 0.3, 1.15, -0.95),
    kenney('building-e', 1.4, 0.55, 0.55, Math.PI / 2),
    kenney('detail-tank-large', 0.7, -0.95, 0.8),
    now(pile(0.35, 0.3, -0.15, 1.05)),
  ],
  forest: () => [
    // Dvě prostřídané řady stromů v zadní části areálu, od každého druhu tři
    ...(
      [
        ['tree_pineDefaultA', -1.2, -1.25, 0.6],
        ['tree_oak', -0.6, -1.3, 0.45],
        ['tree_pineRoundA', 0.0, -1.2, 0.55],
        ['tree_pineDefaultA', 0.6, -1.3, 0.5],
        ['tree_oak', 1.2, -1.2, 0.5],
        ['tree_pineRoundA', -0.9, -0.8, 0.5],
        ['tree_oak', -0.3, -0.85, 0.4],
        ['tree_pineDefaultA', 0.3, -0.9, 0.55],
        ['tree_pineRoundA', 0.9, -0.8, 0.45],
      ] as const
    ).map(([model, x, z, scale]) => tree(model, scale, x, z)),
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
    smokingBuilding('building-c', 1.4, -0.5, -0.55, [
      [0.34, 0.17],
      [0.34, -0.18],
    ]),
    smokingChimney('chimney-small', 0.3, 0.75, -1.05),
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
    smokingChimney('chimney-medium', 0.4, -0.95, -0.85),
    kenney('building-b', 0.9, 0.85, -0.45, Math.PI / 2),
    now(beam(new THREE.Vector3(-0.2, 0.3, -0.9), new THREE.Vector3(-0.85, 0.3, 0.85), 0.04, DARK_STEEL)),
  ],
  'iron-mine': () => [
    now(headframe(0.7, -0.75)),
    smokingBuilding('building-m', 1.2, -0.7, -0.7, [
      [0.33, 0.4],
      [0.33, 0],
      [0.33, -0.4],
    ]),
    now(pile(0.5, 0.42, 0.75, 0.75, ORE)),
    now(pile(0.35, 0.3, -0.1, 0.95, ORE)),
    now(pile(0.25, 0.2, -0.85, 0.6, ORE)),
    now(conveyor(new THREE.Vector3(0.75, 0.35, 0.55), new THREE.Vector3(0.7, 0.9, -0.5))),
  ],
  'steel-mill': () => [
    kenney('building-f', 1.4, 0.5, -0.5),
    now(blastFurnace(-0.8, -0.6)),
    smokingChimney('chimney-large', 0.6, -0.95, 0.4),
    smokingChimney('chimney-medium', 0.45, -0.4, 0.55),
    now(stack(0.4, 0.75, PLATE)),
    now(stack(0.95, 1.05, PLATE, 3)),
  ],
  factory: () => [
    kenney('building-g', 1.6, -0.35, -0.45),
    smokingChimney('chimney-medium', 0.45, 0.95, -1.0),
    kenney('water-tower', 0.5, 1.0, -0.2),
    kenney('detail-tank', 0.8, -0.75, 0.9),
  ],
  farm: () => [
    kenney('building-type-f', 0.95, -0.8, -0.6, 0, 'city kit suburban'),
    rotatingWindmill(0.65, -0.75),
    crop('crop_turnip', 0.5, -0.9, 0.55),
    crop('crop_carrot', 0.5, -0.25, 0.75),
    crop('crop_pumpkin', 0.55, 0.45, 0.72),
    crop('crop_melon', 0.55, 1.0, 0.45),
  ],
  'food-factory': () => [
    smokingBuilding('building-q', 1.35, -0.45, -0.45, [[-0.2, 0.3]], Math.PI / 2),
    smokingChimney('chimney-small', 0.35, 0.8, -0.85),
    kenney('planter', 0.8, -0.55, 0.9, 0, 'city kit suburban'),
  ],
};

export async function buildIndustryPreview(kind: IndustryKind): Promise<THREE.Group> {
  const area = new THREE.Group();
  area.add(industryGround(kind), industryFence(kind), industryFloodlights(), ...(await Promise.all(LAYOUTS[kind]())));
  return area;
}

export const INDUSTRY_ASSET_MODELS: readonly { kit: Kit; name: string }[] = [
  ...[
    'building-k',
    'building-n',
    'building-e',
    'building-c',
    'building-b',
    'building-m',
    'building-f',
    'building-g',
    'building-q',
    'chimney-small',
    'chimney-medium',
    'chimney-large',
    'chimney-basic',
    'detail-tank-large',
    'detail-tank',
    'water-tower',
    'windmill',
  ].map((name) => ({ kit: 'city kit industrial' as Kit, name })),
  ...['building-type-f', 'planter'].map((name) => ({
    kit: 'city kit suburban' as Kit,
    name,
  })),
  ...['crop_turnip', 'crop_carrot', 'crop_pumpkin', 'crop_melon'].map((name) => ({ kit: 'nature kit' as Kit, name })),
];

// Průmyslové areály složené z modelů Kenney a jednoduchých těles, s popiskem názvu
export class IndustriesView {
  readonly object = new THREE.Group();
  // Popisky závodů; vykresluje je CSS2DRenderer ve vlastní scéně
  readonly labels = new THREE.Group();
  private readonly views = new Map<
    number,
    { area: THREE.Object3D; label: CSS2DObject; animations: ((seconds: number) => void)[] }
  >();
  private lampPositions: THREE.Vector3[] = [];

  // Středy světel reflektorů všech areálů; nové pole při každé změně závodů
  get lamps(): readonly THREE.Vector3[] {
    return this.lampPositions;
  }

  // Jas reflektorů 0 (den) až 1 (noc)
  setNightMode(amount: number): void {
    setFloodlights(amount);
  }

  // Doplní nově založené závody a odebere zaniklé
  async sync(industries: readonly Industry[]): Promise<void> {
    const half = INDUSTRY_SIZE / 2;
    const up = new THREE.Vector3(0, 1, 0);
    this.lampPositions = industries.flatMap((industry) =>
      FLOODLIGHT_POOLS.map((pool) =>
        pool
          .clone()
          .applyAxisAngle(up, (industry.rotation * Math.PI) / 2)
          .add(new THREE.Vector3(industry.x + half, 0, industry.y + half)),
      ),
    );
    const ids = new Set(industries.map((i) => i.id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      // Popisek musí odejít sám, jinak jeho element zůstane v DOM
      this.object.remove(view.area);
      this.labels.remove(view.label);
      disposeSnow(view.area);
      this.views.delete(id);
    }
    const added = industries.filter((i) => !this.views.has(i.id));
    for (const industry of added)
      this.views.set(industry.id, { area: new THREE.Group(), label: this.label(industry), animations: [] });
    await Promise.all(added.map((industry) => this.build(industry)));
  }

  update(seconds: number): void {
    for (const view of this.views.values()) for (const update of view.animations) update(seconds);
  }

  setSeason(season: Season): void {
    activeSeason = season;
    for (const { area } of this.views.values()) {
      area.traverse((part) => {
        if (part.userData.snowRoof) part.visible = season === 'winter';
      });
    }
  }

  private label(industry: Industry): CSS2DObject {
    const el = document.createElement('div');
    el.className = 'industry-label';
    el.dataset.kind = 'industry';
    el.dataset.id = String(industry.id);
    el.textContent = industry.name;
    const label = new CSS2DObject(el);
    const half = INDUSTRY_SIZE / 2;
    label.position.set(industry.x + half, 2.2, industry.y + half);
    return label;
  }

  private async build(industry: Industry): Promise<void> {
    const preview = await buildIndustryPreview(industry.kind);
    const parts = [...preview.children];
    const view = this.views.get(industry.id);
    // Mezitím mohl závod zaniknout
    if (!view) {
      for (const part of parts) disposeSnow(part);
      return;
    }
    const { area, label } = view;
    area.add(...parts);
    area.traverse((part) => {
      const update = part.userData.updateAnimation;
      if (typeof update === 'function') view.animations.push(update as (seconds: number) => void);
      if (part instanceof THREE.Mesh) for (const material of [part.material].flat()) withLampLight(material);
    });
    const half = INDUSTRY_SIZE / 2;
    area.position.set(industry.x + half, 0, industry.y + half);
    area.rotation.y = (industry.rotation * Math.PI) / 2;
    freezeStatic(area);
    freezeStatic(label);
    this.object.add(area);
    this.labels.add(label);
  }
}
