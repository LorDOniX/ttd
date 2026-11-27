import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameMap, TileType } from '../world/map';
import { Edge, RailNetwork } from '../world/rail';
import { portAt } from '../world/port';
import { airportModel } from './airports';
import { portModel } from './ports';
import { RailView } from './rail';

function snowMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((part) => {
    if (part.userData.snowRoof && part instanceof THREE.Mesh) found.push(part);
  });
  return found;
}

function triangles(mesh: THREE.Mesh): number {
  return mesh.geometry.getAttribute('position')?.count ?? 0;
}

describe('sníh na letištích a přístavu', () => {
  it('letiště a přístav ve hře mají sníh na střechách jen v zimě', () => {
    const map = new GameMap(40, 40);
    for (let y = 30; y < 40; y++) for (let x = 0; x < 40; x++) map.set(x, y, TileType.Water);
    const rail = new RailNetwork(map);
    rail.addAirport({ x: 5, y: 5, axis: 'x', length: 5, tracks: 4 }, 'small', 'Letiště', 0);
    rail.addAirport({ x: 15, y: 5, axis: 'y', length: 7, tracks: 5 }, 'large', 'Velké letiště', 0);
    rail.addPort(portAt(map, { x: 10, y: 29 }, Edge.S)!, 'Přístav', 0);

    const view = new RailView(rail);
    const snow = snowMeshes(view.object);
    expect(snow).toHaveLength(3);
    expect(snow.every((mesh) => triangles(mesh) > 0)).toBe(true);
    expect(snow.some((mesh) => mesh.visible)).toBe(false);

    view.setSeason('winter');
    expect(snowMeshes(view.object).every((mesh) => mesh.visible)).toBe(true);
    // Stavby postavené v zimě mají sníh hned
    view.rebuild();
    expect(snowMeshes(view.object).every((mesh) => mesh.visible)).toBe(true);
    view.setSeason('spring');
    expect(snowMeshes(view.object).some((mesh) => mesh.visible)).toBe(false);
  });

  it('sníh leží na střechách, ne na ranveji a parkovišti', () => {
    for (const type of ['small', 'large'] as const) {
      const [snow] = snowMeshes(airportModel(type, true));
      const box = new THREE.Box3().setFromBufferAttribute(
        snow.geometry.getAttribute('position') as THREE.BufferAttribute,
      );
      expect(box.min.y).toBeGreaterThan(0.06);
      expect(snowMeshes(airportModel(type))).toHaveLength(0);
    }
    expect(snowMeshes(portModel(true))).toHaveLength(1);
  });
});
