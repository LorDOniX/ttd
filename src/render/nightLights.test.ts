import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NightLightsView } from './nightLights';

function texel(view: NightLightsView, x: number, z: number): number {
  const { width, data } = view.lampLight.image;
  const scale = width / 16;
  return data![(Math.floor(z * scale) * width + Math.floor(x * scale)) * 4];
}

describe('noční světla', () => {
  it('zapeče světlo lamp do textury a rozsvítí ho na zemi jen v noci', () => {
    const view = new NightLightsView(16, 16);
    const ground = new THREE.MeshLambertMaterial();
    view.light(ground);
    const frustum = new THREE.Frustum();

    view.update(false, frustum, [new THREE.Vector3(4, 0.02, 4)]);
    expect(view.object.visible).toBe(false);
    expect(ground.lightMap).toBe(view.lampLight);
    expect(ground.lightMapIntensity).toBe(0);
    expect(texel(view, 4, 4)).toBeGreaterThan(0);
    expect(texel(view, 12, 12)).toBe(0);

    view.update(true, frustum, [new THREE.Vector3(4, 0.02, 4)]);
    expect(view.object.visible).toBe(true);
    expect(ground.lightMapIntensity).toBeGreaterThan(0);
  });

  it('nepoužívá bodová světla a stejné lampy znovu nepřepéká', () => {
    const view = new NightLightsView(16, 16);
    const frustum = new THREE.Frustum();
    view.update(true, frustum, [new THREE.Vector3(4, 0.02, 4)], [], 0);
    const version = view.lampLight.version;

    view.update(true, frustum, [new THREE.Vector3(4, 0.02, 4)], [], 200);
    expect(view.lampLight.version).toBe(version);

    view.update(true, frustum, [new THREE.Vector3(10, 0.02, 10)], [], 400);
    expect(view.lampLight.version).toBeGreaterThan(version);
    expect(texel(view, 4, 4)).toBe(0);
    expect(texel(view, 10, 10)).toBeGreaterThan(0);

    let pointLights = 0;
    view.object.traverse((child) => {
      if (child instanceof THREE.PointLight) pointLights++;
    });
    expect(pointLights).toBe(0);
  });

  it('přidá světelný kruh pro každé město ve viewportu a vynechá města mimo něj', () => {
    const view = new NightLightsView(16, 16);
    const frustum = new THREE.Frustum();
    frustum.intersectsSphere = (sphere) => sphere.center.x < 10;
    const towns = [
      { x: 0, y: 0, radius: 8 },
      { x: 1000, y: 1000, radius: 8 },
    ];

    view.update(true, frustum, [], towns);

    const townGlows = view.object.children.find((child) => child instanceof THREE.InstancedMesh);
    expect(townGlows).toBeInstanceOf(THREE.InstancedMesh);
    expect((townGlows as THREE.InstancedMesh).count).toBe(1);
  });

  it('při stabilním viewportu znovu nepřepisuje instance a po změně pohledu je obnoví', () => {
    const view = new NightLightsView(16, 16);
    const frustum = new THREE.Frustum();
    let checks = 0;
    frustum.intersectsSphere = () => {
      checks++;
      return true;
    };
    const lamps = [new THREE.Vector3(0, 0.02, 0)];
    const towns = [{ x: 0, y: 0, radius: 8 }];

    view.update(true, frustum, lamps, towns, 0);
    const firstChecks = checks;
    const townGlows = view.object.children.find((child) => child instanceof THREE.InstancedMesh)!;
    const matrixVersion = townGlows.instanceMatrix.version;

    view.update(true, frustum, lamps, towns, 40);

    expect(checks).toBe(firstChecks);
    expect(townGlows.instanceMatrix.version).toBe(matrixVersion);

    frustum.planes[0].constant = 1;
    view.update(true, frustum, lamps, towns, 100);
    expect(checks).toBeGreaterThan(firstChecks);
  });
});
