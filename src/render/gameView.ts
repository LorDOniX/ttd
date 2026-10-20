import * as THREE from 'three';
import type { Game } from '../game/game';
import { formatMoney } from '../game/game';
import { BuildingsView } from './buildings';
import { IsoCamera } from './camera';
import { FloatingTexts, StationLabels, TownLabels } from './labels';
import { RailView } from './rail';
import { RoadView } from './roads';
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
  private readonly floatingTexts = new FloatingTexts();

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
    const railView = new RailView(world.rail);
    this.trains = new TrainsView(game.fleet, map);
    this.labels = new TownLabels(container);
    this.labels.setSize(window.innerWidth, window.innerHeight);
    this.labels.rebuild(towns);
    const stationLabels = new StationLabels();
    scene.add(
      this.terrain.object,
      roads.object,
      buildings.object,
      trees.object,
      railView.object,
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
      stationLabels.rebuild(world.rail.stations, (s) => game.passengers.townsInReach(s).length > 0);
    rebuildStationLabels();

    // Stavba, růst měst i demolice může vykácet stromy
    for (const event of ['railChanged', 'roadsChanged', 'townsChanged', 'treesChanged'] as const) {
      game.events.on(event, () => {
        this.terrain.refresh();
        void trees.refresh();
      });
    }
    game.events.on('townsChanged', () => {
      roads.rebuild();
      void buildings.rebuild(towns);
      towns.forEach((town) => this.labels.update(town));
    });
    game.events.on('railChanged', () => {
      railView.rebuild();
      // Demolice přejezdu mění i vzhled silnice
      roads.rebuild();
      rebuildStationLabels();
    });
    game.events.on('stationsChanged', rebuildStationLabels);
    game.events.on('roadsChanged', () => roads.rebuild());
    game.events.on('income', (amount, x, z) =>
      this.floatingTexts.show(`+${formatMoney(amount)}`, x, z, 'income-label'),
    );
  }

  // Jeden snímek: posun hry o reálný čas dtMs a vykreslení
  frame(now: number, dtMs: number): void {
    this.game.update(dtMs);
    this.trains.update();
    this.floatingTexts.update(now);
    this.renderer.render(this.scene, this.camera.camera);
    this.labels.render(this.scene, this.camera.camera);
  }
}
