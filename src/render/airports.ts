import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIRPORT_TYPES, type AirportType } from '../game/balance';
import { RUNWAY_C, STAND_C, TAXIWAY_C, airportPoint, hangarColumn, standColumns } from '../world/airport';
import type { StationShape } from '../world/rail';

const ASPHALT = 0x3f4246;
const TAXIWAY = 0x55585d;
const APRON = 0x9a9a96;
const MARKING = 0xf2f2ee;
const YELLOW = 0xe8c341;
const TERMINAL = 0xd9d4c8;
const GLASS = 0x6fa3c4;
const ROOF = 0x7d8288;
const ROOF_LIGHT = 0xe9e6df;
const TOWER = 0xe6e2d8;
const HANGAR = 0xa9b0b6;
const HANGAR_DOOR = 0x5b6168;
const PARKING = 0x4f5256;
const LAMP_RED = 0xd8473c;
const LAMP_GREEN = 0x4fc35a;

function colorize(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Kvádr v místních souřadnicích letiště: a podél ranveje (X), c napříč (Z), y0 spodní hrana
function slab(
  a0: number,
  a1: number,
  c0: number,
  c1: number,
  y0: number,
  h: number,
  color: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(a1 - a0, h, c1 - c0).translate((a0 + a1) / 2, y0 + h / 2, (c0 + c1) / 2);
  return colorize(geometry, color);
}

function cylinder(
  a: number,
  c: number,
  y0: number,
  r: number,
  h: number,
  color: number,
  segments = 10,
): THREE.BufferGeometry {
  return colorize(new THREE.CylinderGeometry(r, r, h, segments).translate(a, y0 + h / 2, c), color);
}

// Hangár: stěny a půlválcová střecha podél osy c, vrata na straně pojezdové dráhy (c0)
function hangar(a0: number, a1: number, c0: number, c1: number): THREE.BufferGeometry[] {
  const wall = 0.3;
  const r = (a1 - a0) / 2;
  const roof = new THREE.CylinderGeometry(r, r, c1 - c0, 12, 1, false, -Math.PI / 2, Math.PI)
    .rotateX(-Math.PI / 2)
    .translate((a0 + a1) / 2, wall, (c0 + c1) / 2);
  return [
    slab(a0, a1, c0, c1, 0, wall, HANGAR),
    colorize(roof, ROOF),
    slab(a0 + 0.08, a1 - 0.08, c0 - 0.01, c0 + 0.02, 0, wall + r * 0.75, HANGAR_DOOR),
  ];
}

// Řídicí věž: dřík, prosklená kabina a střecha
function tower(a: number, c: number, height: number): THREE.BufferGeometry[] {
  return [
    cylinder(a, c, 0, 0.09, height, TOWER, 8),
    cylinder(a, c, height, 0.17, 0.14, GLASS, 8),
    cylinder(a, c, height + 0.14, 0.2, 0.04, ROOF, 8),
    cylinder(a, c, height + 0.18, 0.015, 0.12, 0x444444, 4),
  ];
}

function runway(length: number): THREE.BufferGeometry[] {
  const y = 0.006;
  const parts = [slab(0.05, length - 0.05, RUNWAY_C - 0.4, RUNWAY_C + 0.4, 0, y, ASPHALT)];
  // Přerušovaná osa
  for (let a = 0.9; a < length - 0.9; a += 0.5)
    parts.push(slab(a, a + 0.25, RUNWAY_C - 0.02, RUNWAY_C + 0.02, y, 0.002, MARKING));
  // Prahy ranveje: pruhy napříč na obou koncích
  for (const a of [0.15, length - 0.45]) {
    for (let k = 0; k < 6; k++) {
      const c = RUNWAY_C - 0.32 + k * 0.12 + (k >= 3 ? 0.04 : 0);
      parts.push(slab(a, a + 0.3, c, c + 0.06, y, 0.002, MARKING));
    }
  }
  // Světla na koncích ranveje: zelená na začátku, červená na konci
  for (const [a, color] of [
    [0.08, LAMP_GREEN],
    [length - 0.08, LAMP_RED],
  ] as const) {
    for (let k = 0; k < 5; k++)
      parts.push(slab(a - 0.02, a + 0.02, RUNWAY_C - 0.36 + k * 0.18, RUNWAY_C - 0.32 + k * 0.18, y, 0.03, color));
  }
  return parts;
}

function taxiways(length: number): THREE.BufferGeometry[] {
  const y = 0.005;
  const parts = [
    slab(0.3, length - 0.3, TAXIWAY_C - 0.25, TAXIWAY_C + 0.25, 0, y, TAXIWAY),
    // Spojky z pojezdové dráhy na začátek a z konce ranveje
    slab(0.3, 0.7, RUNWAY_C + 0.4, TAXIWAY_C - 0.25, 0, y, TAXIWAY),
    slab(length - 0.7, length - 0.3, RUNWAY_C + 0.4, TAXIWAY_C - 0.25, 0, y, TAXIWAY),
    slab(0.5, length - 0.5, TAXIWAY_C - 0.015, TAXIWAY_C + 0.015, y, 0.002, YELLOW),
    slab(0.485, 0.515, RUNWAY_C + 0.4, TAXIWAY_C, y, 0.002, YELLOW),
    slab(length - 0.515, length - 0.485, RUNWAY_C + 0.4, TAXIWAY_C, y, 0.002, YELLOW),
  ];
  // Odbavovací plocha před terminálem a hangárem
  parts.push(slab(0.9, length - 0.05, TAXIWAY_C + 0.25, STAND_C + 0.5, 0, y, APRON));
  return parts;
}

// Stání: žlutá naváděcí čára z pojezdové dráhy
function stands(columns: number[]): THREE.BufferGeometry[] {
  return columns.flatMap((a) => [
    slab(a + 0.485, a + 0.515, TAXIWAY_C + 0.25, STAND_C + 0.35, 0.007, 0.002, YELLOW),
    slab(a + 0.3, a + 0.7, STAND_C + 0.33, STAND_C + 0.36, 0.007, 0.002, YELLOW),
  ]);
}

// Terminál: prosklená hala se světlou střechou a technikou na ní, nástupní mosty ke stáním
function terminal(
  a0: number,
  a1: number,
  c0: number,
  c1: number,
  h: number,
  bridges: number[],
): THREE.BufferGeometry[] {
  const parts = [
    slab(a0, a1, c0, c1, 0, h * 0.18, TERMINAL),
    // Prosklený plášť kolem dokola mezi soklem a střechou
    slab(a0 + 0.01, a1 - 0.01, c0 + 0.01, c1 - 0.01, h * 0.18, h * 0.7, GLASS),
    slab(a0, a1, c0, c1, h * 0.88, h * 0.12, TERMINAL),
    slab(a0 - 0.03, a1 + 0.03, c0 - 0.03, c1 + 0.03, h, 0.03, ROOF_LIGHT),
  ];
  // Svislé sloupky ve skle po celém obvodu
  for (let a = a0 + 0.25; a < a1 - 0.1; a += 0.3) {
    for (const c of [c0, c1 - 0.03]) parts.push(slab(a, a + 0.03, c - 0.005, c + 0.035, h * 0.18, h * 0.7, TERMINAL));
  }
  // Klimatizace na střeše
  for (let a = a0 + 0.35; a < a1 - 0.3; a += 0.9)
    parts.push(slab(a, a + 0.22, c0 + 0.25, c0 + 0.45, h + 0.03, 0.06, 0x9ea3a8));
  // Příjezdová stříška nad chodníkem na straně parkoviště
  parts.push(slab(a0 + 0.3, a1 - 0.3, c1, c1 + 0.12, h * 0.55, 0.025, ROOF_LIGHT));
  for (const a of bridges) parts.push(slab(a + 0.62, a + 0.74, STAND_C + 0.1, c0, 0.18, 0.1, TERMINAL));
  return parts;
}

// Parkoviště s bílými čarami
function parking(a0: number, a1: number, c0: number, c1: number): THREE.BufferGeometry[] {
  const parts = [slab(a0, a1, c0, c1, 0, 0.006, PARKING)];
  for (let a = a0 + 0.1; a < a1 - 0.05; a += 0.16)
    parts.push(slab(a, a + 0.02, c0 + 0.08, c0 + 0.3, 0.006, 0.002, MARKING));
  return parts;
}

// Pojmenované díly letiště v místních souřadnicích (1 jednotka = 1 dlaždice, ranvej podél +X na z 0..1)
function layoutParts(type: AirportType): [string, THREE.BufferGeometry][] {
  const { length, depth } = AIRPORT_TYPES[type];
  const columns = standColumns(type);
  const hangarA = hangarColumn(type);
  const first = columns[0];
  const last = columns[columns.length - 1] + 1;
  const parking1 = parking(0.1, 0.9, depth - 0.95, depth - 0.1);
  const parking2 = type === 'large' ? parking(hangarA - 0.92, hangarA - 0.08, STAND_C + 0.55, depth - 0.1) : [];
  const parts: [string, THREE.BufferGeometry[]][] = [
    ['ranvej', runway(length)],
    ['pojezdova-draha', taxiways(length)],
    ['stani', stands(columns)],
    [
      'terminal',
      terminal(first + 0.08, last - 0.08, STAND_C + 0.55, depth - 0.3, type === 'large' ? 0.4 : 0.3, columns),
    ],
    ['hangar', hangar(hangarA + 0.06, hangarA + 0.94, STAND_C - 0.45, depth - 0.1)],
    ['vez', tower(0.5, STAND_C - 0.1, type === 'large' ? 1.25 : 0.85)],
    ['parkoviste', [...parking1, ...parking2]],
  ];
  return parts.map(([name, geometries]) => [name, mergeGeometries(geometries)!]);
}

const layouts = new Map<AirportType, THREE.BufferGeometry>();

function layoutGeometry(type: AirportType): THREE.BufferGeometry {
  let geometry = layouts.get(type);
  if (!geometry) {
    geometry = mergeGeometries(layoutParts(type).map(([, part]) => part))!;
    layouts.set(type, geometry);
  }
  return geometry;
}

// Letiště jako skupina pojmenovaných dílů (pro galerii modelů a export); počátek v rohu u začátku ranveje
export function airportModel(type: AirportType): THREE.Group {
  const group = new THREE.Group();
  group.name = `letiste-${type}`;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const [name, geometry] of layoutParts(type)) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
  }
  return group;
}

// Letiště na mapě: místní a, c se natočí stejně jako v airportPoint (u osy y o −90°)
export function createAirportObject(shape: StationShape, type: AirportType, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(layoutGeometry(type), material);
  const origin = airportPoint(shape, 0, 0);
  mesh.position.set(origin.x, 0, origin.y);
  if (shape.axis === 'y') mesh.rotation.y = -Math.PI / 2;
  return mesh;
}
