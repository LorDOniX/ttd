import * as THREE from 'three';
import './style.css';
import { BuildingsView } from './render/buildings';
import { IsoCamera } from './render/camera';
import { TileCursor } from './render/cursor';
import { TownLabels } from './render/labels';
import { RoadView } from './render/roads';
import { TerrainView } from './render/terrain';
import { generateWorld } from './world/generator';
import { NO_OWNER, type TilePos } from './world/map';
import { hashSeed } from './world/rng';

const MAP_SIZE = 256;

// Seed z URL (?seed=...), jinak náhodný
const seedText = new URLSearchParams(location.search).get('seed') ?? String(Date.now());
const world = generateWorld(hashSeed(seedText), MAP_SIZE);
const { map, towns } = world;

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

const terrain = new TerrainView(map, towns);
scene.add(terrain.object);

const roads = new RoadView(map);
scene.add(roads.object);

const buildings = new BuildingsView();
scene.add(buildings.object);
void buildings.rebuild(towns);

const labels = new TownLabels(container);
labels.setSize(window.innerWidth, window.innerHeight);
labels.rebuild(towns);
scene.add(labels.object);

const cursor = new TileCursor();
scene.add(cursor.object);

const isoCamera = new IsoCamera(
  renderer.domElement,
  new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(MAP_SIZE, MAP_SIZE)),
);
const biggest = [...towns].sort((a, b) => b.population - a.population)[0];
if (biggest) isoCamera.focus(biggest.x + 0.5, biggest.y + 0.5);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  labels.setSize(window.innerWidth, window.innerHeight);
  isoCamera.resize();
});

// Dočasný výpis vybrané dlaždice, nahradí ho HUD ve fázi 3
const status = document.createElement('div');
status.className = 'debug-status';
status.textContent = `Seed: ${seedText}`;
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
  const owner = tile ? map.getOwner(tile.x, tile.y) : NO_OWNER;
  const town = owner === NO_OWNER ? '' : ` – ${towns[owner].name}`;
  status.textContent = `Seed: ${seedText}` + (tile ? ` | Dlaždice ${tile.x}, ${tile.y}${town}` : '');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') terrain.setGridVisible(!terrain.gridVisible);
});

renderer.setAnimationLoop(() => {
  renderer.render(scene, isoCamera.camera);
  labels.render(scene, isoCamera.camera);
});
