import * as THREE from 'three';
import type { Season } from '../game/seasons';
import { loadPrototype } from './buildings';
import { MapChanges, TileType, type GameMap } from '../world/map';

export const ANIMAL_MODELS = [
  'animal-deer',
  'animal-fox',
  'animal-hog',
  'animal-bunny',
  'animal-beaver',
  'animal-bee',
] as const;
// Při větším oddálení jsou zvířata jen pár pixelů, skryjí se a nepohybují
export const ANIMALS_MIN_ZOOM = 0.45;
const SPAWN_CHANCE = 0.012;
const BEE_CHANCE = 0.008;
const BUNNY_SCALE = 0.55;
const BEE_SCALE = 0.07;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
// Křídla včely mávají kolem úchytu u těla (pivot uzlu v modelu), levé a pravé zrcadlově
const WING_FLAP: Partial<Record<string, number>> = { 'wing-left': 1, 'wing-right': -1 };
const WING_SPEED = 70;
const WING_AMPLITUDE = 0.5;

export interface AnimalPlacement {
  tile: number;
  model: (typeof ANIMAL_MODELS)[number];
  x: number;
  z: number;
  rotation: number;
  scale: number;
  // Výška letu nad zemí, chodící zvířata 0
  altitude: number;
}

interface RoamingAnimal extends AnimalPlacement {
  modelIndex: number;
  instanceIndex: number;
  previousTile: number;
  targetTile: number | null;
  targetX: number;
  targetZ: number;
  startX: number;
  startZ: number;
  progress: number;
  wait: number;
  step: number;
  speed: number;
  visible: boolean;
  // Fáze kmitání letu, aby včely nebzučely v zákrytu
  phase: number;
}

function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function forestNeighbors(map: GameMap, tile: number): number[] {
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  return [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
  ]
    .filter(({ x, y }) => map.isType(x, y, TileType.Trees))
    .map(({ x, y }) => y * map.width + x);
}

export function nextForestTile(map: GameMap, tile: number, previousTile: number, step: number): number | null {
  const neighbors = forestNeighbors(map, tile);
  const forward = neighbors.filter((neighbor) => neighbor !== previousTile);
  const choices = forward.length > 0 ? forward : neighbors;
  if (choices.length === 0) return null;
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  const choice = Math.min(choices.length - 1, Math.floor(tileHash(x, y, step + 200) * choices.length));
  return choices[choice];
}

function isNearWater(map: GameMap, x: number, y: number): boolean {
  return (
    map.isType(x, y - 1, TileType.Water) ||
    map.isType(x + 1, y, TileType.Water) ||
    map.isType(x, y + 1, TileType.Water) ||
    map.isType(x - 1, y, TileType.Water)
  );
}

export function animalPlacements(map: GameMap): AnimalPlacement[] {
  const placements: AnimalPlacement[] = [];
  for (let tile = 0; tile < map.tiles.length; tile++) {
    if (map.tiles[tile] !== TileType.Trees) continue;
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    const neighbors =
      Number(map.isType(x, y - 1, TileType.Trees)) +
      Number(map.isType(x + 1, y, TileType.Trees)) +
      Number(map.isType(x, y + 1, TileType.Trees)) +
      Number(map.isType(x - 1, y, TileType.Trees));
    if (neighbors < 2) continue;
    // Včely létají nezávisle na ostatní zvěři, mohou sdílet dlaždici
    if (tileHash(x, y, 108) < BEE_CHANCE) {
      placements.push({
        tile,
        model: 'animal-bee',
        x: x + 0.25 + tileHash(x, y, 109) * 0.5,
        z: y + 0.25 + tileHash(x, y, 110) * 0.5,
        rotation: tileHash(x, y, 111) * Math.PI * 2,
        scale: BEE_SCALE * (0.85 + tileHash(x, y, 112) * 0.3),
        altitude: 0.3 + tileHash(x, y, 113) * 0.25,
      });
    }
    if (tileHash(x, y, 100) >= SPAWN_CHANCE) continue;

    const species = tileHash(x, y, 101);
    const model = isNearWater(map, x, y) && species > 0.82 ? ANIMAL_MODELS[4] : ANIMAL_MODELS[Math.floor(species * 4)];
    placements.push({
      tile,
      model,
      x: x + 0.25 + tileHash(x, y, 102) * 0.5,
      z: y + 0.25 + tileHash(x, y, 103) * 0.5,
      rotation: tileHash(x, y, 104) * Math.PI * 2,
      scale: (0.32 + tileHash(x, y, 105) * 0.12) * (model === 'animal-bunny' ? BUNNY_SCALE : 1),
      altitude: 0,
    });
  }
  return placements;
}

type Prototype = Awaited<ReturnType<typeof loadPrototype>>[number];

export class AnimalsView {
  readonly object = new THREE.Group();
  private generation = 0;
  private built = false;
  private meshesByModel: THREE.InstancedMesh[][] = [];
  private prototypesByModel: Prototype[][] = [];
  private roamers: RoamingAnimal[] = [];
  private readonly changes: MapChanges;
  // Čas kmitání letu; stojí, když stojí hra
  private time = 0;
  // V zimě včely nelétají
  private beesHidden = false;

  constructor(private readonly map: GameMap) {
    this.changes = new MapChanges(map);
  }

  sync(): void {
    if (!this.built) return;
    const changes = this.changes.take();
    if (changes === null) {
      void this.refresh();
      return;
    }

    const touched = new Set<THREE.InstancedMesh>();
    for (const animal of this.roamers) {
      if (this.map.tiles[animal.tile] !== TileType.Trees) {
        if (animal.targetTile !== null && this.map.tiles[animal.targetTile] === TileType.Trees) {
          animal.previousTile = animal.tile;
          animal.tile = animal.targetTile;
          animal.x = animal.targetX;
          animal.z = animal.targetZ;
          animal.targetTile = null;
          animal.progress = 0;
          animal.wait = 0;
        } else {
          animal.visible = false;
        }
        this.writeAnimal(animal, touched);
        continue;
      }
      if (animal.targetTile !== null && this.map.tiles[animal.targetTile] !== TileType.Trees) {
        animal.targetTile = null;
        animal.progress = 0;
        animal.x = (animal.tile % this.map.width) + 0.5;
        animal.z = Math.floor(animal.tile / this.map.width) + 0.5;
        animal.wait = 0;
        this.writeAnimal(animal, touched);
      }
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  setZoom(zoom: number): void {
    this.object.visible = zoom >= ANIMALS_MIN_ZOOM;
  }

  update(seconds: number): void {
    if (!this.built || seconds <= 0 || !this.object.visible) return;
    this.time += seconds;
    const touched = new Set<THREE.InstancedMesh>();
    for (const animal of this.roamers) {
      if (!animal.visible) continue;
      const flying = animal.altitude > 0;
      if (flying && this.beesHidden) continue;
      animal.wait = Math.max(0, animal.wait - seconds);
      if (animal.targetTile === null && animal.wait === 0) {
        const target = nextForestTile(this.map, animal.tile, animal.previousTile, animal.step++);
        if (target === null) {
          animal.wait = 1;
          if (flying) this.writeAnimal(animal, touched);
          continue;
        }
        animal.targetTile = target;
        animal.startX = animal.x;
        animal.startZ = animal.z;
        animal.targetX = (target % this.map.width) + 0.5;
        animal.targetZ = Math.floor(target / this.map.width) + 0.5;
        animal.progress = 0;
        animal.rotation = Math.atan2(animal.targetX - animal.x, animal.targetZ - animal.z);
      }

      if (animal.targetTile === null) {
        // Včela i při zastávce poletuje na místě
        if (flying) this.writeAnimal(animal, touched);
        continue;
      }
      animal.progress = Math.min(1, animal.progress + seconds * animal.speed);
      animal.x = animal.startX + (animal.targetX - animal.startX) * animal.progress;
      animal.z = animal.startZ + (animal.targetZ - animal.startZ) * animal.progress;
      if (animal.progress === 1) {
        animal.previousTile = animal.tile;
        animal.tile = animal.targetTile;
        animal.targetTile = null;
        const pause = tileHash(animal.tile % this.map.width, Math.floor(animal.tile / this.map.width), animal.step);
        animal.wait = flying ? 0.3 + pause * 1.2 : 0.5 + pause * 1.5;
      }
      this.writeAnimal(animal, touched);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  setSeason(season: Season): void {
    const hidden = season === 'winter';
    if (hidden === this.beesHidden) return;
    this.beesHidden = hidden;
    if (!this.built) return;
    const touched = new Set<THREE.InstancedMesh>();
    for (const animal of this.roamers) if (animal.altitude > 0) this.writeAnimal(animal, touched);
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const placements = animalPlacements(this.map);
    const matrices: THREE.Matrix4[][] = ANIMAL_MODELS.map(() => []);
    const roamers: RoamingAnimal[] = [];

    for (const placement of placements) {
      const model = ANIMAL_MODELS.indexOf(placement.model);
      const index = matrices[model].length;
      const tileX = placement.tile % this.map.width;
      const tileY = Math.floor(placement.tile / this.map.width);
      const animal: RoamingAnimal = {
        ...placement,
        modelIndex: model,
        instanceIndex: index,
        previousTile: -1,
        targetTile: null,
        targetX: placement.x,
        targetZ: placement.z,
        startX: placement.x,
        startZ: placement.z,
        progress: 0,
        wait: 0.5 + tileHash(tileX, tileY, 106) * 1.5,
        step: 0,
        speed:
          placement.altitude > 0 ? 0.25 + tileHash(tileX, tileY, 107) * 0.15 : 0.1 + tileHash(tileX, tileY, 107) * 0.06,
        visible: true,
        phase: tileHash(tileX, tileY, 114) * Math.PI * 2,
      };
      roamers.push(animal);
      matrices[model].push(this.transform(animal));
    }

    const loadedModels = ANIMAL_MODELS.filter((_, index) => matrices[index].length > 0);
    const prototypes = new Map<string, Prototype[]>();
    await Promise.all(
      loadedModels.map(async (model) => prototypes.set(model, await loadPrototype('cube pets', model))),
    );
    if (generation !== this.generation) return;

    const meshesByModel = ANIMAL_MODELS.map((model, modelIndex) =>
      (prototypes.get(model) ?? []).map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices[modelIndex].length);
        const matrix = new THREE.Matrix4();
        matrices[modelIndex].forEach((placement, index) =>
          mesh.setMatrixAt(index, matrix.multiplyMatrices(placement, part.matrix)),
        );
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.computeBoundingSphere();
        return mesh;
      }),
    );

    for (const child of this.object.children as THREE.InstancedMesh[]) child.dispose();
    this.object.clear();
    this.object.add(...meshesByModel.flat());
    this.meshesByModel = meshesByModel;
    this.prototypesByModel = ANIMAL_MODELS.map((model) => prototypes.get(model) ?? []);
    this.roamers = roamers;
    this.built = true;
  }

  private writeAnimal(animal: RoamingAnimal, touched: Set<THREE.InstancedMesh>): void {
    const transform = this.transform(animal);
    const matrix = new THREE.Matrix4();
    const wing = new THREE.Matrix4();
    const flap = Math.sin((this.time + animal.phase) * WING_SPEED) * WING_AMPLITUDE;
    const meshes = this.meshesByModel[animal.modelIndex];
    const parts = this.prototypesByModel[animal.modelIndex];
    for (let partIndex = 0; partIndex < meshes.length; partIndex++) {
      const mesh = meshes[partIndex];
      const part = parts[partIndex];
      matrix.multiplyMatrices(transform, part.matrix);
      const side = animal.altitude > 0 && part.name ? WING_FLAP[part.name] : undefined;
      if (side !== undefined) matrix.multiply(wing.makeRotationZ(flap * side));
      mesh.setMatrixAt(animal.instanceIndex, matrix);
      mesh.instanceMatrix.addUpdateRange(animal.instanceIndex * 16, 16);
      touched.add(mesh);
    }
  }

  private transform(animal: RoamingAnimal): THREE.Matrix4 {
    const hidden = !animal.visible || (animal.altitude > 0 && this.beesHidden);
    return hidden ? HIDDEN : this.animalMatrix(animal);
  }

  // Včela ve vzduchu kmitá nahoru a dolů a kličkuje do stran
  private animalMatrix(animal: RoamingAnimal): THREE.Matrix4 {
    const position = new THREE.Vector3(animal.x, 0, animal.z);
    if (animal.altitude > 0) {
      const t = this.time + animal.phase;
      position.x += Math.sin(t * 1.5) * 0.06;
      position.z += Math.cos(t * 1.2 + animal.phase) * 0.06;
      position.y = animal.altitude + Math.sin(t * 5) * 0.025 + Math.sin(t * 1.3) * 0.05;
    }
    return new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), animal.rotation),
      new THREE.Vector3(animal.scale, animal.scale, animal.scale),
    );
  }
}
