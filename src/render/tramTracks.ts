import * as THREE from 'three';
import type { GameMap } from '../world/map';
import { EDGE_DELTA, EDGE_MID, type RailNetwork } from '../world/rail';
import { roadMoves } from '../world/roadRoute';
import { ROAD_LANE_OFFSET } from '../game/roadVehicles';
import { roadGround } from './roads';

// Kolejnice v obou jízdních pruzích: střed pruhu ± polovina rozchodu
const GAUGE_HALF = 0.055;
const RAIL_WIDTH = 0.022;
const RAIL_LIFT = 0.014;
// Trolejový drát nad každým pruhem, stožár u kraje silnice
// Výška drátu odpovídá sběrači tramvaje (model z train kitu v měřítku TRAM_SCALE)
const WIRE_HEIGHT = 0.33;
const WIRE_WIDTH = 0.008;
const POLE_OFFSET = 0.44;

const RAIL_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xaab0b6 });
const WIRE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x2b2b2b });
const POLE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x55595e });

// Vodorovný pásek od a do b v šířce width ve výšce podle terénu
function strip(
  out: number[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
  height: (x: number, z: number) => number,
): void {
  const length = Math.hypot(bx - ax, bz - az);
  if (length <= 0) return;
  const nx = (-(bz - az) / length) * (width / 2);
  const nz = ((bx - ax) / length) * (width / 2);
  const ha = height(ax, az);
  const hb = height(bx, bz);
  const quad = [
    [ax - nx, ha, az - nz],
    [ax + nx, ha, az + nz],
    [bx + nx, hb, bz + nz],
    [bx - nx, hb, bz - nz],
  ];
  for (const i of [0, 1, 2, 0, 2, 3]) out.push(...quad[i]);
}

// Tramvajové koleje a troleje na silnicích: na každé dlaždici s kolejí od středu k hranám, kudy kolej
// pokračuje na sousední dlaždici, v obou jízdních pruzích
export class TramTracksView {
  readonly object = new THREE.Group();
  private key = '';

  constructor(
    private readonly map: GameMap,
    private readonly rail: RailNetwork,
  ) {}

  rebuild(): void {
    const { map, rail } = this;
    const key = `${rail.revision}:${map.changeCursor}`;
    if (key === this.key) return;
    this.key = key;
    this.object.clear();
    const ground = roadGround(map, rail);
    const rails: number[] = [];
    const wires: number[] = [];
    const poles: THREE.Vector3[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!rail.hasTram(x, y)) continue;
        const height = (px: number, pz: number): number => ground(x, y, px, pz);
        const cx = x + 0.5;
        const cz = y + 0.5;
        const edges = new Set<number>();
        for (const next of roadMoves(rail, x, y, true)) {
          edges.add(EDGE_DELTA.findIndex(([dx, dy]) => next.x - x === dx && next.y - y === dy));
        }
        // Nájezd mostu nebo portál tunelu: kolej pokračuje i ve směru mostu
        const exit = rail.roadBridgeExit(x, y);
        if (exit !== null) edges.add(exit);
        for (const edge of edges) {
          const [mx, mz] = EDGE_MID[edge];
          const [dx, dz] = EDGE_DELTA[edge];
          // Kolmice k hraně: pruhy leží po obou stranách osy silnice
          const [px, pz] = [-dz, dx];
          for (const lane of [-ROAD_LANE_OFFSET, ROAD_LANE_OFFSET]) {
            for (const side of [-GAUGE_HALF, GAUGE_HALF]) {
              const o = lane + side;
              const lift = (qx: number, qz: number): number => height(qx, qz) + RAIL_LIFT;
              strip(rails, cx + px * o, cz + pz * o, x + mx + px * o, y + mz + pz * o, RAIL_WIDTH, lift);
            }
            const wire = (qx: number, qz: number): number => height(qx, qz) + WIRE_HEIGHT;
            strip(wires, cx + px * lane, cz + pz * lane, x + mx + px * lane, y + mz + pz * lane, WIRE_WIDTH, wire);
          }
        }
        // Stožár na rovné dlaždici u kraje silnice s výložníkem nad oba dráty (na křižovatkách
        // a v obloucích by překážel)
        const straight = edges.size === 2 && [...edges].every((e) => e % 2 === [...edges][0] % 2);
        if (straight) {
          const along = [...edges][0];
          const [dx, dz] = EDGE_DELTA[along];
          const px = cx - dz * POLE_OFFSET;
          const pz = cz + dx * POLE_OFFSET;
          poles.push(new THREE.Vector3(px, height(px, pz), pz));
          const far = -ROAD_LANE_OFFSET - 0.04;
          const arm = (qx: number, qz: number): number => height(qx, qz) + WIRE_HEIGHT + 0.02;
          strip(wires, px, pz, cx - dz * far, cz + dx * far, 0.012, arm);
        }
      }
    }
    const mesh = (positions: number[], material: THREE.Material): THREE.Mesh => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const m = new THREE.Mesh(geometry, material);
      m.frustumCulled = false;
      return m;
    };
    if (rails.length > 0) this.object.add(mesh(rails, RAIL_MATERIAL), mesh(wires, WIRE_MATERIAL));
    if (poles.length > 0) {
      const pole = new THREE.CylinderGeometry(0.012, 0.012, WIRE_HEIGHT + 0.04, 5);
      pole.translate(0, (WIRE_HEIGHT + 0.04) / 2, 0);
      const instances = new THREE.InstancedMesh(pole, POLE_MATERIAL, poles.length);
      const m = new THREE.Matrix4();
      poles.forEach((p, i) => instances.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
      instances.frustumCulled = false;
      this.object.add(instances);
    }
  }
}
