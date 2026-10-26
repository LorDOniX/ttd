import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createLodGeometry } from './buildingLod';

const triangles = (geometry: THREE.BufferGeometry): number => geometry.index!.count / 3;

describe('zjednodušená budova', () => {
  it('z kvádru udělá střechu a čtyři stěny ve výšce a barvě modelu', () => {
    const box = new THREE.BoxGeometry(0.8, 1, 0.6).translate(0, 0.5, 0);
    const uv = box.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.3, 0.6);

    const lod = createLodGeometry([{ geometry: box, matrix: new THREE.Matrix4() }])!;

    expect(triangles(lod)).toBe(10);
    lod.computeBoundingBox();
    expect(lod.boundingBox!.min.y).toBeCloseTo(0);
    expect(lod.boundingBox!.max.y).toBeCloseTo(1);
    expect(lod.boundingBox!.max.x - lod.boundingBox!.min.x).toBeCloseTo(0.8);
    expect(lod.boundingBox!.max.z - lod.boundingBox!.min.z).toBeCloseTo(0.6);
    expect(lod.getAttribute('uv').getX(0)).toBeCloseTo(0.3);
    expect(lod.getAttribute('uv').getY(0)).toBeCloseTo(0.6);
  });

  it('plochy míří ven podle normál', () => {
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const lod = createLodGeometry([{ geometry: box, matrix: new THREE.Matrix4() }])!;
    const position = lod.getAttribute('position');
    const normal = lod.getAttribute('normal');
    const index = lod.index!;
    const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      n.fromBufferAttribute(normal, index.getX(i));
      expect(b.sub(a).cross(c.sub(a)).dot(n)).toBeGreaterThan(0);
    }
  });

  it('vyšší věž na nižší budově přidá stěny jen nad sousední střechou', () => {
    const base = new THREE.BoxGeometry(1, 0.2, 1).translate(0, 0.1, 0);
    const tower = new THREE.BoxGeometry(0.4, 1, 0.4).translate(0, 0.5, 0);
    const lod = createLodGeometry([
      { geometry: base, matrix: new THREE.Matrix4() },
      { geometry: tower, matrix: new THREE.Matrix4() },
    ])!;
    lod.computeBoundingBox();
    expect(lod.boundingBox!.max.y).toBeCloseTo(1);
    const position = lod.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const inTower = Math.abs(position.getX(i)) < 0.21 && Math.abs(position.getZ(i)) < 0.21;
      if (!inTower) expect(position.getY(i)).toBeLessThanOrEqual(0.2 + 1e-6);
    }
  });
});
