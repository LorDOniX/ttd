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
    expect(view.object.children.filter((lamp) => lamp.visible)).toHaveLength(1);
  });
});
