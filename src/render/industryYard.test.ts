import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type IndustryKind } from '../world/industry';
import { FLOODLIGHT_POOLS, industryFence, industryFloodlights, industryGround, setFloodlightsOn } from './industryYard';

const KINDS = Object.keys(INDUSTRY_TYPES) as IndustryKind[];

describe('povrch a oplocení areálu', () => {
  it('každý druh závodu má vlastní povrch přes celý areál', () => {
    const textures = KINDS.map((kind) => {
      const ground = industryGround(kind);
      const box = new THREE.Box3().setFromObject(ground);
      expect(box.max.x - box.min.x).toBeCloseTo(INDUSTRY_SIZE);
      expect(box.max.z - box.min.z).toBeCloseTo(INDUSTRY_SIZE);
      return (ground.material as THREE.MeshLambertMaterial).map;
    });
    expect(new Set(textures).size).toBe(KINDS.length);
  });

  it('plot vede po obvodu uvnitř areálu a vpředu nechává vjezd', () => {
    const half = INDUSTRY_SIZE / 2;
    const gate = new THREE.Raycaster(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0, 1));
    for (const kind of KINDS) {
      const fence = industryFence(kind);
      fence.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(fence);
      expect(box.max.x).toBeLessThanOrEqual(half);
      expect(box.min.z).toBeGreaterThanOrEqual(-half);
      expect(box.max.x).toBeGreaterThan(half - 0.1);
      expect(box.min.z).toBeLessThan(-half + 0.1);
      expect(gate.intersectObject(fence, true)).toHaveLength(0);
    }
  });

  it('reflektory stojí ve čtyřech rozích, svítí dovnitř areálu a rozsvítí se v noci', () => {
    const half = INDUSTRY_SIZE / 2;
    const lights = industryFloodlights();
    const box = new THREE.Box3().setFromObject(lights);
    expect(box.max.x).toBeLessThan(half);
    expect(box.max.x).toBeGreaterThan(half - 0.3);
    expect(box.min.z).toBeGreaterThan(-half);

    expect(FLOODLIGHT_POOLS).toHaveLength(4);
    const corners = new Set(FLOODLIGHT_POOLS.map((p) => `${Math.sign(p.x)},${Math.sign(p.z)}`));
    expect(corners.size).toBe(4);
    expect(FLOODLIGHT_POOLS.every((p) => Math.abs(p.x) < half - 0.3 && Math.abs(p.z) < half - 0.3)).toBe(true);

    const head = (lights.children[1] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    setFloodlightsOn(true);
    expect(head.emissiveIntensity).toBeGreaterThan(0);
    setFloodlightsOn(false);
    expect(head.emissiveIntensity).toBe(0);
  });
});
