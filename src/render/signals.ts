import * as THREE from 'three';
import { EDGE_MID, PIECES, type Edge, type RailNetwork } from '../world/rail';

const MAX_SIGNALS = 2048;
const POLE_HEIGHT = 0.45;
// Vzdálenost sloupku od osy koleje
const SIDE_OFFSET = 0.3;
const RED = new THREE.Color(0xff3020);
export const SIGNAL_GREEN = new THREE.Color(0x30e050);
export const SIGNAL_POLE = new THREE.BoxGeometry(0.04, POLE_HEIGHT, 0.04).translate(0, POLE_HEIGHT / 2, 0);
export const SIGNAL_POLE_COLOR = 0x3a3a3a;
export const SIGNAL_LAMP = new THREE.BoxGeometry(0.09, 0.12, 0.09).translate(0, POLE_HEIGHT, 0);
// Šipka na koleji u jednosměrného návěstidla, v základní poloze míří k +X
export const SIGNAL_ARROW = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0.11, 0);
  shape.lineTo(-0.07, 0.08);
  shape.lineTo(-0.03, 0);
  shape.lineTo(-0.07, -0.08);
  shape.closePath();
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.075, 0);
})();
export const SIGNAL_ARROW_COLOR = 0xfff3c4;

export interface SignalPlacement {
  // Sloupek (v souřadnicích mapy)
  pole: [number, number];
  // Střed kusu koleje a natočení šipky (jen u jednosměrného)
  center: [number, number];
  angle: number | null;
}

// Kde stojí návěstidlo na dlaždici: obousměrné vedle kusu na straně ke středu dlaždice,
// jednosměrné vpravo ve směru jízdy jako v OpenTTD, se šipkou na koleji
export function signalPlacement(piece: number, x: number, y: number, dir?: Edge): SignalPlacement {
  let [a, b] = PIECES[piece];
  const oneWay = dir !== undefined && (a === dir || b === dir);
  if (oneWay && a === dir) [a, b] = [b, a];
  const [ax, az] = EDGE_MID[a];
  const [bx, bz] = EDGE_MID[b];
  const length = Math.hypot(bx - ax, bz - az);
  const [tx, tz] = [(bx - ax) / length, (bz - az) / length];
  const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
  // Vpravo od směru jízdy (y nahoru): (−tz, tx)
  const [nx, nz] = [-tz, tx];
  const side = oneWay ? 1 : (0.5 - mx) * nx + (0.5 - mz) * nz >= 0 ? 1 : -1;
  return {
    pole: [x + mx + side * nx * SIDE_OFFSET, y + mz + side * nz * SIDE_OFFSET],
    center: [x + mx, y + mz],
    angle: oneWay ? Math.atan2(-tz, tx) : null,
  };
}

// Návěstidla: sloupek vedle kusu koleje, světlo červené, když je úsek obsazený; jednosměrná mají šipku
export class SignalsView {
  readonly object = new THREE.Group();
  private readonly poles = new THREE.InstancedMesh(
    SIGNAL_POLE,
    new THREE.MeshLambertMaterial({ color: SIGNAL_POLE_COLOR }),
    MAX_SIGNALS,
  );
  private readonly lamps = new THREE.InstancedMesh(SIGNAL_LAMP, new THREE.MeshBasicMaterial(), MAX_SIGNALS);
  private readonly arrows = new THREE.InstancedMesh(
    SIGNAL_ARROW,
    new THREE.MeshBasicMaterial({ color: SIGNAL_ARROW_COLOR, transparent: true, opacity: 0.85 }),
    MAX_SIGNALS,
  );
  private tiles: { x: number; y: number }[] = [];

  constructor(private readonly rail: RailNetwork) {
    this.poles.count = 0;
    this.lamps.count = 0;
    this.arrows.count = 0;
    this.object.add(this.poles, this.lamps, this.arrows);
  }

  rebuild(): void {
    const { width } = this.rail.map;
    this.tiles = [...this.rail.signals].slice(0, MAX_SIGNALS).map((i) => ({ x: i % width, y: Math.floor(i / width) }));
    const m = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    let arrows = 0;
    this.tiles.forEach(({ x, y }, i) => {
      const piece = PIECES.findIndex((_, p) => this.rail.has(x, y, p));
      const place =
        piece < 0
          ? { pole: [x + 0.5, y + 0.5], center: [x + 0.5, y + 0.5], angle: null }
          : signalPlacement(piece, x, y, this.rail.signalDir(x, y));
      const ground = this.rail.map.elevation(x, y);
      m.makeTranslation(place.pole[0], this.rail.map.heightAt(place.pole[0], place.pole[1]), place.pole[1]);
      this.poles.setMatrixAt(i, m);
      this.lamps.setMatrixAt(i, m);
      this.lamps.setColorAt(i, SIGNAL_GREEN);
      if (place.angle !== null) {
        m.makeTranslation(place.center[0], ground, place.center[1]).multiply(rotation.makeRotationY(place.angle));
        this.arrows.setMatrixAt(arrows++, m);
      }
    });
    for (const mesh of [this.poles, this.lamps]) mesh.count = this.tiles.length;
    this.arrows.count = arrows;
    for (const mesh of [this.poles, this.lamps, this.arrows]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  // Barvy podle toho, zda dlaždici návěstidla drží nějaký vlak
  update(isReserved: (x: number, y: number) => boolean): void {
    if (!this.lamps.instanceColor) return;
    this.tiles.forEach(({ x, y }, i) => this.lamps.setColorAt(i, isReserved(x, y) ? RED : SIGNAL_GREEN));
    this.lamps.instanceColor.needsUpdate = true;
  }
}
