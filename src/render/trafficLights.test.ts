import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TrafficLights } from '../game/trafficLights';
import { GameMap } from '../world/map';
import { RailNetwork } from '../world/rail';
import { TrafficLightsView } from './trafficLights';

const junction = { x: 3, y: 3, townId: 0, phaseOffset: 0 };

describe('traffic light rendering', () => {
  it('places light faces on all four sides at every corner', () => {
    const view = new TrafficLightsView();
    view.sync([junction]);
    view.object.updateMatrixWorld(true);

    expect(view.object.children).toHaveLength(4);
    for (const signal of view.object.children) {
      const faces = signal.children.filter((child) => child instanceof THREE.Group);
      expect(faces).toHaveLength(4);
      for (const [index, face] of faces.entries()) {
        expect(face.children).toHaveLength(2);
        const lightPosition = face.children[0].getWorldPosition(new THREE.Vector3());
        const offset = lightPosition.sub(signal.position);
        const angle = (index * Math.PI) / 2;
        expect(offset.x).toBeCloseTo(Math.sin(angle) * 0.06);
        expect(offset.z).toBeCloseTo(Math.cos(angle) * 0.06);
      }
    }
  });

  it('uses a darker housing above the light-gray pole', () => {
    const view = new TrafficLightsView();
    view.sync([junction]);
    for (const signal of view.object.children) {
      const [pole, housing] = signal.children;
      expect(pole).toBeInstanceOf(THREE.Mesh);
      expect(housing).toBeInstanceOf(THREE.Mesh);
      if (!(pole instanceof THREE.Mesh) || !(housing instanceof THREE.Mesh)) throw new Error('Missing signal mesh');
      const poleMaterial = pole.material as THREE.MeshLambertMaterial;
      const housingMaterial = housing.material as THREE.MeshLambertMaterial;
      expect(poleMaterial.color.getHex()).toBe(0xc4c8cc);
      expect(housingMaterial.color.getHex()).toBe(0x41474d);
      const poleBounds = new THREE.Box3().setFromObject(pole);
      const housingBounds = new THREE.Box3().setFromObject(housing);
      expect(poleBounds.min.y).toBeCloseTo(0);
      expect(poleBounds.max.y).toBeGreaterThan(housingBounds.min.y);
      expect(housingBounds.max.y - poleBounds.max.y).toBeGreaterThan(0.019);
    }
  });

  it('updates all four faces for each green axis and the all-red interval', () => {
    const map = new GameMap(7, 7);
    const controller = new TrafficLights(map, new RailNetwork(map), []);
    const phase = vi.spyOn(controller, 'greenAxis');
    const view = new TrafficLightsView();
    view.sync([junction]);

    for (const axis of ['x', 'y', null] as const) {
      phase.mockReturnValue(axis);
      view.update(controller);
      for (const signal of view.object.children) {
        const faces = signal.children.filter((child) => child instanceof THREE.Group);
        expect(faces).toHaveLength(4);
        for (const [index, face] of faces.entries()) {
          const green = axis === (index % 2 === 0 ? 'y' : 'x');
          const [redLight, greenLight] = face.children;
          expect(redLight.visible).toBe(true);
          expect(greenLight.visible).toBe(true);
          if (!(redLight instanceof THREE.Mesh) || !(greenLight instanceof THREE.Mesh)) {
            throw new Error('Missing signal lights');
          }
          const redMaterial = redLight.material as THREE.MeshLambertMaterial;
          const greenMaterial = greenLight.material as THREE.MeshLambertMaterial;
          expect(redMaterial.color.getHex()).toBe(green ? 0x310d0b : 0xf04438);
          expect(greenMaterial.color.getHex()).toBe(green ? 0x35c759 : 0x0a2812);
          expect(redMaterial.emissive.getHex()).toBe(green ? 0x000000 : 0x9e1710);
          expect(greenMaterial.emissive.getHex()).toBe(green ? 0x146b2a : 0x000000);
        }
      }
    }
  });
});
