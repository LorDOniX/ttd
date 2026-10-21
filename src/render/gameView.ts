import * as THREE from 'three';
import type { Game } from '../game/game';
import { formatMoney } from '../game/game';
import { BuildingsView } from './buildings';
import { IsoCamera } from './camera';
import { IndustriesView } from './industries';
import { FloatingTexts, StationLabels, TownLabels } from './labels';
import { RailView } from './rail';
import { RoadView } from './roads';
import { SignalsView } from './signals';
import { TerrainView } from './terrain';
import { TrainsView } from './trains';
import { TreesView } from './trees';

// 3D scéna rozehrané hry: terén, města, koleje, vlaky a popisky, napojené na události hry
export class GameView {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera: IsoCamera;
  readonly terrain: TerrainView;
  private readonly labels: TownLabels;
  private readonly trains: TrainsView;
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
    const roads = new RoadView(map);
    const buildings = new BuildingsView();
    void buildings.rebuild(towns);
    const trees = new TreesView(map);
    void trees.refresh();
    const industries = new IndustriesView();
    void industries.build(world.industries);
    const railView = new RailView(world.rail);
    this.signals = new SignalsView(world.rail);
    this.signals.rebuild();
    this.trains = new TrainsView(game.fleet, map);
    this.labels = new TownLabels(container);
    this.labels.setSize(window.innerWidth, window.innerHeight);
    this.labels.rebuild(towns);
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
      this.labels.object,
      stationLabels.object,
      this.floatingTexts.object,
    );

    this.camera = new IsoCamera(
      this.renderer.domElement,
      new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(map.width, map.height)),
    );
    const biggest = [...towns].sort((a, b) => b.population - a.population)[0];
    if (biggest) this.camera.focus(biggest.x + 0.5, biggest.y + 0.5);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.labels.setSize(window.innerWidth, window.innerHeight);
      this.camera.resize();
    });

    const rebuildStationLabels = (): void =>
      stationLabels.rebuild(world.rail.stations, (s) => {
        const towns = game.passengers.townsInReach(s).length > 0;
        const mine = game.freight.industriesInReach(s, 'coal-mine').length > 0;
        const plant = game.freight.acceptsCoal(s);
        const parts = [s.name];
        if (towns) parts.push(`čeká ${Math.floor(s.waiting)}`);
        if (mine) parts.push(`uhlí ${Math.floor(s.coal)} t`);
        if (plant) parts.push('výkup uhlí');
        parts.push(towns || mine || plant ? `${Math.round(s.rating * 100)} %` : 'mimo dosah města a průmyslu');
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

  // Jeden snímek: posun hry o reálný čas dtMs a vykreslení
  frame(now: number, dtMs: number): void {
    this.game.update(dtMs);
    this.syncMap();
    this.trains.update();
    const { reservations } = this.game.fleet;
    this.signals.update((x, y) => reservations.ownerAt(x, y) !== undefined);
    this.floatingTexts.update(now);
    this.renderer.render(this.scene, this.camera.camera);
    this.labels.render(this.scene, this.camera.camera);
  }
}
