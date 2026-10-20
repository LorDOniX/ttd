import { TRAIN_MODELS } from '../game/balance';
import { START_YEAR } from '../game/clock';
import { Game } from '../game/game';
import { describeSave, launch, readAutosave, type NewGameOptions, type TownAmount, type WaterAmount } from '../game/launch';
import { parseSave } from '../game/save';
import { GameView } from '../render/gameView';
import { createLoadButton } from '../ui/dialogs';
import { h } from '../ui/dom';
import { generateWorld } from '../world/generator';
import { Edge, defaultStationShape, type Station } from '../world/rail';
import { findTrackPath } from '../world/railPath';
import { hashSeed } from '../world/rng';
import type { Town } from '../world/town';
import { DEFAULT_OPTIONS } from './game';

// Ukázka na pozadí běží rychleji, aby bylo co sledovat
const DEMO_SPEED = 3;
const SPIN_PER_SECOND = 0.05;
const DEMO_LINES = 3;

function placeStationNear(game: Game, town: Town): Station | null {
  const { rail } = game.world;
  for (let r = town.radius; r < town.radius + 12; r++) {
    for (let a = 0; a < 64; a++) {
      const x = Math.round(town.x + Math.cos((a / 64) * Math.PI * 2) * r);
      const y = Math.round(town.y + Math.sin((a / 64) * Math.PI * 2) * r);
      // Místo pro depo za západním koncem nástupiště
      const shape = defaultStationShape(x, y, 'x');
      if (!rail.canPlaceStation(shape) || !rail.canPlaceDepot(x - 2, y)) continue;
      const station = rail.addStation({ ...shape, name: town.name, townId: town.id });
      if (game.passengers.townsInReach(station).includes(town)) return station;
      rail.removeStation(station);
    }
  }
  return null;
}

// Trať mezi dvěma městy s depem a vypraveným vlakem
function buildDemoLine(game: Game, from: Town, to: Town, modelIndex: number): boolean {
  const { rail } = game.world;
  const a = placeStationNear(game, from);
  const b = a && placeStationNear(game, to);
  const path = a && b && findTrackPath(rail, { x: a.x + 1, y: a.y }, { x: b.x, y: b.y });
  if (!a || !b || !path) return false;
  for (const step of path) rail.addPiece(step.x, step.y, step.piece);
  const depot = rail.addDepot(a.x - 2, a.y, Edge.E);
  game.fleet.buy(depot, TRAIN_MODELS[modelIndex % TRAIN_MODELS.length]);
  const train = game.fleet.trains[game.fleet.trains.length - 1];
  for (let i = 0; i < 3; i++) game.fleet.addWagon(train);
  return game.fleet.start(train, [a.id, b.id]) === null;
}

function createDemo(): Game {
  const game = new Game(generateWorld(hashSeed('ttd-title'), 128, START_YEAR, { waterLevel: 0.3, townDensity: 2.5 }));
  game.money = 1e9;
  const towns = [...game.world.towns].sort((a, b) => b.population - a.population);
  const used = new Set<Town>();
  let lines = 0;
  for (const from of towns) {
    if (lines >= DEMO_LINES || used.has(from)) continue;
    const to = towns
      .filter((t) => t !== from && !used.has(t))
      .sort((p, q) => Math.hypot(p.x - from.x, p.y - from.y) - Math.hypot(q.x - from.x, q.y - from.y))[0];
    if (!to || !buildDemoLine(game, from, to, lines * 3)) continue;
    used.add(from).add(to);
    lines++;
  }
  return game;
}

function select<T extends string>(options: [T, string][], value: T): HTMLSelectElement {
  const el = h('select', {});
  for (const [v, label] of options) el.append(h('option', { value: v, selected: v === value }, label));
  return el;
}

function menuButton(label: string, hint: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { className: 'title__button' }, h('span', {}, label), h('small', {}, hint));
  b.addEventListener('click', onClick);
  return b;
}

function newGamePanel(back: () => void): HTMLElement {
  const seed = h('input', { type: 'text', value: String(Math.floor(Math.random() * 100000)), maxLength: 30 });
  const size = select<'128' | '256' | '512'>(
    [
      ['128', '128 × 128 (malá)'],
      ['256', '256 × 256 (střední)'],
      ['512', '512 × 512 (velká)'],
    ],
    String(DEFAULT_OPTIONS.size) as '256',
  );
  const water = select<WaterAmount>(
    [
      ['low', 'Málo'],
      ['normal', 'Středně'],
      ['high', 'Hodně'],
    ],
    DEFAULT_OPTIONS.water,
  );
  const towns = select<TownAmount>(
    [
      ['few', 'Málo'],
      ['normal', 'Středně'],
      ['many', 'Hodně'],
    ],
    DEFAULT_OPTIONS.towns,
  );
  const start = menuButton('Začít', '', () => {
    const options: NewGameOptions = {
      seedText: seed.value.trim() || String(Date.now()),
      size: Number(size.value) as NewGameOptions['size'],
      water: water.value as WaterAmount,
      towns: towns.value as TownAmount,
    };
    launch({ mode: 'new', options });
  });
  const cancel = menuButton('Zpět', '', back);
  const field = (label: string, input: HTMLElement): HTMLElement => h('label', { className: 'form__field' }, label, input);
  return h(
    'div',
    { className: 'form' },
    h('h2', {}, 'Nová hra'),
    field('Seed mapy', seed),
    field('Velikost mapy', size),
    field('Voda', water),
    field('Města a vesnice', towns),
    start,
    cancel,
  );
}

function mainPanel(showNewGame: () => void): HTMLElement {
  const status = h('div', { className: 'form__hint' });
  const items: HTMLElement[] = [];

  const autosave = readAutosave();
  if (autosave) {
    try {
      const description = describeSave(parseSave(autosave));
      items.push(menuButton('Pokračovat', description, () => launch({ mode: 'load', save: autosave })));
    } catch {
      // Nečitelné automatické uložení se nenabízí
    }
  }
  items.push(menuButton('Nová hra', 'seed, velikost, voda, města', showNewGame));
  items.push(createLoadButton((save) => launch({ mode: 'load', save }), status, null));
  return h('div', { className: 'form' }, ...items, status);
}

export function runTitle(container: HTMLElement): void {
  const game = createDemo();
  const view = new GameView(container, game);
  view.terrain.setGridVisible(false);
  // Těžiště nástupišť, aby byly vidět tratě a vlaky; přiblížení skryje okraj mapy
  view.camera.camera.zoom = 1.2;
  view.camera.camera.updateProjectionMatrix();
  const { map, rail } = game.world;
  const count = Math.max(1, rail.stations.length);
  const cx = rail.stations.reduce((sum, s) => sum + s.x, 0) / count || map.width / 2;
  const cy = rail.stations.reduce((sum, s) => sum + s.y, 0) / count || map.height / 2;
  view.camera.focus(cx, cy);

  const panel = h('div', { className: 'title__panel' });
  const showMain = (): void => panel.replaceChildren(mainPanel(() => panel.replaceChildren(newGamePanel(showMain))));
  showMain();
  container.append(
    h(
      'div',
      { className: 'title' },
      h('h1', { className: 'title__heading' }, 'Transport Tycoon'),
      h('div', { className: 'title__subtitle' }, `Česká železnice ${START_YEAR}–2050`),
      panel,
    ),
  );

  let lastFrame = performance.now();
  view.renderer.setAnimationLoop((now: number) => {
    const dt = now - lastFrame;
    lastFrame = now;
    view.camera.spin((SPIN_PER_SECOND * dt) / 1000);
    view.frame(now, dt * DEMO_SPEED);
  });
}
