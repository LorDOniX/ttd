import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { portFrame, type PortShape } from '../world/port';
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

function layout(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    slab(0, 2, 0.04, 1, 0, 0.03, CONCRETE),
    slab(0, 2, 0, 0.06, 0, 0.045, KERB),
    // Dřevěné molo nad vodou s kůly
    slab(0.04, 1.96, -0.16, 0, 0.005, 0.025, DECK),
  ];
  for (let a = 0.1; a < 2; a += 0.3)
    parts.push(slab(a - 0.02, a + 0.02, -0.17, -0.13, -WATER_DEPTH - 0.04, WATER_DEPTH + 0.075, POST));
  for (let a = 0.25; a < 2; a += 0.5) parts.push(cylinder(a, 0.03, 0.045, 0.022, 0.035, BOLLARD));
  parts.push(...crane(0.5));
  // Skladiště s vraty k nábřeží
  parts.push(slab(1.08, 1.92, 0.5, 0.95, 0.03, 0.26, WAREHOUSE));
  parts.push(slab(1.04, 1.96, 0.47, 0.98, 0.29, 0.04, WAREHOUSE_ROOF));
  parts.push(slab(1.35, 1.65, 0.49, 0.51, 0.03, 0.18, DOOR));
  // Kontejnery naskládané u skladiště
  let k = 0;
  for (const [a, c, level] of [
    [1.12, 0.14, 0],
    [1.42, 0.14, 0],
    [1.12, 0.14, 1],
    [1.72, 0.14, 0],
  ] as const) {
    parts.push(slab(a, a + 0.26, c, c + 0.12, 0.03 + level * 0.1, 0.1, CONTAINERS[k++ % CONTAINERS.length]));
  }
  // Bóje na vnějším okraji kotvišť
  for (const a of [0.05, 1.95]) parts.push(cylinder(a, -0.95, -WATER_DEPTH - 0.02, 0.05, 0.09, BUOY));
  return mergeGeometries(parts)!;
}

let geometry: THREE.BufferGeometry | null = null;

export function createPortObject(shape: PortShape, material: THREE.Material): THREE.Mesh {
  geometry ??= layout();
  const mesh = new THREE.Mesh(geometry, material);
  const { origin, u } = portFrame(shape);
  mesh.position.set(origin.x, 0, origin.y);
  mesh.rotation.y = Math.atan2(-u.y, u.x);
  return mesh;
}
