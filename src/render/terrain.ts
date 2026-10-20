import * as THREE from 'three';
import { GameMap, TileType } from '../world/map';
import type { Town } from '../world/town';

const GRASS = new THREE.Color(0x5f9e3c);
const WATER = new THREE.Color(0x3a6fb0);
const PAVEMENT = new THREE.Color(0xa3a39a);
const GARDEN = new THREE.Color(0x6aa843);

// Deterministický šum 0..1 pro jemné odstíny dlaždic
function tileNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class TerrainView {
  readonly object = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly grid: THREE.LineSegments;

  constructor(
    private readonly map: GameMap,
    private readonly towns: readonly Town[],
  ) {
    this.geometry = this.buildGeometry();
    const mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.grid = this.buildGrid();
    this.object.add(mesh, this.grid);
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  get gridVisible(): boolean {
    return this.grid.visible;
  }

  updateTile(x: number, y: number): void {
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.writeTileColor(colors.array as Float32Array, x, y);
    colors.needsUpdate = true;
  }

  private buildGeometry(): THREE.BufferGeometry {
    const { width, height } = this.map;
    const count = width * height;
    const positions = new Float32Array(count * 4 * 3);
    const colors = new Float32Array(count * 4 * 3);
    const indices = new Uint32Array(count * 6);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = i * 12;
        positions.set([x, 0, y, x + 1, 0, y, x + 1, 0, y + 1, x, 0, y + 1], p);
        const v = i * 4;
        indices.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
        this.writeTileColor(colors, x, y);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return geometry;
  }

  private tileColor(x: number, y: number): THREE.Color {
    switch (this.map.get(x, y)) {
      case TileType.Water:
        return WATER;
      case TileType.Building:
        return this.towns[this.map.getOwner(x, y)]?.kind === 'city' ? PAVEMENT : GARDEN;
      default:
        return GRASS;
    }
  }

  private writeTileColor(colors: Float32Array, x: number, y: number): void {
    const base = this.tileColor(x, y);
    const shade = 0.94 + tileNoise(x, y) * 0.08;
    const offset = (y * this.map.width + x) * 12;
    for (let k = 0; k < 4; k++) {
      colors[offset + k * 3] = base.r * shade;
      colors[offset + k * 3 + 1] = base.g * shade;
      colors[offset + k * 3 + 2] = base.b * shade;
    }
  }

  private buildGrid(): THREE.LineSegments {
    const { width, height } = this.map;
    const points: number[] = [];
    const lift = 0.01;
    for (let x = 0; x <= width; x++) points.push(x, lift, 0, x, lift, height);
    for (let y = 0; y <= height; y++) points.push(0, lift, y, width, lift, y);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }),
    );
  }
}
