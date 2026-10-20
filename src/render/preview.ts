import * as THREE from 'three';
import type { TilePos } from '../world/map';
import type { Axis, Edge } from '../world/rail';
import { TrackView, createDepotMesh, createStationMesh, placeDepot, placeStation, type TrackItem } from './rail';

const VALID = 0x9fff9f;
const INVALID = 0xff7070;
const DEMOLISH = 0xff3030;
const ROAD = 0x606068;
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
  private readonly station = createStationMesh(this.material);
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

  constructor() {
    this.object.add(this.track.object, this.station, this.depot, this.area);
    this.object.renderOrder = 5;
    this.clear();
  }

  clear(): void {
    this.track.update([]);
    this.station.visible = false;
    this.depot.visible = false;
    this.area.count = 0;
  }

  // Zvýraznění dlaždic: demolice červeně, nová silnice šedě
  showArea(tiles: TilePos[], kind: 'demolish' | 'road' | 'invalid'): void {
    this.clear();
    this.areaMaterial.color.set(kind === 'demolish' ? DEMOLISH : kind === 'road' ? ROAD : INVALID);
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

  showStation(x: number, y: number, axis: Axis, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    placeStation(this.station, x, y, axis);
    this.station.visible = true;
  }

  showDepot(x: number, y: number, entrance: Edge, valid: boolean): void {
    this.clear();
    this.material.color.set(valid ? VALID : INVALID);
    placeDepot(this.depot, x, y, entrance);
    this.depot.visible = true;
  }
}
