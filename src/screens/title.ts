import { TRAIN_MODELS, type TrainModel } from '../game/balance';
import { START_YEAR } from '../game/clock';
import { Game } from '../game/game';
import {
  describeSave,
  launch,
  readAutosave,
  type IndustryAmount,
  type NewGameOptions,
  type TownAmount,
  type WaterAmount,
} from '../game/launch';
import { parseSave } from '../game/save';
import { GameView } from '../render/gameView';
import { createLoadButton } from '../ui/dialogs';
import { h, isDevHost } from '../ui/dom';
import { generateWorld } from '../world/generator';
import { Edge, defaultStationShape, type Station } from '../world/rail';
import { findTrackPath } from '../world/railPath';
import { hashSeed } from '../world/rng';
import { growTown, type Town } from '../world/town';
import { DEFAULT_OPTIONS } from './game';

// Ukázka na pozadí běží rychleji, aby bylo co sledovat
const DEMO_SPEED = 3;
const SPIN_PER_SECOND = 0.05;
const DEMO_LINES = 3;
// Ukázka v pozdějším roce: města mají za sebou desítky let růstu a v centru mrakodrapy
const DEMO_YEAR = 2025;
const DEMO_SIZE = 128;
// Přiblížení ukázky; když by i tak byl vidět okraj mapy (široké okno), přiblíží se víc
const DEMO_ZOOM = 1.6;

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
function buildDemoLine(game: Game, from: Town, to: Town, model: TrainModel): boolean {
  const { rail } = game.world;
  const a = placeStationNear(game, from);
  const b = a && placeStationNear(game, to);
  const path = a && b && findTrackPath(rail, { x: a.x + 1, y: a.y }, { x: b.x, y: b.y });
  if (!a || !b || !path) return false;
  for (const step of path) rail.addPiece(step.x, step.y, step.piece);
  const depot = rail.addDepot(a.x - 2, a.y, Edge.E);
  game.fleet.buy(depot, model);
  const train = game.fleet.trains[game.fleet.trains.length - 1];
  for (let i = 0; i < 3; i++) game.fleet.addWagon(train);
  return game.fleet.start(train, [a.id, b.id]) === null;
}

function createDemo(): Game {
  // Brno uprostřed mapy, aby kolem něj při otáčení nebyl vidět okraj
  const center = { x: DEMO_SIZE / 2, y: DEMO_SIZE / 2 };
  const game = new Game(
    generateWorld(hashSeed('ttd-title'), DEMO_SIZE, START_YEAR, {
      waterLevel: 0.3,
      townDensity: 2.5,
      firstTownAt: center,
    }),
  );
  game.money = 1e9;
  const { map } = game.world;
  for (let year = START_YEAR + 1; year <= DEMO_YEAR; year++) {
    for (const town of game.world.towns) growTown(map, town, year, game.rng);
  }
  game.clock.date = { year: DEMO_YEAR, month: 0, day: 1 };
  // Od nejnovějších vlaků, které v roce ukázky jezdí
  const models = TRAIN_MODELS.filter((m) => m.year <= DEMO_YEAR).reverse();
  // Brno (uprostřed mapy) dostane trať jako první, ostatní podle velikosti
  const towns = [...game.world.towns].sort(
    (a, b) => Number(b.name === 'Brno') - Number(a.name === 'Brno') || b.population - a.population,
  );
  const used = new Set<Town>();
  let lines = 0;
  for (const from of towns) {
    if (lines >= DEMO_LINES || used.has(from)) continue;
    const to = towns
      .filter((t) => t !== from && !used.has(t))
      .sort((p, q) => Math.hypot(p.x - from.x, p.y - from.y) - Math.hypot(q.x - from.x, q.y - from.y))[0];
    if (!to || !buildDemoLine(game, from, to, models[(lines * 2) % models.length])) continue;
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

// Odkaz na podstránku hry (s base, na serveru /ttd/…)
function menuLink(label: string, hint: string, path: string): HTMLAnchorElement {
  return h(
    'a',
    { className: 'title__button', href: `${import.meta.env.BASE_URL}${path}` },
    h('span', {}, label),
    h('small', {}, hint),
  );
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
  const industries = select<IndustryAmount>(
    [
      ['few', 'Málo'],
      ['normal', 'Středně'],
      ['many', 'Hodně'],
    ],
    DEFAULT_OPTIONS.industries,
  );
  const start = menuButton('Začít', '', () => {
    const options: NewGameOptions = {
      seedText: seed.value.trim() || String(Date.now()),
      size: Number(size.value) as NewGameOptions['size'],
      water: water.value as WaterAmount,
      towns: towns.value as TownAmount,
      industries: industries.value as IndustryAmount,
    };
    launch({ mode: 'new', options });
  });
  const cancel = menuButton('Zpět', '', back);
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h('label', { className: 'form__field' }, label, input);
  return h(
    'div',
    { className: 'form' },
    h('h2', {}, 'Nová hra'),
    field('Seed mapy', seed),
    field('Velikost mapy', size),
    field('Voda', water),
    field('Města a vesnice', towns),
    field('Průmysl', industries),
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
  items.push(menuButton('Nová hra', 'seed, velikost, voda, města, průmysl', showNewGame));
  items.push(createLoadButton((save) => launch({ mode: 'load', save }), status, null));
  // Pomocné stránky jen při vývoji; na serveru zůstávají dostupné jen přímou adresou
  if (isDevHost()) {
    items.push(
      h('div', { className: 'title__section' }, 'Vývoj'),
      menuLink('Modely assetů', 'všechny GLB ze složky assets', 'all-models'),
      menuLink('Modely použité ve hře', 'vozidla, letiště, export GLB', 'game-assets'),
    );
  }
  return h('div', { className: 'form' }, ...items, status);
}

export function runTitle(container: HTMLElement): void {
  const game = createDemo();
  const view = new GameView(container, game);
  view.setSeasonMode('summer');
  view.terrain.setGridVisible(false);
  view.setLabelsInteractive(false);
  // Ukázka se jen otáčí: bez zoomu, posunu a otáčení myší
  view.camera.interactive = false;
  // Mezi centrum Brna a jeho nádraží, aby bylo vidět město i vlaky
  const { map, rail, towns } = game.world;
  const brno = towns.find((town) => town.name === 'Brno');
  const station = brno && rail.stations.find((candidate) => candidate.townId === brno.id);
  const focus = brno
    ? station
      ? { x: (brno.x + station.x) / 2, y: (brno.y + station.y) / 2 }
      : { x: brno.x + 0.5, y: brno.y + 0.5 }
    : { x: map.width / 2, y: map.height / 2 };
  // Střed pohledu tak daleko od okraje, kam kamera v jakémkoli natočení dohlédne
  const fitView = (): void => {
    const camera = view.camera.camera;
    camera.zoom = DEMO_ZOOM;
    camera.updateProjectionMatrix();
    const limit = Math.min(map.width, map.height) / 2 - 1;
    const radius = view.camera.visibleRadius();
    if (radius > limit) {
      camera.zoom *= radius / limit;
      camera.updateProjectionMatrix();
    }
    const margin = Math.min(limit, radius) + 1;
    const clamp = (value: number, size: number): number =>
      Math.min(Math.max(value, margin), Math.max(margin, size - margin));
    view.camera.focus(clamp(focus.x, map.width), clamp(focus.y, map.height));
  };
  fitView();
  window.addEventListener('resize', fitView);

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
    view.frame(now, dt * DEMO_SPEED, dt);
  });
}
