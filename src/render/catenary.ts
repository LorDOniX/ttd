import * as THREE from 'three';
import { EDGE_MID, PIECES, type RailNetwork } from '../world/rail';

const MAX_PIECES = 16384;
// Výška trolejového drátu nad terénem a stožáru
const WIRE_HEIGHT = 0.62;
const POLE_HEIGHT = 0.7;
// Vzdálenost stožáru od osy koleje
const POLE_OFFSET = 0.4;
const POLE = new THREE.BoxGeometry(0.035, POLE_HEIGHT, 0.035).translate(0, POLE_HEIGHT / 2, 0);
// Drát a výložník mají jednotkovou délku podél x, na místo se natáhnou maticí
const WIRE = new THREE.BoxGeometry(1, 0.012, 0.012).translate(0.5, 0, 0);
const ARM = new THREE.BoxGeometry(1, 0.02, 0.02).translate(0.5, 0, 0);
const POLE_COLOR = 0x6b6f73;
const WIRE_COLOR = 0x2b2b2b;

// Trolejové vedení nad elektrizovanou tratí: drát nad každým kusem koleje a na dlaždici jeden stožár
// s výložníkem nad osu koleje (jako v OpenTTD)
export class CatenaryView {
  readonly object = new THREE.Group();
  private readonly poles = new THREE.InstancedMesh(
    POLE,
    new THREE.MeshLambertMaterial({ color: POLE_COLOR }),
    MAX_PIECES,
  );
  private readonly arms = new THREE.InstancedMesh(
    ARM,
    new THREE.MeshLambertMaterial({ color: POLE_COLOR }),
    MAX_PIECES,
  );
  private readonly wires = new THREE.InstancedMesh(
    WIRE,
    new THREE.MeshBasicMaterial({ color: WIRE_COLOR }),
    MAX_PIECES,
  );

  constructor(private readonly rail: RailNetwork) {
    for (const mesh of [this.poles, this.arms, this.wires]) {
      mesh.count = 0;
      // Vedení se nevybírá klikem a nevrhá stín přes celou trať
      mesh.raycast = () => {};
      this.object.add(mesh);
    }
  }

  rebuild(): void {
    const { map, electrified } = this.rail;
    const m = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    const pitch = new THREE.Matrix4();
    let poles = 0;
    let wires = 0;
    for (let i = 0; i < electrified.length && wires < MAX_PIECES; i++) {
      if (!electrified[i]) continue;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      let poled = false;
      for (let p = 0; p < PIECES.length && wires < MAX_PIECES; p++) {
        if (!this.rail.has(x, y, p)) continue;
        const [a, b] = PIECES[p];
        const [ax, az] = EDGE_MID[a];
        const [bx, bz] = EDGE_MID[b];
        const length = Math.hypot(bx - ax, bz - az);
        const angle = Math.atan2(-(bz - az), bx - ax);
        // Drát sleduje terén: ve svahu stoupá spolu s kolejí
        const ha = map.heightAt(x + ax, y + az);
        const hb = map.heightAt(x + bx, y + bz);
        m.makeTranslation(x + ax, ha + WIRE_HEIGHT, y + az)
          .multiply(rotation.makeRotationY(angle))
          .multiply(pitch.makeRotationZ(Math.atan2(hb - ha, length)))
          .multiply(scale.makeScale(Math.hypot(length, hb - ha), 1, 1));
        this.wires.setMatrixAt(wires++, m);
        if (poled) continue;
        poled = true;
        // Stožár vedle středu kusu na straně ke středu dlaždice, výložník k ose koleje
        const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
        const [tx, tz] = [(bx - ax) / length, (bz - az) / length];
        let [nx, nz] = [-tz, tx];
        if ((0.5 - mx) * nx + (0.5 - mz) * nz < 0) [nx, nz] = [-nx, -nz];
        // U rovné koleje stojí stožár vždy na stejné straně
        if (p < 2) [nx, nz] = p === 0 ? [1, 0] : [0, 1];
        const [px, pz] = [x + mx + nx * POLE_OFFSET, y + mz + nz * POLE_OFFSET];
        const ground = map.heightAt(px, pz);
        m.makeTranslation(px, ground, pz);
        this.poles.setMatrixAt(poles, m);
        m.makeTranslation(px, ground + WIRE_HEIGHT + 0.04, pz)
          .multiply(rotation.makeRotationY(Math.atan2(nz, -nx)))
          .multiply(scale.makeScale(POLE_OFFSET, 1, 1));
        this.arms.setMatrixAt(poles++, m);
      }
    }
    this.poles.count = poles;
    this.arms.count = poles;
    this.wires.count = wires;
    for (const mesh of [this.poles, this.arms, this.wires]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}

// Ikona nástroje: stožár s výložníkem a drát nad rovnou kolejí podél x (souřadnice dlaždice 0..1)
export function createCatenaryIcon(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: POLE_COLOR });
  const pole = new THREE.Mesh(POLE, material);
  pole.position.set(0.5, 0, 0.5 + POLE_OFFSET);
  const arm = new THREE.Mesh(ARM, material);
  arm.position.set(0.5, WIRE_HEIGHT + 0.04, 0.5 + POLE_OFFSET);
  arm.rotation.y = Math.PI / 2;
  arm.scale.x = POLE_OFFSET;
  const wire = new THREE.Mesh(WIRE, new THREE.MeshBasicMaterial({ color: WIRE_COLOR }));
  wire.position.set(0, WIRE_HEIGHT, 0.5);
  group.add(pole, arm, wire);
  return group;
}
