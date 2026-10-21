import { START_YEAR, formatDate } from '../game/clock';
import { Game } from '../game/game';
import type { RoadVehicle } from '../game/roadVehicles';
import type { Train } from '../game/trains';
import { launch, returnToTitle, writeAutosave, type LaunchIntent, type NewGameOptions } from '../game/launch';
import { parseSave, restoreGame } from '../game/save';
import { TileCursor } from '../render/cursor';
import { GameView } from '../render/gameView';
import { BuildPreview } from '../render/preview';
import { BuildTools, type PointerTile } from '../ui/buildTools';
import { openDepot } from '../ui/depot';
import { openNewsLog, openSaveLoad, openSettings, openTown } from '../ui/dialogs';
import { h } from '../ui/dom';
import { openFinance } from '../ui/finance';
import { Hud, type ToolbarActions } from '../ui/hud';
import { openMinimap } from '../ui/minimap';
import { Shortcuts } from '../ui/shortcuts';
import { openTileInfo } from '../ui/tileInfo';
import { openTrain, openTrainList } from '../ui/trainWindow';
import { openRoadDepot, openRoadVehicle, openVehicleList } from '../ui/roadVehicles';
import { WindowManager } from '../ui/windows';
import { generateWorld } from '../world/generator';
import { NO_OWNER } from '../world/map';
import { industryAt, type Industry } from '../world/industry';
import { openIndustry } from '../ui/industry';
import { openStation } from '../ui/station';
import type { Depot, Station } from '../world/rail';
import { hashSeed } from '../world/rng';
import type { Town } from '../world/town';

const WATER_LEVELS = { low: 0.28, normal: 0.34, high: 0.42 } as const;
const TOWN_DENSITY = { few: 0.6, normal: 1, many: 1.5 } as const;
// Posun šipkami ve výškách obrazovky za sekundu
const KEY_PAN_SPEED = 0.8;

export const DEFAULT_OPTIONS: Omit<NewGameOptions, 'seedText'> = { size: 256, water: 'normal', towns: 'normal' };

function newGame(options: NewGameOptions): Game {
  return new Game(
    generateWorld(hashSeed(options.seedText), options.size, START_YEAR, {
      waterLevel: WATER_LEVELS[options.water],
      townDensity: TOWN_DENSITY[options.towns],
    }),
  );
}

// Hra podle volby z úvodní obrazovky; poškozené uložení vrátí na úvodní obrazovku
function createGame(intent: LaunchIntent): { game: Game; seedText: string; message: string } {
  if (intent.mode === 'load') {
    try {
      const data = parseSave(intent.save);
      const game = restoreGame(data);
      return { game, seedText: data.seedText, message: `Hra načtena: ${formatDate(game.clock.date)}.` };
    } catch (e) {
      alert(`Hru se nepodařilo načíst: ${e instanceof Error ? e.message : ''}`);
      returnToTitle();
      throw e;
    }
  }
  return {
    game: newGame(intent.options),
    seedText: intent.options.seedText,
    message: `Vítejte v roce ${START_YEAR}! Začínáte s rozpočtem na stavbu železnice.`,
  };
}

export function runGame(container: HTMLElement, intent: LaunchIntent): void {
  const { game, seedText, message } = createGame(intent);
  const { world } = game;
  const { map, towns } = world;
  const view = new GameView(container, game);
  const { renderer, camera: isoCamera, terrain } = view;

  const preview = new BuildPreview();
  const cursor = new TileCursor();
  view.scene.add(preview.object, cursor.object);

  const windows = new WindowManager(container);
  const buildTools = new BuildTools(game, windows, preview, container);
  const grid = {
    visible: () => terrain.gridVisible,
    setVisible: (visible: boolean) => terrain.setGridVisible(visible),
  };
  const focus = (x: number, z: number): void => isoCamera.focus(x, z);
  const vehicleLinks = {
    focus,
    openRoadDepot: (depot: Depot) => openRoadDepot(windows, game, depot, vehicleLinks),
  };
  const links = {
    focus,
    openDepot: (depot: Depot) => openDepot(windows, game, depot, focus),
    openRoadDepot: vehicleLinks.openRoadDepot,
    openTown: (town: Town) => openTown(windows, game, town, focus),
    openIndustry: (industry: Industry) => openIndustry(windows, game, industry, focus),
    openStation: (station: Station) =>
      openStation(windows, game, station, {
        focus,
        openTrain: (train: Train) => openTrain(windows, game, train, links),
        openVehicle: (vehicle: RoadVehicle) => openRoadVehicle(windows, game, vehicle, vehicleLinks),
      }),
  };
  buildTools.onInspect = (tile) => openTileInfo(windows, game, tile, links);
  const actions: ToolbarActions = {
    openSaveLoad: () =>
      openSaveLoad(windows, game, seedText, {
        load: (save) => launch({ mode: 'load', save }),
        toTitle: () => {
          writeAutosave(game, seedText);
          returnToTitle();
        },
      }),
    openSettings: () => openSettings(windows, game, grid, seedText, shortcuts.help()),
    openFinance: () => openFinance(windows, game),
    openRailBuild: () => buildTools.openRailWindow(),
    openRoadBuild: () => buildTools.openRoadWindow(),
    rotateView: (direction) => isoCamera.rotate(direction),
    openMinimap: () => openMinimap(windows, game, isoCamera, renderer.domElement),
    openTrainList: () => openTrainList(windows, game, links),
    openVehicleList: () => openVehicleList(windows, game, vehicleLinks),
    openNews: () => openNewsLog(windows, game, focus),
    toggleInfo: () => buildTools.toggleTool('info'),
  };
  const hud = new Hud(container, game, actions);
  buildTools.anchorFor = (id) => (id === 'rail-build' ? hud.railButton : hud.roadButton);
  buildTools.onToolChange = (tool) => hud.setInfoActive(tool === 'info');

  const { clock } = game;
  const shortcuts = new Shortcuts([
    { codes: ['Space'], key: 'Mezerník', label: 'Pauza', run: () => (clock.paused = !clock.paused) },
    { codes: ['Digit1', 'Numpad1'], key: '1', label: 'Rychlost ×1', run: () => (clock.speed = 1) },
    { codes: ['Digit2', 'Numpad2'], key: '2', label: 'Rychlost ×2', run: () => (clock.speed = 2) },
    { codes: ['Digit3', 'Numpad3'], key: '3', label: 'Rychlost ×4', run: () => (clock.speed = 4) },
    { codes: ['KeyQ'], key: 'Q', label: 'Otočit pohled doleva', run: () => isoCamera.rotate(-1) },
    { codes: ['KeyE'], key: 'E', label: 'Otočit pohled doprava', run: () => isoCamera.rotate(1) },
    { codes: ['KeyK'], key: 'K', label: 'Koleje', run: () => buildTools.toggleTool('track') },
    { codes: ['KeyN'], key: 'N', label: 'Nástupiště', run: () => buildTools.toggleTool('station') },
    { codes: ['KeyD'], key: 'D', label: 'Depo', run: () => buildTools.toggleTool('depot') },
    { codes: ['KeyS'], key: 'S', label: 'Silnice', run: () => buildTools.toggleTool('road') },
    { codes: ['KeyZ'], key: 'Z', label: 'Zastávka aut', run: () => buildTools.toggleTool('road-stop') },
    { codes: ['KeyU'], key: 'U', label: 'Garáž aut', run: () => buildTools.toggleTool('road-depot') },
    { codes: ['KeyB'], key: 'B', label: 'Návěstidlo', run: () => buildTools.toggleTool('signal') },
    { codes: ['KeyX'], key: 'X', label: 'Demolice', run: () => buildTools.toggleTool('demolish') },
    { codes: ['KeyR'], key: 'R', label: 'Otočit nástupiště nebo depo', run: () => buildTools.rotate() },
    { codes: ['KeyI'], key: 'I', label: 'Informace o dlaždici („?“)', run: actions.toggleInfo },
    { codes: ['KeyF'], key: 'F', label: 'Finance', run: actions.openFinance },
    { codes: ['KeyV'], key: 'V', label: 'Seznam vlaků', run: actions.openTrainList },
    { codes: ['KeyA'], key: 'A', label: 'Seznam aut', run: actions.openVehicleList },
    { codes: ['KeyH'], key: 'H', label: 'Historie zpráv', run: actions.openNews },
    { codes: ['KeyM'], key: 'M', label: 'Minimapa', run: actions.openMinimap },
    { codes: ['KeyG'], key: 'G', label: 'Mřížka', run: () => grid.setVisible(!grid.visible()) },
    {
      codes: ['Escape'],
      key: 'Esc',
      label: 'Zrušit nástroj, jinak zavřít horní okno',
      run: () => (buildTools.tool ? buildTools.setTool(null) : windows.closeTop()),
    },
    { codes: ['Delete'], key: 'Delete', label: 'Zavřít všechna okna', run: () => windows.closeAll() },
  ]);

  game.events.on('outOfMoney', () => {
    windows.open(
      'out-of-money',
      'Došly peníze',
      h('p', {}, 'Výstavba byla zastavena, na další dílek nemáte dost peněz.'),
      { width: 300 },
    );
  });

  // Automatické uložení pro Pokračovat na úvodní obrazovce
  game.clock.events.on('month', () => writeAutosave(game, seedText));
  window.addEventListener('beforeunload', () => writeAutosave(game, seedText));
  writeAutosave(game, seedText);

  game.news(message);

  function tileAt(clientX: number, clientY: number): PointerTile | null {
    const p = isoCamera.groundPoint(clientX, clientY);
    if (!p) return null;
    const x = Math.floor(p.x);
    const y = Math.floor(p.z);
    return map.inBounds(x, y) ? { x, y, fx: p.x - x, fy: p.z - y } : null;
  }

  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', (e) => {
    const tile = tileAt(e.clientX, e.clientY);
    cursor.show(tile);
    if (buildTools.tool) buildTools.pointerMove(tile, e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerleave', () => cursor.show(null));

  let clickStart: { x: number; y: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (buildTools.tool) {
      canvas.setPointerCapture(e.pointerId);
      buildTools.pointerDown(tileAt(e.clientX, e.clientY));
      return;
    }
    clickStart = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    if (buildTools.tool) {
      buildTools.pointerUp();
      return;
    }
    if (!clickStart) return;
    const moved = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
    clickStart = null;
    if (moved > 4) return;
    const trainId = view.trainAt(e.clientX, e.clientY);
    const train = game.fleet.trains.find((t) => t.id === trainId);
    if (train) {
      openTrain(windows, game, train, links);
      return;
    }
    const vehicleId = view.vehicleAt(e.clientX, e.clientY);
    const vehicle = game.roadFleet.vehicles.find((v) => v.id === vehicleId);
    if (vehicle) {
      openRoadVehicle(windows, game, vehicle, vehicleLinks);
      return;
    }
    const tile = tileAt(e.clientX, e.clientY);
    if (!tile) return;
    const depot = world.rail.depotAt(tile.x, tile.y);
    if (depot) {
      links.openDepot(depot);
      return;
    }
    const roadDepot = world.rail.roadDepotAt(tile.x, tile.y);
    if (roadDepot) {
      links.openRoadDepot(roadDepot);
      return;
    }
    const industry = industryAt(world.industries, tile.x, tile.y);
    if (industry) {
      links.openIndustry(industry);
      return;
    }
    const station = world.rail.stationAt(tile.x, tile.y);
    if (station) {
      links.openStation(station);
      return;
    }
    const owner = map.getOwner(tile.x, tile.y);
    if (owner !== NO_OWNER) links.openTown(towns[owner]);
  });

  let lastFrame = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const dt = now - lastFrame;
    const [panX, panY] = shortcuts.panDirection();
    if (panX || panY) {
      const step = (KEY_PAN_SPEED * Math.min(dt, 100)) / 1000;
      isoCamera.pan(panX * step, panY * step);
    }
    view.frame(now, dt);
    lastFrame = now;
  });
}
