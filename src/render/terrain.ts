import * as THREE from 'three';
import { GameMap, MapChanges, TileType } from '../world/map';
import type { Town } from '../world/town';
import type { Season } from '../game/seasons';
import { updateWater, withWater } from './water';
import { withLampLightUv } from './nightLights';

const WATER = new THREE.Color(0x3a6fb0);
// Mělčina u břehu, do hloubky přechází plynule přes dlaždici
const SHALLOW = new THREE.Color(0x5aa3cc);
const PAVEMENT = new THREE.Color(0xa3a39a);
const INDUSTRY_GROUND = new THREE.Color(0x857a68);
const SAND = new THREE.Color(0xd6c38c);
const BANK = new THREE.Color(0x8a7150);
const TERRAIN_PALETTES: Record<
  Season,
  {
    grass: THREE.Color;
    garden: THREE.Color;
    forest: THREE.Color;
    detailTint: readonly [number, number, number];
    detailAlpha: number;
  }
> = {
  spring: {
    grass: new THREE.Color(0x75b84b),
    garden: new THREE.Color(0x8cbe62),
    forest: new THREE.Color(0x568e3b),
    detailTint: [0.95, 1, 0.84],
    detailAlpha: 1,
  },
  summer: {
    grass: new THREE.Color(0x5f9e3c),
    garden: new THREE.Color(0x6aa843),
    forest: new THREE.Color(0x4f8a32),
    detailTint: [1, 1, 1],
    detailAlpha: 1,
  },
  autumn: {
    grass: new THREE.Color(0x9b8b49),
    garden: new THREE.Color(0xaaa05a),
    forest: new THREE.Color(0x806037),
    detailTint: [1, 0.88, 0.62],
    detailAlpha: 0.9,
  },
  winter: {
    grass: new THREE.Color(0xe8ece5),
    garden: new THREE.Color(0xf0f1ed),
    forest: new THREE.Color(0xd5ddd5),
    detailTint: [1, 1, 1],
    detailAlpha: 0.06,
  },
};

// Hladina leží pod terénem, na rozhraní s pevninou je svislý hliněný břeh a nad ním písčitý lem
export const WATER_DEPTH = 0.06;
const BEACH_WIDTH = 0.12;
const BEACH_LIFT = 0.002;
const SHALLOWS_LIFT = 0.001;

// Sousedé v pořadí S, V, J, Z (S = y-1)
const SIDES: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function createGreenTexture(): THREE.DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 173;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const drawBlade = (startX: number, startY: number, length: number, color: readonly number[]): void => {
    let x = startX;
    for (let dy = 0; dy < length; dy++) {
      x += Math.floor(random() * 3) - 1;
      const y = (startY + dy) % size;
      for (let dx = 0; dx < (random() > 0.72 ? 2 : 1); dx++) {
        const offset = (y * size + ((x + dx + size) % size)) * 4;
        pixels.set(color, offset);
      }
    }
  };

  const bladeColors = [
    [39, 79, 29, 125],
    [53, 100, 34, 115],
    [72, 118, 40, 105],
    [91, 137, 49, 95],
    [126, 151, 50, 70],
  ];
  for (let i = 0; i < 500; i++) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const length = 3 + Math.floor(random() * 7);
    const color = bladeColors[Math.floor(random() * bladeColors.length)];
    drawBlade(x, y, length, color);
  }

  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const GREEN_TEXTURE = createGreenTexture();

// Deterministický šum 0..1 pro jemné odstíny dlaždic
function tileNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class TerrainView {
  readonly object = new THREE.Group();
  readonly groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly geometry: THREE.BufferGeometry;
  private readonly greenDetails: THREE.BufferGeometry;
  private readonly greenDetailColors: Float32Array;
  private readonly shore: THREE.Mesh;
  private readonly grid: THREE.LineSegments;
  private readonly changes: MapChanges;
  private season: Season = 'summer';
  // Voda (1) nebo pevnina (0) při posledním vykreslení, při změně se přestaví břehy
  private readonly water: Uint8Array;

  constructor(
    private readonly map: GameMap,
    private readonly towns: readonly Town[],
  ) {
    this.changes = new MapChanges(map);
    this.water = new Uint8Array(map.width * map.height);
    this.geometry = this.buildGeometry();
    this.greenDetails = this.buildGreenDetails();
    this.greenDetailColors = this.greenDetails.getAttribute('color').array as Float32Array;
    // Hladina (dlaždice vody i mělčina) má animované vlnky
    const surface = -WATER_DEPTH + 0.005;
    const mesh = new THREE.Mesh(this.geometry, withWater(this.groundMaterial, surface));
    mesh.onBeforeRender = () => updateWater(performance.now() / 1000);
    const details = new THREE.Mesh(
      this.greenDetails,
      new THREE.MeshBasicMaterial({
        map: GREEN_TEXTURE,
        transparent: true,
        depthWrite: false,
        vertexColors: true,
      }),
    );
    this.shore = new THREE.Mesh(
      this.buildShore(),
      withWater(new THREE.MeshLambertMaterial({ vertexColors: true }), surface),
    );
    this.grid = this.buildGrid();
    this.object.add(mesh, details, this.shore, this.grid);
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  setSeason(season: Season): void {
    if (this.season === season) return;
    this.season = season;
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const detailColors = this.greenDetails.getAttribute('color') as THREE.BufferAttribute;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        this.writeTileColor(colors.array as Float32Array, x, y);
        this.writeGreenDetailAlpha(x, y);
      }
    }
    colors.clearUpdateRanges();
    colors.needsUpdate = true;
    detailColors.clearUpdateRanges();
    detailColors.needsUpdate = true;
  }

  get gridVisible(): boolean {
    return this.grid.visible;
  }

  updateTile(x: number, y: number): void {
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.writeTileColor(colors.array as Float32Array, x, y);
    colors.needsUpdate = true;
    this.writeGreenDetailAlpha(x, y);
    const detailColors = this.greenDetails.getAttribute('color') as THREE.BufferAttribute;
    detailColors.addUpdateRange((y * this.map.width + x) * 16 + 3, 16);
    detailColors.needsUpdate = true;
  }

  // Přebarví jen dlaždice změněné od posledního volání; změna vody přestaví i břehy a mělčiny
  sync(): void {
    const changes = this.changes.take();
    if (changes === null) {
      this.refresh();
      return;
    }
    if (changes.length === 0) return;
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const detailColors = this.greenDetails.getAttribute('color') as THREE.BufferAttribute;
    const { width } = this.map;
    let shoreChanged = false;
    for (const i of new Set(changes)) {
      const x = i % width;
      const y = Math.floor(i / width);
      this.writeGreenDetailAlpha(x, y);
      detailColors.addUpdateRange(i * 16 + 3, 16);
      const water = this.isWater(x, y) ? 1 : 0;
      if (water === this.water[i]) {
        this.writeTileColor(colors.array as Float32Array, x, y);
        colors.addUpdateRange(i * 12, 12);
        continue;
      }
      this.water[i] = water;
      shoreChanged = true;
      this.writeTileHeight(positions.array as Float32Array, x, y);
      positions.addUpdateRange(i * 12, 12);
      positions.needsUpdate = true;
      this.writeTileColor(colors.array as Float32Array, x, y);
      colors.addUpdateRange(i * 12, 12);
    }
    detailColors.needsUpdate = true;
    colors.needsUpdate = true;
    if (shoreChanged) this.rebuildShore();
  }

  refresh(): void {
    const colors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        this.water[y * this.map.width + x] = this.isWater(x, y) ? 1 : 0;
        this.writeTileHeight(positions.array as Float32Array, x, y);
        this.writeTileColor(colors.array as Float32Array, x, y);
        this.writeGreenDetailAlpha(x, y);
      }
    }
    colors.clearUpdateRanges();
    colors.needsUpdate = true;
    const detailColors = this.greenDetails.getAttribute('color') as THREE.BufferAttribute;
    detailColors.clearUpdateRanges();
    detailColors.needsUpdate = true;
    positions.clearUpdateRanges();
    positions.needsUpdate = true;
    this.rebuildShore();
  }

  private isGreenTile(x: number, y: number): boolean {
    const type = this.map.get(x, y);
    return (
      type === TileType.Grass ||
      type === TileType.Trees ||
      (type === TileType.Building && this.towns[this.map.getOwner(x, y)]?.kind !== 'city')
    );
  }

  private writeGreenDetailAlpha(x: number, y: number): void {
    const offset = (y * this.map.width + x) * 16;
    const { detailTint, detailAlpha } = TERRAIN_PALETTES[this.season];
    const alpha = this.isGreenTile(x, y) ? detailAlpha : 0;
    for (let k = 0; k < 4; k++) {
      const vertex = offset + k * 4;
      this.greenDetailColors[vertex] = detailTint[0];
      this.greenDetailColors[vertex + 1] = detailTint[1];
      this.greenDetailColors[vertex + 2] = detailTint[2];
      this.greenDetailColors[vertex + 3] = alpha;
    }
  }

  private buildGreenDetails(): THREE.BufferGeometry {
    const { width, height } = this.map;
    const count = width * height;
    const positions = new Float32Array(count * 12);
    const uvs = new Float32Array(count * 8);
    const colors = new Float32Array(count * 16);
    const indices = new Uint32Array(count * 6);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = i * 12;
        positions.set([x, 0.001, y, x + 1, 0.001, y, x + 1, 0.001, y + 1, x, 0.001, y + 1], p);
        uvs.set(
          [x * 0.5, y * 0.5, (x + 1) * 0.5, y * 0.5, (x + 1) * 0.5, (y + 1) * 0.5, x * 0.5, (y + 1) * 0.5],
          i * 8,
        );
        for (let k = 0; k < 4; k++) {
          const c = i * 16 + k * 4;
          colors[c] = 1;
          colors[c + 1] = 1;
          colors[c + 2] = 1;
          colors[c + 3] = this.isGreenTile(x, y) ? 1 : 0;
        }
        const v = i * 4;
        indices.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  }

  // Voda včetně dlaždic pod železničním i silničním mostem
  private isWater(x: number, y: number): boolean {
    return (
      this.map.isType(x, y, TileType.Water) ||
      this.map.isType(x, y, TileType.Bridge) ||
      this.map.roadBridgeAxis(x, y) !== null
    );
  }

  private isLand(x: number, y: number): boolean {
    return this.map.inBounds(x, y) && !this.isWater(x, y);
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
        this.water[i] = this.isWater(x, y) ? 1 : 0;
        this.writeTileHeight(positions, x, y);
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
    return withLampLightUv(geometry);
  }

  private writeTileHeight(positions: Float32Array, x: number, y: number): void {
    const h = this.isWater(x, y) ? -WATER_DEPTH : 0;
    positions.set([x, h, y, x + 1, h, y, x + 1, h, y + 1, x, h, y + 1], (y * this.map.width + x) * 12);
  }

  private tileColor(x: number, y: number): THREE.Color {
    const palette = TERRAIN_PALETTES[this.season];
    switch (this.map.get(x, y)) {
      case TileType.Water:
      case TileType.Bridge:
      case TileType.RoadBridgeX:
      case TileType.RoadBridgeY:
        return WATER;
      case TileType.Trees:
        return palette.forest;
      case TileType.Building:
        return this.towns[this.map.getOwner(x, y)]?.kind === 'city' ? PAVEMENT : palette.garden;
      case TileType.Industry:
        return INDUSTRY_GROUND;
      default:
        return palette.grass;
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

  private rebuildShore(): void {
    this.shore.geometry.dispose();
    this.shore.geometry = this.buildShore();
  }

  // Břeh: svislá stěna z hladiny k terénu, písčitý lem na okraji pevniny podél vody a mělčina
  private buildShore(): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const quad = (corners: number[], normal: number[], color: THREE.Color): void => {
      const v = positions.length / 3;
      positions.push(...corners);
      for (let k = 0; k < 4; k++) {
        normals.push(...normal);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    const color = new THREE.Color();
    // Mělčina přes dlaždici vody: vějíř ze středu, aby přechod do hloubky neměl šikmé pruhy
    const shallows = (x: number, y: number): void => {
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      const shallow = corners.map(
        ([cx, cy]) =>
          this.isLand(cx - 1, cy - 1) || this.isLand(cx, cy - 1) || this.isLand(cx - 1, cy) || this.isLand(cx, cy),
      );
      if (!shallow.some(Boolean)) return;
      const shade = 0.94 + tileNoise(x, y) * 0.08;
      const h = -WATER_DEPTH + SHALLOWS_LIFT;
      const v = positions.length / 3;
      const vertex = (px: number, pz: number, depth: number): void => {
        positions.push(px, h, pz);
        normals.push(0, 1, 0);
        color.lerpColors(SHALLOW, WATER, depth).multiplyScalar(shade);
        colors.push(color.r, color.g, color.b);
      };
      vertex(x + 0.5, y + 0.5, 1 - shallow.filter(Boolean).length / 4);
      corners.forEach(([cx, cy], k) => vertex(cx, cy, shallow[k] ? 0 : 1));
      // Rohy 1..4 jsou SZ, SV, JV, JZ; trojúhelníky proti směru hodin při pohledu shora
      indices.push(v, v + 1, v + 4, v, v + 4, v + 3, v, v + 3, v + 2, v, v + 2, v + 1);
    };
    // Vodorovný obdélník lemu [x0, x1] × [z0, z1]
    const beach = (x0: number, z0: number, x1: number, z1: number): void =>
      quad([x0, BEACH_LIFT, z0, x0, BEACH_LIFT, z1, x1, BEACH_LIFT, z1, x1, BEACH_LIFT, z0], [0, 1, 0], SAND);
    const w = BEACH_WIDTH;

    const { width, height } = this.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!this.isLand(x, y)) {
          shallows(x, y);
          continue;
        }
        const wet = SIDES.map(([dx, dy]) => this.map.inBounds(x + dx, y + dy) && this.isWater(x + dx, y + dy));
        SIDES.forEach(([dx, dy], side) => {
          if (!wet[side]) return;
          // Stěna na hraně dlaždice čelem k vodě; vodorovná osa stěny vede tak, aby normála mířila ven
          const cx = x + 0.5 + dx * 0.5;
          const cz = y + 0.5 + dy * 0.5;
          const [tx, tz] = [dy * 0.5, -dx * 0.5];
          quad(
            [cx - tx, -WATER_DEPTH, cz - tz, cx + tx, -WATER_DEPTH, cz + tz, cx + tx, 0, cz + tz, cx - tx, 0, cz - tz],
            [dx, 0, dy],
            BANK,
          );
          if (dy === -1) beach(x, y, x + 1, y + w);
          if (dy === 1) beach(x, y + 1 - w, x + 1, y + 1);
          if (dx === -1) beach(x, y, x + w, y + 1);
          if (dx === 1) beach(x + 1 - w, y, x + 1, y + 1);
        });
        // Roh, kde voda sousedí jen úhlopříčně, doplní lem mezi lemy sousedních dlaždic
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          if (!this.map.inBounds(x + dx, y + dy) || !this.isWater(x + dx, y + dy)) continue;
          if (this.isWater(x + dx, y) || this.isWater(x, y + dy)) continue;
          const x0 = dx < 0 ? x : x + 1 - w;
          const z0 = dy < 0 ? y : y + 1 - w;
          beach(x0, z0, x0 + w, z0 + w);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    return geometry;
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
