import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NightLightsView } from './nightLights';

describe('noční světla', () => {
  it('zapne pouze pouliční lampy ve frustumu a přes den je skryje', () => {
    const view = new NightLightsView();
    const frustum = new THREE.Frustum();
    frustum.intersectsSphere = (sphere) => sphere.center.x < 10;
    const visible = new THREE.Vector3(0, 0.02, 0);
    const outside = new THREE.Vector3(1000, 0.02, 1000);

    view.update(false, frustum, new THREE.Vector3(), [visible]);
    expect(view.object.visible).toBe(false);

    view.update(true, frustum, new THREE.Vector3(), [visible, outside]);
    expect(view.object.visible).toBe(true);
    expect(view.object.children.filter((lamp) => lamp instanceof THREE.Group && lamp.visible)).toHaveLength(1);
  });

  it('přidá světelný kruh pro každé město ve viewportu a vynechá města mimo něj', () => {
    const view = new NightLightsView();
    const frustum = new THREE.Frustum();
    frustum.intersectsSphere = (sphere) => sphere.center.x < 10;
    const towns = [
      { x: 0, y: 0, radius: 8 },
      { x: 1000, y: 1000, radius: 8 },
    ];

    view.update(true, frustum, new THREE.Vector3(), [], towns);

    const townGlows = view.object.children.find((child) => child instanceof THREE.InstancedMesh);
    expect(townGlows).toBeInstanceOf(THREE.InstancedMesh);
    expect((townGlows as THREE.InstancedMesh).count).toBe(1);
  });

  it('při stabilním viewportu znovu nepřepisuje instance a po změně pohledu je obnoví', () => {
    const view = new NightLightsView();
    const frustum = new THREE.Frustum();
    let checks = 0;
    frustum.intersectsSphere = () => {
      checks++;
      return true;
    };
    const camera = new THREE.Vector3();
    const lamps = [new THREE.Vector3(0, 0.02, 0)];
    const towns = [{ x: 0, y: 0, radius: 8 }];

    view.update(true, frustum, camera, lamps, towns, 0);
    const firstChecks = checks;
    const townGlows = view.object.children.find((child) => child instanceof THREE.InstancedMesh)!;
    const matrixVersion = townGlows.instanceMatrix.version;

    view.update(true, frustum, camera, lamps, towns, 40);

    expect(checks).toBe(firstChecks);
    expect(townGlows.instanceMatrix.version).toBe(matrixVersion);

    frustum.planes[0].constant = 1;
    view.update(true, frustum, camera, lamps, towns, 100);
    expect(checks).toBeGreaterThan(firstChecks);
  });
});
