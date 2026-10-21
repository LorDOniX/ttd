import * as THREE from 'three';
import type { TilePos } from '../world/map';
import type { Axis, Edge, StationShape } from '../world/rail';
import {
  TrackView,
  createDepotMesh,
  createRoadDepotMesh,
  createRoadStopMesh,
  createStationObject,
  placeDepot,
  type TrackItem,
} from './rail';
import { roadAtlas, roadGeometry } from './roads';

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

  constructor() {
    this.object.add(this.track.object, this.station, this.depot, this.area, this.road);
    this.object.renderOrder = 5;
    this.clear();
  }

  clear(): void {
    this.track.update([]);
    this.station.clear();
    this.depot.visible = false;
    this.area.count = 0;
    this.road.visible = false;
  }

  // Silnice tak, jak bude vypadat: napojená na stávající silnice i na sebe
  showRoad(tiles: TilePos[], isRoad: (x: number, y: number) => boolean, valid: boolean): void {
    this.clear();
    const planned = new Set(tiles.map((t) => `${t.x},${t.y}`));
    this.road.geometry.dispose();
    this.road.geometry = roadGeometry(tiles, (x, y) => planned.has(`${x},${y}`) || isRoad(x, y), 0.012);
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

  showTrack(items: TrackItem[], valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.track.update(items);
  }

  showStation(shape: StationShape, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    this.station.add(createStationObject(shape, this.material));
  }

  showDepot(x: number, y: number, entrance: Edge, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    placeDepot(this.depot, x, y, entrance);
    this.depot.visible = true;
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
