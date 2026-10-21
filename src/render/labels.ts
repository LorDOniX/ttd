import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Town } from '../world/town';
import type { Station } from '../world/rail';

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

// Popisky nástupišť (čekající cestující, uhlí, hodnocení); vykresluje je CSS2DRenderer z TownLabels
export class StationLabels {
  readonly object = new THREE.Group();

  rebuild(stations: readonly Station[], describe: (station: Station) => string): void {
    this.object.clear();
    for (const station of stations) {
      const el = document.createElement('div');
      el.className = 'station-label';
      el.textContent = describe(station);
      const label = new CSS2DObject(el);
      label.position.set(station.x + 0.5, 0.8, station.y + 0.5);
      this.object.add(label);
    }
  }
}

const FLOAT_MS = 2500;
const FLOAT_RISE = 1.5;

// Krátce zobrazené texty ve scéně (např. výdělek nad nástupištěm), stoupají a mizí
export class FloatingTexts {
  readonly object = new THREE.Group();
  private readonly items: { label: CSS2DObject; start: number; y: number }[] = [];

  show(text: string, x: number, z: number, className: string): void {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    const label = new CSS2DObject(el);
    label.position.set(x, 1.2, z);
    this.object.add(label);
    this.items.push({ label, start: performance.now(), y: 1.2 });
  }

  update(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const t = (now - item.start) / FLOAT_MS;
      if (t >= 1) {
        this.object.remove(item.label);
        this.items.splice(i, 1);
        continue;
      }
      item.label.position.y = item.y + t * FLOAT_RISE;
      item.label.element.style.opacity = String(1 - t * t);
    }
  }
}
