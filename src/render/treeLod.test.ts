import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createLatheGeometry } from './treeLod';

// Každý trojúhelník míří od svislé osy ven nebo nahoru
function facesOutward(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position');
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const center = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).setY(0);
    if (normal.y < -1e-9 || (normal.y < 1e-9 && normal.dot(center) <= 0)) return false;
  }
  return true;
}

describe('zjednodušený strom', () => {
  it('kužel se sbíhá do špičky a má méně trojúhelníků', () => {
    const cone = new THREE.ConeGeometry(0.5, 1, 32, 4).translate(0, 0.5, 0);
    const lod = createLatheGeometry(cone, new THREE.Matrix4(), 6, 4)!;

    expect(lod.getAttribute('position').count / 3).toBe(6 * 2 * 2 + 6);
    lod.computeBoundingBox();
    expect(lod.boundingBox!.max.y).toBeCloseTo(1);
    expect(lod.boundingBox!.max.x).toBeCloseTo(0.48, 1);
    expect(facesOutward(lod)).toBe(true);
  });

  it('válec dostane plochý vršek a průřez podle modelu', () => {
    const cylinder = new THREE.CylinderGeometry(0.1, 0.1, 2, 16).translate(0.3, 1, 0);
    const lod = createLatheGeometry(cylinder, new THREE.Matrix4(), 4, 2)!;

    expect(lod.getAttribute('position').count / 3).toBe(4 * 2 + 2);
    lod.computeBoundingBox();
    expect(lod.boundingBox!.min.y).toBeCloseTo(0);
    expect(lod.boundingBox!.max.y).toBeCloseTo(2);
    expect(lod.boundingBox!.max.x).toBeCloseTo(0.4, 2);
    expect(facesOutward(lod.clone().translate(-0.3, 0, 0))).toBe(true);
  });
});
