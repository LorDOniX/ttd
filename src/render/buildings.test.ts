import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSnowRoofGeometry } from './buildings';

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

  it('nevytvoří sníh, pokud model nemá vodorovné horní plochy', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0], 3));

    expect(createSnowRoofGeometry(geometry, new THREE.Matrix4())).toBeNull();
    geometry.dispose();
  });
});
