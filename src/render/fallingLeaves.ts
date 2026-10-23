import * as THREE from 'three';
import type { Season } from '../game/seasons';
import { MapChanges, TileType, type GameMap } from '../world/map';

const MAX_LEAVES = 600;
const LEAF_CHANCE = 0.08;
const LEAF_COLORS = [0xef7b2d, 0xf0b83a, 0xd84c32, 0xc88728];
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export interface FallingLeaf {
  tile: number;
  x: number;
  z: number;
  height: number;
  phase: number;
  speed: number;
  driftX: number;
  driftZ: number;
  rotation: number;
  size: number;
  active: boolean;
  inViewport: boolean;
}

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function fallingLeafPlacements(map: GameMap): FallingLeaf[] {
  const candidates: number[] = [];
  for (let tile = 0; tile < map.tiles.length; tile++) {
    if (map.tiles[tile] !== TileType.Trees) continue;
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    if (tileHash(x, y, 300) < LEAF_CHANCE) candidates.push(tile);
  }

  const count = Math.min(MAX_LEAVES, candidates.length);
  const leaves: FallingLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const candidateIndex = Math.floor(((i + 0.5) * candidates.length) / count);
    const tile = candidates[candidateIndex];
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    leaves.push({
      tile,
      x: x + 0.25 + tileHash(x, y, 301) * 0.5,
      z: y + 0.25 + tileHash(x, y, 302) * 0.5,
      height: 0.85 + tileHash(x, y, 303) * 0.75,
      phase: tileHash(x, y, 304),
      speed: 0.12 + tileHash(x, y, 305) * 0.06,
      driftX: tileHash(x, y, 306) * 0.5 - 0.25,
      driftZ: tileHash(x, y, 307) * 0.5 - 0.25,
      rotation: tileHash(x, y, 308) * Math.PI * 2,
      size: 0.22 + tileHash(x, y, 309) * 0.1,
      active: true,
      inViewport: false,
    });
  }
  return leaves;
}

function createLeafGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0.5, 0, -0.28, 0.06, 0, 0, -0.5, 0, 0.28, 0.06, 0], 3),
  );
  geometry.setIndex([0, 1, 3, 1, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

const LEAF_GEOMETRY = createLeafGeometry();
const LEAF_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });

export class FallingLeavesView {
  readonly object = new THREE.Group();
  private readonly changes: MapChanges;
  private leaves: FallingLeaf[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private season: Season = 'summer';
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();

  constructor(private readonly map: GameMap) {
    this.changes = new MapChanges(map);
    this.refresh();
  }

  setSeason(season: Season): void {
    this.season = season;
    if (this.mesh) this.mesh.visible = season === 'autumn';
  }

  sync(): void {
    const changes = this.changes.take();
    if (changes === null) {
      this.refresh();
      return;
    }
    if (!this.mesh) return;

    let changed = false;
    for (const tile of changes) {
      if (this.map.tiles[tile] === TileType.Trees) continue;
      for (let index = 0; index < this.leaves.length; index++) {
        const leaf = this.leaves[index];
        if (leaf.tile !== tile || !leaf.active) continue;
        leaf.active = false;
        leaf.inViewport = false;
        this.mesh.setMatrixAt(index, HIDDEN);
        this.mesh.instanceMatrix.addUpdateRange(index * 16, 16);
        changed = true;
      }
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(seconds: number, frustum: THREE.Frustum): void {
    if (this.season !== 'autumn' || !this.mesh) return;
    let changed = false;
    for (let index = 0; index < this.leaves.length; index++) {
      const leaf = this.leaves[index];
      if (!leaf.active) continue;
      const progress = (seconds * leaf.speed + leaf.phase) % 1;
      const sway = Math.sin(seconds * 2.1 + leaf.phase * Math.PI * 2);
      this.position.set(
        leaf.x + leaf.driftX * progress + sway * 0.08,
        Math.max(0.025, leaf.height * (1 - progress)),
        leaf.z + leaf.driftZ * progress + Math.cos(seconds * 1.8 + leaf.phase * 8) * 0.08,
      );
      if (!frustum.containsPoint(this.position)) {
        if (leaf.inViewport) {
          leaf.inViewport = false;
          this.mesh.setMatrixAt(index, HIDDEN);
          changed = true;
        }
        continue;
      }
      this.rotation.set(
        Math.sin(seconds * 2.7 + leaf.phase * 6) * 0.65,
        leaf.rotation + seconds * (1.5 + leaf.speed * 8),
        progress * Math.PI * 2,
        'YXZ',
      );
      this.quaternion.setFromEuler(this.rotation);
      this.scale.setScalar(leaf.size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
      leaf.inViewport = true;
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private refresh(): void {
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
    }
    this.leaves = fallingLeafPlacements(this.map);
    if (this.leaves.length === 0) {
      this.mesh = null;
      return;
    }

    this.mesh = new THREE.InstancedMesh(LEAF_GEOMETRY, LEAF_MATERIAL, this.leaves.length);
    this.mesh.frustumCulled = false;
    this.leaves.forEach((leaf, index) => {
      this.mesh!.setColorAt(
        index,
        new THREE.Color(
          LEAF_COLORS[
            Math.floor(
              tileHash(leaf.tile % this.map.width, Math.floor(leaf.tile / this.map.width), 310) * LEAF_COLORS.length,
            )
          ],
        ),
      );
      this.mesh!.setMatrixAt(index, HIDDEN);
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = this.season === 'autumn';
    this.object.add(this.mesh);
  }
}
