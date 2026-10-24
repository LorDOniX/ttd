import * as THREE from 'three';
import { MapChanges, TileType, type GameMap } from '../world/map';
import type { Season } from '../game/seasons';
import { loadPrototype } from './buildings';

// Listnaté a jehličnaté stromy z nature kitu; varianty _dark mají tmavší listí
export const TREE_MODELS = [
  'tree_default',
  'tree_default_dark',
  'tree_oak',
  'tree_oak_dark',
  'tree_detailed',
  'tree_fat',
  'tree_simple',
  'tree_tall_dark',
  'tree_cone',
  'tree_cone_dark',
  'tree_pineDefaultA',
  'tree_pineDefaultB',
  'tree_pineRoundA',
  'tree_pineRoundC',
  'tree_pineSmallA',
];
// Nejvyšší strom v plném měřítku (jako dřívější velký strom ze suburban kitu); štíhlé jehličnany
// by po normalizaci na šířku dlaždice byly příliš vysoké
const TREE_HEIGHT = 2.7;
// Kit má tyrkysové listí a kovový materiál, stromy se přebarví do zelené jako zbytek krajiny
const TREE_COLORS: Record<string, number> = {
  leafsGreen: 0x3f9d4f,
  leafsDark: 0x2b7f4c,
  woodBark: 0x8a5636,
  woodBarkDark: 0x6e4630,
};
const SEASON_TREE_COLORS: Record<Season, Record<string, number>> = {
  spring: { ...TREE_COLORS, leafsGreen: 0x67ad50, leafsDark: 0x438744 },
  summer: TREE_COLORS,
  autumn: { ...TREE_COLORS, leafsGreen: 0xc18737, leafsDark: 0x985a2d },
  winter: { ...TREE_COLORS, leafsGreen: 0xe5ece5, leafsDark: 0xcbd6ce },
};

const treeTime = { value: 0 };
type Parts = Awaited<ReturnType<typeof loadPrototype>>;
const treeMaterials = new Map<string, THREE.Material>();
let activeSeason: Season = 'summer';

function applyTreeSeason(season: Season): void {
  activeSeason = season;
  for (const [name, material] of treeMaterials) {
    const color = SEASON_TREE_COLORS[season][name];
    if (color !== undefined) (material as THREE.MeshLambertMaterial).color.setHex(color);
  }
}

function treeMaterial(material: THREE.Material): THREE.Material {
  let result = treeMaterials.get(material.name);
  if (!result) {
    const color =
      SEASON_TREE_COLORS[activeSeason][material.name] ??
      (material as THREE.MeshStandardMaterial).color?.getHex() ??
      0xffffff;
    result = new THREE.MeshLambertMaterial({ color });
    result.onBeforeCompile = (shader) => {
      shader.uniforms.treeTime = treeTime;
      shader.vertexShader =
        'uniform float treeTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
             float wind = sin(treeTime * 0.8 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5);
             transformed.x += wind * max(position.y, 0.0) * 0.014;
             transformed.z += wind * max(position.y, 0.0) * 0.006;
           #endif`,
        );
    };
    result.customProgramCacheKey = () => 'tree-wind';
    treeMaterials.set(material.name, result);
  }
  return result;
}

// Strom z nature kitu: přebarvený, na šířku dlaždice a nejvýš TREE_HEIGHT vysoký
async function loadTree(model: string): Promise<Parts> {
  const parts = await loadPrototype('nature kit', model);
  const box = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrix));
  }
  const s = Math.min(1, TREE_HEIGHT / box.max.y);
  const scale = new THREE.Matrix4().makeScale(s, s, s);
  // Zbytky exportu s výchozím bílým materiálem se vynechají
  return parts
    .filter((part) => !Array.isArray(part.material) && part.material.name !== '_defaultMat')
    .map((part) => ({
      ...part,
      material: treeMaterial(part.material as THREE.Material),
      matrix: scale.clone().multiply(part.matrix),
    }));
}

// Vykácený strom: nulové měřítko instanci schová
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// Samostatný strom stejný jako v lesích (sezónní barvy i vítr), např. pro průmyslové areály
export async function treeObject(
  model: string,
  scale: number,
  x: number,
  z: number,
  rotation = 0,
): Promise<THREE.Object3D> {
  const parts = await loadTree(model);
  const placement = new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromAxisAngle(UP, rotation),
    new THREE.Vector3(scale, scale, scale),
  );
  const group = new THREE.Group();
  for (const part of parts) {
    // Instancovaný mesh, protože vítr ve stromovém shaderu působí jen na instance
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1);
    mesh.setMatrixAt(0, placement.clone().multiply(part.matrix));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Stromy jako instancované modely z nature kitu; rozmístění je dané dlaždicí, takže je stabilní
export class TreesView {
  readonly object = new THREE.Group();
  private generation = 0;
  private built = false;
  // Instance po modelech a pro každou dlaždici její instance (model, index), aby šly skrýt jednotlivě
  private meshesByModel: THREE.InstancedMesh[][] = [];
  private instancesByTile = new Map<number, [number, number][]>();
  private readonly changes: MapChanges;

  constructor(private readonly map: GameMap) {
    this.changes = new MapChanges(map);
  }

  update(seconds: number): void {
    treeTime.value = seconds;
  }

  setSeason(season: Season): void {
    applyTreeSeason(season);
  }

  // Stromy jen ubývají: vykácené dlaždice se skryjí bez přestavby celé vrstvy
  sync(): void {
    if (!this.built) return;
    const changes = this.changes.take();
    if (changes === null) {
      void this.refresh();
      return;
    }
    const touched = new Set<THREE.InstancedMesh>();
    for (const i of changes) {
      const instances = this.instancesByTile.get(i);
      if (!instances || this.map.tiles[i] === TileType.Trees) continue;
      this.instancesByTile.delete(i);
      for (const [model, index] of instances) {
        for (const mesh of this.meshesByModel[model]) {
          mesh.setMatrixAt(index, HIDDEN);
          mesh.instanceMatrix.addUpdateRange(index * 16, 16);
          touched.add(mesh);
        }
      }
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  async refresh(): Promise<void> {
    const { map } = this;
    const generation = ++this.generation;
    const matrices: THREE.Matrix4[][] = TREE_MODELS.map(() => []);
    const instancesByTile = new Map<number, [number, number][]>();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] !== TileType.Trees) continue;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      const count = 1 + Math.floor(tileHash(x, y, 1) * 3);
      const instances: [number, number][] = [];
      for (let k = 0; k < count; k++) {
        const model = Math.min(TREE_MODELS.length - 1, Math.floor(tileHash(x, y, 10 + k) * TREE_MODELS.length));
        const scale = 0.35 + tileHash(x, y, 20 + k) * 0.25;
        const px = x + 0.2 + tileHash(x, y, 30 + k) * 0.6;
        const pz = y + 0.2 + tileHash(x, y, 40 + k) * 0.6;
        q.setFromAxisAngle(up, tileHash(x, y, 50 + k) * Math.PI * 2);
        instances.push([model, matrices[model].length]);
        matrices[model].push(
          new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(scale, scale, scale)),
        );
      }
      instancesByTile.set(i, instances);
    }

    const prototypes = await Promise.all(TREE_MODELS.map(loadTree));
    if (generation !== this.generation) return;
    const meshesByModel = prototypes.map((parts, model) =>
      parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, matrices[model].length));
        const m = new THREE.Matrix4();
        matrices[model].forEach((placement, i) => mesh.setMatrixAt(i, m.multiplyMatrices(placement, part.matrix)));
        mesh.count = matrices[model].length;
        mesh.computeBoundingSphere();
        return mesh;
      }),
    );

    for (const old of this.object.children as THREE.InstancedMesh[]) old.dispose();
    this.object.clear();
    this.object.add(...meshesByModel.flat());
    this.meshesByModel = meshesByModel;
    this.instancesByTile = instancesByTile;
    this.built = true;
  }
}
