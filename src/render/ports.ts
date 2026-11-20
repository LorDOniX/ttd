import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadScene } from '../assets';
import { CHAIN_LINK, customFence, floodlights, type FenceSegment, type FloodlightSpot } from './industryYard';
import { withLampLight } from './nightLights';
import { portFrame, portPoint, type PortShape } from '../world/port';
import { WATER_DEPTH } from './terrain';

const CONCRETE = 0xb3b0a6;
const KERB = 0x8c897f;
const DECK = 0x8a6440;
const POST = 0x5b4330;
const BOLLARD = 0x2f3236;
const CRANE = 0xe0a526;
const CRANE_CAB = 0x3c4a57;
const WAREHOUSE = 0x9a5a3c;
const WAREHOUSE_ROOF = 0x5d6266;
const DOOR = 0x3a3d40;
const BUOY = 0xd8473c;
const CONTAINERS = [0x2f6db5, 0xc0392b, 0x2e8b57, 0xe67e22, 0x7f8c8d];

function colorize(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Kvádr v místních souřadnicích přístavu: a podél nábřeží (X), c do vnitrozemí (Z, nad vodou záporné)
function slab(
  a0: number,
  a1: number,
  c0: number,
  c1: number,
  y0: number,
  h: number,
  color: number,
): THREE.BufferGeometry {
  return colorize(
    new THREE.BoxGeometry(a1 - a0, h, c1 - c0).translate((a0 + a1) / 2, y0 + h / 2, (c0 + c1) / 2),
    color,
  );
}

function cylinder(a: number, c: number, y0: number, r: number, h: number, color: number): THREE.BufferGeometry {
  return colorize(new THREE.CylinderGeometry(r, r, h, 8).translate(a, y0 + h / 2, c), color);
}

// Portálový jeřáb nad nábřežím s výložníkem nad kotvištěm
function crane(a: number): THREE.BufferGeometry[] {
  const height = 0.5;
  const parts: THREE.BufferGeometry[] = [];
  for (const da of [-0.22, 0.22]) {
    for (const c of [0.12, 0.5])
      parts.push(slab(a + da - 0.025, a + da + 0.025, c - 0.025, c + 0.025, 0.03, height, CRANE));
    parts.push(slab(a + da - 0.03, a + da + 0.03, 0.08, 0.55, 0.03 + height - 0.04, 0.05, CRANE));
  }
  parts.push(slab(a - 0.26, a + 0.26, 0.28, 0.36, 0.03 + height, 0.05, CRANE));
  parts.push(slab(a - 0.04, a + 0.04, -0.75, 0.6, 0.03 + height + 0.05, 0.05, CRANE));
  parts.push(slab(a - 0.1, a + 0.1, 0.18, 0.42, 0.03 + height + 0.1, 0.14, CRANE_CAB));
  // Lano s hákem nad vodou
  parts.push(slab(a - 0.008, a + 0.008, -0.55, -0.534, 0.25, 0.33, BOLLARD));
  return parts;
}

// Pojmenované díly přístavu v místních souřadnicích (1 jednotka = 1 dlaždice, nábřeží podél +X, voda na z < 0)
function layoutParts(): [string, THREE.BufferGeometry][] {
  const quay = [slab(0, 2, 0.04, 1, 0, 0.03, CONCRETE), slab(0, 2, 0, 0.06, 0, 0.045, KERB)];
  for (let a = 0.25; a < 2; a += 0.5) quay.push(cylinder(a, 0.03, 0.045, 0.022, 0.035, BOLLARD));
  // Dřevěné molo nad vodou s kůly
  const pier = [slab(0.04, 1.96, -0.16, 0, 0.005, 0.025, DECK)];
  for (let a = 0.1; a < 2; a += 0.3) {
    pier.push(slab(a - 0.02, a + 0.02, -0.17, -0.13, -WATER_DEPTH - 0.04, WATER_DEPTH + 0.075, POST));
  }
  // Skladiště s vraty k nábřeží
  const warehouse = [
    slab(1.08, 1.92, 0.5, 0.95, 0.03, 0.26, WAREHOUSE),
    slab(1.04, 1.96, 0.47, 0.98, 0.29, 0.04, WAREHOUSE_ROOF),
    slab(1.35, 1.65, 0.49, 0.51, 0.03, 0.18, DOOR),
  ];
  // Kontejnery naskládané u skladiště
  const containers: THREE.BufferGeometry[] = [];
  let k = 0;
  for (const [a, c, level] of [
    [1.12, 0.14, 0],
    [1.42, 0.14, 0],
    [1.12, 0.14, 1],
    [1.72, 0.14, 0],
  ] as const) {
    containers.push(slab(a, a + 0.26, c, c + 0.12, 0.03 + level * 0.1, 0.1, CONTAINERS[k++ % CONTAINERS.length]));
  }
  // Bóje na vnějším okraji kotvišť
  const buoys = [0.05, 1.95].map((a) => cylinder(a, -0.95, -WATER_DEPTH - 0.02, 0.05, 0.09, BUOY));
  const parts: [string, THREE.BufferGeometry[]][] = [
    ['nabrezi', quay],
    ['molo', pier],
    ['jerab', crane(0.5)],
    ['skladiste', warehouse],
    ['kontejnery', containers],
    ['boje', buoys],
  ];
  return parts.map(([name, geometries]) => [name, mergeGeometries(geometries)!]);
}

function layout(): THREE.BufferGeometry {
  return mergeGeometries(layoutParts().map(([, part]) => part))!;
}

// Přístav jako skupina pojmenovaných dílů (pro galerii modelů a export)
export function portModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pristav';
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const [name, part] of layoutParts()) {
    const mesh = new THREE.Mesh(part, material);
    mesh.name = name;
    group.add(mesh);
  }
  return group;
}

let geometry: THREE.BufferGeometry | null = null;

// Podrobný model přístavu z assets/ports/port.glb ve stejné místní soustavě jako díly z kódu
// (a podél nábřeží 0..2, voda na z < 0). Dokud se nenačte, nebo když chybí, kreslí se přístav z kódu.
let detailed: THREE.Group | null = null;
let loading: Promise<THREE.Group | null> | null = null;

// Desítky dílů s vlastními materiály se slijí podle textury do pár meshů (draw callů);
// barva materiálu přejde do barev ve vrcholech, stínování zůstane ploché jako u low-poly modelu
function mergeByTexture(scene: THREE.Object3D): THREE.Group {
  scene.updateMatrixWorld(true);
  const groups = new Map<string, { map: THREE.Texture | null; side: THREE.Side; parts: THREE.BufferGeometry[] }>();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = (Array.isArray(child.material) ? child.material[0] : child.material) as THREE.MeshStandardMaterial;
    const part = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    part.applyMatrix4(child.matrixWorld);
    for (const name of Object.keys(part.attributes))
      if (name !== 'position' && name !== 'uv') part.deleteAttribute(name);
    const count = part.getAttribute('position').count;
    if (!part.getAttribute('uv')) part.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    part.computeVertexNormals();
    const tint = source.color ?? new THREE.Color(1, 1, 1);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3);
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const map = source.map ?? null;
    const key = `${map?.uuid ?? 'barvy'}:${source.side}`;
    const group = groups.get(key) ?? { map, side: source.side, parts: [] };
    group.parts.push(part);
    groups.set(key, group);
  });
  const merged = new THREE.Group();
  merged.name = 'pristav';
  for (const { map, side, parts } of groups.values()) {
    const material = new THREE.MeshLambertMaterial({ map, side, vertexColors: true });
    withLampLight(material);
    merged.add(new THREE.Mesh(mergeGeometries(parts)!, material));
  }
  return merged;
}

export function loadPortModel(): Promise<THREE.Group | null> {
  loading ??= loadScene('ports', 'port').then(
    (scene) => (detailed = mergeByTexture(scene)),
    () => null,
  );
  return loading;
}

// Pletivový plot jako u průmyslu jen po souši: vzadu s vjezdem mezi jeřábem a skladištěm a po stranách.
// Strana k vodě zůstává volná, boky začínají až za úvazníky na hraně nábřeží.
const FENCE_INSET = 0.03;
const FENCE_FROM_WATER = 0.12;
const FENCE_GATE: [number, number] = [0.8, 1.05];
const FENCE_SEGMENTS: FenceSegment[] = [
  [FENCE_INSET, FENCE_FROM_WATER, FENCE_INSET, 1 - FENCE_INSET],
  [2 - FENCE_INSET, FENCE_FROM_WATER, 2 - FENCE_INSET, 1 - FENCE_INSET],
  [FENCE_INSET, 1 - FENCE_INSET, FENCE_GATE[0], 1 - FENCE_INSET],
  [FENCE_GATE[1], 1 - FENCE_INSET, 2 - FENCE_INSET, 1 - FENCE_INSET],
];

function portFence(): THREE.Group {
  const fence = customFence('port', CHAIN_LINK, FENCE_SEGMENTS);
  fence.traverse((child) => {
    if (child instanceof THREE.Mesh) for (const material of [child.material].flat()) withLampLight(material);
  });
  return fence;
}

// Osvětlení jako u průmyslu: dva reflektory u vody svítí na kotviště, třetí vzadu do dvora.
// Místa sloupů a skvrn světla [a, c] v místní soustavě přístavu
const FLOODLIGHTS: { pole: [number, number]; pool: [number, number] }[] = [
  { pole: [0.08, 0.14], pool: [0.55, -0.4] },
  { pole: [1.93, 0.14], pool: [1.45, -0.4] },
  { pole: [0.08, 0.92], pool: [0.6, 0.55] },
];
const FLOODLIGHT_SPOTS: FloodlightSpot[] = FLOODLIGHTS.map(({ pole: [a, c], pool: [pa, pc] }) => ({
  x: a,
  z: c,
  yaw: Math.atan2(pa - a, pc - c),
}));

let lights: THREE.Group | null = null;

function portFloodlights(): THREE.Group {
  lights ??= floodlights(FLOODLIGHT_SPOTS);
  return lights.clone();
}

// Skvrny světla reflektorů všech přístavů na mapě (x, z) pro zapečení nočního světla
export function portLamps(ports: readonly PortShape[]): THREE.Vector3[] {
  return ports.flatMap((port) =>
    FLOODLIGHTS.map(({ pool: [a, c] }) => {
      const p = portPoint(port, a, c);
      return new THREE.Vector3(p.x, 0, p.y);
    }),
  );
}

// Přístav na mapě s plotem; useModel = podrobný model (náhled stavby kreslí obrysy z kódu barvou platnosti, bez plotu)
export function createPortObject(shape: PortShape, material: THREE.Material, useModel = true): THREE.Object3D {
  geometry ??= layout();
  const object = new THREE.Group();
  const { origin, u } = portFrame(shape);
  object.position.set(origin.x, 0, origin.y);
  object.rotation.y = Math.atan2(-u.y, u.x);
  if (!useModel) {
    object.add(new THREE.Mesh(geometry, material));
    return object;
  }
  object.add(portFence(), portFloodlights());
  if (detailed) {
    object.add(detailed.clone());
    return object;
  }
  const fallback = new THREE.Mesh(geometry, material);
  object.add(fallback);
  void loadPortModel().then((model) => {
    if (!model) return;
    object.remove(fallback);
    object.add(model.clone());
  });
  return object;
}
