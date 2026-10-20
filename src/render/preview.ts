import * as THREE from 'three';
import type { Axis, Edge } from '../world/rail';
import { TrackView, createDepotMesh, createStationMesh, placeDepot, placeStation, type TrackItem } from './rail';

const VALID = 0x9fff9f;
const INVALID = 0xff7070;

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

  constructor() {
    this.object.add(this.track.object, this.station, this.depot);
    this.object.renderOrder = 5;
    this.clear();
  }

  clear(): void {
    this.track.update([]);
    this.station.visible = false;
    this.depot.visible = false;
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
