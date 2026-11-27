import type { GameMap } from '../world/map';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HEIGHT_STEP, TileType } from '../world/map';
import {
  EDGE_DELTA,
  EDGE_MID,
  Edge,
  PIECES,
  RailNetwork,
  RailType,
  bridgeEnd,
  opposite,
  isCorner,
  stationTiles,
  type Axis,
  type RailBridge,
  type StationShape,
} from '../world/rail';
import { BRIDGE_HEIGHT } from '../world/route';
import { createAirportObject } from './airports';
import { createPortObject } from './ports';
import type { Season } from '../game/seasons';
import type { PortShape } from '../world/port';
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
const ROAD_DECK = 0x4d4d50;
const MONORAIL_BEAM = 0xb4b0a6;
const MONORAIL_TOP = 0x4a4a52;
const MONORAIL_FOOT = 0x8a8680;
const MAGLEV_SLAB = 0xc9c7c0;
const MAGLEV_GUIDE = 0x6b7684;
const MAGLEV_STRIP = 0x3a6fb0;
const ROAD_MARKING = 0xe8e4d8;
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

// Kvádr se středem v počátku a barvou ve vrcholech (pro natáčení nájezdů)
function slab(w: number, h: number, d: number, color: number): THREE.BufferGeometry {
  return box(w, h, d, color, 0, -h / 2, 0);
}

const BRIDGE_DECK_THICKNESS = 0.08;
const BRIDGE_WIDTH = 0.5;

// Vrchní stavba koleje (pražce a kolejnice) délky `length` podél osy X, spodkem v y = 0
function trackTop(length: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const sleepers = Math.max(2, Math.round(length / 0.125));
  for (let i = 0; i < sleepers; i++) {
    const x = -length / 2 + (i + 0.5) * (length / sleepers);
    parts.push(box(0.06, 0.02, 0.36, SLEEPER, x, 0, 0));
  }
  for (const z of [-0.1, 0.1]) parts.push(box(length, 0.03, 0.025, RAIL, 0, 0.02, z));
  return parts;
}

// Vozovka silničního mostu délky `length` podél osy X, spodkem v y = 0: asfalt a přerušovaná středová čára
function roadTop(length: number): THREE.BufferGeometry[] {
  const parts = [box(length, 0.012, 0.66, ROAD_DECK, 0, 0, 0)];
  const dashes = Math.max(1, Math.round(length / 0.25));
  for (let i = 0; i < dashes; i++) {
    const x = -length / 2 + (i + 0.5) * (length / dashes);
    parts.push(box((length / dashes) * 0.5, 0.004, 0.025, ROAD_MARKING, x, 0.012, 0));
  }
  return parts;
}

interface BridgeStyle {
  width: number;
  top: (length: number) => THREE.BufferGeometry[];
  railingZ: number;
  pierZ: number;
}

const RAIL_BRIDGE_STYLE: BridgeStyle = { width: BRIDGE_WIDTH, top: trackTop, railingZ: 0.24, pierZ: 0.3 };
const ROAD_BRIDGE_STYLE: BridgeStyle = { width: 0.78, top: roadTop, railingZ: 0.37, pierZ: 0.36 };

// Most podél +X od vnějšího okraje nájezdu A (x = 0) po vnější okraj nájezdu B (x = span + 2):
// nájezdy stoupají na výšku mostovky, pilíře stojí na hranách dlaždic mimo osu, aby nepřekážely provozu pod mostem
export function railBridgeGeometry(span: number, style: BridgeStyle = RAIL_BRIDGE_STYLE): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = BRIDGE_HEIGHT;
  const slope = Math.atan(top);
  const rampLength = Math.hypot(1, top);
  // Nájezdy: šikmá deska s kolejí (vozovkou), natočená kolem osy Z
  for (const [cx, angle] of [
    [0.5, slope],
    [span + 1.5, -slope],
  ] as const) {
    const ramp = [slab(rampLength, BRIDGE_DECK_THICKNESS, style.width, BRIDGE), ...style.top(rampLength)];
    // Kolej leží na horní ploše desky; horní plocha vede od země po výšku mostovky
    ramp.slice(1).forEach((g) => g.translate(0, BRIDGE_DECK_THICKNESS / 2, 0));
    for (const g of ramp) {
      g.translate(0, -BRIDGE_DECK_THICKNESS / 2, 0);
      g.rotateZ(angle);
      g.translate(cx, top / 2, 0);
      parts.push(g);
    }
  }
  // Mostovka s kolejí (vozovkou) a zábradlím
  parts.push(box(span, BRIDGE_DECK_THICKNESS, style.width, BRIDGE, 1 + span / 2, top - BRIDGE_DECK_THICKNESS, 0));
  for (const g of style.top(span)) parts.push(g.translate(1 + span / 2, top, 0));
  for (const z of [-style.railingZ, style.railingZ]) {
    parts.push(box(span, 0.025, 0.025, BRIDGE_RAIL, 1 + span / 2, top + 0.09, z));
    for (let i = 0; i <= span * 4; i++) parts.push(box(0.02, 0.09, 0.02, BRIDGE_RAIL, 1 + i / 4, top, z));
  }
  // Pilíře na hranách dlaždic po obou stranách mostovky
  for (let i = 1; i <= span + 1; i++) {
    for (const z of [-style.pierZ, style.pierZ]) {
      parts.push(box(0.08, top - BRIDGE_DECK_THICKNESS, 0.08, BRIDGE, i, 0, z));
    }
  }
  return mergeGeometries(parts)!;
}

const bridgeGeometries = new Map<string, THREE.BufferGeometry>();

// Most na mapě; geometrie se sdílí podle délky a druhu (road = silniční most)
export function createRailBridgeObject(
  bridge: Pick<RailBridge, 'x' | 'y' | 'dir' | 'span'>,
  material: THREE.Material,
  road = false,
): THREE.Mesh {
  const key = `${road ? 'road' : 'rail'}:${bridge.span}`;
  let geometry = bridgeGeometries.get(key);
  if (!geometry) {
    geometry = railBridgeGeometry(bridge.span, road ? ROAD_BRIDGE_STYLE : RAIL_BRIDGE_STYLE);
    bridgeGeometries.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material);
  const [dx, dy] = EDGE_DELTA[bridge.dir];
  mesh.position.set(bridge.x + 0.5 - dx / 2, 0, bridge.y + 0.5 - dy / 2);
  mesh.rotation.y = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][bridge.dir];
  return mesh;
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

// Jednokolejka: betonový nosník s tmavou pojezdovou plochou na nízkých patkách
function monorailGeometry(length: number): THREE.BufferGeometry {
  const parts = [box(length, 0.09, 0.14, MONORAIL_BEAM, 0, 0.03, 0), box(length, 0.012, 0.1, MONORAIL_TOP, 0, 0.12, 0)];
  const feet = Math.max(1, Math.round(length / 0.5));
  for (let i = 0; i < feet; i++) {
    const x = -length / 2 + (i + 0.5) * (length / feet);
    parts.push(box(0.08, 0.03, 0.22, MONORAIL_FOOT, x, 0, 0));
  }
  return mergeGeometries(parts)!;
}

// Maglev: široká betonová dráha s vodicí lištou uprostřed a modrými magnetickými pásy
function maglevGeometry(length: number): THREE.BufferGeometry {
  return mergeGeometries([
    box(length, 0.05, 0.46, MAGLEV_SLAB, 0, 0, 0),
    box(length, 0.045, 0.1, MAGLEV_GUIDE, 0, 0.05, 0),
    ...[-0.15, 0.15].map((z) => box(length, 0.01, 0.06, MAGLEV_STRIP, 0, 0.05, z)),
  ])!;
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
// Rovný a rohový dílek podle druhu koleje (RailType)
const PIECE_GEOMETRY: Record<RailType, [THREE.BufferGeometry, THREE.BufferGeometry]> = {
  [RailType.Rail]: [STRAIGHT, CORNER],
  [RailType.Monorail]: [monorailGeometry(1), monorailGeometry(Math.SQRT1_2)],
  [RailType.Maglev]: [maglevGeometry(1), maglevGeometry(Math.SQRT1_2)],
};
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

const PITCH = new THREE.Matrix4();
const STRETCH = new THREE.Matrix4();

// Dílek koleje na dlaždici; s mapou ve výšce terénu a ve svahu nakloněný a natažený přes celou šikmou délku
function pieceMatrix(
  x: number,
  y: number,
  piece: number,
  lift: number,
  target: THREE.Matrix4,
  map?: GameMap,
  flat = false,
): THREE.Matrix4 {
  const [a, b] = PIECES[piece];
  const [ax, az] = EDGE_MID[a];
  const [bx, bz] = EDGE_MID[b];
  const angle = Math.atan2(-(bz - az), bx - ax);
  const cx = x + (ax + bx) / 2;
  const cz = y + (az + bz) / 2;
  if (!map) return target.makeRotationY(angle).setPosition(cx, 0.002 + lift, cz);
  if (flat) return target.makeRotationY(angle).setPosition(cx, map.elevation(x, y) + 0.002 + lift, cz);
  const ha = map.heightAt(x + ax, y + az);
  const hb = map.heightAt(x + bx, y + bz);
  target.makeRotationY(angle).setPosition(cx, (ha + hb) / 2 + 0.002 + lift, cz);
  if (ha === hb) return target;
  const length = Math.hypot(bx - ax, bz - az);
  target.multiply(PITCH.makeRotationZ(Math.atan2(hb - ha, length)));
  return target.multiply(STRETCH.makeScale(Math.hypot(length, hb - ha) / length, 1, 1));
}

export interface TrackItem {
  x: number;
  y: number;
  piece: number;
  crossing?: boolean;
  bridge?: boolean;
  // Druh koleje; bez údaje železnice
  type?: RailType;
  // Portál tunelu: kolej vede rovně ve výšce portálu, ne po svahu
  flat?: boolean;
}

const RAIL_TYPES = [RailType.Rail, RailType.Monorail, RailType.Maglev] as const;

// Kusy kolejí jako instancované meshe (rovné a rohové pro každý druh koleje, přejezdy, mostovky)
export class TrackView {
  readonly object = new THREE.Group();
  private pieces: [THREE.InstancedMesh, THREE.InstancedMesh][];
  private crossing: THREE.InstancedMesh;
  private bridge: THREE.InstancedMesh;

  // map: dílky ve výšce terénu a ve svahu nakloněné (bez mapy rovina)
  constructor(
    private readonly material: THREE.Material,
    private readonly map?: GameMap,
  ) {
    this.pieces = RAIL_TYPES.map((type) => {
      const [straight, corner] = PIECE_GEOMETRY[type];
      return [new THREE.InstancedMesh(straight, material, 0), new THREE.InstancedMesh(corner, material, 0)];
    });
    this.crossing = new THREE.InstancedMesh(CROSSING, material, 0);
    this.bridge = new THREE.InstancedMesh(BRIDGE_MESH, material, 0);
    this.object.add(...this.pieces.flat(), this.crossing, this.bridge);
  }

  // type: druh koleje pro položky bez vlastního údaje (náhled stavby)
  update(items: TrackItem[], type: RailType = RailType.Rail): void {
    RAIL_TYPES.forEach((t, i) => {
      const own = items.filter((item) => (item.type ?? type) === t);
      const [straightGeometry, cornerGeometry] = PIECE_GEOMETRY[t];
      const [straight, corner] = this.pieces[i];
      this.pieces[i] = [
        this.replace(
          straight,
          straightGeometry,
          own.filter((item) => !isCorner(item.piece) && !item.crossing),
        ),
        this.replace(
          corner,
          cornerGeometry,
          own.filter((item) => isCorner(item.piece)),
        ),
      ];
    });
    const crossing = items.filter((i) => i.crossing);
    const bridge = items.filter((i) => i.bridge);
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
      mesh.setMatrixAt(
        i,
        pieceMatrix(item.x, item.y, item.piece, deck ? -0.002 : lift, m, this.map, item.flat === true),
      );
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
    // Kolej na nájezdu mostu je součástí mostu; v portálu tunelu vede rovně
    const head = mask !== 0 && rail.bridges.length > 0 ? rail.bridgeAtHead(x, y) : undefined;
    if (head && !head.tunnel) return;
    const flat = head?.tunnel === true;
    const crossing = mask !== 0 && rail.map.get(x, y) === TileType.Crossing;
    const bridge = mask !== 0 && rail.map.get(x, y) === TileType.Bridge;
    const type = rail.railType[i] as RailType;
    for (let piece = 0; mask >> piece; piece++) {
      if (mask & (1 << piece)) {
        items.push({ x, y, piece, crossing, bridge, ...(type ? { type } : {}), ...(flat ? { flat } : {}) });
      }
    }
  });
  return items;
}

const PORTAL_STONE = new THREE.MeshLambertMaterial({ color: 0x9a9184, side: THREE.DoubleSide });
const PORTAL_MOUTH = new THREE.MeshBasicMaterial({ color: 0x141414 });
const PORTAL_HEIGHT = HEIGHT_STEP + 0.12;
// Boční opěrná zeď portálu: trojúhelník od vnějšího okraje dlaždice (0) po vnitřní (výška svahu)
const PORTAL_SIDE = new THREE.BufferGeometry().setAttribute(
  'position',
  new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, HEIGHT_STEP + 0.02, 0], 3),
);
PORTAL_SIDE.computeVertexNormals();

// Portál tunelu na dlaždici (x, y) ve výšce level: čelní zeď s tmavým ústím na vnitřní hraně (inner)
// a boční zdi, které zakryjí svah kolem zaříznutého portálu
export function createTunnelPortal(x: number, y: number, inner: Edge, ground: number): THREE.Group {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.08, PORTAL_HEIGHT, 1), PORTAL_STONE);
  wall.position.set(0.46, PORTAL_HEIGHT / 2, 0);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.52), PORTAL_MOUTH);
  mouth.position.set(0.415, 0.15, 0);
  group.add(wall, mouth);
  for (const side of [-0.5, 0.5]) {
    const sideWall = new THREE.Mesh(PORTAL_SIDE, PORTAL_STONE);
    sideWall.position.z = side;
    group.add(sideWall);
  }
  group.position.set(x + 0.5, ground, y + 0.5);
  // Místní osa +x míří k vnitřní hraně (do kopce)
  group.rotation.y = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][inner];
  return group;
}

// Oba portály tunelu
export function createTunnelPortals(tunnel: RailBridge, map: GameMap): THREE.Group {
  const group = new THREE.Group();
  const end = bridgeEnd(tunnel);
  const ground = map.elevation(tunnel.x, tunnel.y);
  group.add(
    createTunnelPortal(tunnel.x, tunnel.y, tunnel.dir, ground),
    createTunnelPortal(end.x, end.y, opposite(tunnel.dir), ground),
  );
  return group;
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
  private readonly track: TrackView;
  private readonly structures = new THREE.Group();
  // Sníh na střechách letišť a přístavů
  private winter = false;

  constructor(private readonly rail: RailNetwork) {
    this.track = new TrackView(this.material, rail.map);
    this.object.add(this.track.object, this.structures);
    this.rebuild();
  }

  // Stavby stojí na rovných dlaždicích; celý objekt se zvedne na výšku terénu pod (x, y)
  private placed<T extends THREE.Object3D>(object: T, x: number, y: number): T {
    object.position.y += this.rail.map.elevation(x, y);
    return object;
  }

  setSeason(season: Season): void {
    this.winter = season === 'winter';
    this.structures.traverse((part) => {
      if (part.userData.snowRoof) part.visible = this.winter;
    });
  }

  rebuild(): void {
    this.track.update(networkTrack(this.rail));
    this.structures.clear();
    for (const s of this.rail.stations) {
      this.structures.add(
        this.placed(
          s.kind === 'road'
            ? createRoadStopMesh(this.material, s.x, s.y, s.axis)
            : s.kind === 'air'
              ? createAirportObject(s, s.airport ?? 'small', this.material, this.winter)
              : s.kind === 'water'
                ? createPortObject(s as PortShape, this.material, true, this.winter)
                : createStationObject(s, this.material),
          s.x,
          s.y,
        ),
      );
    }
    for (const d of this.rail.depots) {
      const mesh = createDepotMesh(this.material);
      placeDepot(mesh, d.x, d.y, d.entrance);
      this.structures.add(this.placed(mesh, d.x, d.y));
    }
    for (const d of this.rail.roadDepots) {
      const mesh = createRoadDepotMesh(this.material);
      placeDepot(mesh, d.x, d.y, d.entrance);
      this.structures.add(this.placed(mesh, d.x, d.y));
    }
    for (const b of [...this.rail.bridges, ...this.rail.roadBridges]) {
      if (b.tunnel) this.structures.add(createTunnelPortals(b, this.rail.map));
    }
    for (const b of this.rail.bridges) {
      if (!b.tunnel) this.structures.add(this.placed(createRailBridgeObject(b, this.material), b.x, b.y));
    }
    for (const b of this.rail.roadBridges) {
      if (!b.tunnel) this.structures.add(this.placed(createRailBridgeObject(b, this.material, true), b.x, b.y));
    }
  }
}
