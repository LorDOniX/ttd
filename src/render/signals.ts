import * as THREE from 'three';
import { EDGE_MID, PIECES, type RailNetwork } from '../world/rail';

const MAX_SIGNALS = 2048;
const POLE_HEIGHT = 0.45;
// Vzdálenost sloupku od osy koleje
const SIDE_OFFSET = 0.3;
const RED = new THREE.Color(0xff3020);
const GREEN = new THREE.Color(0x30e050);

// Návěstidla: sloupek vedle středu kusu koleje, světlo červené, když je úsek obsazený
export class SignalsView {
  readonly object = new THREE.Group();
  private readonly poles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.04, POLE_HEIGHT, 0.04).translate(0, POLE_HEIGHT / 2, 0),
    new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
    MAX_SIGNALS,
  );
  private readonly lamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.09, 0.12, 0.09).translate(0, POLE_HEIGHT, 0),
    new THREE.MeshBasicMaterial(),
    MAX_SIGNALS,
  );
  private tiles: { x: number; y: number }[] = [];

  constructor(private readonly rail: RailNetwork) {
    this.poles.count = 0;
    this.lamps.count = 0;
    this.object.add(this.poles, this.lamps);
  }

  rebuild(): void {
    const { width } = this.rail.map;
    this.tiles = [...this.rail.signals].slice(0, MAX_SIGNALS).map((i) => ({ x: i % width, y: Math.floor(i / width) }));
    const m = new THREE.Matrix4();
    this.tiles.forEach(({ x, y }, i) => {
      const [cx, cz] = this.place(x, y);
      m.makeTranslation(x + cx, 0, y + cz);
      this.poles.setMatrixAt(i, m);
      this.lamps.setMatrixAt(i, m);
      this.lamps.setColorAt(i, GREEN);
    });
    for (const mesh of [this.poles, this.lamps]) {
      mesh.count = this.tiles.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  // Barvy podle toho, zda dlaždici návěstidla drží nějaký vlak
  update(isReserved: (x: number, y: number) => boolean): void {
    if (!this.lamps.instanceColor) return;
    this.tiles.forEach(({ x, y }, i) => this.lamps.setColorAt(i, isReserved(x, y) ? RED : GREEN));
    this.lamps.instanceColor.needsUpdate = true;
  }

  // Bod kolmo vedle středu kusu koleje, na straně bližší středu dlaždice
  private place(x: number, y: number): [number, number] {
    const piece = PIECES.findIndex((_, p) => this.rail.has(x, y, p));
    if (piece < 0) return [0.5, 0.5];
    const [a, b] = PIECES[piece];
    const [ax, az] = EDGE_MID[a];
    const [bx, bz] = EDGE_MID[b];
    const length = Math.hypot(bx - ax, bz - az);
    const [nx, nz] = [-(bz - az) / length, (bx - ax) / length];
    const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
    const side = (0.5 - mx) * nx + (0.5 - mz) * nz >= 0 ? 1 : -1;
    return [mx + side * nx * SIDE_OFFSET, mz + side * nz * SIDE_OFFSET];
  }
}
