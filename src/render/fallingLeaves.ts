import * as THREE from 'three';
import type { Season } from '../game/seasons';
import { TileType, type GameMap } from '../world/map';

// Při větším oddálení by listy měly jen pár pixelů
export const LEAF_MIN_ZOOM = 0.9;
// Strop listů v záběru, aby velký výřez lesa nezahltil snímek
export const MAX_VISIBLE_LEAVES = 4000;
const LEAF_CHANCE = 0.27;
const LEAVES_PER_TILE = 3;
const LEAF_TOP = 1.65;
// Tlumené podzimní tóny: dýně, okr, horčice, rez a hnědá
const LEAF_COLORS = [0xd9822b, 0xc8641e, 0xe0a73a, 0xb5462a, 0xa8572a, 0xcf9a3c];
// Část cyklu, kdy list dopadne; zbytek leží na zemi a zmenšuje se
const LAND_AT = 0.88;
// Každá barva v několika odstínech a jasech, předpočítané, aby se nepočítaly každý snímek
const LEAF_TINTS = LEAF_COLORS.flatMap((hex) =>
  [
    [-0.01, -0.04],
    [0.01, 0.03],
    [0, -0.01],
    [-0.005, 0.05],
  ].map(([hue, lightness]) => new THREE.Color(hex).offsetHSL(hue, 0, lightness)),
);

export interface FallingLeaf {
  x: number;
  z: number;
  height: number;
  phase: number;
  speed: number;
  driftX: number;
  driftZ: number;
  rotation: number;
  size: number;
  tint: number;
}

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function hasFallingLeaves(map: GameMap, x: number, y: number): boolean {
  return map.tiles[y * map.width + x] === TileType.Trees && tileHash(x, y, 300) < LEAF_CHANCE;
}

// Parametry k-tého listu dlaždice jsou z hashe, takže se listy nikde neukládají a vznikají jen v záběru
export function fallingLeaf(x: number, y: number, k: number, out = {} as FallingLeaf): FallingLeaf {
  const salt = k * 16;
  out.x = x + 0.25 + tileHash(x, y, 301 + salt) * 0.5;
  out.z = y + 0.25 + tileHash(x, y, 302 + salt) * 0.5;
  out.height = 0.85 + tileHash(x, y, 303 + salt) * 0.75;
  out.phase = tileHash(x, y, 304 + salt);
  out.speed = 0.12 + tileHash(x, y, 305 + salt) * 0.06;
  out.driftX = tileHash(x, y, 306 + salt) * 0.5 - 0.25;
  out.driftZ = tileHash(x, y, 307 + salt) * 0.5 - 0.25;
  out.rotation = tileHash(x, y, 308 + salt) * Math.PI * 2;
  out.size = 0.12 + tileHash(x, y, 309 + salt) * 0.05;
  out.tint = Math.floor(tileHash(x, y, 310 + salt) * LEAF_TINTS.length);
  return out;
}

// Low-poly list ve vodorovné rovině: žilka podél osy x, poloviny čepele zvednuté do V,
// barvy vrcholů (násobí barvu instance) dělají světlejší žilku, tmavší rezavé okraje a hnědou stopku
function createLeafGeometry(): THREE.BufferGeometry {
  const fold = 0.09;
  const rib = [1, 0.97, 0.82];
  const edge = [0.86, 0.68, 0.6];
  const tip = [0.78, 0.6, 0.5];
  const stem = [0.5, 0.36, 0.26];
  const points: Record<string, [number, number, number, number[]]> = {
    stem: [-0.62, 0, 0, stem],
    stemL: [-0.42, 0, -0.025, stem],
    stemR: [-0.42, 0, 0.025, stem],
    base: [-0.42, 0, 0, rib],
    mid: [0, 0, 0, rib],
    tip: [0.5, 0, 0, tip],
    l1: [-0.28, fold * 0.6, -0.2, edge],
    l2: [0, fold, -0.3, edge],
    l3: [0.28, fold * 0.7, -0.19, edge],
    r1: [-0.28, fold * 0.6, 0.2, edge],
    r2: [0, fold, 0.3, edge],
    r3: [0.28, fold * 0.7, 0.19, edge],
  };
  const triangles = [
    ['stem', 'stemL', 'stemR'],
    ['base', 'l1', 'mid'],
    ['l1', 'l2', 'mid'],
    ['l2', 'l3', 'mid'],
    ['l3', 'tip', 'mid'],
    ['base', 'mid', 'r1'],
    ['r1', 'mid', 'r2'],
    ['r2', 'mid', 'r3'],
    ['r3', 'mid', 'tip'],
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  for (const triangle of triangles) {
    for (const name of triangle) {
      const [x, y, z, color] = points[name];
      positions.push(x, y, z);
      colors.push(...color);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const LEAF_GEOMETRY = createLeafGeometry();
const LEAF_MATERIAL = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  side: THREE.DoubleSide,
});

// Listy jen z lesních dlaždic v záběru kamery; mimo záběr se nepočítají ani nekreslí
export class FallingLeavesView {
  readonly object = new THREE.Group();
  private readonly mesh = new THREE.InstancedMesh(LEAF_GEOMETRY, LEAF_MATERIAL, MAX_VISIBLE_LEAVES);
  private season: Season = 'summer';
  private readonly leaf = {} as FallingLeaf;
  private readonly near = new THREE.Vector3();
  private readonly far = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();

  constructor(private readonly map: GameMap) {
    this.mesh.setColorAt(0, LEAF_TINTS[0]);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.object.add(this.mesh);
  }

  setSeason(season: Season): void {
    this.season = season;
    if (season !== 'autumn') this.mesh.visible = false;
  }

  update(seconds: number, camera: THREE.Camera & { zoom: number }, frustum: THREE.Frustum): void {
    const active = this.season === 'autumn' && camera.zoom >= LEAF_MIN_ZOOM;
    this.mesh.visible = active;
    if (!active) return;

    const [x0, y0, x1, y1] = this.visibleTiles(camera);
    let count = 0;
    tiles: for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!hasFallingLeaves(this.map, x, y)) continue;
        for (let k = 0; k < LEAVES_PER_TILE; k++) {
          if (count >= MAX_VISIBLE_LEAVES) break tiles;
          if (this.place(fallingLeaf(x, y, k, this.leaf), seconds, frustum)) {
            this.mesh.setMatrixAt(count, this.matrix);
            this.mesh.setColorAt(count, LEAF_TINTS[this.leaf.tint]);
            count++;
          }
        }
      }
    }
    this.mesh.count = count;
    const { instanceMatrix, instanceColor } = this.mesh;
    instanceMatrix.clearUpdateRanges();
    instanceMatrix.addUpdateRange(0, count * 16);
    instanceMatrix.needsUpdate = true;
    instanceColor!.clearUpdateRanges();
    instanceColor!.addUpdateRange(0, count * 3);
    instanceColor!.needsUpdate = true;
  }

  // Spočte matici listu v čase seconds; false, když je list mimo záběr
  private place(leaf: FallingLeaf, seconds: number, frustum: THREE.Frustum): boolean {
    const progress = (seconds * leaf.speed + leaf.phase) % 1;
    const fall = Math.min(1, progress / LAND_AT);
    // Kyvadlový let: list se houpá ze strany na stranu, na krajních bodech se nakloní a mírně zvedne;
    // těsně nad zemí se kyv utlumí, aby list dosedl naplocho
    const air = Math.min(1, (1 - fall) * 8);
    const swing = Math.sin(seconds * 2.4 + leaf.phase * Math.PI * 2) * air;
    const yaw = leaf.rotation + Math.sin(seconds * 0.5 + leaf.phase * 3) * 0.6;
    this.position.set(
      leaf.x + leaf.driftX * fall + Math.sin(yaw) * swing * 0.1,
      Math.max(0.012, leaf.height * (1 - fall)) + swing * swing * 0.03,
      leaf.z + leaf.driftZ * fall + Math.cos(yaw) * swing * 0.1,
    );
    if (!frustum.containsPoint(this.position)) return false;
    this.rotation.set(-swing * 0.65, yaw, Math.sin(seconds * 3.3 + leaf.phase * 11) * 0.25 * air, 'YXZ');
    this.quaternion.setFromEuler(this.rotation);
    const grow = Math.min(1, progress / 0.05);
    const shrink = progress > LAND_AT ? 1 - (progress - LAND_AT) / (1 - LAND_AT) : 1;
    this.scale.setScalar(leaf.size * Math.min(grow, shrink));
    this.matrix.compose(this.position, this.quaternion, this.scale);
    return true;
  }

  // Obdélník dlaždic [x0, y0, x1, y1], který kamera vidí mezi zemí a nejvyšším listem
  private visibleTiles(camera: THREE.Camera): [number, number, number, number] {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const nx of [-1, 1]) {
      for (const ny of [-1, 1]) {
        this.near.set(nx, ny, -1).unproject(camera);
        this.far.set(nx, ny, 1).unproject(camera);
        for (const height of [0, LEAF_TOP]) {
          const t = (height - this.near.y) / (this.far.y - this.near.y);
          const x = this.near.x + (this.far.x - this.near.x) * t;
          const z = this.near.z + (this.far.z - this.near.z) * t;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    // List se od své dlaždice vzdálí nejvýš o necelou dlaždici
    return [
      Math.max(0, Math.floor(minX) - 1),
      Math.max(0, Math.floor(minZ) - 1),
      Math.min(this.map.width - 1, Math.floor(maxX) + 1),
      Math.min(this.map.height - 1, Math.floor(maxZ) + 1),
    ];
  }
}
