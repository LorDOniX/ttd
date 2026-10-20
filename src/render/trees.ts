import * as THREE from 'three';
import { TileType, type GameMap } from '../world/map';
import { loadPrototype } from './buildings';

const MODELS = ['tree-large', 'tree-small'];

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Stromy jako instancované modely ze suburban kitu; rozmístění je dané dlaždicí, takže je stabilní
export class TreesView {
  readonly object = new THREE.Group();
  private treeTiles = -1;
  private generation = 0;

  constructor(private readonly map: GameMap) {}

  // Stromy jen ubývají, takže stačí přestavět při změně jejich počtu
  async refresh(): Promise<void> {
    const { map } = this;
    const tiles: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TileType.Trees) tiles.push(i);
    if (tiles.length === this.treeTiles) return;
    this.treeTiles = tiles.length;
    const generation = ++this.generation;

    const matrices: THREE.Matrix4[][] = MODELS.map(() => []);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const i of tiles) {
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      const count = 1 + Math.floor(tileHash(x, y, 1) * 3);
      for (let k = 0; k < count; k++) {
        const model = tileHash(x, y, 10 + k) < 0.5 ? 0 : 1;
        const scale = 0.35 + tileHash(x, y, 20 + k) * 0.25;
        const px = x + 0.2 + tileHash(x, y, 30 + k) * 0.6;
        const pz = y + 0.2 + tileHash(x, y, 40 + k) * 0.6;
        q.setFromAxisAngle(up, tileHash(x, y, 50 + k) * Math.PI * 2);
        matrices[model].push(
          new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(scale, scale, scale)),
        );
      }
    }

    const meshes: THREE.InstancedMesh[] = [];
    const prototypes = await Promise.all(MODELS.map((m) => loadPrototype('city kit suburban', m)));
    if (generation !== this.generation) return;
    prototypes.forEach((parts, model) => {
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, matrices[model].length));
        const m = new THREE.Matrix4();
        matrices[model].forEach((placement, i) => mesh.setMatrixAt(i, m.multiplyMatrices(placement, part.matrix)));
        mesh.count = matrices[model].length;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
      }
    });

    for (const old of this.object.children as THREE.InstancedMesh[]) old.dispose();
    this.object.clear();
    this.object.add(...meshes);
  }
}
