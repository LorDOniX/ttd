import type { Aircraft } from '../game/aircraft';
import type { Ship } from '../game/ships';
import { cityCarName, type CityCar } from '../game/cityTraffic';
import type { Game } from '../game/game';
import type { RoadVehicle } from '../game/roadVehicles';
import type { Train } from '../game/trains';
import { CabCamera, WalkCamera, nearestStandable, type CabPose, type DropMarker } from '../render/firstPerson';
import type { GameView } from '../render/gameView';
import { NO_OWNER, TileType, type TilePos } from '../world/map';
import { aircraftStateText } from './aircraft';
import { shipStateText } from './ships';
import { h } from './dom';
import { vehicleStateText } from './roadVehicles';
import { stateText } from './trainWindow';

// Žlutý panáček ve stylu street view
export const PEGMAN_SVG = `
<svg viewBox="0 0 24 40" aria-hidden="true">
  <g fill="#ffc928" stroke="#9a6d00" stroke-width="1.2" stroke-linejoin="round">
    <circle cx="12" cy="6" r="4.6"/>
    <path d="M6.2 13.5c0-1.6 1.3-2.9 2.9-2.9h5.8c1.6 0 2.9 1.3 2.9 2.9v9.3c0 1-.8 1.8-1.8 1.8h-.6V37a1.8 1.8 0 0 1-3.6 0v-9h-.6v9a1.8 1.8 0 0 1-3.6 0V24.6h-.6c-1 0-1.8-.8-1.8-1.8z"/>
    <path d="M6.2 14.2l-2.6 7.4a1.5 1.5 0 0 0 2.8 1l1.6-4.6zM17.8 14.2l2.6 7.4a1.5 1.5 0 0 1-2.8 1l-1.6-4.6z"/>
  </g>
</svg>`;

// Rám čelního skla a palubní deska kolem výhledu z kabiny (souřadnice v procentech obrazovky)
const CAB_FRAME_SVG = `
<svg class="fp-cab__frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="fp-dash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b3d42"/>
      <stop offset="1" stop-color="#16171a"/>
    </linearGradient>
  </defs>
  <path d="M0 0H100V3.5H0z" fill="#26282c"/>
  <path d="M0 0H8L3 78H0z" fill="#2c2e33"/>
  <path d="M100 0H92L97 78H100z" fill="#2c2e33"/>
  <path d="M0 80Q50 70 100 80V100H0z" fill="url(#fp-dash)"/>
</svg>`;

// Tachometr do 160 km/h, ručička se otáčí v rozsahu −120° až +120°
const GAUGE_MAX_KMH = 160;
const GAUGE_SVG = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="#101114" stroke="#5b5e66" stroke-width="3"/>
  <path d="M17.1 69A38 38 0 1 1 82.9 69" fill="none" stroke="#3a3d44" stroke-width="5"/>
  <path d="M71.6 18.9A38 38 0 0 1 82.9 69" fill="none" stroke="#b8442f" stroke-width="5"/>
  <line class="fp-gauge__needle" x1="50" y1="50" x2="50" y2="17" stroke="#ffb03a" stroke-width="3" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="5" fill="#ffb03a"/>
</svg>`;

// Růžice kompasu, S míří na sever (−y na mapě, nahoru na minimapě)
const COMPASS_SVG = `
<svg viewBox="0 0 60 60" aria-hidden="true">
  <circle cx="30" cy="30" r="28" fill="rgba(16,17,20,.65)" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>
  <path d="M30 6l6 24h-12z" fill="#e2483a"/>
  <path d="M30 54l6-24h-12z" fill="#e8e6df"/>
  <text x="30" y="5" fill="#fff" font-size="8" text-anchor="middle" dominant-baseline="hanging" font-weight="700">S</text>
</svg>`;

const TILE_NAMES: Partial<Record<TileType, string>> = {
  [TileType.Grass]: 'Louka',
  [TileType.Trees]: 'Les',
  [TileType.Road]: 'Silnice',
  [TileType.Rail]: 'Koleje',
  [TileType.Crossing]: 'Železniční přejezd',
  [TileType.Station]: 'Nástupiště',
  [TileType.RoadStop]: 'Zastávka',
  [TileType.RoadBridgeX]: 'Silniční most',
  [TileType.RoadBridgeY]: 'Silniční most',
  [TileType.Airport]: 'Letiště',
  [TileType.Port]: 'Přístav',
};

export interface FirstPersonHooks {
  // Přepnutí do pohledu z první osoby (skrytí HUD, vypnutí zkratek) a zpět
  enter: () => void;
  exit: () => void;
}

interface CabInfo {
  icon: string;
  title: string;
  status: () => string;
  // Vozidlo pořád existuje (neprodáno, nezmizelo); jinak se pohled zavře
  alive: () => boolean;
  pose: () => CabPose | null;
  parkedText: string;
}

// Pohled z kabiny vozidla a průzkum pěšky; překryvné UI s tlačítkem zpět do původní projekce
export class FirstPersonMode {
  private overlay: HTMLElement | null = null;
  private frame = 0;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    this.exit();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
    private readonly view: GameView,
    private readonly hooks: FirstPersonHooks,
  ) {}

  get active(): boolean {
    return this.overlay !== null;
  }

  rideTrain(train: Train): void {
    this.exit();
    this.ride({
      icon: '🚆',
      title: train.name,
      status: () => stateText(this.game, train),
      alive: () => this.game.fleet.trains.includes(train),
      pose: this.view.trainCab(train.id),
      parkedText: 'Vlak stojí v depu.',
    });
  }

  rideVehicle(vehicle: RoadVehicle): void {
    this.exit();
    this.ride({
      icon: '🚌',
      title: vehicle.name,
      status: () => vehicleStateText(this.game, vehicle),
      alive: () => this.game.roadFleet.vehicles.includes(vehicle),
      pose: this.view.vehicleCab(`player:${vehicle.id}`),
      parkedText: 'Auto stojí v garáži.',
    });
  }

  rideAircraft(plane: Aircraft): void {
    this.exit();
    this.ride({
      icon: '✈️',
      title: plane.name,
      status: () => aircraftStateText(this.game, plane),
      alive: () => this.game.airFleet.aircraft.includes(plane),
      pose: this.view.aircraftCab(plane.id),
      parkedText: 'Letadlo stojí v hangáru.',
    });
  }

  rideShip(ship: Ship): void {
    this.exit();
    this.ride({
      icon: '🚢',
      title: ship.name,
      status: () => shipStateText(this.game, ship),
      alive: () => this.game.shipFleet.ships.includes(ship),
      pose: this.view.shipCab(ship.id),
      parkedText: 'Loď stojí v loděnici.',
    });
  }

  rideCityCar(car: CityCar): void {
    this.exit();
    const town = this.game.world.towns[car.townId]?.name ?? '';
    this.ride({
      icon: '🚗',
      title: cityCarName(car.model),
      status: () => (town ? `Městský provoz: ${town}` : 'Městský provoz'),
      alive: () => this.view.cityCar(car.id) === car,
      pose: this.view.vehicleCab(`city:${car.id}`),
      parkedText: '',
    });
  }

  // Chodec na dlaždici (x, y); yaw je směr pohledu, jinak vyhledá nejbližší volné místo
  walk(tile: TilePos, yaw: number): boolean {
    const { map, towns } = this.game.world;
    const spot = nearestStandable(map, tile.x, tile.y);
    if (!spot) return false;
    this.exit();
    const walker = new WalkCamera(map, spot.x + 0.5, spot.y + 0.5, yaw);
    const place = h('div', { className: 'fp-walk__place' });
    const compass = h('div', { className: 'fp-walk__compass', title: 'Kompas' });
    compass.innerHTML = COMPASS_SVG;
    const close = h('button', { className: 'fp-button', title: 'Zpět do mapy (Esc)' }, '✕ Zavřít');
    close.addEventListener('click', () => this.exit());
    const overlay = h(
      'div',
      { className: 'fp-overlay fp-walk' },
      h(
        'div',
        { className: 'fp-bar' },
        h('div', { className: 'fp-bar__title' }, h('span', { className: 'fp-walk__pegman' }), 'Průzkum pěšky'),
        place,
        close,
      ),
      compass,
      h('div', { className: 'fp-crosshair' }),
      h(
        'div',
        { className: 'fp-hint' },
        h('kbd', {}, 'W'),
        h('kbd', {}, 'A'),
        h('kbd', {}, 'S'),
        h('kbd', {}, 'D'),
        ' nebo šipky chůze · ',
        h('kbd', {}, 'Shift'),
        ' běh · tažení myší rozhlížení · ',
        h('kbd', {}, 'Esc'),
        ' zpět',
      ),
    );
    overlay.querySelector('.fp-walk__pegman')!.innerHTML = PEGMAN_SVG;
    const rose = compass.querySelector('svg')!;
    let lastTile = -1;
    this.open(overlay, walker, () => {
      // Sever je −y: úhel od směru pohledu po směru hodinových ručiček
      const angle = Math.atan2(-Math.sin(walker.heading), -Math.cos(walker.heading));
      rose.style.transform = `rotate(${angle}rad)`;
      const tx = Math.floor(walker.position.x);
      const ty = Math.floor(walker.position.y);
      if (ty * map.width + tx === lastTile || !map.inBounds(tx, ty)) return;
      lastTile = ty * map.width + tx;
      const owner = map.getOwner(tx, ty);
      const station = this.game.world.rail.stationAt(tx, ty);
      const kind = station ? station.name : (TILE_NAMES[map.get(tx, ty)] ?? '');
      const where = owner !== NO_OWNER ? towns[owner]?.name : 'Volná krajina';
      place.textContent = [where, kind].filter(Boolean).join(' · ');
    });
    return true;
  }

  exit(): void {
    if (!this.overlay) return;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay.remove();
    this.overlay = null;
    this.view.setFirstPerson(null);
    this.hooks.exit();
  }

  private ride(info: CabInfo): void {
    const cab = new CabCamera(info.pose);
    const needle = h('div', { className: 'fp-gauge' });
    needle.innerHTML = GAUGE_SVG;
    const speed = h('div', { className: 'fp-dash__speed' });
    const status = h('div', { className: 'fp-dash__status' });
    const back = h('button', { className: 'fp-button', title: 'Zpět do mapy (Esc)' }, '← Zpět');
    back.addEventListener('click', () => this.exit());
    const overlay = h(
      'div',
      { className: 'fp-overlay fp-cab' },
      h('div', { className: 'fp-cab__frame-wrap' }),
      h('div', { className: 'fp-bar' }, h('div', { className: 'fp-bar__title' }, `${info.icon} ${info.title}`), back),
      h('div', { className: 'fp-dash' }, needle, h('div', { className: 'fp-dash__text' }, speed, status)),
      h(
        'div',
        { className: 'fp-hint' },
        'Tažení myší rozhlížení · dvojklik pohled vpřed · ',
        h('kbd', {}, 'Esc'),
        ' zpět',
      ),
    );
    overlay.querySelector('.fp-cab__frame-wrap')!.innerHTML = CAB_FRAME_SVG;
    overlay.addEventListener('dblclick', () => cab.resetLook());
    const line = needle.querySelector<SVGLineElement>('.fp-gauge__needle')!;
    let lastText = 0;
    this.open(overlay, cab, (now) => {
      if (!info.alive()) {
        this.exit();
        return;
      }
      const kmh = Math.min(cab.speedKmh, GAUGE_MAX_KMH);
      line.style.transform = `rotate(${-120 + (kmh / GAUGE_MAX_KMH) * 240}deg)`;
      // Text stačí obnovit pár krát za sekundu
      if (now - lastText < 200) return;
      lastText = now;
      speed.textContent = `${Math.round(cab.speedKmh)} km/h`;
      status.textContent = cab.parked && info.parkedText ? info.parkedText : info.status();
    });
  }

  private open(overlay: HTMLElement, controller: CabCamera | WalkCamera, tick: (now: number) => void): void {
    // Volající už předchozí pohled zavřel (ride*, walk), aby nezrušil právě skrytou kabinu
    this.hooks.enter();
    this.overlay = overlay;
    this.bindLook(overlay, controller);
    this.root.append(overlay);
    this.view.setFirstPerson(controller);
    window.addEventListener('keydown', this.onKey, true);
    const loop = (now: number): void => {
      if (this.overlay !== overlay) return;
      tick(now);
      if (this.overlay === overlay) this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  // Tažení myší (levým i pravým tlačítkem) otáčí pohledem
  private bindLook(overlay: HTMLElement, controller: CabCamera | WalkCamera): void {
    let last: { x: number; y: number } | null = null;
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    overlay.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      overlay.setPointerCapture(e.pointerId);
      overlay.classList.add('fp-overlay--dragging');
      last = { x: e.clientX, y: e.clientY };
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!last) return;
      controller.look(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    });
    const end = (e: PointerEvent): void => {
      last = null;
      overlay.classList.remove('fp-overlay--dragging');
      if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId);
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
  }
}

export interface PegmanDockOptions {
  // Dlaždice pod bodem obrazovky
  tileAt: (clientX: number, clientY: number) => TilePos | null;
  // Dlaždice uprostřed obrazovky, když se na panáčka jen klikne
  centerTile: () => TilePos | null;
  marker: DropMarker;
  game: Game;
  // Položení panáčka na dlaždici, kam smí
  drop: (tile: TilePos) => void;
  // Panáček puštěný na mapu tam, kde v okolí není kam se postavit (širá voda)
  reject: () => void;
}

// Kam panáček z dlaždice opravdu dopadne: na ni, nebo na nejbližší volné místo (budova, voda u břehu)
function landing(game: Game, tile: TilePos | null): TilePos | null {
  return tile ? nearestStandable(game.world.map, tile.x, tile.y) : null;
}

// Panáček v rohu obrazovky: přetažením na mapu se přepne do průzkumu pěšky na dané dlaždici
export function createPegmanDock(root: HTMLElement, options: PegmanDockOptions): HTMLElement {
  const button = h('button', {
    className: 'pegman-dock',
    title: 'Průzkum pěšky: přetáhněte panáčka na mapu (kliknutím doprostřed obrazovky)',
  });
  button.innerHTML = PEGMAN_SVG;
  let start: { x: number; y: number } | null = null;
  let ghost: HTMLElement | null = null;
  let target: TilePos | null = null;
  // Dlaždice pod kurzorem (i když se na ni nedá postavit)
  let hovered: TilePos | null = null;

  const cleanup = (): void => {
    hovered = null;
    start = null;
    target = null;
    ghost?.remove();
    ghost = null;
    button.classList.remove('pegman-dock--empty');
    document.body.classList.remove('pegman-dragging');
    options.marker.show(null);
  };

  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
  });
  button.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      ghost = h('div', { className: 'pegman-ghost' });
      ghost.innerHTML = PEGMAN_SVG;
      root.append(ghost);
      button.classList.add('pegman-dock--empty');
      document.body.classList.add('pegman-dragging');
    }
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    // Nad lištou nebo dockem se nepokládá
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const onMap = over instanceof HTMLCanvasElement || !!over?.closest('.label-layer');
    const tile = onMap ? options.tileAt(e.clientX, e.clientY) : null;
    hovered = tile;
    target = landing(options.game, tile);
    ghost.classList.toggle('pegman-ghost--invalid', tile !== null && target === null);
    // Žlutě místo, kam panáček opravdu dopadne (u vody nejbližší břeh), červeně dlaždice, kam nemůže
    options.marker.show(target ?? tile, target !== null);
  });
  button.addEventListener('pointerup', () => {
    if (!start) return;
    const dragged = ghost !== null;
    const tile = dragged ? target : options.centerTile();
    const rejected = dragged && hovered !== null && target === null;
    cleanup();
    if (tile) options.drop(tile);
    else if (rejected) options.reject();
  });
  // Prohlížeč může tažení ukončit i bez pointerup (ztráta zachycení, přepnutí okna): panáček nesmí zůstat viset
  button.addEventListener('pointercancel', cleanup);
  button.addEventListener('lostpointercapture', () => {
    if (start) cleanup();
  });
  window.addEventListener('blur', () => {
    if (start) cleanup();
  });
  window.addEventListener('keydown', (e) => {
    if (start && e.code === 'Escape') cleanup();
  });
  root.append(button);
  return button;
}
