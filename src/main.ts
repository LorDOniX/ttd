import * as THREE from 'three';
import './style.css';
import { START_YEAR } from './game/clock';
import { TRACK_PIECE_COST } from './game/balance';
import { Game, formatMoney } from './game/game';
import { BuildingsView } from './render/buildings';
import { IsoCamera } from './render/camera';
import { TileCursor } from './render/cursor';
import { TownLabels } from './render/labels';
import { BuildPreview } from './render/preview';
import { RailView } from './render/rail';
import { RoadView } from './render/roads';
import { TerrainView } from './render/terrain';
import { openFinance, openSettings, openTown } from './ui/dialogs';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { RailTools } from './ui/railTools';
import { WindowManager } from './ui/windows';
import { generateWorld } from './world/generator';
import { NO_OWNER, type TilePos } from './world/map';
import { hashSeed } from './world/rng';

const MAP_SIZE = 256;

// Seed z URL (?seed=...), jinak náhodný
const seedText = new URLSearchParams(location.search).get('seed') ?? String(Date.now());
const world = generateWorld(hashSeed(seedText), MAP_SIZE, START_YEAR);
const { map, towns } = world;
const game = new Game(world);

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

const railView = new RailView(world.rail);
scene.add(railView.object);

const preview = new BuildPreview();
scene.add(preview.object);

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

const windows = new WindowManager(container);
const railTools = new RailTools(game, windows, preview, container);
const grid = {
  visible: () => terrain.gridVisible,
  setVisible: (visible: boolean) => terrain.setGridVisible(visible),
};
new Hud(container, game, {
  openSettings: () => openSettings(windows, game, grid, seedText),
  openFinance: () => openFinance(windows, game),
  openRailBuild: () => railTools.openWindow(),
});

game.events.on('townsChanged', () => {
  terrain.refresh();
  roads.rebuild();
  void buildings.rebuild(towns);
  towns.forEach((town) => labels.update(town));
});

game.events.on('railChanged', () => railView.rebuild());

game.events.on('outOfMoney', () => {
  windows.open(
    'out-of-money',
    'Došly peníze',
    h('p', {}, `Výstavba byla zastavena, na další dílek koleje (${formatMoney(TRACK_PIECE_COST)}) nemáte dost peněz.`),
    { width: 300 },
  );
});

game.news(`Vítejte v roce ${START_YEAR}! Začínáte s rozpočtem na stavbu železnice.`);

function tileAt(clientX: number, clientY: number): TilePos | null {
  const p = isoCamera.groundPoint(clientX, clientY);
  if (!p) return null;
  const x = Math.floor(p.x);
  const y = Math.floor(p.z);
  return map.inBounds(x, y) ? { x, y } : null;
}

renderer.domElement.addEventListener('pointermove', (e) => {
  const tile = tileAt(e.clientX, e.clientY);
  cursor.show(tile);
  if (railTools.tool) railTools.pointerMove(tile, e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerleave', () => cursor.show(null));

let clickStart: { x: number; y: number } | null = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (railTools.tool) {
    renderer.domElement.setPointerCapture(e.pointerId);
    railTools.pointerDown(tileAt(e.clientX, e.clientY));
    return;
  }
  clickStart = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (railTools.tool) {
    railTools.pointerUp();
    return;
  }
  if (!clickStart) return;
  const moved = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
  clickStart = null;
  if (moved > 4) return;
  const tile = tileAt(e.clientX, e.clientY);
  const owner = tile ? map.getOwner(tile.x, tile.y) : NO_OWNER;
  if (owner !== NO_OWNER) openTown(windows, game, towns[owner]);
});

let lastFrame = performance.now();
renderer.setAnimationLoop((now: number) => {
  game.update(now - lastFrame);
  lastFrame = now;
  renderer.render(scene, isoCamera.camera);
  labels.render(scene, isoCamera.camera);
});
