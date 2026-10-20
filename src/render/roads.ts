import * as THREE from 'three';
import { GameMap, MapChanges } from '../world/map';

// Bity propojení silnice se sousedy: S = y-1, V = x+1, J = y+1, Z = x-1
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const VARIANTS = 16;
const CELL = 128;

// Atlas 16 variant silnice podle propojení se sousedy, kreslený do canvasu
function createRoadAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * VARIANTS;
  canvas.height = CELL;
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

export class RoadView {
  readonly object: THREE.Mesh;
  // Které dlaždice byly silnicí při poslední přestavbě
  private readonly roadTiles: Uint8Array;
  private readonly changes: MapChanges;

  constructor(private readonly map: GameMap) {
    this.object = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ map: createRoadAtlas(), alphaTest: 0.5 }),
    );
    this.roadTiles = new Uint8Array(map.width * map.height);
    this.changes = new MapChanges(map);
    this.rebuild();
  }

  // Přestavba jen při změně silniční sítě, ne při každé změně mapy
  sync(): void {
    const changes = this.changes.take();
    const { map } = this;
    const width = map.width;
    const roadChanged =
      changes === null ||
      changes.some((i) => this.roadTiles[i] !== Number(map.isRoad(i % width, Math.floor(i / width))));
    if (roadChanged) this.rebuild();
  }

  rebuild(): void {
    const { map } = this;
    this.roadTiles.fill(0);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const lift = 0.005;
    const inset = 0.5 / (CELL * VARIANTS);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!map.isRoad(x, y)) continue;
        this.roadTiles[y * map.width + x] = 1;
        const mask =
          (map.isRoad(x, y - 1) ? N : 0) |
          (map.isRoad(x + 1, y) ? E : 0) |
          (map.isRoad(x, y + 1) ? S : 0) |
          (map.isRoad(x - 1, y) ? W : 0);
        const u0 = mask / VARIANTS + inset;
        const u1 = (mask + 1) / VARIANTS - inset;
        const v = positions.length / 3;
        positions.push(x, lift, y, x + 1, lift, y, x + 1, lift, y + 1, x, lift, y + 1);
        uvs.push(u0, 1, u1, 1, u1, 0, u0, 0);
        indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.object.geometry.dispose();
    this.object.geometry = geometry;
  }
}
