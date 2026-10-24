import * as THREE from 'three';
import { GameMap, MapChanges, NO_OWNER, TileType, bridgeAlong } from '../world/map';
import { EDGE_DELTA, Edge, RailNetwork, opposite } from '../world/rail';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRIDGE_DECK, ROAD_BRIDGE, axisRotation } from './rail';
import { SIDEWALK_WIDTH, WALK_INSET, hasCrosswalks, sidewalkTown, type RoadConnects } from '../world/sidewalks';
import { withLampLightUv } from './nightLights';

export type { RoadConnects } from '../world/sidewalks';

// Bity propojení silnice se sousedy: S = y-1, V = x+1, J = y+1, Z = x-1
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const VARIANTS = 16;
const CELL = 128;
// Řádek atlasu: obyčejná silnice a městská křižovatka se zebrami
const ROWS = 2;
const CROSSWALK_ROW = 1;

const STREETLIGHT_HEIGHT = 0.35;
const STREETLIGHT_POLE = (() => {
  const headHeight = 0.065 + 0.018;
  const poleHeight = STREETLIGHT_HEIGHT - headHeight - 0.02;
  const pole = new THREE.CylinderGeometry(0.014, 0.019, poleHeight, 6);
  pole.translate(0, 0.02 + poleHeight / 2, 0);
  const base = new THREE.CylinderGeometry(0.028, 0.028, 0.035, 8);
  base.translate(0, 0.0175, 0);
  return mergeGeometries([pole, base])!;
})();
const STREETLIGHT_HEAD = (() => {
  const glass = new THREE.BoxGeometry(0.045, 0.065, 0.045);
  glass.translate(0, STREETLIGHT_HEIGHT - 0.018 - 0.0325, 0);
  const cap = new THREE.BoxGeometry(0.075, 0.018, 0.075);
  cap.translate(0, STREETLIGHT_HEIGHT - 0.009, 0);
  return mergeGeometries([glass, cap])!;
})();
const STREETLIGHT_POLE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x454843 });
const STREETLIGHT_HEAD_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x9a916d });

// Zebra přes rameno křižovatky na ose chůze po chodníku
function drawCrosswalks(ctx: CanvasRenderingContext2D, mask: number, ox: number, oy: number): void {
  const c = CELL / 2;
  const half = CELL * 0.25;
  const across = CELL * WALK_INSET;
  const depth = CELL * 0.12;
  const stripe = CELL * 0.05;
  ctx.fillStyle = '#ecece4';
  for (let s = -half + stripe / 2; s + stripe <= half; s += stripe * 2) {
    if (mask & N) ctx.fillRect(ox + c + s, oy + across - depth / 2, stripe, depth);
    if (mask & S) ctx.fillRect(ox + c + s, oy + CELL - across - depth / 2, stripe, depth);
    if (mask & W) ctx.fillRect(ox + across - depth / 2, oy + c + s, depth, stripe);
    if (mask & E) ctx.fillRect(ox + CELL - across - depth / 2, oy + c + s, depth, stripe);
  }
}

// Atlas 16 variant silnice podle propojení se sousedy, kreslený do canvasu
function createRoadAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * VARIANTS;
  canvas.height = CELL * ROWS;
  const ctx = canvas.getContext('2d')!;
  const c = CELL / 2;

  const arms = (mask: number, half: number, ox: number): void => {
    ctx.fillRect(ox + c - half, c - half, half * 2, half * 2);
    if (mask & N) ctx.fillRect(ox + c - half, 0, half * 2, c);
    if (mask & S) ctx.fillRect(ox + c - half, c, half * 2, c);
    if (mask & W) ctx.fillRect(ox, c - half, c, half * 2);
    if (mask & E) ctx.fillRect(ox + c, c - half, c, half * 2);
  };

  for (let mask = 0; mask < VARIANTS; mask++) {
    const ox = mask * CELL;
    ctx.fillStyle = '#b9b8b0';
    arms(mask, CELL * 0.32, ox);
    ctx.fillStyle = '#4d4e54';
    arms(mask, CELL * 0.25, ox);

    // Středová čára jen na rovných úsecích a zatáčkách, ne na křižovatkách
    const count = [N, E, S, W].filter((bit) => mask & bit).length;
    if (count === 0 || count > 2) continue;
    ctx.strokeStyle = '#e8e8e0';
    ctx.lineWidth = CELL * 0.025;
    ctx.setLineDash([CELL * 0.1, CELL * 0.08]);
    ctx.beginPath();
    const ends: [number, number][] = [];
    if (mask & N) ends.push([c, 0]);
    if (mask & S) ends.push([c, CELL]);
    if (mask & W) ends.push([0, c]);
    if (mask & E) ends.push([CELL, c]);
    for (const [ex, ey] of ends) {
      ctx.moveTo(ox + ex, ey);
      ctx.lineTo(ox + c, c);
    }
    ctx.stroke();
  }

  // Druhý řádek je kopie prvního, křižovatky v něm mají zebry
  ctx.setLineDash([]);
  ctx.drawImage(canvas, 0, 0, CELL * VARIANTS, CELL, 0, CELL * CROSSWALK_ROW, CELL * VARIANTS, CELL);
  for (let mask = 0; mask < VARIANTS; mask++) {
    const count = [N, E, S, W].filter((bit) => mask & bit).length;
    if (count >= 3) drawCrosswalks(ctx, mask, mask * CELL, CELL * CROSSWALK_ROW);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

let atlas: THREE.CanvasTexture | null = null;

export function roadAtlas(): THREE.CanvasTexture {
  atlas ??= createRoadAtlas();
  return atlas;
}

export function roadConnects(map: GameMap, rail: RailNetwork): RoadConnects {
  return (x, y, edge) => {
    const nx = x + EDGE_DELTA[edge][0];
    const ny = y + EDGE_DELTA[edge][1];
    // Most se napojuje jen na svých koncích
    const own = map.roadBridgeAxis(x, y);
    if (own && !bridgeAlong(own, edge)) return false;
    const other = map.roadBridgeAxis(nx, ny);
    if (other) return bridgeAlong(other, edge);
    if (map.isRoad(nx, ny)) return true;
    return map.isType(nx, ny, TileType.RoadDepot) && rail.roadDepotAt(nx, ny)?.entrance === opposite(edge);
  };
}

// Silnice na dlaždicích tiles s napojením podle connects; crosswalks určí křižovatky se zebrami
export function roadGeometry(
  tiles: Iterable<{ x: number; y: number }>,
  connects: RoadConnects,
  lift: number,
  crosswalks: (x: number, y: number) => boolean = () => false,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const inset = 0.5 / (CELL * VARIANTS);
  const insetV = 0.5 / (CELL * ROWS);
  for (const { x, y } of tiles) {
    const mask =
      (connects(x, y, Edge.N) ? N : 0) |
      (connects(x, y, Edge.E) ? E : 0) |
      (connects(x, y, Edge.S) ? S : 0) |
      (connects(x, y, Edge.W) ? W : 0);
    const u0 = mask / VARIANTS + inset;
    const u1 = (mask + 1) / VARIANTS - inset;
    // Řádek 0 je v canvasu nahoře, tedy u v = 1
    const row = crosswalks(x, y) ? CROSSWALK_ROW : 0;
    const v0 = 1 - (row + 1) / ROWS + insetV;
    const v1 = 1 - row / ROWS - insetV;
    const v = positions.length / 3;
    positions.push(x, lift, y, x + 1, lift, y, x + 1, lift, y + 1, x, lift, y + 1);
    uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
    indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Výška chodníku nad terénem; obrubník je jeho bočnice
export const SIDEWALK_HEIGHT = 0.02;

// Chodníky městských silnic: rohy dlaždice vždy, podél hrany jen tam, kde silnice nepokračuje
export function sidewalkGeometry(
  tiles: Iterable<{ x: number; y: number }>,
  connects: RoadConnects,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const h = SIDEWALK_HEIGHT;
  const quad = (corners: number[], normal: [number, number, number]): void => {
    const v = positions.length / 3;
    positions.push(...corners);
    for (let k = 0; k < 4; k++) normals.push(...normal);
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  // Kvádr chodníku nad obdélníkem [x0, x1] × [z0, z1]
  const slab = (x0: number, z0: number, x1: number, z1: number): void => {
    quad([x0, h, z0, x0, h, z1, x1, h, z1, x1, h, z0], [0, 1, 0]);
    quad([x0, 0, z1, x1, 0, z1, x1, h, z1, x0, h, z1], [0, 0, 1]);
    quad([x1, 0, z0, x0, 0, z0, x0, h, z0, x1, h, z0], [0, 0, -1]);
    quad([x1, 0, z1, x1, 0, z0, x1, h, z0, x1, h, z1], [1, 0, 0]);
    quad([x0, 0, z0, x0, 0, z1, x0, h, z1, x0, h, z0], [-1, 0, 0]);
  };
  const w = SIDEWALK_WIDTH;
  for (const { x, y } of tiles) {
    slab(x, y, x + w, y + w);
    slab(x + 1 - w, y, x + 1, y + w);
    slab(x + 1 - w, y + 1 - w, x + 1, y + 1);
    slab(x, y + 1 - w, x + w, y + 1);
    if (!connects(x, y, Edge.N)) slab(x + w, y, x + 1 - w, y + w);
    if (!connects(x, y, Edge.S)) slab(x + w, y + 1 - w, x + 1 - w, y + 1);
    if (!connects(x, y, Edge.W)) slab(x, y + w, x + w, y + 1 - w);
    if (!connects(x, y, Edge.E)) slab(x + 1 - w, y + w, x + 1, y + 1 - w);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

// Silnice a chodníky městských silnic, silniční mosty s vozovkou na mostovce
export class RoadView {
  readonly object = new THREE.Group();
  // Zvyšuje se s každou přestavbou, aby chodci poznali změnu chodníků
  version = 0;
  // Dlaždice s chodníky podle města
  readonly sidewalks = new Map<number, number[]>();
  private streetLampPositions: THREE.Vector3[] = [];
  private readonly road: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly sidewalk: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly bridges: THREE.Mesh;
  private readonly streetLights = new THREE.Group();
  // Kód dlaždice při poslední přestavbě: silnice, garáž a město vlastnící chodník
  private readonly roadTiles: Int32Array;
  private readonly changes: MapChanges;

  constructor(
    private readonly map: GameMap,
    private readonly rail: RailNetwork,
  ) {
    this.road = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ map: roadAtlas(), alphaTest: 0.5 }),
    );
    this.sidewalk = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0xc4c1b6 }));
    this.bridges = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.object.add(this.road, this.sidewalk, this.bridges, this.streetLights);
    this.roadTiles = new Int32Array(map.width * map.height);
    this.changes = new MapChanges(map);
    this.rebuild();
  }

  get streetLamps(): readonly THREE.Vector3[] {
    return this.streetLampPositions;
  }

  get groundMaterials(): THREE.MeshLambertMaterial[] {
    return [this.road.material, this.sidewalk.material];
  }

  setNightMode(night: boolean): void {
    STREETLIGHT_HEAD_MATERIAL.color.setHex(night ? 0xffd58a : 0x9a916d);
    STREETLIGHT_HEAD_MATERIAL.emissive.setHex(night ? 0xffb74d : 0x000000);
    STREETLIGHT_HEAD_MATERIAL.emissiveIntensity = night ? 1.8 : 0;
  }

  private code(x: number, y: number): number {
    const road = this.map.isRoad(x, y) ? 1 : this.map.isType(x, y, TileType.RoadDepot) ? 2 : 0;
    return road + (sidewalkTown(this.map, x, y) + 1) * 4;
  }

  // Přestavba jen při změně silniční sítě, garáží nebo vlastníka silnice, ne při každé změně mapy
  sync(): void {
    const changes = this.changes.take();
    const width = this.map.width;
    const roadChanged =
      changes === null || changes.some((i) => this.roadTiles[i] !== this.code(i % width, Math.floor(i / width)));
    if (roadChanged) this.rebuild();
  }

  rebuild(): void {
    const { map } = this;
    const tiles: { x: number; y: number }[] = [];
    const bridgeTiles: { x: number; y: number; axis: 'x' | 'y' }[] = [];
    const sidewalkTiles: { x: number; y: number }[] = [];
    this.sidewalks.clear();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const code = this.code(x, y);
        this.roadTiles[y * map.width + x] = code;
        const axis = map.roadBridgeAxis(x, y);
        if (axis) bridgeTiles.push({ x, y, axis });
        else if ((code & 3) === 1) tiles.push({ x, y });
        const town = sidewalkTown(map, x, y);
        if (town === NO_OWNER) continue;
        sidewalkTiles.push({ x, y });
        let list = this.sidewalks.get(town);
        if (!list) this.sidewalks.set(town, (list = []));
        list.push(y * map.width + x);
      }
    }
    const connects = roadConnects(map, this.rail);
    const crosswalks = (x: number, y: number): boolean => hasCrosswalks(map, connects, x, y);
    const land = roadGeometry(tiles, connects, 0.005, crosswalks);
    this.road.geometry.dispose();
    this.road.geometry = withLampLightUv(
      bridgeTiles.length > 0
        ? mergeGeometries([land, roadGeometry(bridgeTiles, connects, BRIDGE_DECK + 0.005)])!
        : land,
    );
    this.bridges.geometry.dispose();
    this.bridges.geometry =
      bridgeTiles.length > 0
        ? mergeGeometries(
            bridgeTiles.map(({ x, y, axis }) =>
              ROAD_BRIDGE.clone().applyMatrix4(
                new THREE.Matrix4()
                  .makeTranslation(x + 0.5, 0, y + 0.5)
                  .multiply(new THREE.Matrix4().makeRotationY(axisRotation(axis))),
              ),
            ),
          )!
        : new THREE.BufferGeometry();
    this.sidewalk.geometry.dispose();
    this.sidewalk.geometry = withLampLightUv(sidewalkGeometry(sidewalkTiles, connects));
    this.rebuildStreetLights(sidewalkTiles, connects);
    this.version++;
  }

  private rebuildStreetLights(tiles: readonly { x: number; y: number }[], connects: RoadConnects): void {
    for (const light of this.streetLights.children as THREE.InstancedMesh[]) light.dispose();
    this.streetLights.clear();
    const positions: THREE.Vector3[] = [];
    for (const { x, y } of tiles) {
      const vertical = connects(x, y, Edge.N) || connects(x, y, Edge.S);
      const horizontal = connects(x, y, Edge.E) || connects(x, y, Edge.W);
      const count = Number(vertical) + Number(horizontal);
      if (count === 0 || hasCrosswalks(this.map, connects, x, y)) continue;

      const alongVertical = vertical && (!horizontal || (x + y) % 2 === 0);
      const along = alongVertical ? y : x;
      const across = alongVertical ? x : y;
      if (along % 4 !== across % 4) continue;

      if (alongVertical) {
        positions.push(new THREE.Vector3(x + 0.035, SIDEWALK_HEIGHT, y + 0.5));
        positions.push(new THREE.Vector3(x + 0.965, SIDEWALK_HEIGHT, y + 0.5));
      } else {
        positions.push(new THREE.Vector3(x + 0.5, SIDEWALK_HEIGHT, y + 0.035));
        positions.push(new THREE.Vector3(x + 0.5, SIDEWALK_HEIGHT, y + 0.965));
      }
    }

    this.streetLampPositions = positions;
    if (positions.length === 0) return;
    const poles = new THREE.InstancedMesh(STREETLIGHT_POLE, STREETLIGHT_POLE_MATERIAL, positions.length);
    const heads = new THREE.InstancedMesh(STREETLIGHT_HEAD, STREETLIGHT_HEAD_MATERIAL, positions.length);
    const matrix = new THREE.Matrix4();
    positions.forEach((position, i) => {
      matrix.makeTranslation(position.x, position.y, position.z);
      poles.setMatrixAt(i, matrix);
      heads.setMatrixAt(i, matrix);
    });
    poles.computeBoundingSphere();
    heads.computeBoundingSphere();
    this.streetLights.add(poles, heads);
  }
}
