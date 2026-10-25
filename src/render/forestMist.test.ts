import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { ForestMistView, FOREST_MIST_MIN_ZOOM, MAX_FOREST_MIST, hasForestMist } from './forestMist';

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

describe('podzimní mlha v lese', () => {
  it('objevuje se pouze v lese na podzim a mizí při oddálení', () => {
    const map = new GameMap(80, 80);
    const view = new ForestMistView(map);
    const camera = topCamera(40, 40, 8);
    const frustum = frustumOf(camera);

    view.setSeason('autumn');
    view.update(0, camera, frustum);
    expect((view.object.children[0] as THREE.InstancedMesh).count).toBe(0);
    expect(view.object.visible).toBe(false);

    map.tiles.fill(TileType.Trees);
    view.setEnabled(true);
    view.update(0, camera, frustum);
    const meshes = view.object.children as THREE.InstancedMesh[];
    expect(view.object.visible).toBe(true);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBeGreaterThan(0);
    expect(meshes.every((mesh) => mesh.count <= MAX_FOREST_MIST)).toBe(true);

    camera.zoom = FOREST_MIST_MIN_ZOOM / 2;
    view.update(1, camera, frustum);
    expect(view.object.visible).toBe(false);
    expect(meshes.every((mesh) => mesh.count === 0)).toBe(true);

    camera.zoom = 1;
    view.setSeason('winter');
    view.update(2, camera, frustum);
    expect(view.object.visible).toBe(false);
    expect(meshes.every((mesh) => mesh.count === 0)).toBe(true);
  });

  it('má stabilní hustotu na různě velkých mapách a kreslí pouze v záběru', () => {
    const small = new GameMap(40, 40);
    const large = new GameMap(1024, 1024);
    small.tiles.fill(TileType.Trees);
    large.tiles.fill(TileType.Trees);
    const camera = topCamera(20, 20, 6);
    const frustum = frustumOf(camera);
    const counts = [small, large].map((map) => {
      const view = new ForestMistView(map);
      view.setSeason('autumn');
      view.setEnabled(true);
      view.update(0, camera, frustum);
      const meshes = view.object.children as THREE.InstancedMesh[];
      const matrix = new THREE.Matrix4();
      for (const mesh of meshes) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          const center = new THREE.Vector3().setFromMatrixPosition(matrix);
          const scale = new THREE.Vector3().setFromMatrixScale(matrix);
          expect(frustum.intersectsSphere(new THREE.Sphere(center, scale.x * 0.7))).toBe(true);
        }
      }
      return meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    });

    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });

  it('husté světlé skvrny umisťuje deterministicky jen do lesa', () => {
    const map = new GameMap(80, 80);
    let wooded = 0;
    map.tiles.fill(TileType.Trees);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) wooded += Number(hasForestMist(map, x, y));
    expect(wooded).toBeGreaterThan(0);
    expect(wooded).toBeLessThan(map.width * map.height);

    map.tiles.fill(TileType.Grass);
    expect(hasForestMist(map, 12, 12)).toBe(false);
  });
});
