import * as THREE from 'three';
import type { AirportType } from '../game/balance';
import { createAirportObject } from './airports';
import { createPortObject } from './ports';
import type { PortShape } from '../world/port';
import type { TilePos } from '../world/map';
import {
  EDGE_DELTA,
  PIECES,
  type Axis,
  type Edge,
  type RailBridge,
  type RailNetwork,
  type StationShape,
} from '../world/rail';
import { SIGNAL_ARROW, SIGNAL_LAMP, SIGNAL_POLE, signalPlacement } from './signals';
import {
  TrackView,
  createDepotMesh,
  createRailBridgeObject,
  createRoadDepotMesh,
  createRoadStopMesh,
  createStationObject,
  placeDepot,
  type TrackItem,
} from './rail';
import { roadAtlas, roadGeometry, type RoadConnects } from './roads';

const VALID = 0x9fff9f;
const INVALID = 0xff7070;
const DEMOLISH = 0xff3030;
const CATCHMENT = 0x4f8fff;
const MAX_AREA = 4096;

// Poloprůhledný náhled stavby pod kurzorem
export class BuildPreview {
  readonly object = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  private readonly track = new TrackView(this.material);
  private readonly station = new THREE.Group();
  private readonly depot = createDepotMesh(this.material);
  private readonly areaMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  private readonly area = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.96, 0.1, 0.96).translate(0.5, 0.05, 0.5),
    this.areaMaterial,
    MAX_AREA,
  );

  private readonly roadMaterial = new THREE.MeshBasicMaterial({
    map: roadAtlas(),
    transparent: true,
    opacity: 0.8,
    alphaTest: 0.5,
    depthWrite: false,
  });
  private readonly road = new THREE.Mesh(new THREE.BufferGeometry(), this.roadMaterial);
  private readonly signals = new THREE.Group();
  private readonly signalMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });

  constructor() {
    this.object.add(this.track.object, this.station, this.depot, this.area, this.road, this.signals);
    this.object.renderOrder = 5;
    this.clear();
  }

  clear(): void {
    this.track.update([]);
    this.station.clear();
    this.depot.visible = false;
    this.area.count = 0;
    this.road.visible = false;
    this.signals.clear();
  }

  // Návěstidla tak, jak budou stát (jednosměrná se šipkou), a zvýrazněné dlaždice pod nimi
  showSignals(items: (TilePos & { dir?: Edge })[], rail: RailNetwork, kind: 'valid' | 'invalid'): void {
    this.clear();
    const color = kind === 'valid' ? VALID : INVALID;
    this.signalMaterial.color.set(color);
    for (const { x, y, dir } of items.slice(0, 512)) {
      const piece = PIECES.findIndex((_, p) => rail.has(x, y, p));
      if (piece < 0) continue;
      const place = signalPlacement(piece, x, y, dir);
      for (const geometry of [SIGNAL_POLE, SIGNAL_LAMP]) {
        const mesh = new THREE.Mesh(geometry, this.signalMaterial);
        mesh.position.set(place.pole[0], 0, place.pole[1]);
        this.signals.add(mesh);
      }
      if (place.angle !== null) {
        const arrow = new THREE.Mesh(SIGNAL_ARROW, this.signalMaterial);
        arrow.position.set(place.center[0], 0.01, place.center[1]);
        arrow.rotation.y = place.angle;
        this.signals.add(arrow);
      }
    }
    this.areaMaterial.color.set(color);
    this.areaMaterial.opacity = 0.3;
    this.setArea(items);
  }

  // Silnice tak, jak bude vypadat: napojená na stávající silnice i na sebe
  showRoad(tiles: TilePos[], connects: RoadConnects, valid: boolean): void {
    this.clear();
    const planned = new Set(tiles.map((t) => `${t.x},${t.y}`));
    this.road.geometry.dispose();
    this.road.geometry = roadGeometry(
      tiles,
      (x, y, edge) => planned.has(`${x + EDGE_DELTA[edge][0]},${y + EDGE_DELTA[edge][1]}`) || connects(x, y, edge),
      0.012,
    );
    this.roadMaterial.color.set(valid ? VALID : INVALID);
    this.road.visible = true;
  }

  // Zvýraznění dlaždic: demolice červeně, jinak platné zeleně a neplatné červeně
  showArea(tiles: TilePos[], kind: 'demolish' | 'valid' | 'invalid'): void {
    this.clear();
    const colors = { demolish: DEMOLISH, valid: VALID, invalid: INVALID };
    this.areaMaterial.color.set(colors[kind]);
    this.areaMaterial.opacity = 0.45;
    this.setArea(tiles);
  }

  // Dosah nástupiště; přidá se k ostatnímu náhledu (např. stavěnému nástupišti)
  showCatchment(tiles: TilePos[]): void {
    this.areaMaterial.color.set(CATCHMENT);
    this.areaMaterial.opacity = 0.3;
    this.setArea(tiles);
  }

  private setArea(tiles: TilePos[]): void {
    const m = new THREE.Matrix4();
    const count = Math.min(tiles.length, MAX_AREA);
    for (let i = 0; i < count; i++) this.area.setMatrixAt(i, m.makeTranslation(tiles[i].x, 0, tiles[i].y));
    this.area.count = count;
    this.area.instanceMatrix.needsUpdate = true;
    this.area.computeBoundingSphere();
  }

  // Kolej k položení; blocked = zbytek tažení za překážkou (červeně)
  showTrack(items: TrackItem[], valid: boolean, blocked: TilePos[] = []): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.track.update(items);
    if (blocked.length > 0) {
      this.areaMaterial.color.set(INVALID);
      this.areaMaterial.opacity = 0.45;
      this.setArea(blocked);
    }
  }

  // Kusy koleje, které se odeberou
  showTrackRemoval(items: TrackItem[]): void {
    this.clear();
    this.material.color.set(DEMOLISH);
    this.track.update(items);
  }

  // Most tak, jak bude stát (nájezdy, mostovka, pilíře)
  showBridge(bridge: Pick<RailBridge, 'x' | 'y' | 'dir' | 'span'>, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.station.add(createRailBridgeObject(bridge, this.material));
  }

  showStation(shape: StationShape, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.station.add(createStationObject(shape, this.material));
  }

  showAirport(shape: StationShape, type: AirportType, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.station.add(createAirportObject(shape, type, this.material));
  }

  showPort(shape: PortShape, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.station.add(createPortObject(shape, this.material, false));
  }

  // Depo i se spojkami, kterými se napojí na kolej před vjezdem
  showDepot(x: number, y: number, entrance: Edge, valid: boolean, links: TrackItem[] = []): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    placeDepot(this.depot, x, y, entrance);
    this.depot.visible = true;
    this.track.update(links);
  }

  showRoadStop(x: number, y: number, axis: Axis, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.station.add(createRoadStopMesh(this.material, x, y, axis));
  }

  showRoadDepot(x: number, y: number, entrance: Edge, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    const mesh = createRoadDepotMesh(this.material);
    placeDepot(mesh, x, y, entrance);
    this.station.add(mesh);
  }
}
