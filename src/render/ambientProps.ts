import * as THREE from 'three';
import { MapChanges, NO_OWNER, TileType, type GameMap } from '../world/map';
import { Edge, EDGE_DELTA, type RailNetwork } from '../world/rail';
import { SIDEWALK_HEIGHT, roadConnects, type RoadView } from './roads';

type Shape = 'box' | 'cylinder' | 'cone' | 'sphere';
interface Part {
  shape: Shape;
  size: readonly number[];
  color: number;
  matrix: THREE.Matrix4;
}

const COLORS = {
  darkMetal: 0x42464a,
  metal: 0x777b7c,
  wood: 0x80623d,
  woodLight: 0xa88759,
  cream: 0xd5c9a3,
  green: 0x547b3e,
  red: 0x9a4938,
  blue: 0x486b82,
  yellow: 0xc5a345,
  stone: 0x77756d,
  hay: 0xc4a64c,
  roof: 0x66453a,
  water: 0x647d7c,
} as const;

const POWER_LINE_HEIGHT = 0.68;

export interface ParkedCarPlacement {
  x: number;
  z: number;
  yaw: number;
  model: string;
}

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function shapeKey(shape: Shape, size: readonly number[]): string {
  return `${shape}:${size.join(',')}`;
}

function geometry(shape: Shape, size: readonly number[]): THREE.BufferGeometry {
  if (shape === 'box') return new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (shape === 'cylinder') return new THREE.CylinderGeometry(size[0], size[1], size[2], size[3] ?? 8);
  if (shape === 'cone') return new THREE.ConeGeometry(size[0], size[1], size[2] ?? 6);
  return new THREE.SphereGeometry(size[0], size[1] ?? 8, size[2] ?? 6);
}

export class AmbientPropsView {
  readonly object = new THREE.Group();
  private readonly changes: MapChanges;
  private readonly connects;
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
  private parkedCars: ParkedCarPlacement[] = [];

  constructor(
    private readonly map: GameMap,
    rail: RailNetwork,
    private readonly roads: RoadView,
  ) {
    this.changes = new MapChanges(map);
    this.connects = roadConnects(map, rail);
    this.rebuild();
  }

  sync(): void {
    const changes = this.changes.take();
    if (changes === null || changes.length > 0) this.rebuild();
  }

  get parkedCarPlacements(): readonly ParkedCarPlacement[] {
    return this.parkedCars;
  }

  private rebuild(): void {
    const parts: Part[] = [];
    this.parkedCars = [];
    this.cityProps(parts);
    this.ruralProps(parts);

    for (const child of this.object.children as THREE.InstancedMesh[]) child.dispose();
    this.object.clear();
    const batches = new Map<
      string,
      { geometry: THREE.BufferGeometry; material: THREE.MeshLambertMaterial; matrices: THREE.Matrix4[] }
    >();
    for (const part of parts) {
      const geoKey = shapeKey(part.shape, part.size);
      let geo = this.geometries.get(geoKey);
      if (!geo) {
        geo = geometry(part.shape, part.size);
        this.geometries.set(geoKey, geo);
      }
      let mat = this.materials.get(part.color);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: part.color, flatShading: true });
        this.materials.set(part.color, mat);
      }
      const key = `${geoKey}:${part.color}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { geometry: geo, material: mat, matrices: [] };
        batches.set(key, batch);
      }
      batch.matrices.push(part.matrix);
    }

    for (const batch of batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.computeBoundingSphere();
      this.object.add(mesh);
    }
  }

  private cityProps(parts: Part[]): void {
    const roadTiles = new Set<number>();
    for (const tiles of this.roads.sidewalks.values()) for (const i of tiles) roadTiles.add(i);
    for (let i = 0; i < this.map.tiles.length; i++) {
      if (this.map.tiles[i] === TileType.RoadStop) roadTiles.add(i);
    }

    for (const i of roadTiles) {
      const x = i % this.map.width;
      const y = Math.floor(i / this.map.width);
      const value = hash(x, y, 100);
      if (this.map.isType(x, y, TileType.RoadStop)) {
        const vertical = this.vertical(x, y);
        const side = hash(x, y, 101) > 0.5 ? 0.045 : 0.955;
        this.shelter(parts, vertical ? x + side : x + 0.5, vertical ? y + 0.5 : y + side, vertical ? Math.PI / 2 : 0);
        continue;
      }
      if ([Edge.N, Edge.E, Edge.S, Edge.W].filter((edge) => this.connects(x, y, edge)).length >= 3) continue;

      const vertical = this.vertical(x, y);
      const side = hash(x, y, 101) > 0.5 ? 0.055 : 0.945;
      const px = vertical ? x + side : x + 0.5;
      const pz = vertical ? y + 0.5 : y + side;
      const yaw = vertical ? Math.PI / 2 : 0;
      if (value < 0.045) this.bench(parts, px, pz, yaw);
      else if (value < 0.09) this.bin(parts, px, pz);
      else if (value < 0.125) this.sign(parts, px, pz, yaw);
      else if (value < 0.155) this.flowerbed(parts, px, pz, yaw);
      else if (value < 0.18) this.mailbox(parts, px, pz, yaw);
      else if (value < 0.2) this.phoneBox(parts, px, pz, yaw);
      else if (value < 0.23) this.hydrant(parts, px, pz);
      else if (value < 0.255) this.streetTree(parts, px, pz);
      else if (value < 0.31) this.parkedCar(x, y, vertical, hash(x, y, 102) > 0.5);
    }
  }

  private ruralProps(parts: Part[]): void {
    const { width, height } = this.map;
    for (let y = 12; y < height - 12; y += 40) {
      for (let x = 12; x < width - 12; x += 40) {
        if (!this.clearGrass(x, y, 7)) continue;
        const roll = hash(x, y, 200);
        if (roll < 0.34) this.farm(parts, x + 0.5, y + 0.5, hash(x, y, 201) * Math.PI * 2);
        else if (roll < 0.5) this.windmill(parts, x + 0.5, y + 0.5);
        else if (roll < 0.64) this.turbine(parts, x + 0.5, y + 0.5);
        else if (roll < 0.78) this.waterTower(parts, x + 0.5, y + 0.5);
      }
    }

    this.powerLines(parts);
    this.waterProps(parts);
  }

  private clearGrass(x: number, y: number, radius: number): boolean {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.map.isType(tx, ty, TileType.Grass) || this.map.getOwner(tx, ty) !== NO_OWNER) return false;
      }
    }
    return true;
  }

  private vertical(x: number, y: number): boolean {
    return this.connects(x, y, Edge.N) || this.connects(x, y, Edge.S);
  }

  private component(
    parts: Part[],
    shape: Shape,
    size: readonly number[],
    color: number,
    originX: number,
    originZ: number,
    localX: number,
    localY: number,
    localZ: number,
    yaw = 0,
    localYaw = 0,
  ): void {
    const position = new THREE.Vector3(localX, localY, localZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + localYaw);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(originX + position.x, SIDEWALK_HEIGHT + position.y, originZ + position.z),
      rotation,
      new THREE.Vector3(1, 1, 1),
    );
    parts.push({ shape, size, color, matrix });
  }

  private box(
    parts: Part[],
    x: number,
    z: number,
    local: readonly [number, number, number],
    size: readonly [number, number, number],
    color: number,
    yaw = 0,
  ): void {
    this.component(parts, 'box', size, color, x, z, ...local, yaw);
  }

  private bench(parts: Part[], x: number, z: number, yaw: number): void {
    this.box(parts, x, z, [0, 0.065, 0], [0.28, 0.035, 0.065], COLORS.wood, yaw);
    this.box(parts, x, z, [0, 0.125, -0.025], [0.28, 0.1, 0.025], COLORS.wood, yaw);
    for (const dx of [-0.1, 0.1]) this.box(parts, x, z, [dx, 0.0325, 0], [0.018, 0.065, 0.045], COLORS.darkMetal, yaw);
  }

  private bin(parts: Part[], x: number, z: number): void {
    this.component(parts, 'cylinder', [0.035, 0.035, 0.11, 8], COLORS.green, x, z, 0, 0.075, 0);
    this.box(parts, x, z, [0, 0.14, 0], [0.08, 0.018, 0.08], COLORS.darkMetal);
  }

  private sign(parts: Part[], x: number, z: number, yaw: number): void {
    this.box(parts, x, z, [0, 0.21, 0], [0.018, 0.42, 0.018], COLORS.darkMetal, yaw);
    this.box(parts, x, z, [0, 0.34, 0], [0.16, 0.09, 0.025], COLORS.blue, yaw);
  }

  private flowerbed(parts: Part[], x: number, z: number, yaw: number): void {
    this.box(parts, x, z, [0, 0.045, 0], [0.26, 0.07, 0.095], COLORS.wood, yaw);
    this.box(parts, x, z, [0, 0.085, 0], [0.22, 0.025, 0.07], COLORS.green, yaw);
    for (const dx of [-0.07, 0, 0.07])
      this.component(parts, 'sphere', [0.025, 6, 4], dx === 0 ? COLORS.yellow : COLORS.red, x, z, dx, 0.11, 0, yaw);
  }

  private mailbox(parts: Part[], x: number, z: number, yaw: number): void {
    this.box(parts, x, z, [0, 0.13, 0], [0.018, 0.25, 0.018], COLORS.darkMetal, yaw);
    this.box(parts, x, z, [0, 0.26, 0], [0.085, 0.07, 0.07], COLORS.red, yaw);
  }

  private phoneBox(parts: Part[], x: number, z: number, yaw: number): void {
    this.box(parts, x, z, [0, 0.27, 0], [0.07, 0.52, 0.07], COLORS.red, yaw);
    this.box(parts, x, z, [0, 0.34, 0.038], [0.045, 0.12, 0.008], COLORS.cream, yaw);
    this.box(parts, x, z, [0, 0.05, 0], [0.09, 0.04, 0.09], COLORS.darkMetal, yaw);
  }

  private streetTree(parts: Part[], x: number, z: number): void {
    this.component(parts, 'cylinder', [0.018, 0.025, 0.46, 6], COLORS.wood, x, z, 0, 0.23, 0);
    this.component(parts, 'sphere', [0.16, 8, 6], COLORS.green, x, z, 0, 0.58, 0);
    this.box(parts, x, z, [0, 0.035, 0], [0.085, 0.05, 0.085], COLORS.stone);
  }

  private hydrant(parts: Part[], x: number, z: number): void {
    this.component(parts, 'cylinder', [0.025, 0.035, 0.11, 8], COLORS.red, x, z, 0, 0.075, 0);
    this.component(parts, 'cylinder', [0.045, 0.045, 0.025, 8], COLORS.red, x, z, 0, 0.1, 0);
    this.component(parts, 'sphere', [0.03, 6, 4], COLORS.red, x, z, 0, 0.145, 0);
  }

  private shelter(parts: Part[], x: number, z: number, yaw: number): void {
    for (const dx of [-0.26, 0.26])
      for (const dz of [-0.055, 0.055])
        this.box(parts, x, z, [dx, 0.25, dz], [0.018, 0.5, 0.018], COLORS.darkMetal, yaw);
    this.box(parts, x, z, [0, 0.52, 0], [0.62, 0.04, 0.07], COLORS.roof, yaw);
    this.box(parts, x, z, [0, 0.3, -0.025], [0.5, 0.3, 0.008], COLORS.blue, yaw);
    this.box(parts, x, z, [0, 0.14, 0.01], [0.4, 0.025, 0.04], COLORS.wood, yaw);
  }

  private parkedCar(tileX: number, tileY: number, vertical: boolean, side: boolean): void {
    const x = tileX + (vertical ? (side ? 0.37 : 0.63) : 0.5);
    const z = tileY + (vertical ? 0.5 : side ? 0.37 : 0.63);
    const models = ['hatchback-sports', 'sedan', 'suv', 'van'];
    this.parkedCars.push({
      x,
      z,
      yaw: vertical ? 0 : Math.PI / 2,
      model: models[Math.floor(hash(tileX, tileY, 103) * models.length)],
    });
  }

  private farm(parts: Part[], x: number, z: number, yaw: number): void {
    this.box(parts, x, z, [-1.3, 0.22, -0.7], [0.9, 0.44, 0.72], COLORS.woodLight, yaw);
    this.component(parts, 'cone', [0.65, 0.42, 4], COLORS.roof, x, z, -1.3, 0.65, -0.7, yaw, Math.PI / 4);
    this.component(parts, 'cylinder', [0.14, 0.16, 0.65, 10], COLORS.stone, x, z, 0.25, 0.33, -0.8, yaw);
    this.component(parts, 'cone', [0.16, 0.12, 10], COLORS.roof, x, z, 0.25, 0.72, -0.8, yaw);
    for (const [bx, bz] of [
      [-0.2, 0.55],
      [0.2, 0.55],
      [0.6, 0.55],
    ] as const) {
      this.component(parts, 'cylinder', [0.14, 0.14, 0.24, 8], COLORS.hay, x, z, bx, 0.14, bz, yaw, Math.PI / 2);
    }
    for (const k of [-1, 1]) {
      for (let i = -2; i <= 2; i++) {
        const fx = i * 0.55;
        this.box(parts, x, z, [fx, 0.22, k * 1.65], [0.045, 0.44, 0.045], COLORS.wood, yaw);
        if (i < 2) this.box(parts, x, z, [fx + 0.275, 0.28, k * 1.65], [0.55, 0.025, 0.025], COLORS.woodLight, yaw);
      }
    }
    for (const fx of [-1.1, -0.55, 0.55, 1.1])
      this.box(parts, x, z, [fx, 0.22, 1.65], [0.045, 0.44, 0.045], COLORS.wood, yaw);
    for (const fx of [-0.825, 0.825])
      this.box(parts, x, z, [fx, 0.28, 1.65], [0.55, 0.025, 0.025], COLORS.woodLight, yaw);
    this.box(parts, x, z, [0, 0.16, 1.65], [0.5, 0.025, 0.025], COLORS.woodLight, yaw);
    this.waterTower(parts, x + 1.3, z + 0.7);
  }

  private waterTower(parts: Part[], x: number, z: number): void {
    this.component(parts, 'cylinder', [0.035, 0.035, 0.58, 6], COLORS.darkMetal, x, z, 0, 0.31, 0);
    this.component(parts, 'cylinder', [0.14, 0.13, 0.18, 10], COLORS.water, x, z, 0, 0.67, 0);
    this.component(parts, 'cone', [0.15, 0.1, 10], COLORS.roof, x, z, 0, 0.81, 0);
  }

  private windmill(parts: Part[], x: number, z: number): void {
    this.component(parts, 'cone', [0.11, 0.62, 8], COLORS.cream, x, z, 0, 0.31, 0);
    this.component(parts, 'sphere', [0.045, 8, 6], COLORS.wood, x, z, 0, 0.62, 0.1);
    for (const angle of [0, Math.PI / 2])
      this.box(parts, x, z, [0, 0.62, 0.21], [0.035, 0.35, 0.035], COLORS.wood, angle);
    this.component(parts, 'sphere', [0.035, 8, 6], COLORS.darkMetal, x, z, 0, 0.62, 0.22);
  }

  private turbine(parts: Part[], x: number, z: number): void {
    this.component(parts, 'cylinder', [0.018, 0.026, 0.8, 6], COLORS.metal, x, z, 0, 0.4, 0);
    this.component(parts, 'sphere', [0.055, 8, 6], COLORS.cream, x, z, 0, 0.82, 0);
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3])
      this.box(parts, x, z, [0, 0.82, 0.15], [0.035, 0.25, 0.025], COLORS.cream, angle);
  }

  private powerLines(parts: Part[]): void {
    for (let y = 20; y < this.map.height; y += 32) {
      let lastX = -1;
      for (let x = 8; x < this.map.width; x += 12) {
        if (!this.clearGrass(x, y, 0)) continue;
        this.component(parts, 'cylinder', [0.018, 0.026, 0.72, 6], COLORS.wood, x + 0.5, y + 0.5, 0, 0.36, 0);
        this.box(parts, x + 0.5, y + 0.5, [0, POWER_LINE_HEIGHT, 0], [0.38, 0.035, 0.035], COLORS.wood);
        if (lastX >= 0) {
          const clear = x - lastX <= 12;
          if (
            clear &&
            Array.from({ length: x - lastX + 1 }, (_, i) => this.map.isType(lastX + i, y, TileType.Grass)).every(
              Boolean,
            )
          ) {
            this.segment(
              parts,
              [0.007, 0.007, 1, 5],
              COLORS.darkMetal,
              new THREE.Vector3(lastX + 0.5, POWER_LINE_HEIGHT, y + 0.5),
              new THREE.Vector3(x + 0.5, POWER_LINE_HEIGHT, y + 0.5),
            );
          }
        }
        lastX = x;
      }
    }
  }

  private segment(parts: Part[], size: readonly number[], color: number, from: THREE.Vector3, to: THREE.Vector3): void {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const matrix = new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
      new THREE.Vector3(1, length, 1),
    );
    parts.push({ shape: 'cylinder', size, color, matrix });
  }

  private waterProps(parts: Part[]): void {
    const { width, height } = this.map;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!this.map.isType(x, y, TileType.Water)) continue;
        const northSouth = this.map.isType(x, y - 1, TileType.Grass) && this.map.isType(x, y + 1, TileType.Grass);
        const eastWest = this.map.isType(x - 1, y, TileType.Grass) && this.map.isType(x + 1, y, TileType.Grass);
        const footbridge = (northSouth || eastWest) && hash(x, y, 303) < 0.004;
        if (footbridge) {
          const yaw = northSouth ? 0 : Math.PI / 2;
          this.box(parts, x + 0.5, y + 0.5, [0, 0.06, 0], [0.26, 0.05, 0.8], COLORS.wood, yaw);
          for (const side of [-0.12, 0.12])
            this.box(parts, x + 0.5, y + 0.5, [side, 0.14, 0], [0.025, 0.16, 0.8], COLORS.woodLight, yaw);
        } else if (hash(x, y, 301) < 0.012) {
          this.component(parts, 'cylinder', [0.018, 0.024, 0.24, 8], COLORS.darkMetal, x + 0.5, y + 0.5, 0, 0.12, 0);
          this.component(parts, 'sphere', [0.075, 8, 6], COLORS.yellow, x + 0.5, y + 0.5, 0, 0.28, 0);
        }
        const direction = [Edge.N, Edge.E, Edge.S, Edge.W].find((edge) => {
          const [dx, dy] = EDGE_DELTA[edge];
          return this.map.isType(x + dx, y + dy, TileType.Grass) && hash(x, y, 302) < 0.02;
        });
        if (direction === undefined) continue;
        const [dx, dy] = EDGE_DELTA[direction];
        const landX = x + dx;
        const landY = y + dy;
        if (this.map.getOwner(landX, landY) !== NO_OWNER) continue;
        const angle = Math.atan2(-dx, dy);
        const dockX = landX + 0.5 - dx * 0.12;
        const dockZ = landY + 0.5 - dy * 0.12;
        this.box(parts, dockX, dockZ, [0, 0.06, 0], [0.32, 0.05, 0.58], COLORS.wood, angle);
        for (const side of [-0.12, 0.12])
          for (const end of [-0.22, 0.22])
            this.component(
              parts,
              'cylinder',
              [0.025, 0.03, 0.28, 6],
              COLORS.wood,
              dockX,
              dockZ,
              side,
              -0.02,
              end,
              angle,
            );
      }
    }
  }
}
