import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Town } from '../world/town';

// Popisky měst jako HTML nad 3D scénou
export class TownLabels {
  readonly object = new THREE.Group();
  readonly renderer = new CSS2DRenderer();
  private readonly labels = new Map<number, HTMLElement>();

  constructor(container: HTMLElement) {
    this.renderer.domElement.classList.add('label-layer');
    container.appendChild(this.renderer.domElement);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  rebuild(towns: readonly Town[]): void {
    this.object.clear();
    this.labels.clear();
    for (const town of towns) {
      const el = document.createElement('div');
      el.className = `town-label town-label--${town.kind}`;
      const label = new CSS2DObject(el);
      label.position.set(town.x + 0.5, 1.5, town.y + 0.5);
      this.object.add(label);
      this.labels.set(town.id, el);
      this.update(town);
    }
  }

  update(town: Town): void {
    const el = this.labels.get(town.id);
    if (el) el.textContent = `${town.name} (${town.population.toLocaleString('cs-CZ')})`;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }
}
