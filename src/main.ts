import * as THREE from 'three';
import './style.css';
import { IsoCamera } from './render/camera';
import { TileCursor } from './render/cursor';
import { TerrainView } from './render/terrain';
import { GameMap, type TilePos } from './world/map';

const MAP_SIZE = 128;

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d8);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(10, 20, 5);
scene.add(sun);

const map = new GameMap(MAP_SIZE, MAP_SIZE);
const terrain = new TerrainView(map);
scene.add(terrain.object);

const cursor = new TileCursor();
scene.add(cursor.object);

const isoCamera = new IsoCamera(
  renderer.domElement,
  new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(MAP_SIZE, MAP_SIZE)),
);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  isoCamera.resize();
});

// Dočasný výpis vybrané dlaždice, nahradí ho HUD ve fázi 3
const status = document.createElement('div');
status.className = 'debug-status';
container.appendChild(status);

function tileAt(clientX: number, clientY: number): TilePos | null {
  const p = isoCamera.groundPoint(clientX, clientY);
  if (!p) return null;
  const x = Math.floor(p.x);
  const y = Math.floor(p.z);
  return map.inBounds(x, y) ? { x, y } : null;
}

renderer.domElement.addEventListener('pointermove', (e) => {
  cursor.show(tileAt(e.clientX, e.clientY));
});

renderer.domElement.addEventListener('pointerleave', () => cursor.show(null));

let clickStart: { x: number; y: number } | null = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) clickStart = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !clickStart) return;
  const moved = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
  clickStart = null;
  if (moved > 4) return;
  const tile = tileAt(e.clientX, e.clientY);
  status.textContent = tile ? `Dlaždice ${tile.x}, ${tile.y}` : '';
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') terrain.setGridVisible(!terrain.gridVisible);
});

renderer.setAnimationLoop(() => renderer.render(scene, isoCamera.camera));
