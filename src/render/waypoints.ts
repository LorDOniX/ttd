import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Axis, RailNetwork } from '../world/rail';

// Průjezdný bod: dva sloupky po stranách koleje a nad ní žlutočerná tabule (jako značka v OpenTTD)
const POST = new THREE.BoxGeometry(0.05, 0.55, 0.05).translate(0, 0.275, 0);
const BOARD = new THREE.BoxGeometry(0.06, 0.14, 0.7).translate(0, 0.55, 0);
const STRIPE = new THREE.BoxGeometry(0.065, 0.05, 0.7).translate(0, 0.55, 0);
const POST_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
const BOARD_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
const STRIPE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x222222 });
// Vzdálenost sloupku od osy koleje
const SIDE = 0.34;

// Značka v souřadnicích dlaždice (0..1); kolej vede po ose axis, tabule napříč přes ni
export function createWaypointObject(axis: Axis): THREE.Group {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(POST, POST_MATERIAL);
    post.position.z = side * SIDE;
    group.add(post);
  }
  group.add(new THREE.Mesh(BOARD, BOARD_MATERIAL), new THREE.Mesh(STRIPE, STRIPE_MATERIAL));
  // Pro kolej podél osy x stojí tabule napříč (podél z); pro osu y se otočí
  if (axis === 'y') group.rotation.y = Math.PI / 2;
  const tile = new THREE.Group();
  group.position.set(0.5, 0, 0.5);
  tile.add(group);
  return tile;
}

// Značky průjezdných bodů a jejich jména (popisky vykresluje CSS2DRenderer)
export class WaypointsView {
  readonly object = new THREE.Group();
  readonly labels = new THREE.Group();

  constructor(private readonly rail: RailNetwork) {}

  rebuild(): void {
    this.object.clear();
    this.labels.clear();
    for (const w of this.rail.waypoints) {
      const marker = createWaypointObject(w.axis);
      const ground = this.rail.map.elevation(w.x, w.y);
      marker.position.set(w.x, ground, w.y);
      this.object.add(marker);
      const el = document.createElement('div');
      el.className = 'waypoint-label';
      el.textContent = w.name;
      const label = new CSS2DObject(el);
      label.position.set(w.x + 0.5, ground + 0.9, w.y + 0.5);
      this.labels.add(label);
    }
  }
}
