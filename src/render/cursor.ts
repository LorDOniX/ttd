import * as THREE from 'three';
import type { TilePos } from '../world/map';

// Obrys dlaždice pod kurzorem
export class TileCursor {
  readonly object: THREE.LineLoop;

  constructor() {
    const lift = 0.02;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, lift, 0, 1, lift, 0, 1, lift, 1, 0, lift, 1], 3),
    );
    this.object = new THREE.LineLoop(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    this.object.renderOrder = 10;
    this.object.visible = false;
  }

  show(tile: TilePos | null): void {
    this.object.visible = tile !== null;
    if (tile) this.object.position.set(tile.x, 0, tile.y);
  }
}
