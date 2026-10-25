import * as THREE from 'three';
import type { Season } from '../game/seasons';
import { TileType, type GameMap } from '../world/map';

export const FOREST_MIST_MIN_ZOOM = 0.65;
export const MAX_FOREST_MIST = 2400;
const MIST_CHANCE = 0.42;
const MIST_TOP = 0.42;
const MIST_Y = 0.025;
const TEMP_MATRIX = new THREE.Matrix4();
const VIEW_SPHERE = new THREE.Sphere(new THREE.Vector3(), 0.9);
const LAYERS = [
  { y: 0.015, width: 1, depth: 1, opacity: 0.62, drift: 0.08 },
  { y: 0.105, width: 1.38, depth: 1.25, opacity: 0.42, drift: 0.15 },
  { y: 0.22, width: 1.75, depth: 1.45, opacity: 0.28, drift: 0.23 },
] as const;

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function hasForestMist(map: GameMap, x: number, y: number): boolean {
  return map.inBounds(x, y) && map.tiles[y * map.width + x] === TileType.Trees && tileHash(x, y, 700) < MIST_CHANCE;
}

function createMistTexture(): THREE.DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5 - size / 2) / (size / 2);
      const py = (y + 0.5 - size / 2) / (size / 2);
      const radius = Math.hypot(px * 0.92, py * 1.15);
      const edge = Math.max(0, 1 - radius);
      const wisps =
        0.72 +
        0.2 * Math.sin(px * 5 + Math.sin(py * 4) * 2) +
        0.14 * Math.sin(py * 9 + px * 3) +
        0.1 * Math.sin(px * 15 - py * 8);
      const lobes = 0.72 + 0.28 * Math.sin(px * 3 + Math.sin(py * 3) * 2);
      const alpha = Math.round(255 * Math.pow(edge, 0.9) * Math.max(0.16, wisps) * lobes);
      pixels.set([224, 231, 228, alpha], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const MIST_GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const MIST_MATERIAL = new THREE.MeshBasicMaterial({
  map: createMistTexture(),
  transparent: true,
  opacity: 1,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});

function mistMaterial(opacity: number): THREE.MeshBasicMaterial {
  const material = MIST_MATERIAL.clone();
  material.opacity = opacity;
  return material;
}

// Tenký opar nízko nad lesní půdou, instance vznikají pouze pro lesní dlaždice ve výřezu kamery
export class ForestMistView {
  readonly object = new THREE.Group();
  private readonly meshes = LAYERS.map(
    ({ opacity }) => new THREE.InstancedMesh(MIST_GEOMETRY, mistMaterial(opacity), MAX_FOREST_MIST),
  );
  private readonly near = new THREE.Vector3();
  private readonly far = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private season: Season = 'summer';
  private enabled = false;

  constructor(private readonly map: GameMap) {
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
    }
    this.object.add(...this.meshes);
    this.object.visible = false;
  }

  setSeason(season: Season): void {
    this.season = season;
    this.object.visible = this.enabled && season === 'autumn';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.object.visible = enabled && this.season === 'autumn';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  update(seconds: number, camera: THREE.Camera & { zoom: number }, frustum: THREE.Frustum): void {
    if (!this.enabled || this.season !== 'autumn' || camera.zoom < FOREST_MIST_MIN_ZOOM) {
      this.object.visible = false;
      for (const mesh of this.meshes) mesh.count = 0;
      return;
    }
    this.object.visible = true;
    const [x0, y0, x1, y1] = this.visibleTiles(camera);
    const counts = LAYERS.map(() => 0);
    tiles: for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!hasForestMist(this.map, x, y)) continue;
        const phase = tileHash(x, y, 701) * Math.PI * 2;
        const drift = seconds * 0.12 + phase;
        const baseWidth = 1.1 + tileHash(x, y, 703) * 1.2;
        const baseDepth = 0.48 + tileHash(x, y, 704) * 0.62;
        for (let layer = 0; layer < LAYERS.length; layer++) {
          if (counts[layer] >= MAX_FOREST_MIST) break tiles;
          const puff = LAYERS[layer];
          const layerDrift = drift + layer * 1.7;
          this.position.set(
            x + 0.5 + Math.sin(layerDrift * 0.7) * puff.drift,
            MIST_Y + tileHash(x, y, 702) * 0.035 + puff.y + Math.sin(layerDrift) * 0.018,
            y + 0.5 + Math.cos(layerDrift * 0.6) * puff.drift,
          );
          VIEW_SPHERE.center.copy(this.position);
          VIEW_SPHERE.radius = baseWidth * puff.width * 0.7;
          if (!frustum.intersectsSphere(VIEW_SPHERE)) continue;
          const rotation = tileHash(x, y, 705) * Math.PI + seconds * 0.035 + layer * 0.5;
          this.quaternion.setFromAxisAngle(this.up, rotation);
          this.scale.set(baseWidth * puff.width, 1, baseDepth * puff.depth);
          TEMP_MATRIX.compose(this.position, this.quaternion, this.scale);
          this.meshes[layer].setMatrixAt(counts[layer]++, TEMP_MATRIX);
        }
      }
    }
    for (let layer = 0; layer < this.meshes.length; layer++) {
      const mesh = this.meshes[layer];
      const count = counts[layer];
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private visibleTiles(camera: THREE.Camera): [number, number, number, number] {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const nx of [-1, 1]) {
      for (const ny of [-1, 1]) {
        this.near.set(nx, ny, -1).unproject(camera);
        this.far.set(nx, ny, 1).unproject(camera);
        for (const height of [0, MIST_TOP]) {
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
    return [
      Math.max(0, Math.floor(minX) - 1),
      Math.max(0, Math.floor(minZ) - 1),
      Math.min(this.map.width - 1, Math.floor(maxX) + 1),
      Math.min(this.map.height - 1, Math.floor(maxZ) + 1),
    ];
  }
}
