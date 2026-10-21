import * as THREE from 'three';
import { GameMap, MapChanges, TileType } from '../world/map';
import { RailNetwork, axisPiece } from '../world/rail';

const POST = 0x3a3a3a;
const ARM_RED = 0xc8202a;
const ARM_WHITE = 0xf2f2ee;
const HOUSING = 0x1e1e1e;
const LAMP_OFF = 0x3a0c0c;
const LAMP_ON = 0xff2a1a;
// Okraj vozovky, pozice závory před kolejemi a výška otočného čepu
const SIDE = 0.36;
const BEFORE = 0.4;
const PIVOT = 0.13;
const ARM_LENGTH = 0.62;
// Rychlost spouštění závory (rad/s) a perioda blikání světel (ms)
const ARM_SPEED = 2.2;
const BLINK_MS = 500;

const postGeometry = new THREE.BoxGeometry(0.035, PIVOT + 0.03, 0.035).translate(0, (PIVOT + 0.03) / 2, 0);
const housingGeometry = new THREE.BoxGeometry(0.1, 0.045, 0.03);
const lampGeometry = new THREE.SphereGeometry(0.013, 8, 6);
const stripeGeometry = new THREE.BoxGeometry(ARM_LENGTH / 5, 0.018, 0.018);
const postMaterial = new THREE.MeshLambertMaterial({ color: POST });
const housingMaterial = new THREE.MeshLambertMaterial({ color: HOUSING });
const redMaterial = new THREE.MeshLambertMaterial({ color: ARM_RED });
const whiteMaterial = new THREE.MeshLambertMaterial({ color: ARM_WHITE });

interface CrossingView {
  group: THREE.Group;
  arms: THREE.Object3D[];
  // Dvě světla na každém návěstidle, blikají střídavě
  lamps: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  angle: number;
}

// Závora se světly na pravé straně silnice před kolejemi; v místních souřadnicích vede silnice podél Z
function barrier(side: 1 | -1, lamps: THREE.MeshBasicMaterial[]): { object: THREE.Group; arm: THREE.Object3D } {
  const object = new THREE.Group();
  const x = -side * SIDE;
  const z = -side * BEFORE;
  const post = new THREE.Mesh(postGeometry, postMaterial);
  post.position.set(x, 0, z);
  object.add(post);

  // Světla mířící proti přijíždějícím autům
  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  housing.position.set(x, PIVOT + 0.06, z);
  object.add(housing);
  lamps.forEach((material, i) => {
    const lamp = new THREE.Mesh(lampGeometry, material);
    lamp.position.set(x + (i - 0.5) * 0.05, PIVOT + 0.06, z - side * 0.018);
    object.add(lamp);
  });

  // Ráhno se otáčí kolem čepu na sloupku; zavřené vede napříč vozovkou
  const pivot = new THREE.Group();
  pivot.position.set(x, PIVOT, z);
  if (side === -1) pivot.rotation.y = Math.PI;
  const arm = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const stripe = new THREE.Mesh(stripeGeometry, i % 2 === 0 ? redMaterial : whiteMaterial);
    stripe.position.x = (i + 0.5) * (ARM_LENGTH / 5);
    arm.add(stripe);
  }
  pivot.add(arm);
  object.add(pivot);
  return { object, arm };
}

// Železniční přejezdy: závory a blikající světla, která se zavřou, když si přejezd rezervuje vlak
export class CrossingsView {
  readonly object = new THREE.Group();
  private readonly views = new Map<number, CrossingView>();
  private readonly changes: MapChanges;
  private lastFrame = performance.now();

  constructor(
    private readonly map: GameMap,
    private readonly rail: RailNetwork,
  ) {
    this.changes = new MapChanges(map);
    for (let i = 0; i < map.width * map.height; i++) this.refreshTile(i);
  }

  update(now: number, isClosed: (x: number, y: number) => boolean): void {
    const changes = this.changes.take();
    if (changes === null) for (let i = 0; i < this.map.width * this.map.height; i++) this.refreshTile(i);
    else for (const i of changes) this.refreshTile(i);

    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const blink = Math.floor(now / BLINK_MS) % 2;
    for (const [i, view] of this.views) {
      const closed = isClosed(i % this.map.width, Math.floor(i / this.map.width));
      const target = closed ? 0 : Math.PI / 2;
      const step = ARM_SPEED * dt;
      view.angle += Math.max(-step, Math.min(step, target - view.angle));
      for (const arm of view.arms) arm.rotation.z = view.angle;
      view.lamps[0].color.set(closed && blink === 0 ? LAMP_ON : LAMP_OFF);
      view.lamps[1].color.set(closed && blink === 1 ? LAMP_ON : LAMP_OFF);
    }
  }

  private refreshTile(i: number): void {
    const x = i % this.map.width;
    const y = Math.floor(i / this.map.width);
    const isCrossing = this.map.get(x, y) === TileType.Crossing;
    const existing = this.views.get(i);
    if (isCrossing === (existing !== undefined)) return;
    if (existing) {
      this.object.remove(existing.group);
      existing.lamps.forEach((m) => m.dispose());
      this.views.delete(i);
      return;
    }
    const lamps: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] = [
      new THREE.MeshBasicMaterial({ color: LAMP_OFF }),
      new THREE.MeshBasicMaterial({ color: LAMP_OFF }),
    ];
    const group = new THREE.Group();
    const arms = ([1, -1] as const).map((side) => {
      const { object, arm } = barrier(side, lamps);
      group.add(object);
      return arm;
    });
    group.position.set(x + 0.5, 0, y + 0.5);
    // Kolej podél X znamená silnici podél Z, jinak je přejezd otočený o 90°
    if (this.rail.mask(x, y) !== 1 << axisPiece('x')) group.rotation.y = Math.PI / 2;
    this.object.add(group);
    this.views.set(i, { group, arms, lamps, angle: Math.PI / 2 });
  }
}
