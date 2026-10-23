import * as THREE from 'three';
import { loadScene } from '../assets';
import type { GameMap } from '../world/map';
import type { RailNetwork } from '../world/rail';
import {
  WALK_INSET,
  SIDEWALK_WIDTH,
  nodePoint,
  sidewalkSteps,
  sidewalkTown,
  type SidewalkNode,
} from '../world/sidewalks';
import type { Town } from '../world/town';
import { inView } from './camera';
import { SIDEWALK_HEIGHT, roadConnects, type RoadView } from './roads';

// Chodců na obyvatele: 10 na každých 1000, počet roste i klesá s městem
const PEDESTRIANS_PER_RESIDENT = 10 / 1000;
export const CHARACTER_MODELS = 'abcdefghijklmnopqr'.split('').map((s) => `character-${s}`);
// Výška postavy v dlaždicích (auto je dlouhé ~0,4)
const HEIGHT = 0.16;
// Rychlost chůze v dlaždicích za sekundu a délka jednoho dvojkroku
const SPEED_MIN = 0.09;
const SPEED_MAX = 0.14;
const STRIDE = 0.12;
// Rozkmit končetin v radiánech
const SWING = 0.6;
// Na křižovatce chodec přejde po zebře méně často, než pokračuje po chodníku
const CROSSING_WEIGHT = 0.35;
const ROAD_TOP = 0.005;

// Končetiny se kývají kolem kloubu, levá noha s pravou rukou
const LIMB_SWING: Partial<Record<string, number>> = {
  'leg-left': 1,
  'leg-right': -1,
  'arm-left': -1,
  'arm-right': 1,
};

interface CharacterPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  // Klidová poloha dílu v modelu normalizovaném na výšku HEIGHT, kloub je v počátku dílu
  rest: THREE.Matrix4;
  swing: number;
}

interface Variant {
  parts: CharacterPart[];
  meshes: THREE.InstancedMesh[];
  capacity: number;
}

interface Pedestrian {
  town: number;
  variant: number;
  from: SidewalkNode;
  to: SidewalkNode;
  crossing: boolean;
  // Ušlá vzdálenost na kroku from → to
  walked: number;
  speed: number;
  phase: number;
}

async function loadCharacter(name: string): Promise<CharacterPart[]> {
  const scene = await loadScene('blocky characters', name);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const s = HEIGHT / (box.max.y - box.min.y);
  const normalize = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
  const parts: CharacterPart[] = [];
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    parts.push({
      geometry: child.geometry,
      material: child.material,
      rest: normalize.clone().multiply(child.matrixWorld),
      swing: LIMB_SWING[child.name] ?? 0,
    });
  });
  return parts;
}

const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

// Chodci procházející se náhodně po chodnících svého města; nejsou součástí hry ani uložení
export class PedestriansView {
  readonly object = new THREE.Group();
  private readonly variants: (Variant | null)[] = CHARACTER_MODELS.map(() => null);
  private readonly pedestrians: Pedestrian[] = [];
  // Počet chodců podle města při poslední kontrole
  private readonly targets = new Map<number, number>();
  private readonly connects;
  private version = -1;
  private readonly body = new THREE.Matrix4();
  private readonly limb = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly map: GameMap,
    rail: RailNetwork,
    private readonly towns: readonly Town[],
    private readonly roads: RoadView,
  ) {
    this.connects = roadConnects(map, rail);
    CHARACTER_MODELS.forEach((name, i) => {
      void loadCharacter(name).then((parts) => (this.variants[i] = { parts, meshes: [], capacity: 0 }));
    });
  }

  // Posun chodců o dt sekund (0 při pauze) a přepočet instancí jen pro chodce v záběru
  update(dt: number, frustum: THREE.Frustum): void {
    const roadsChanged = this.roads.version !== this.version;
    this.version = this.roads.version;
    if (roadsChanged) this.relocate();
    if (this.updateTargets() || roadsChanged) this.populate();
    for (const p of this.pedestrians) this.walk(p, dt);
    this.render(frustum);
  }

  get crossingTiles(): ReadonlySet<number> {
    const tiles = new Set<number>();
    const curb = SIDEWALK_WIDTH - WALK_INSET;
    for (const p of this.pedestrians) {
      const length = this.stepLength(p);
      if (!p.crossing || p.walked <= curb || length - p.walked <= curb) continue;
      tiles.add(p.from >> 2);
    }
    return tiles;
  }

  // Přesadí chodce, jejichž chodník zmizel nebo kteří uvízli
  private relocate(): void {
    for (const p of this.pedestrians) {
      const tiles = this.roads.sidewalks.get(p.town);
      if (!tiles) continue;
      if (p.from === p.to || !this.onSidewalk(p.from, p.town) || !this.onSidewalk(p.to, p.town)) this.place(p, tiles);
    }
  }

  // Přepočte cílové počty chodců; vrací, zda se některý změnil
  private updateTargets(): boolean {
    let changed = false;
    for (const town of this.towns) {
      const target = this.roads.sidewalks.has(town.id) ? Math.round(town.population * PEDESTRIANS_PER_RESIDENT) : 0;
      if (this.targets.get(town.id) === target) continue;
      this.targets.set(town.id, target);
      changed = true;
    }
    return changed;
  }

  // Odebere přebývající chodce a doplní chybějící podle cílových počtů měst
  private populate(): void {
    const perTown = new Map<number, number>();
    const kept = this.pedestrians.filter((p) => {
      const count = perTown.get(p.town) ?? 0;
      if (count >= (this.targets.get(p.town) ?? 0)) return false;
      perTown.set(p.town, count + 1);
      return true;
    });
    this.pedestrians.length = 0;
    this.pedestrians.push(...kept);

    for (const [town, target] of this.targets) {
      const tiles = this.roads.sidewalks.get(town);
      if (!tiles) continue;
      for (let i = perTown.get(town) ?? 0; i < target; i++) {
        const p: Pedestrian = {
          town,
          variant: Math.floor(Math.random() * CHARACTER_MODELS.length),
          from: 0,
          to: 0,
          crossing: false,
          walked: 0,
          speed: randomBetween(SPEED_MIN, SPEED_MAX),
          phase: Math.random() * Math.PI * 2,
        };
        this.place(p, tiles);
        this.pedestrians.push(p);
      }
    }
  }

  private onSidewalk(node: SidewalkNode, town: number): boolean {
    const tile = node >> 2;
    return sidewalkTown(this.map, tile % this.map.width, Math.floor(tile / this.map.width)) === town;
  }

  // Postaví chodce na náhodný roh chodníku a rozejde ho náhodným směrem
  private place(p: Pedestrian, tiles: number[]): void {
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    p.from = tile * 4 + Math.floor(Math.random() * 4);
    p.to = p.from;
    p.walked = 0;
    this.chooseNext(p, p.from);
  }

  // Další krok z rohu p.to; zpět jen ze slepého rohu, odkud nevede nic, chodec zůstane stát
  private chooseNext(p: Pedestrian, previous: SidewalkNode): void {
    const steps = sidewalkSteps(this.map, this.connects, p.to);
    const forward = steps.filter((s) => s.to !== previous);
    const options = forward.length > 0 ? forward : steps;
    p.from = p.to;
    p.crossing = false;
    if (options.length === 0) return;
    const weight = (s: { crossing: boolean }): number => (s.crossing ? CROSSING_WEIGHT : 1);
    let roll = Math.random() * options.reduce((sum, s) => sum + weight(s), 0);
    let next = options[options.length - 1];
    for (const s of options) {
      roll -= weight(s);
      if (roll < 0) {
        next = s;
        break;
      }
    }
    p.to = next.to;
    p.crossing = next.crossing;
  }

  private stepLength(p: Pedestrian): number {
    const a = nodePoint(this.map, p.from);
    const b = nodePoint(this.map, p.to);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private walk(p: Pedestrian, dt: number): void {
    if (dt <= 0 || p.from === p.to) return;
    let distance = p.speed * dt;
    p.phase += (distance / STRIDE) * Math.PI * 2;
    // Krok může během snímku skončit a navázat dalším
    while (distance > 0) {
      const length = this.stepLength(p);
      const left = length - p.walked;
      if (distance < left) {
        p.walked += distance;
        return;
      }
      distance -= left;
      p.walked = 0;
      this.chooseNext(p, p.from);
      if (p.from === p.to) return;
    }
  }

  private render(frustum: THREE.Frustum): void {
    const used = this.variants.map(() => 0);
    for (const p of this.pedestrians) if (this.variants[p.variant]) used[p.variant]++;
    this.variants.forEach((variant, i) => {
      if (variant && used[i] > variant.capacity) this.allocate(variant, Math.max(used[i], variant.capacity * 2));
    });

    const filled = this.variants.map(() => 0);
    for (const p of this.pedestrians) {
      const variant = this.variants[p.variant];
      if (!variant) continue;
      this.placeBody(p);
      const { x, y, z } = this.position;
      if (!inView(frustum, x, y + HEIGHT / 2, z, HEIGHT)) continue;
      const index = filled[p.variant]++;
      const angle = Math.sin(p.phase) * SWING;
      variant.parts.forEach((part, k) => {
        this.matrix.multiplyMatrices(this.body, part.rest);
        if (part.swing !== 0) this.matrix.multiply(this.limb.makeRotationX(angle * part.swing));
        variant.meshes[k].setMatrixAt(index, this.matrix);
      });
    }
    this.variants.forEach((variant, i) => {
      if (!variant) return;
      for (const mesh of variant.meshes) {
        mesh.count = filled[i];
        mesh.instanceMatrix.needsUpdate = true;
      }
    });
  }

  // Poloha a natočení postavy ve směru chůze; na zebře sestoupí z chodníku na vozovku
  private placeBody(p: Pedestrian): void {
    const a = nodePoint(this.map, p.from);
    const b = nodePoint(this.map, p.to);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = p.walked / length;
    const curb = SIDEWALK_WIDTH - WALK_INSET;
    const onRoad = p.crossing && p.walked > curb && length - p.walked > curb;
    const bob = Math.abs(Math.sin(p.phase)) * HEIGHT * 0.03;
    this.position.set(a.x + (b.x - a.x) * t, (onRoad ? ROAD_TOP : SIDEWALK_HEIGHT) + bob, a.y + (b.y - a.y) * t);
    this.rotation.setFromAxisAngle(this.up, Math.atan2(b.x - a.x, b.y - a.y));
    this.body.compose(this.position, this.rotation, this.scale);
  }

  private allocate(variant: Variant, capacity: number): void {
    for (const mesh of variant.meshes) {
      this.object.remove(mesh);
      mesh.dispose();
    }
    variant.meshes = variant.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Mimo záběr chodce vynechává už render(), hranice instancí by se musely počítat každý snímek
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.object.add(mesh);
      return mesh;
    });
    variant.capacity = capacity;
  }
}
