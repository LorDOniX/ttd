import * as THREE from 'three';
import { HEIGHT_STEP, TileType, type GameMap } from '../world/map';
import { EDGE_DELTA, type Edge } from '../world/rail';
import { CANAL_DROP, canSail, lockEnds } from '../world/port';
import { WATER_DEPTH } from './terrain';
import { withWater } from './water';

// Kamenná nábřežní zeď kanálu: od dna nad okolní terén
const WALL_TOP = 0.025;
const WALL_THICKNESS = 0.05;
const GATE_THICKNESS = 0.04;

const WATER_MATERIAL = withWater(new THREE.MeshLambertMaterial({ color: 0x3a6fb0, side: THREE.DoubleSide }), 1e6);
const STONE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x9a9184 });
const GATE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x5b4632 });

type Out = number[];

// Vodorovný obdélník v místních souřadnicích dlaždice: osa a podél, c napříč (0–1)
function flat(out: Out, x0: number, z0: number, x1: number, z1: number, y: number): void {
  out.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1);
}

// Kvádr od (x0, y0, z0) do (x1, y1, z1)
function box(out: Out, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  out.push(...(geometry.getAttribute('position').array as Float32Array));
  geometry.dispose();
}

// Obdélník podél hrany dlaždice: from/to podél hrany (0–1), depth od hrany dovnitř
function edgeRect(x: number, y: number, edge: Edge, from: number, to: number, depth: number): number[] {
  switch (edge) {
    case 0: // sever: hrana y
      return [x + from, y, x + to, y + depth];
    case 2: // jih
      return [x + from, y + 1 - depth, x + to, y + 1];
    case 1: // východ
      return [x + 1 - depth, y + from, x + 1, y + to];
    default: // západ
      return [x, y + from, x + depth, y + to];
  }
}

// Kanály a zdymadla: hladina v úrovni dlaždice, kamenné zdi tam, kde kanál nenavazuje na vodu
// ve stejné hladině, a ve zdymadle dolní a horní komora s vraty uprostřed
export class CanalsView {
  readonly object = new THREE.Group();
  private key = '';

  constructor(private readonly map: GameMap) {}

  rebuild(): void {
    const { map } = this;
    const key = String(map.changeCursor);
    if (key === this.key) return;
    this.key = key;
    this.object.clear();
    const water: Out = [];
    const stone: Out = [];
    const gates: Out = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const type = map.get(x, y);
        if (type === TileType.Canal) this.canal(x, y, water, stone);
        else if (type === TileType.Lock) this.lock(x, y, water, stone, gates);
      }
    }
    for (const [positions, material] of [
      [water, WATER_MATERIAL],
      [stone, STONE_MATERIAL],
      [gates, GATE_MATERIAL],
    ] as const) {
      if (positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.object.add(mesh);
    }
  }

  private canal(x: number, y: number, water: Out, stone: Out): void {
    const ground = this.map.tileLevel(x, y) * HEIGHT_STEP;
    const surface = ground - CANAL_DROP;
    flat(water, x, y, x + 1, y + 1, surface);
    for (let edge = 0 as Edge; edge < 4; edge++) {
      const [dx, dy] = EDGE_DELTA[edge];
      if (canSail(this.map, x, y, x + dx, y + dy)) continue;
      const [x0, z0, x1, z1] = edgeRect(x, y, edge, 0, 1, WALL_THICKNESS);
      box(stone, x0, ground - WATER_DEPTH, z0, x1, ground + WALL_TOP, z1);
    }
  }

  private lock(x: number, y: number, water: Out, stone: Out, gates: Out): void {
    const ends = lockEnds(this.map, x, y);
    if (!ends) return;
    const low = ends.low * HEIGHT_STEP;
    const high = ends.high * HEIGHT_STEP;
    const [dx, dy] = EDGE_DELTA[ends.up];
    const alongX = dx !== 0;
    // Místní poloha podél osy: t = 0 dolní hrana, 1 horní; napříč c 0–1
    const point = (t: number, c: number): [number, number] => {
      const a = dx > 0 || dy > 0 ? t : 1 - t;
      return alongX ? [x + a, y + c] : [x + c, y + a];
    };
    const rect = (t0: number, t1: number, c0: number, c1: number): [number, number, number, number] => {
      const [ax, az] = point(t0, c0);
      const [bx, bz] = point(t1, c1);
      return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
    };
    // Dolní komora v dolní hladině, horní komora jako kvádr vody v horní hladině
    const [lx0, lz0, lx1, lz1] = rect(0, 0.5, 0, 1);
    flat(water, lx0, lz0, lx1, lz1, low - CANAL_DROP);
    const [ux0, uz0, ux1, uz1] = rect(0.5, 1, 0, 1);
    flat(water, ux0, uz0, ux1, uz1, high - CANAL_DROP);
    // Stěna horní komory pod vraty a boční zdi po celé délce
    const [wx0, wz0, wx1, wz1] = rect(0.48, 0.52, 0, 1);
    box(stone, wx0, low - WATER_DEPTH, wz0, wx1, high - CANAL_DROP, wz1);
    for (const [c0, c1] of [
      [0, WALL_THICKNESS],
      [1 - WALL_THICKNESS, 1],
    ]) {
      const [sx0, sz0, sx1, sz1] = rect(0, 1, c0, c1);
      box(stone, sx0, low - WATER_DEPTH, sz0, sx1, high + WALL_TOP, sz1);
    }
    // Vrata: dolní, prostřední (nad stěnou) a horní
    for (const [t, bottom, top] of [
      [0.04, low - CANAL_DROP, low + WALL_TOP],
      [0.5, high - CANAL_DROP, high + WALL_TOP],
      [0.96, high - CANAL_DROP, high + WALL_TOP],
    ]) {
      const [gx0, gz0, gx1, gz1] = rect(
        t - GATE_THICKNESS / 2,
        t + GATE_THICKNESS / 2,
        WALL_THICKNESS,
        1 - WALL_THICKNESS,
      );
      box(gates, gx0, bottom, gz0, gx1, top, gz1);
    }
  }
}
