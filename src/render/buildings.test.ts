import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GeometryBatch, createSnowRoofGeometry } from './buildings';

describe('sníh na střechách', () => {
  it('pokrývá horní plochy a vynechá svislé stěny', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0], 3),
    );

    const snow = createSnowRoofGeometry(geometry, new THREE.Matrix4());

    expect(snow?.getAttribute('position').count).toBe(3);
    expect(snow?.getAttribute('normal').getY(0)).toBeCloseTo(1);
    snow?.dispose();
    geometry.dispose();
  });

  it('pokryje i nízké střechy přízemních přístavků, ale ne plochy na zemi', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0.18, 0, 0, 0.18, 1, 1, 0.18, 1, 0, 0.02, 0, 0, 0.02, 1, 1, 0.02, 1],
        3,
      ),
    );

    const snow = createSnowRoofGeometry(geometry, new THREE.Matrix4());

    expect(snow?.getAttribute('position').count).toBe(3);
    expect(snow?.getAttribute('position').getY(0)).toBeCloseTo(0.182);
    snow?.dispose();
    geometry.dispose();
  });

  it('nevytvoří sníh, pokud model nemá vodorovné horní plochy', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0], 3));

    expect(createSnowRoofGeometry(geometry, new THREE.Matrix4())).toBeNull();
    geometry.dispose();
  });
});

describe('dávka budov', () => {
  const box = (size: number): THREE.BufferGeometry => new THREE.BoxGeometry(size, size, size);
  const at = (x: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, 0, 0);
  const placed = (batch: GeometryBatch, id: number): number =>
    new THREE.Vector3().setFromMatrixPosition(batch.mesh.getMatrixAt(id, new THREE.Matrix4())).x;

  it('při přestavbě přepíše instance, doplní geometrie a zvětší kapacitu', () => {
    const small = box(1);
    const large = box(2);
    const batch = new GeometryBatch(new THREE.MeshBasicMaterial(), [{ geometry: small, matrix: at(1) }]);
    expect(batch.mesh.instanceCount).toBe(1);

    const items = Array.from({ length: 10 }, (_, i) => ({ geometry: i % 2 ? large : small, matrix: at(i) }));
    batch.set(items);
    expect(batch.mesh.instanceCount).toBe(10);
    expect(batch.mesh.maxInstanceCount).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < 10; i++) expect(placed(batch, i)).toBe(i);
    expect(batch.mesh.getGeometryIdAt(1)).not.toBe(batch.mesh.getGeometryIdAt(0));

    batch.set([{ geometry: large, matrix: at(7) }]);
    expect(batch.mesh.instanceCount).toBe(1);
    expect(placed(batch, 0)).toBe(7);
    batch.mesh.dispose();
  });
});
