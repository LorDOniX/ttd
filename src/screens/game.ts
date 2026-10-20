import { START_YEAR, formatDate } from '../game/clock';
import { Game } from '../game/game';
import { launch, returnToTitle, writeAutosave, type LaunchIntent, type NewGameOptions } from '../game/launch';
import { parseSave, restoreGame } from '../game/save';
import { TileCursor } from '../render/cursor';
import { GameView } from '../render/gameView';
import { BuildPreview } from '../render/preview';
import { BuildTools } from '../ui/buildTools';
import { openDepot } from '../ui/depot';
import { openFinance, openSaveLoad, openSettings, openTown } from '../ui/dialogs';
import { h } from '../ui/dom';
import { Hud } from '../ui/hud';
import { WindowManager } from '../ui/windows';
import { generateWorld } from '../world/generator';
import { NO_OWNER, type TilePos } from '../world/map';
import { hashSeed } from '../world/rng';

const WATER_LEVELS = { low: 0.28, normal: 0.34, high: 0.42 } as const;
const TOWN_DENSITY = { few: 0.6, normal: 1, many: 1.5 } as const;

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
  new Hud(container, game, {
    openSaveLoad: () =>
      openSaveLoad(windows, game, seedText, {
        load: (save) => launch({ mode: 'load', save }),
        toTitle: () => {
          writeAutosave(game, seedText);
          returnToTitle();
        },
      }),
    openSettings: () => openSettings(windows, game, grid, seedText),
    openFinance: () => openFinance(windows, game),
    openRailBuild: () => buildTools.openRailWindow(),
    openRoadBuild: () => buildTools.openRoadWindow(),
    rotateView: (direction) => isoCamera.rotate(direction),
  });

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

  function tileAt(clientX: number, clientY: number): TilePos | null {
    const p = isoCamera.groundPoint(clientX, clientY);
    if (!p) return null;
    const x = Math.floor(p.x);
    const y = Math.floor(p.z);
    return map.inBounds(x, y) ? { x, y } : null;
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
    const tile = tileAt(e.clientX, e.clientY);
    if (!tile) return;
    const depot = world.rail.depotAt(tile.x, tile.y);
    const focus = (x: number, z: number): void => isoCamera.focus(x, z);
    if (depot) {
      openDepot(windows, game, depot, focus);
      return;
    }
    const owner = map.getOwner(tile.x, tile.y);
    if (owner !== NO_OWNER) openTown(windows, game, towns[owner], focus);
  });

  let lastFrame = performance.now();
  renderer.setAnimationLoop((now: number) => {
    view.frame(now, now - lastFrame);
    lastFrame = now;
  });
}
