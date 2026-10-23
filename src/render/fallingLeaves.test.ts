import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { fallingLeafPlacements, FallingLeavesView } from './fallingLeaves';

describe('podzimní listí', () => {
  it('rozmístí stabilní omezený počet listů pouze na lesní dlaždice', () => {
    const map = new GameMap(256, 256);
    map.tiles.fill(TileType.Trees);

    const leaves = fallingLeafPlacements(map);
    const rows = leaves.map(({ tile }) => Math.floor(tile / map.width));

    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.length).toBeLessThanOrEqual(600);
    expect(fallingLeafPlacements(map)).toEqual(leaves);
    expect(leaves.every(({ tile }) => map.tiles[tile] === TileType.Trees)).toBe(true);
    expect(leaves.every(({ size }) => size >= 0.22 && size <= 0.32)).toBe(true);
    expect(Math.min(...rows)).toBeLessThan(map.height * 0.25);
    expect(Math.max(...rows)).toBeGreaterThan(map.height * 0.75);
  });

  it('nevytváří listí mimo stromy', () => {
    const map = new GameMap(80, 80);

    expect(fallingLeafPlacements(map)).toEqual([]);
  });

  it('zobrazuje animaci pouze na podzim', () => {
    const map = new GameMap(80, 80);
    map.tiles.fill(TileType.Trees);
    const leaves = new FallingLeavesView(map);
    const mesh = leaves.object.children[0];

    expect(mesh.visible).toBe(false);
    leaves.setSeason('autumn');
    expect(mesh.visible).toBe(true);
    leaves.setSeason('winter');
    expect(mesh.visible).toBe(false);
  });

  it('vykreslí pouze listy uvnitř frustumu kamery', () => {
    const map = new GameMap(80, 80);
    map.tiles.fill(TileType.Trees);
    const leaves = new FallingLeavesView(map);
    leaves.setSeason('autumn');
    const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
    camera.position.set(40, 50, 40);
    camera.lookAt(40, 0, 40);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );

    leaves.update(0, frustum);

    const mesh = leaves.object.children[0] as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let visible = 0;
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      scale.setFromMatrixScale(matrix);
      if (scale.length() > 0) visible++;
    }
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(mesh.count);
  });
});
