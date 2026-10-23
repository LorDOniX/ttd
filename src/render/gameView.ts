import * as THREE from 'three';
import { CARGOS, type Cargo } from '../game/cargo';
import type { Game } from '../game/game';
import { formatMoney } from '../game/game';
import { BuildingsView } from './buildings';
import { IsoCamera } from './camera';
import { CrossingsView } from './crossings';
import { IndustriesView } from './industries';
import { FloatingTexts, StationLabels, TownLabels } from './labels';
import { PedestriansView } from './pedestrians';
import { RailView } from './rail';
import { RoadVehiclesView } from './roadVehicles';
import { RoadView } from './roads';
import { SignalsView } from './signals';
import { TerrainView } from './terrain';
import { TrainsView } from './trains';
import { TreesView } from './trees';

// Klikatelný popisek ve scéně: město, nástupiště nebo závod
export interface LabelTarget {
  kind: 'town' | 'station' | 'industry';
  id: number;
  // Poloha popisku na obrazovce, nad ní se otevře okno
  rect: DOMRect;
}

// 3D scéna rozehrané hry: terén, města, koleje, vlaky a popisky, napojené na události hry
export class GameView {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera: IsoCamera;
  readonly terrain: TerrainView;
  onLabelClick: (target: LabelTarget) => void = () => {};
  private readonly labels: TownLabels;
  private readonly trains: TrainsView;
  private readonly vehicles: RoadVehiclesView;
  private readonly pedestrians: PedestriansView;
  private readonly crossings: CrossingsView;
  private readonly signals: SignalsView;
  private readonly floatingTexts = new FloatingTexts();
  private readonly syncMap: () => void;
  private railDirty = false;

  constructor(
    container: HTMLElement,
    private readonly game: Game,
  ) {
    const { world } = game;
    const { map, towns } = world;

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    const scene = this.scene;
    scene.background = new THREE.Color(0x87b5d8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 5);
    scene.add(sun);

    this.terrain = new TerrainView(map, towns);
    const roads = new RoadView(map, world.rail);
    const buildings = new BuildingsView();
    void buildings.rebuild(towns);
    const trees = new TreesView(map);
    void trees.refresh();
    const industries = new IndustriesView();
    void industries.sync(world.industries);
    const railView = new RailView(world.rail);
    this.signals = new SignalsView(world.rail);
    this.signals.rebuild();
    this.trains = new TrainsView(game.fleet, map);
    this.vehicles = new RoadVehiclesView(game.roadFleet);
    this.pedestrians = new PedestriansView(map, world.rail, towns, roads);
    this.crossings = new CrossingsView(map, world.rail);
    this.labels = new TownLabels(container);
    this.labels.setSize(window.innerWidth, window.innerHeight);
    this.labels.rebuild(towns);
    this.bindLabelEvents();
    const stationLabels = new StationLabels();
    scene.add(
      this.terrain.object,
      roads.object,
      buildings.object,
      industries.object,
      trees.object,
      railView.object,
      this.signals.object,
      this.trains.object,
      this.vehicles.object,
      this.pedestrians.object,
      this.crossings.object,
      this.labels.object,
      stationLabels.object,
      this.floatingTexts.object,
    );

    this.camera = new IsoCamera(
      this.renderer.domElement,
      new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(map.width, map.height)),
    );
    const biggest = [...towns].sort((a, b) => b.population - a.population)[0];
    if (game.view) this.camera.restore(game.view);
    else if (biggest) this.camera.focus(biggest.x + 0.5, biggest.y + 0.5);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.labels.setSize(window.innerWidth, window.innerHeight);
      this.camera.resize();
    });

    const rebuildStationLabels = (): void =>
      stationLabels.rebuild(world.rail.stations, (s) => {
        const towns = game.passengers.townsInReach(s).length > 0;
        const produced = game.freight.produced(s);
        const accepted = game.freight.accepted(s);
        const parts = [s.name];
        const rated = (text: string, cargo: Cargo): string =>
          `${text} (${Math.round(s.ratings[cargo].rating * 100)} %)`;
        if (towns) parts.push(rated(`čeká ${Math.floor(s.waiting)}`, 'passengers'));
        if (s.freight.mail >= 1) parts.push(rated(`pošta ${Math.floor(s.freight.mail)} t`, 'mail'));
        for (const type of produced) parts.push(rated(`${CARGOS[type].noun} ${Math.floor(s.freight[type])} t`, type));
        if (accepted.length > 0) parts.push(`výkup ${accepted.map((t) => CARGOS[t].genitive).join(', ')}`);
        if (!towns && produced.length === 0 && accepted.length === 0) parts.push('mimo dosah města a průmyslu');
        return parts.join(' · ');
      });
    rebuildStationLabels();

    // Terén, silnice a stromy čtou změny mapy samy jednou za snímek; koleje se přestaví nejvýš jednou za snímek
    this.syncMap = () => {
      this.terrain.sync();
      roads.sync();
      trees.sync();
      if (this.railDirty) {
        this.railDirty = false;
        railView.rebuild();
        this.signals.rebuild();
        rebuildStationLabels();
      }
    };
    game.events.on('townsChanged', () => {
      void buildings.rebuild(towns);
      towns.forEach((town) => this.labels.update(town));
    });
    game.events.on('railChanged', () => (this.railDirty = true));
    game.events.on('stationsChanged', rebuildStationLabels);
    game.events.on('industriesChanged', () => void industries.sync(world.industries));
    game.events.on('income', (amount, x, z) =>
      this.floatingTexts.show(`+${formatMoney(amount)}`, x, z, 'income-label'),
    );
    game.events.on('demolished', (amount, x, z) =>
      amount > 0
        ? this.floatingTexts.show(`+${formatMoney(amount)}`, x, z, 'income-label')
        : this.floatingTexts.show(`−${formatMoney(-amount)}`, x, z, 'expense-label'),
    );
  }

  // Id vlaku pod kurzorem
  trainAt(clientX: number, clientY: number): number | null {
    return this.trains.pick(this.camera.ray(clientX, clientY));
  }

  // Id auta pod kurzorem
  vehicleAt(clientX: number, clientY: number): number | null {
    return this.vehicles.pick(this.camera.ray(clientX, clientY));
  }

  // Se stavebním nástrojem popisky kliknutí nechytá, aby šlo stavět i pod nimi
  setLabelsInteractive(interactive: boolean): void {
    this.labels.renderer.domElement.classList.toggle('label-layer--passive', !interactive);
  }

  private bindLabelEvents(): void {
    const layer = this.labels.renderer.domElement;
    const canvas = this.renderer.domElement;
    layer.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
      if (el)
        this.onLabelClick({
          kind: el.dataset.kind as LabelTarget['kind'],
          id: Number(el.dataset.id),
          rect: el.getBoundingClientRect(),
        });
    });
    // Kolečko a posun pravým tlačítkem nad popiskem patří kameře
    layer.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        canvas.dispatchEvent(new WheelEvent('wheel', e));
      },
      { passive: false },
    );
    layer.addEventListener('pointerdown', (e) => {
      if (e.button === 2) canvas.dispatchEvent(new PointerEvent('pointerdown', e));
    });
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Jeden snímek: posun hry o reálný čas dtMs a vykreslení
  frame(now: number, dtMs: number): void {
    this.game.update(dtMs);
    this.syncMap();
    const frustum = this.camera.frustum();
    this.trains.update(frustum);
    this.vehicles.update(frustum);
    // Chodci chodí v reálném čase nezávisle na rychlosti hry, při pauze stojí
    this.pedestrians.update(this.game.clock.paused ? 0 : Math.min(dtMs, 100) / 1000, frustum);
    const { reservations } = this.game.fleet;
    this.signals.update((x, y) => reservations.ownerAt(x, y) !== undefined);
    this.crossings.update(now, (x, y) => reservations.ownerAt(x, y) !== undefined);
    this.floatingTexts.update(now);
    this.renderer.render(this.scene, this.camera.camera);
    this.labels.render(this.scene, this.camera.camera);
    // Pohled se ukládá s hrou
    this.game.view = this.camera.view;
  }
}
