import * as THREE from 'three';
import type { TilePos } from '../world/map';

const ENABLED_KEY = 'ttd-tile-cursor';

// Obrys dlaždice pod kurzorem; zapíná se v Nastavení a volba se pamatuje v prohlížeči
export class TileCursor {
  readonly object: THREE.LineLoop;
  private on = localStorage.getItem(ENABLED_KEY) === '1';

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

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(enabled: boolean): void {
    this.on = enabled;
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
    if (!enabled) this.object.visible = false;
  }

  show(tile: TilePos | null): void {
    this.object.visible = this.on && tile !== null;
    if (tile) this.object.position.set(tile.x, 0, tile.y);
  }
}
