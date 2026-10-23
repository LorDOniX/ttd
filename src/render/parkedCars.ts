import * as THREE from 'three';
import { loadScene } from '../assets';
import type { ParkedCarPlacement } from './ambientProps';

const SCALE = 0.13;

interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

const prototypes = new Map<string, Promise<ModelPart[]>>();

function loadPrototype(model: string): Promise<ModelPart[]> {
  let pending = prototypes.get(model);
  if (!pending) {
    pending = loadScene('car kit', model).then((scene) => {
      scene.updateMatrixWorld(true);
      const parts: ModelPart[] = [];
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        parts.push({
          geometry: child.geometry,
          material: child.material,
          matrix: child.matrixWorld.clone(),
        });
      });
      return parts;
    });
    prototypes.set(model, pending);
  }
  return pending;
}

export class ParkedCarsView {
  readonly object = new THREE.Group();
  private placementKey = '';
  private generation = 0;

  sync(placements: readonly ParkedCarPlacement[]): void {
    const key = placements.map(({ model, x, z, yaw }) => `${model}:${x},${z},${yaw}`).join('|');
    if (key === this.placementKey) return;
    this.placementKey = key;
    const generation = ++this.generation;
    void this.rebuild(placements, generation).catch((error: unknown) => {
      console.error('Nepodařilo se načíst modely zaparkovaných aut.', error);
    });
  }

  private async rebuild(placements: readonly ParkedCarPlacement[], generation: number): Promise<void> {
    const models = [...new Set(placements.map(({ model }) => model))];
    const prototypes = new Map(
      await Promise.all(models.map(async (model) => [model, await loadPrototype(model)] as const)),
    );
    if (generation !== this.generation) return;

    const batches = new Map<
      string,
      { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrices: THREE.Matrix4[] }
    >();
    for (const placement of placements) {
      const car = new THREE.Matrix4().compose(
        new THREE.Vector3(placement.x, 0.01, placement.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw),
        new THREE.Vector3(SCALE, SCALE, SCALE),
      );
      for (const [index, part] of (prototypes.get(placement.model) ?? []).entries()) {
        const key = `${placement.model}:${index}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { geometry: part.geometry, material: part.material, matrices: [] };
          batches.set(key, batch);
        }
        batch.matrices.push(car.clone().multiply(part.matrix));
      }
    }

    for (const child of this.object.children as THREE.InstancedMesh[]) child.dispose();
    this.object.clear();
    for (const batch of batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.computeBoundingSphere();
      this.object.add(mesh);
    }
  }
}
