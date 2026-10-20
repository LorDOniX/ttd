import * as THREE from 'three';
import './style.css';
import { START_YEAR, formatDate } from './game/clock';
import { Game } from './game/game';
import { PENDING_LOAD_KEY, parseSave, restoreGame } from './game/save';
import { BuildingsView } from './render/buildings';
import { IsoCamera } from './render/camera';
import { TileCursor } from './render/cursor';
import { StationLabels, TownLabels } from './render/labels';
import { BuildPreview } from './render/preview';
import { RailView } from './render/rail';
import { RoadView } from './render/roads';
import { TerrainView } from './render/terrain';
import { TrainsView } from './render/trains';
import { BuildTools } from './ui/buildTools';
import { openDepot } from './ui/depot';
import { openFinance, openSaveLoad, openSettings, openTown } from './ui/dialogs';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { WindowManager } from './ui/windows';
import { generateWorld } from './world/generator';
import { NO_OWNER, type TilePos } from './world/map';
import { hashSeed } from './world/rng';

const MAP_SIZE = 256;

// Načtená hra čeká v sessionStorage po reloadu, jinak nová hra ze seedu z URL (?seed=...)
function startGame(): { game: Game; seedText: string; loaded: boolean; error: string | null } {
  const pending = sessionStorage.getItem(PENDING_LOAD_KEY);
  sessionStorage.removeItem(PENDING_LOAD_KEY);
  let error: string | null = null;
  if (pending) {
    try {
      const data = parseSave(pending);
      return { game: restoreGame(data), seedText: data.seedText, loaded: true, error };
    } catch (e) {
      error = e instanceof Error ? e.message : 'Hru se nepodařilo načíst.';
    }
  }
  const seedText = new URLSearchParams(location.search).get('seed') ?? String(Date.now());
  const game = new Game(generateWorld(hashSeed(seedText), MAP_SIZE, START_YEAR));
  return { game, seedText, loaded: false, error };
}

const { game, seedText, loaded, error: loadError } = startGame();
const { world } = game;
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

const railView = new RailView(world.rail);
scene.add(railView.object);

const trainsView = new TrainsView(game.fleet, map);
scene.add(trainsView.object);

const preview = new BuildPreview();
scene.add(preview.object);

const labels = new TownLabels(container);
labels.setSize(window.innerWidth, window.innerHeight);
labels.rebuild(towns);
scene.add(labels.object);

const stationLabels = new StationLabels();
scene.add(stationLabels.object);

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
const buildTools = new BuildTools(game, windows, preview, container);
const grid = {
  visible: () => terrain.gridVisible,
  setVisible: (visible: boolean) => terrain.setGridVisible(visible),
};
new Hud(container, game, {
  openSaveLoad: () => openSaveLoad(windows, game, seedText),
  openSettings: () => openSettings(windows, game, grid, seedText),
  openFinance: () => openFinance(windows, game),
  openRailBuild: () => buildTools.openRailWindow(),
  openRoadBuild: () => buildTools.openRoadWindow(),
});

game.events.on('townsChanged', () => {
  terrain.refresh();
  roads.rebuild();
  void buildings.rebuild(towns);
  towns.forEach((town) => labels.update(town));
});

game.events.on('railChanged', () => {
  railView.rebuild();
  // Demolice přejezdu mění i vzhled silnice
  roads.rebuild();
  rebuildStationLabels();
});

const rebuildStationLabels = (): void =>
  stationLabels.rebuild(world.rail.stations, (s) => game.passengers.townsInReach(s).length > 0);
game.events.on('stationsChanged', rebuildStationLabels);

game.events.on('roadsChanged', () => roads.rebuild());

game.events.on('outOfMoney', () => {
  windows.open(
    'out-of-money',
    'Došly peníze',
    h('p', {}, 'Výstavba byla zastavena, na další dílek nemáte dost peněz.'),
    { width: 300 },
  );
});

rebuildStationLabels();

if (loadError) game.news(`Načtení selhalo: ${loadError} Začíná nová hra.`);
else if (loaded) game.news(`Hra načtena: ${formatDate(game.clock.date)}.`);
else game.news(`Vítejte v roce ${START_YEAR}! Začínáte s rozpočtem na stavbu železnice.`);

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
  if (buildTools.tool) buildTools.pointerMove(tile, e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerleave', () => cursor.show(null));

let clickStart: { x: number; y: number } | null = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (buildTools.tool) {
    renderer.domElement.setPointerCapture(e.pointerId);
    buildTools.pointerDown(tileAt(e.clientX, e.clientY));
    return;
  }
  clickStart = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (buildTools.tool) {
    buildTools.pointerUp();
    return;
  }
  if (!clickStart) return;
  const moved = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
  clickStart = null;
  if (moved > 4) return;
  const tile = tileAt(e.clientX, e.clientY);
  if (!tile) return;
  const depot = world.rail.depotAt(tile.x, tile.y);
  if (depot) {
    openDepot(windows, game, depot);
    return;
  }
  const owner = map.getOwner(tile.x, tile.y);
  if (owner !== NO_OWNER) openTown(windows, game, towns[owner]);
});

let lastFrame = performance.now();
renderer.setAnimationLoop((now: number) => {
  game.update(now - lastFrame);
  lastFrame = now;
  trainsView.update();
  renderer.render(scene, isoCamera.camera);
  labels.render(scene, isoCamera.camera);
});
