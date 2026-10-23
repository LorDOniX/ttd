import * as THREE from 'three';
import type { TrafficHotspot } from '../game/traffic';

const MAX_MARKERS = 512;
const HOTSPOT_COLORS = [0x4fbd75, 0xe4c94a, 0xec8b38, 0xdf493e];

function colorForScore(score: number): number {
  if (score < 1.5) return HOTSPOT_COLORS[0];
  if (score < 2.5) return HOTSPOT_COLORS[1];
  if (score < 4) return HOTSPOT_COLORS[2];
  return HOTSPOT_COLORS[3];
}

export class TrafficOverlayView {
  readonly object = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;

  constructor() {
    const geometry = new THREE.PlaneGeometry(0.46, 0.46);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      MAX_MARKERS,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.object.visible = false;
    this.object.add(this.mesh);
  }

  get visible(): boolean {
    return this.object.visible;
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  update(hotspots: readonly TrafficHotspot[]): void {
    if (!this.visible) return;
    const count = Math.min(hotspots.length, MAX_MARKERS);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < count; index++) {
      const hotspot = hotspots[index];
      const size = Math.min(1, 0.62 + Math.min(hotspot.score, 5) * 0.06);
      position.set(hotspot.x + 0.5, 0.035, hotspot.y + 0.5);
      scale.set(size, 1, size);
      matrix.compose(position, new THREE.Quaternion(), scale);
      this.mesh.setMatrixAt(index, matrix);
      this.mesh.setColorAt(index, new THREE.Color(colorForScore(hotspot.score)));
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
