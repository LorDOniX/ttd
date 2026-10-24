import * as THREE from 'three';
import { CARGOS, type Cargo } from '../game/cargo';
import { CityTraffic } from '../game/cityTraffic';
import { dominantSeason, seasonBlendForDate, type Season, type SeasonMode } from '../game/seasons';
import { collectTrafficHotspots, type TrafficHotspot } from '../game/traffic';
import type { Game } from '../game/game';
import { formatMoney } from '../game/game';
import { TrafficLights } from '../game/trafficLights';
import { AmbientPropsView } from './ambientProps';
import { AnimalsView } from './animals';
import { BuildingsView } from './buildings';
import { IsoCamera } from './camera';
import { CrossingsView } from './crossings';
import { IndustriesView } from './industries';
import { FloatingTexts, StationLabels, TownLabels } from './labels';
import { FallingLeavesView } from './fallingLeaves';
import { PedestriansView } from './pedestrians';
import { RailView } from './rail';
import { RoadVehiclesView } from './roadVehicles';
import { RoadView } from './roads';
import { SignalsView } from './signals';
import { TerrainView } from './terrain';
import { TrafficLightsView } from './trafficLights';
import { TrafficOverlayView } from './trafficOverlay';
import { NIGHT_DETAIL_ZOOM, NightLightsView } from './nightLights';
import { TrainsView } from './trains';
import { TreesView } from './trees';

const NIGHT_TRANSITION_MS = 2500;
const DAY_SKY = new THREE.Color(0x87b5d8);
const NIGHT_SKY = new THREE.Color(0x10182a);
const DAY_HEMISPHERE = new THREE.Color(0xffffff);
const NIGHT_HEMISPHERE = new THREE.Color(0x536b9a);
const DAY_GROUND = new THREE.Color(0x556644);
const NIGHT_GROUND = new THREE.Color(0x171b26);
const DAY_SUN = new THREE.Color(0xffffff);
const NIGHT_SUN = new THREE.Color(0x8095c0);
// Přechod ročního období po krocích: každý krok přebarví celý terén, proto ne každý herní den
const SEASON_STEPS = 10;

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
  private readonly cityTraffic: CityTraffic;
  private readonly pedestrians: PedestriansView;
  private readonly trees: TreesView;
  private readonly fallingLeaves: FallingLeavesView;
  private readonly animals: AnimalsView;
  private readonly buildings: BuildingsView;
  private readonly industries: IndustriesView;
  private readonly ambientProps: AmbientPropsView;
  private readonly crossings: CrossingsView;
  private readonly signals: SignalsView;
  private readonly roads: RoadView;
  private readonly trafficLights: TrafficLights;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly trafficLightView = new TrafficLightsView();
  private readonly nightLights: NightLightsView;
  readonly trafficOverlay = new TrafficOverlayView();
  private readonly floatingTexts = new FloatingTexts();
  private readonly syncMap: () => void;
  private railDirty = false;
  private seasonMode: SeasonMode = 'auto';
  private currentSeason: Season | null = null;
  private seasonKey = '';
  private nightTarget = false;
  // Průběh soumraku 0 (den) až 1 (noc), mění se plynule v reálném čase
  private nightAmount = 0;
  private lastFrameTime: number | null = null;
  private readonly sky = new THREE.Color(DAY_SKY);

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
    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x556644, 1.2);
    scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.position.set(10, 20, 5);
    scene.add(this.sun);

    this.terrain = new TerrainView(map, towns);
    const roads = (this.roads = new RoadView(map, world.rail));
    this.nightLights = new NightLightsView(map.width, map.height);
    this.nightLights.light(this.terrain.groundMaterial, ...roads.groundMaterials);
    this.ambientProps = new AmbientPropsView(map, world.rail, roads);
    this.trafficLights = new TrafficLights(map, world.rail, towns);
    this.cityTraffic = new CityTraffic(map, world.rail, towns, world.seed, roads.version, game.roadFleet.vehicles);
    this.cityTraffic.setTrafficLights(this.trafficLights);
    game.roadFleet.setTrafficLights(this.trafficLights);
    this.trafficLightView.sync(this.trafficLights.all);
    this.buildings = new BuildingsView();
    void this.buildings.rebuild(towns);
    this.trees = new TreesView(map);
    void this.trees.refresh();
    this.fallingLeaves = new FallingLeavesView(map);
    this.animals = new AnimalsView(map);
    void this.animals.refresh();
    this.industries = new IndustriesView();
    this.applySeason();
    void this.industries.sync(world.industries);
    const railView = new RailView(world.rail);
    this.signals = new SignalsView(world.rail);
    this.signals.rebuild();
    this.trains = new TrainsView(game.fleet, map);
    this.vehicles = new RoadVehiclesView(game.roadFleet, map);
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
      this.nightLights.object,
      this.trafficOverlay.object,
      this.ambientProps.object,
      this.trafficLightView.object,
      this.buildings.object,
      this.industries.object,
      this.trees.object,
      this.fallingLeaves.object,
      this.animals.object,
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
      this.roads.sync();
      this.trafficLights.reconcile(this.roads.version);
      this.trafficLightView.sync(this.trafficLights.all);
      this.ambientProps.sync();
      game.roadFleet.setTrafficObstacles(this.cityTraffic.obstacles());
      this.trees.sync();
      this.animals.sync();
      if (this.railDirty) {
        this.railDirty = false;
        railView.rebuild();
        this.signals.rebuild();
        rebuildStationLabels();
      }
    };
    game.events.on('townsChanged', () => {
      void this.buildings.rebuild(towns);
      towns.forEach((town) => this.labels.update(town));
      this.trafficLights.refresh();
      this.trafficLightView.sync(this.trafficLights.all);
      this.cityTraffic.reconcile(this.roads.version, game.roadFleet.vehicles);
      this.nightLights.invalidate();
    });
    game.events.on('railChanged', () => (this.railDirty = true));
    game.events.on('stationsChanged', rebuildStationLabels);
    game.events.on('industriesChanged', () => void this.industries.sync(world.industries));
    game.events.on('income', (amount, x, z) =>
      this.floatingTexts.show(`+${formatMoney(amount)}`, x, z, 'income-label'),
    );
    game.events.on('demolished', (amount, x, z) =>
      amount > 0
        ? this.floatingTexts.show(`+${formatMoney(amount)}`, x, z, 'income-label')
        : this.floatingTexts.show(`−${formatMoney(-amount)}`, x, z, 'expense-label'),
    );
  }

  get selectedSeasonMode(): SeasonMode {
    return this.seasonMode;
  }

  setSeasonMode(mode: SeasonMode): void {
    this.seasonMode = mode;
    this.applySeason();
  }

  trafficHotspots(): TrafficHotspot[] {
    return collectTrafficHotspots(
      this.game.world.map,
      this.game.world.towns,
      this.cityTraffic.cars,
      this.game.roadFleet.vehicles,
    );
  }

  toggleNightMode(): boolean {
    this.nightTarget = !this.nightTarget;
    return this.nightTarget;
  }

  // Lampy se rozsvítí až za soumraku, ne hned s prvním ztmavnutím oblohy
  private get lightsAmount(): number {
    return THREE.MathUtils.smoothstep(this.nightAmount, 0.35, 0.85);
  }

  private updateNight(ms: number): void {
    const target = this.nightTarget ? 1 : 0;
    if (this.nightAmount === target) return;
    const step = ms / NIGHT_TRANSITION_MS;
    this.nightAmount =
      target > this.nightAmount ? Math.min(target, this.nightAmount + step) : Math.max(target, this.nightAmount - step);
    const t = THREE.MathUtils.smoothstep(this.nightAmount, 0, 1);
    this.scene.background = this.sky.lerpColors(DAY_SKY, NIGHT_SKY, t);
    this.hemisphere.color.lerpColors(DAY_HEMISPHERE, NIGHT_HEMISPHERE, t);
    this.hemisphere.groundColor.lerpColors(DAY_GROUND, NIGHT_GROUND, t);
    this.hemisphere.intensity = THREE.MathUtils.lerp(1.2, 0.28, t);
    this.sun.color.lerpColors(DAY_SUN, NIGHT_SUN, t);
    this.sun.intensity = THREE.MathUtils.lerp(1.5, 0.12, t);
    this.roads.setNightMode(this.lightsAmount);
    this.industries.setNightMode(this.lightsAmount);
  }

  private applySeason(): void {
    const blend = seasonBlendForDate(this.game.clock.date, this.seasonMode);
    const stepped = { ...blend, t: Math.round(blend.t * SEASON_STEPS) / SEASON_STEPS };
    const key = `${stepped.from}>${stepped.to}:${stepped.t}`;
    if (this.seasonKey === key) return;
    this.seasonKey = key;
    this.terrain.setSeason(stepped);
    this.trees.setSeason(stepped);
    const season = dominantSeason(stepped);
    if (this.currentSeason === season) return;
    this.currentSeason = season;
    this.fallingLeaves.setSeason(season);
    this.buildings.setSeason(season);
    this.industries.setSeason(season);
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
  frame(now: number, dtMs: number, trafficDtMs = dtMs): void {
    this.updateNight(this.lastFrameTime === null ? 0 : now - this.lastFrameTime);
    this.lastFrameTime = now;
    this.syncMap();
    const frustum = this.camera.frustum();
    // Chodci chodí v reálném čase nezávisle na rychlosti hry, při pauze stojí
    this.pedestrians.update(this.game.clock.paused ? 0 : Math.min(dtMs, 100) / 1000, frustum);
    this.game.roadFleet.setPedestrianCrossings(this.pedestrians.crossingTiles);
    this.game.roadFleet.setTrafficObstacles(this.cityTraffic.obstacles());
    this.game.update(dtMs);
    const trafficSeconds = this.game.clock.paused ? 0 : Math.min(trafficDtMs, 100) / 1000;
    this.trafficLights.update(trafficSeconds);
    this.cityTraffic.update(
      trafficSeconds,
      this.pedestrians.crossingTiles,
      this.game.roadFleet.vehicles,
      this.roads.version,
    );
    if (this.trafficOverlay.visible) this.trafficOverlay.update(this.trafficHotspots());
    this.nightLights.update(
      this.lightsAmount,
      frustum,
      [this.roads.streetLamps, this.industries.lamps],
      this.game.world.towns,
      now,
    );
    this.game.roadFleet.setTrafficObstacles(this.cityTraffic.obstacles());
    this.syncMap();
    this.applySeason();
    const seconds = now / 1000;
    this.trees.update(seconds);
    this.fallingLeaves.update(seconds, this.camera.camera, frustum);
    this.animals.update(trafficSeconds);
    this.industries.update(seconds);
    // Světla vozidel jsou při oddálení menší než pixel, jen by přidávala draw cally
    const vehicleLights = this.lightsAmount > 0.5 && this.camera.camera.zoom >= NIGHT_DETAIL_ZOOM;
    this.trains.update(frustum, vehicleLights);
    this.vehicles.update(frustum, this.cityTraffic.cars, vehicleLights);
    this.trafficLightView.update(this.trafficLights);
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
