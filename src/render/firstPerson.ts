import * as THREE from 'three';
import { HEIGHT_STEP, TileType, type GameMap } from '../world/map';
import { BRIDGE_DECK } from './rail';

// Zoom, který se v pohledu z první osoby hlásí LOD a efektům: plné detaily stromů, budov, zvířat a světel
export const FIRST_PERSON_DETAIL_ZOOM = 4;
// Dohled kamery a mlha, která ho zakryje (v dlaždicích)
const FAR = 90;
export const FOG_NEAR = 28;
export const FOG_FAR = 80;
// Okruh dlaždic kolem kamery pro efekty počítané po dlaždicích (listí, mlha v lese)
export const FIRST_PERSON_EFFECT_RADIUS = 14;
const FOV = 70;
// Dlaždice ≈ 10 m (postava 0,16 dlaždice ≈ 1,7 m), převod rychlosti pro tachometr
const KMH_PER_TILE_PER_SECOND = 36;
// Rozhlížení tažením myši
const LOOK_RADIANS_PER_PIXEL = 0.004;
const MAX_PITCH = 1.2;
const CAB_PITCH = -0.06;

// Chůze: výška očí, rychlost (dlaždice za sekundu) a poloměr těla pro narážení do budov
const EYE_HEIGHT = 0.15;
const WALK_SPEED = 0.45;
const RUN_SPEED = 1.3;
const BODY_RADIUS = 0.07;
// Dlaždice, kam chodec nevejde
const BLOCKED = new Set<TileType>([
  TileType.Water,
  TileType.Building,
  TileType.Industry,
  TileType.Depot,
  TileType.RoadDepot,
  TileType.Bridge,
]);

// Poloha a natočení vozidla pro pohled z kabiny: střed vozu na zemi, směr jízdy (úhel v rovině XZ od +Z k +X),
// výška střechy a vzdálenost čela od středu
export interface CabPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  height: number;
  front: number;
}

// Kamera, kterou GameView vykreslí místo izometrického pohledu
export interface FirstPersonController {
  readonly camera: THREE.PerspectiveCamera;
  update(seconds: number): void;
  // Tažení myší v překryvném UI
  look(dx: number, dy: number): void;
  dispose(): void;
}

function perspectiveCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.01, FAR);
  camera.rotation.order = 'YXZ';
  return camera;
}

function fitAspect(camera: THREE.PerspectiveCamera): void {
  const aspect = window.innerWidth / window.innerHeight;
  if (camera.aspect === aspect) return;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

// Rozdíl úhlů v rozsahu (−π, π]
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// Kamera míří ve směru yaw (úhel od +Z k +X); kamera three.js se dívá podél −Z, proto + π
function aim(camera: THREE.PerspectiveCamera, yaw: number, pitch: number): void {
  camera.rotation.set(pitch, yaw + Math.PI, 0);
  camera.updateMatrixWorld();
}

// Směr pohledu izometrické kamery na zemi jako yaw pro kameru z první osoby
export function groundYaw(camera: THREE.Camera): number {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  return Math.atan2(direction.x, direction.z);
}

// Pohled z kabiny: kamera sedí u čela vozidla a jede s ním; myší se jde rozhlížet kolem směru jízdy
export class CabCamera implements FirstPersonController {
  readonly camera = perspectiveCamera();
  // Rychlost v km/h podle skutečného pohybu ve scéně (vyhlazená)
  speedKmh = 0;
  // Vozidlo zrovna není na trati (depo, garáž), kamera stojí na posledním místě
  parked = false;
  private yaw = 0;
  private pitch = CAB_PITCH;
  private heading: number | null = null;
  private last: { x: number; z: number } | null = null;

  constructor(private readonly pose: () => CabPose | null) {}

  look(dx: number, dy: number): void {
    this.yaw = THREE.MathUtils.clamp(this.yaw - dx * LOOK_RADIANS_PER_PIXEL, -Math.PI, Math.PI);
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_RADIANS_PER_PIXEL, -MAX_PITCH, MAX_PITCH);
  }

  // Zpět na pohled vpřed
  resetLook(): void {
    this.yaw = 0;
    this.pitch = CAB_PITCH;
  }

  update(seconds: number): void {
    fitAspect(this.camera);
    const pose = this.pose();
    this.parked = pose === null;
    if (!pose) {
      this.speedKmh = 0;
      this.last = null;
      aim(this.camera, (this.heading ?? 0) + this.yaw, this.pitch);
      return;
    }
    // Směr se mírně vyhlazuje, aby se obraz v obloucích netřásl
    this.heading =
      this.heading === null
        ? pose.heading
        : this.heading + angleDelta(this.heading, pose.heading) * Math.min(1, seconds * 12);
    if (this.last && seconds > 0) {
      const distance = Math.hypot(pose.x - this.last.x, pose.z - this.last.z);
      // Skok (vlak se otočil ve stanici, auto bylo přemístěno) do tachometru nepatří
      const kmh = distance < 1 ? (distance / seconds) * KMH_PER_TILE_PER_SECOND : this.speedKmh;
      this.speedKmh += (kmh - this.speedKmh) * Math.min(1, seconds * 4);
    }
    this.last = { x: pose.x, z: pose.z };
    const forward = pose.front * 0.55;
    this.camera.position.set(
      pose.x + Math.sin(pose.heading) * forward,
      pose.y + pose.height * 0.82,
      pose.z + Math.cos(pose.heading) * forward,
    );
    aim(this.camera, this.heading + this.yaw, this.pitch);
  }

  dispose(): void {}
}

// Je bod (x, z) pro chodce volný? Kontroluje rohy čtverce o poloměru těla
export function canStand(map: GameMap, x: number, z: number, radius = BODY_RADIUS): boolean {
  for (const ox of [-radius, radius]) {
    for (const oz of [-radius, radius]) {
      const tx = Math.floor(x + ox);
      const tz = Math.floor(z + oz);
      if (!map.inBounds(tx, tz) || BLOCKED.has(map.get(tx, tz))) return false;
    }
  }
  return true;
}

// Nejbližší dlaždice, kam se dá postavit, hledaná v soustředných čtvercích kolem (x, y)
export function nearestStandable(map: GameMap, x: number, y: number, maxRadius = 6): { x: number; y: number } | null {
  for (let r = 0; r <= maxRadius; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!canStand(map, x + dx + 0.5, y + dy + 0.5)) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x: x + dx, y: y + dy, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return null;
}

const WALK_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'];

// Průzkum pěšky: WASD nebo šipky chůze, Shift běh, myší rozhlížení; budovy a voda zastaví
export class WalkCamera implements FirstPersonController {
  readonly camera = perspectiveCamera();
  readonly position: THREE.Vector2;
  private readonly held = new Set<string>();
  private pitch = 0;
  private bob = 0;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!(e.code in WALK_KEYS) && !RUN_KEYS.includes(e.code)) return;
    e.preventDefault();
    this.held.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
  private readonly onBlur = (): void => this.held.clear();

  constructor(
    private readonly map: GameMap,
    x: number,
    z: number,
    // Směr pohledu jako úhel od +Z k +X
    private yaw: number,
  ) {
    this.position = new THREE.Vector2(x, z);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  // Směr pohledu pro kompas: úhel od +Z k +X
  get heading(): number {
    return this.yaw;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_RADIANS_PER_PIXEL;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_RADIANS_PER_PIXEL, -MAX_PITCH, MAX_PITCH);
  }

  update(seconds: number): void {
    fitAspect(this.camera);
    let side = 0;
    let ahead = 0;
    for (const code of this.held) {
      const step = WALK_KEYS[code];
      if (!step) continue;
      side += step[0];
      ahead += step[1];
    }
    const length = Math.hypot(side, ahead);
    if (length > 0 && seconds > 0) {
      const run = RUN_KEYS.some((code) => this.held.has(code));
      const distance = (run ? RUN_SPEED : WALK_SPEED) * Math.min(seconds, 0.1);
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Vpřed je (sin, cos), vpravo (−cos, sin); šikmo jde chodec stejně rychle jako rovně
      const dx = ((ahead * sin - side * cos) / length) * distance;
      const dz = ((ahead * cos + side * sin) / length) * distance;
      // Po osách zvlášť, aby chodec podél zdi klouzal a nezasekl se
      if (canStand(this.map, this.position.x + dx, this.position.y)) this.position.x += dx;
      if (canStand(this.map, this.position.x, this.position.y + dz)) this.position.y += dz;
      this.bob += distance * (run ? 22 : 30);
    }
    const tx = Math.floor(this.position.x);
    const tz = Math.floor(this.position.y);
    // Na silničním mostě jde chodec po mostovce
    const lift = this.map.inBounds(tx, tz) && this.map.roadBridgeAxis(tx, tz) ? BRIDGE_DECK : 0;
    const ground = this.map.heightAt(this.position.x, this.position.y);
    this.camera.position.set(this.position.x, ground + EYE_HEIGHT + lift + Math.sin(this.bob) * 0.004, this.position.y);
    aim(this.camera, this.yaw, this.pitch);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

// Zvýraznění dlaždice, nad kterou hráč drží panáčka; červená = sem nemůže
export class DropMarker {
  readonly object: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  constructor(private readonly map?: GameMap) {
    const geometry = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2).translate(0.5, 0.03, 0.5);
    this.object = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffc928, transparent: true, opacity: 0.55, depthTest: false }),
    );
    this.object.renderOrder = 11;
    this.object.visible = false;
  }

  show(tile: { x: number; y: number } | null, valid = true): void {
    this.object.visible = tile !== null;
    if (!tile) return;
    const top = this.map?.inBounds(tile.x, tile.y) ? Math.max(...this.map.tileCorners(tile.x, tile.y)) : 0;
    this.object.position.set(tile.x, top * HEIGHT_STEP, tile.y);
    this.object.material.color.set(valid ? 0xffc928 : 0xd84a3a);
  }
}

// Obdélník dlaždic [x0, y0, x1, y1] kolem kamery z první osoby (její záběr na zem nemá konečný obrys)
export function tilesAroundCamera(
  camera: THREE.Camera,
  map: Pick<GameMap, 'width' | 'height'>,
  radius = FIRST_PERSON_EFFECT_RADIUS,
): [number, number, number, number] {
  const { x, z } = camera.position;
  return [
    Math.max(0, Math.floor(x - radius)),
    Math.max(0, Math.floor(z - radius)),
    Math.min(map.width - 1, Math.floor(x + radius)),
    Math.min(map.height - 1, Math.floor(z + radius)),
  ];
}
