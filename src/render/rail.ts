import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TileType } from '../world/map';
import { EDGE_MID, Edge, PIECES, RailNetwork, isCorner, stationTiles, type Axis, type StationShape } from '../world/rail';
import { WATER_DEPTH } from './terrain';

const BALLAST = 0x8c8273;
const SLEEPER = 0x5a3d26;
const RAIL = 0xb8bcc4;
const PLATFORM = 0xb5b2a8;
const PLATFORM_EDGE = 0xe0c040;
const ROOF = 0x8a3c2c;
const POST = 0x4a4a4a;
const WALL = 0x9c6b4a;
const DOOR = 0x2a2420;
const BRIDGE = 0x7a7066;
const BRIDGE_RAIL = 0xa8442c;
const GLASS = 0x9fc4d8;
const SIGN = 0xe0c040;
const GARAGE_WALL = 0xa8a8a0;
const GARAGE_DOOR = 0x6a7078;
const GARAGE_ROOF = 0x55585c;
const ASPHALT = 0x4a4a4e;

// Kvádr s barvou ve vrcholech, posunutý na (x, y, z) dle spodní hrany
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Kus koleje délky `length` podél osy X se středem v počátku
function pieceGeometry(length: number): THREE.BufferGeometry {
  const parts = [box(length, 0.03, 0.44, BALLAST, 0, 0, 0)];
  const sleepers = Math.max(2, Math.round(length / 0.125));
  for (let i = 0; i < sleepers; i++) {
    const x = -length / 2 + (i + 0.5) * (length / sleepers);
    parts.push(box(0.06, 0.025, 0.36, SLEEPER, x, 0.03, 0));
  }
  for (const z of [-0.1, 0.1]) parts.push(box(length, 0.03, 0.025, RAIL, 0, 0.055, z));
  return mergeGeometries(parts)!;
}

// Jeden dílek nástupiště podél osy X: nástupní hrany po obou stranách koleje, volitelně přístřešek
function stationTileGeometry(roof: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-0.36, 0.36]) {
    parts.push(box(1, 0.1, 0.26, PLATFORM, 0, 0, z));
    parts.push(box(1, 0.005, 0.03, PLATFORM_EDGE, 0, 0.1, z - Math.sign(z) * 0.115));
    if (!roof) continue;
    for (const x of [-0.35, 0.35]) parts.push(box(0.04, 0.35, 0.04, POST, x, 0.1, z + Math.sign(z) * 0.06));
    parts.push(box(0.9, 0.04, 0.3, ROOF, 0, 0.45, z));
  }
  return mergeGeometries(parts)!;
}

// Depo s vjezdem ve směru +X
function depotGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.7, 0.42, 0.04, WALL, -0.05, 0, -0.36),
    box(0.7, 0.42, 0.04, WALL, -0.05, 0, 0.36),
    box(0.04, 0.42, 0.76, WALL, -0.4, 0, 0),
    box(0.04, 0.12, 0.76, WALL, 0.3, 0.3, 0),
    box(0.02, 0.3, 0.5, DOOR, 0.29, 0, 0),
    box(0.82, 0.06, 0.86, ROOF, -0.05, 0.42, 0),
  ])!;
}

// Zastávka aut podél osy X: na obou okrajích silnice prosklený přístřešek a sloupek s označením
function roadStopGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const z = side * 0.43;
    parts.push(box(0.5, 0.2, 0.012, GLASS, 0, 0, z + side * 0.05));
    for (const x of [-0.24, 0.24]) parts.push(box(0.03, 0.22, 0.03, POST, x, 0, z + side * 0.05));
    parts.push(box(0.56, 0.025, 0.14, ROOF, 0, 0.22, z));
    parts.push(box(0.02, 0.24, 0.02, POST, side * 0.36, 0, z - side * 0.02));
    parts.push(box(0.09, 0.06, 0.015, SIGN, side * 0.36, 0.2, z - side * 0.02));
  }
  return mergeGeometries(parts)!;
}

// Garáž aut s vjezdem ve směru +X a kouskem vozovky k silnici
function roadDepotGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.7, 0.32, 0.04, GARAGE_WALL, -0.1, 0, -0.34),
    box(0.7, 0.32, 0.04, GARAGE_WALL, -0.1, 0, 0.34),
    box(0.04, 0.32, 0.72, GARAGE_WALL, -0.43, 0, 0),
    box(0.04, 0.08, 0.72, GARAGE_WALL, 0.23, 0.24, 0),
    box(0.02, 0.24, 0.56, GARAGE_DOOR, 0.22, 0, 0),
    box(0.78, 0.05, 0.8, GARAGE_ROOF, -0.1, 0.32, 0),
    box(0.27, 0.006, 0.5, ASPHALT, 0.365, 0, 0),
  ])!;
}
export const BRIDGE_DECK = 0.08;
function bridgeGeometry(): THREE.BufferGeometry {
  const parts = [box(1, 0.05, 0.62, BRIDGE, 0, BRIDGE_DECK - 0.05, 0)];
  for (const z of [-0.29, 0.29]) {
    // Ocelové zábradlí: sloupky, madlo a středová tyč
    for (let i = 0; i < 5; i++) parts.push(box(0.03, 0.17, 0.03, BRIDGE_RAIL, -0.4 + i * 0.2, BRIDGE_DECK, z));
    parts.push(box(1, 0.03, 0.035, BRIDGE_RAIL, 0, BRIDGE_DECK + 0.16, z));
    parts.push(box(1, 0.02, 0.025, BRIDGE_RAIL, 0, BRIDGE_DECK + 0.08, z));
  }
  // Pilíře sahají až k hladině pod úrovní terénu
  const pier = BRIDGE_DECK - 0.05 + WATER_DEPTH;
  for (const z of [-0.22, 0.22]) parts.push(box(0.12, pier, 0.12, BRIDGE, 0, -WATER_DEPTH, z));
  return mergeGeometries(parts)!;
}

// Silniční most podél osy X: širší mostovka než u kolejí, zábradlí po okrajích a pilíře k hladině
function roadBridgeGeometry(): THREE.BufferGeometry {
  const parts = [box(1, 0.05, 0.84, BRIDGE, 0, BRIDGE_DECK - 0.05, 0)];
  for (const z of [-0.4, 0.4]) {
    for (let i = 0; i < 5; i++) parts.push(box(0.03, 0.14, 0.03, BRIDGE_RAIL, -0.4 + i * 0.2, BRIDGE_DECK, z));
    parts.push(box(1, 0.03, 0.035, BRIDGE_RAIL, 0, BRIDGE_DECK + 0.13, z));
    parts.push(box(1, 0.02, 0.025, BRIDGE_RAIL, 0, BRIDGE_DECK + 0.065, z));
  }
  const pier = BRIDGE_DECK - 0.05 + WATER_DEPTH;
  for (const z of [-0.28, 0.28]) parts.push(box(0.12, pier, 0.12, BRIDGE, 0, -WATER_DEPTH, z));
  return mergeGeometries(parts)!;
}

export const ROAD_BRIDGE = roadBridgeGeometry();

const STRAIGHT = pieceGeometry(1);
const CORNER = pieceGeometry(Math.SQRT1_2);
// Na přejezdu jen kolejnice zapuštěné ve vozovce
const CROSSING = mergeGeometries([-0.1, 0.1].map((z) => box(1, 0.02, 0.025, RAIL, 0, 0.004, z)))!;
const BRIDGE_MESH = bridgeGeometry();
const STATION_TILE = stationTileGeometry(false);
const STATION_TILE_ROOF = stationTileGeometry(true);
const DEPOT = depotGeometry();
const ROAD_STOP = roadStopGeometry();
const ROAD_DEPOT = roadDepotGeometry();

export function entranceRotation(entrance: Edge): number {
  return [Math.PI / 2, 0, -Math.PI / 2, Math.PI][entrance];
}

export function axisRotation(axis: Axis): number {
  return axis === 'x' ? 0 : Math.PI / 2;
}

function pieceMatrix(x: number, y: number, piece: number, lift: number, target: THREE.Matrix4): THREE.Matrix4 {
  const [a, b] = PIECES[piece];
  const [ax, az] = EDGE_MID[a];
  const [bx, bz] = EDGE_MID[b];
  const angle = Math.atan2(-(bz - az), bx - ax);
  return target.makeRotationY(angle).setPosition(x + (ax + bx) / 2, 0.002 + lift, y + (az + bz) / 2);
}

export interface TrackItem {
  x: number;
  y: number;
  piece: number;
  crossing?: boolean;
  bridge?: boolean;
}

// Kusy kolejí jako instancované meshe (rovné, rohové, přejezdy, mostovky)
export class TrackView {
  readonly object = new THREE.Group();
  private straight: THREE.InstancedMesh;
  private corner: THREE.InstancedMesh;
  private crossing: THREE.InstancedMesh;
  private bridge: THREE.InstancedMesh;

  constructor(private readonly material: THREE.Material) {
    this.straight = new THREE.InstancedMesh(STRAIGHT, material, 0);
    this.corner = new THREE.InstancedMesh(CORNER, material, 0);
    this.crossing = new THREE.InstancedMesh(CROSSING, material, 0);
    this.bridge = new THREE.InstancedMesh(BRIDGE_MESH, material, 0);
    this.object.add(this.straight, this.corner, this.crossing, this.bridge);
  }

  update(items: TrackItem[]): void {
    const straight = items.filter((i) => !isCorner(i.piece) && !i.crossing);
    const corner = items.filter((i) => isCorner(i.piece));
    const crossing = items.filter((i) => i.crossing);
    const bridge = items.filter((i) => i.bridge);
    this.straight = this.replace(this.straight, STRAIGHT, straight);
    this.corner = this.replace(this.corner, CORNER, corner);
    this.crossing = this.replace(this.crossing, CROSSING, crossing);
    this.bridge = this.replace(this.bridge, BRIDGE_MESH, bridge, true);
  }

  private replace(
    old: THREE.InstancedMesh,
    geometry: THREE.BufferGeometry,
    items: TrackItem[],
    deck = false,
  ): THREE.InstancedMesh {
    let mesh = old;
    if (old.instanceMatrix.count < items.length) {
      this.object.remove(old);
      old.dispose();
      mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(64, items.length * 2));
      this.object.add(mesh);
    }
    const m = new THREE.Matrix4();
    items.forEach((item, i) => {
      const lift = item.bridge && !deck ? BRIDGE_DECK : 0;
      mesh.setMatrixAt(i, pieceMatrix(item.x, item.y, item.piece, deck ? -0.002 : lift, m));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

export function networkTrack(rail: RailNetwork): TrackItem[] {
  const items: TrackItem[] = [];
  const { width } = rail.map;
  rail.pieces.forEach((mask, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    const crossing = mask !== 0 && rail.map.get(x, y) === TileType.Crossing;
    const bridge = mask !== 0 && rail.map.get(x, y) === TileType.Bridge;
    for (let piece = 0; mask >> piece; piece++) {
      if (mask & (1 << piece)) items.push({ x, y, piece, crossing, bridge });
    }
  });
  return items;
}

// Nástupiště libovolné velikosti z dílků; přístřešek nad prostředním dílkem každé koleje
export function createStationObject(shape: StationShape, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const middle = Math.floor(shape.length / 2);
  stationTiles(shape).forEach((tile, i) => {
    const roof = Math.floor(i / shape.tracks) === middle;
    const mesh = new THREE.Mesh(roof ? STATION_TILE_ROOF : STATION_TILE, material);
    mesh.position.set(tile.x + 0.5, 0, tile.y + 0.5);
    mesh.rotation.y = axisRotation(shape.axis);
    group.add(mesh);
  });
  return group;
}

export function createDepotMesh(material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(DEPOT, material);
}

export function createRoadStopMesh(material: THREE.Material, x: number, y: number, axis: Axis): THREE.Mesh {
  const mesh = new THREE.Mesh(ROAD_STOP, material);
  mesh.position.set(x + 0.5, 0, y + 0.5);
  mesh.rotation.y = axisRotation(axis);
  return mesh;
}

export function createRoadDepotMesh(material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(ROAD_DEPOT, material);
}

export function placeDepot(mesh: THREE.Object3D, x: number, y: number, entrance: Edge): void {
  mesh.position.set(x + 0.5, 0, y + 0.5);
  mesh.rotation.y = entranceRotation(entrance);
}

// Koleje, nástupiště a depa hráče
export class RailView {
  readonly object = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly track = new TrackView(this.material);
  private readonly structures = new THREE.Group();

  constructor(private readonly rail: RailNetwork) {
    this.object.add(this.track.object, this.structures);
    this.rebuild();
  }

  rebuild(): void {
    this.track.update(networkTrack(this.rail));
    this.structures.clear();
    for (const s of this.rail.stations) {
      this.structures.add(
        s.kind === 'road' ? createRoadStopMesh(this.material, s.x, s.y, s.axis) : createStationObject(s, this.material),
      );
    }
    for (const d of this.rail.depots) {
      const mesh = createDepotMesh(this.material);
      placeDepot(mesh, d.x, d.y, d.entrance);
      this.structures.add(mesh);
    }
    for (const d of this.rail.roadDepots) {
      const mesh = createRoadDepotMesh(this.material);
      placeDepot(mesh, d.x, d.y, d.entrance);
      this.structures.add(mesh);
    }
  }
}
