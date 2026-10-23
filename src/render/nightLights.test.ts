import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NIGHT_DETAIL_ZOOM, NightLightsView } from './nightLights';

function pointLights(view: NightLightsView): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];
  view.object.traverse((child) => {
    if (child instanceof THREE.PointLight) lights.push(child);
  });
  return lights;
}

function shiningLamps(view: NightLightsView): number {
  let count = 0;
  view.object.traverseVisible((child) => {
    if (child instanceof THREE.PointLight && child.intensity > 0) count++;
  });
  return count;
}

describe('noční světla', () => {
  it('zapne pouze pouliční lampy ve frustumu a přes den je skryje', () => {
    const view = new NightLightsView();
    const frustum = new THREE.Frustum();
    frustum.intersectsSphere = (sphere) => sphere.center.x < 10;
    const visible = new THREE.Vector3(0, 0.02, 0);
    const outside = new THREE.Vector3(1000, 0.02, 1000);

    view.update(false, frustum, new THREE.Vector3(), 1, [visible]);
    expect(view.object.visible).toBe(false);

    view.update(true, frustum, new THREE.Vector3(), 1, [visible, outside]);
    expect(view.object.visible).toBe(true);
    expect(shiningLamps(view)).toBe(1);
  });

  it('drží stálý počet bodových světel a při oddálení lampy nepočítá', () => {
    const view = new NightLightsView();
    const frustum = new THREE.Frustum();
    let checks = 0;
    frustum.intersectsSphere = () => {
      checks++;
      return true;
    };
    const lamps = [new THREE.Vector3(0, 0.02, 0)];
    const total = pointLights(view).length;

    view.update(true, frustum, new THREE.Vector3(), 1, lamps, [], 0);
    expect(pointLights(view)).toHaveLength(total);
    expect(shiningLamps(view)).toBe(1);

    checks = 0;
    view.update(true, frustum, new THREE.Vector3(), NIGHT_DETAIL_ZOOM / 2, lamps, [{ x: 0, y: 0, radius: 8 }], 200);
    expect(checks).toBe(1);
    expect(shiningLamps(view)).toBe(0);
  });

  it('přidá světelný kruh pro každé město ve viewportu a vynechá města mimo něj', () => {
    const view = new NightLightsView();
    const frustum = new THREE.Frustum();
    frustum.intersectsSphere = (sphere) => sphere.center.x < 10;
    const towns = [
      { x: 0, y: 0, radius: 8 },
      { x: 1000, y: 1000, radius: 8 },
    ];

    view.update(true, frustum, new THREE.Vector3(), 1, [], towns);

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

    view.update(true, frustum, camera, 1, lamps, towns, 0);
    const firstChecks = checks;
    const townGlows = view.object.children.find((child) => child instanceof THREE.InstancedMesh)!;
    const matrixVersion = townGlows.instanceMatrix.version;

    view.update(true, frustum, camera, 1, lamps, towns, 40);

    expect(checks).toBe(firstChecks);
    expect(townGlows.instanceMatrix.version).toBe(matrixVersion);

    frustum.planes[0].constant = 1;
    view.update(true, frustum, camera, 1, lamps, towns, 100);
    expect(checks).toBeGreaterThan(firstChecks);
  });
});
