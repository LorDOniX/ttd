import * as THREE from 'three';
import { loadScene, type Kit } from '../assets';
import type { Town } from '../world/town';

// Největší půdorysný rozměr budovy vůči dlaždici
const FOOTPRINT = 0.86;

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

const prototypes = new Map<string, Promise<Part[]>>();

// Rozloží model na části a normalizuje ho na střed dlaždice se dnem v y = 0
export function loadPrototype(kit: Kit, model: string): Promise<Part[]> {
  const key = `${kit}/${model}`;
  let pending = prototypes.get(key);
  if (!pending) {
    pending = loadScene(kit, model).then((scene) => {
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = FOOTPRINT / Math.max(size.x, size.z);
      const normalize = new THREE.Matrix4()
        .makeScale(scale, scale, scale)
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

      const parts: Part[] = [];
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        parts.push({
          geometry: child.geometry,
          material: child.material,
          matrix: normalize.clone().multiply(child.matrixWorld),
        });
      });
      return parts;
    });
    prototypes.set(key, pending);
  }
  return pending;
}

// Domky jsou ze suburban kitu, ostatní budovy z commercial kitu
function kitFor(model: string): Kit {
  return model.startsWith('building-type-') ? 'city kit suburban' : 'city kit commercial';
}

// Budovy všech měst jako instancované meshe, jeden na každou část modelu
export class BuildingsView {
  readonly object = new THREE.Group();
  private generation = 0;

  async rebuild(towns: readonly Town[]): Promise<void> {
    const generation = ++this.generation;
    const groups = new Map<string, { kit: Kit; model: string; matrices: THREE.Matrix4[] }>();

    for (const town of towns) {
      for (const b of town.buildings) {
        const kit = kitFor(b.model);
        const key = `${kit}/${b.model}`;
        let group = groups.get(key);
        if (!group) {
          group = { kit, model: b.model, matrices: [] };
          groups.set(key, group);
        }
        group.matrices.push(
          new THREE.Matrix4()
            .makeTranslation(b.x + 0.5, 0, b.y + 0.5)
            .multiply(new THREE.Matrix4().makeRotationY(b.rotation)),
        );
      }
    }

    const meshes: THREE.InstancedMesh[] = [];
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const parts = await loadPrototype(group.kit, group.model);
        for (const part of parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, group.matrices.length);
          const m = new THREE.Matrix4();
          group.matrices.forEach((placement, i) => {
            mesh.setMatrixAt(i, m.multiplyMatrices(placement, part.matrix));
          });
          mesh.computeBoundingSphere();
          meshes.push(mesh);
        }
      }),
    );

    // Mezitím mohl začít novější rebuild
    if (generation !== this.generation) return;
    for (const old of this.object.children as THREE.InstancedMesh[]) old.dispose();
    this.object.clear();
    if (meshes.length > 0) this.object.add(...meshes);
  }
}
