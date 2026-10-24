import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { FallingLeavesView, LEAF_MIN_ZOOM, MAX_VISIBLE_LEAVES, fallingLeaf, hasFallingLeaves } from './fallingLeaves';

function topCamera(x: number, z: number, half: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 100);
  camera.position.set(x, 50, z);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

function frustumOf(camera: THREE.Camera): THREE.Frustum {
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

function shownLeaves(view: FallingLeavesView): THREE.Vector3[] {
  const mesh = view.object.children[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  return Array.from({ length: mesh.visible ? mesh.count : 0 }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
}

describe('podzimní listí', () => {
  it('padá jen z části lesních dlaždic a parametry listu jsou stabilní', () => {
    const map = new GameMap(80, 80);
    expect(hasFallingLeaves(map, 10, 10)).toBe(false);
    map.tiles.fill(TileType.Trees);
    let tiles = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (hasFallingLeaves(map, x, y)) tiles++;

    expect(tiles).toBeGreaterThan(0);
    expect(tiles).toBeLessThan(map.width * map.height);
    expect(fallingLeaf(3, 4, 1)).toEqual(fallingLeaf(3, 4, 1));
    expect(fallingLeaf(3, 4, 1)).not.toEqual(fallingLeaf(3, 4, 2));
    expect(fallingLeaf(3, 4, 1).size).toBeGreaterThanOrEqual(0.12);
    expect(fallingLeaf(3, 4, 1).size).toBeLessThanOrEqual(0.17);
  });

  it('zobrazuje animaci pouze na podzim a ne při velkém oddálení', () => {
    const map = new GameMap(80, 80);
    map.tiles.fill(TileType.Trees);
    const leaves = new FallingLeavesView(map);
    const camera = topCamera(40, 40, 8);
    const frustum = frustumOf(camera);

    leaves.update(0, camera, frustum);
    expect(shownLeaves(leaves)).toHaveLength(0);

    leaves.setSeason('autumn');
    leaves.update(0, camera, frustum);
    expect(shownLeaves(leaves).length).toBeGreaterThan(0);

    camera.zoom = LEAF_MIN_ZOOM / 2;
    leaves.update(0, camera, frustum);
    expect(shownLeaves(leaves)).toHaveLength(0);

    camera.zoom = 1;
    leaves.setSeason('winter');
    leaves.update(0, camera, frustum);
    expect(shownLeaves(leaves)).toHaveLength(0);
  });

  it('počítá a kreslí jen listy v záběru, hustota nezávisí na velikosti mapy', () => {
    const small = new GameMap(40, 40);
    const large = new GameMap(1024, 1024);
    small.tiles.fill(TileType.Trees);
    large.tiles.fill(TileType.Trees);
    const camera = topCamera(20, 20, 6);
    const frustum = frustumOf(camera);
    const counts = [small, large].map((map) => {
      const view = new FallingLeavesView(map);
      view.setSeason('autumn');
      view.update(0, camera, frustum);
      const shown = shownLeaves(view);
      expect(shown.every((p) => frustum.containsPoint(p))).toBe(true);
      return shown.length;
    });

    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[0]).toBeLessThanOrEqual(MAX_VISIBLE_LEAVES);
    expect(counts[1]).toBe(counts[0]);
  });

  it('po vykácení lesa z dlaždice listy přestanou padat', () => {
    const map = new GameMap(20, 20);
    map.tiles.fill(TileType.Trees);
    const view = new FallingLeavesView(map);
    view.setSeason('autumn');
    const camera = topCamera(10, 10, 12);
    view.update(0, camera, frustumOf(camera));
    expect(shownLeaves(view).length).toBeGreaterThan(0);

    map.tiles.fill(TileType.Grass);
    view.update(0, camera, frustumOf(camera));
    expect(shownLeaves(view)).toHaveLength(0);
  });
});
