import * as THREE from 'three';
import { loadScene, type Kit } from '../assets';
import type { Town } from '../world/town';

// Největší půdorysný rozměr budovy vůči dlaždici
const FOOTPRINT = 0.86;

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

const prototypes = new Map<string, Promise<Part[]>>();

// Rozloží model na části a normalizuje ho na střed dlaždice se dnem v y = 0
export function loadPrototype(kit: Kit, model: string): Promise<Part[]> {
  const key = `${kit}/${model}`;
  let pending = prototypes.get(key);
  if (!pending) {
    pending = loadScene(kit, model).then((scene) => {
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = FOOTPRINT / Math.max(size.x, size.z);
      const normalize = new THREE.Matrix4()
        .makeScale(scale, scale, scale)
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

      const parts: Part[] = [];
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        parts.push({
          geometry: child.geometry,
          material: child.material,
          matrix: normalize.clone().multiply(child.matrixWorld),
        });
      });
      return parts;
    });
    prototypes.set(key, pending);
  }
  return pending;
}

// Domky jsou ze suburban kitu, ostatní budovy z commercial kitu
function kitFor(model: string): Kit {
  return model.startsWith('building-type-') ? 'city kit suburban' : 'city kit commercial';
}

// Paleta city kitů (colormap.png) má 4 řádky po 16 políčkách, políčko = řádek * 16 + sloupec;
// řádky 1 a 2 jsou v commercial i suburban kitu stejné
const PALETTE_COLUMNS = 16;
const PALETTE_ROWS = 4;
const cell = (row: number, column: number): number => row * PALETTE_COLUMNS + column;
const GRAY = cell(2, 1);
const WHITE = cell(2, 7);
const GREEN = cell(1, 1);
const BRICK = cell(2, 11);
const DARK = cell(2, 3);

interface Facade {
  walls: number;
  trim: number;
  roof?: number;
}

// Barevné fasády: barva stěn (v modelu bílé), rámů a střech kanceláří (šedé) a střech domků (zelené);
// null je původní vzhled
const FACADES: Partial<Record<Kit, readonly (Facade | null)[]>> = {
  'city kit commercial': [
    null,
    { walls: cell(2, 15), trim: BRICK },
    { walls: BRICK, trim: GRAY },
    { walls: cell(2, 9), trim: GRAY },
    { walls: cell(2, 13), trim: BRICK },
    { walls: cell(3, 1), trim: GRAY },
    { walls: cell(3, 5), trim: GRAY },
    { walls: cell(1, 9), trim: GRAY },
    { walls: WHITE, trim: cell(1, 9) },
    { walls: WHITE, trim: cell(1, 3) },
  ],
  // Domky mají pastelové stěny a různé střechy, podezdívka zůstává šedá
  'city kit suburban': [
    null,
    { walls: cell(2, 15), trim: GRAY, roof: BRICK },
    { walls: cell(2, 13), trim: GRAY, roof: DARK },
    { walls: cell(2, 9), trim: GRAY, roof: BRICK },
    { walls: WHITE, trim: GRAY, roof: BRICK },
    { walls: cell(1, 3), trim: GRAY, roof: DARK },
    { walls: cell(2, 15), trim: GRAY, roof: GREEN },
    { walls: WHITE, trim: GRAY, roof: cell(1, 9) },
    { walls: cell(2, 13), trim: GRAY, roof: cell(1, 5) },
    { walls: cell(2, 9), trim: GRAY, roof: DARK },
  ],
};

function paletteCell(u: number, v: number): number {
  return cell(Math.floor(v * PALETTE_ROWS), Math.floor(u * PALETTE_COLUMNS));
}

// Fasáda podle polohy, aby budova po přestavbě scény barvu neměnila
function facadeAt(kit: Kit, x: number, y: number): number {
  return (((x * 73_856_093) ^ (y * 19_349_663)) >>> 0) % (FACADES[kit]?.length ?? 1);
}

const facades = new Map<string, Promise<Part[]>>();

function loadFacade(kit: Kit, model: string, facade: number): Promise<Part[]> {
  const scheme = FACADES[kit]?.[facade];
  if (!scheme) return loadPrototype(kit, model);
  const key = `${kit}/${model}/${facade}`;
  let pending = facades.get(key);
  if (!pending) {
    pending = loadPrototype(kit, model).then((parts) => recolor(parts, scheme));
    facades.set(key, pending);
  }
  return pending;
}

// Přesune UV bílých, šedých a zelených ploch na barevná políčka palety
function recolor(parts: Part[], scheme: Facade): Part[] {
  const remap = new Map([
    [WHITE, scheme.walls],
    [GRAY, scheme.trim],
  ]);
  if (scheme.roof !== undefined) remap.set(GREEN, scheme.roof);
  return parts.map((part) => {
    const geometry = part.geometry.clone();
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const from = paletteCell(u, v);
      const to = remap.get(from);
      if (to === undefined || to === from) continue;
      const columns = (to % PALETTE_COLUMNS) - (from % PALETTE_COLUMNS);
      const rows = Math.floor(to / PALETTE_COLUMNS) - Math.floor(from / PALETTE_COLUMNS);
      uv.setXY(i, u + columns / PALETTE_COLUMNS, v + rows / PALETTE_ROWS);
    }
    return { ...part, geometry };
  });
}

// Budovy všech měst jako instancované meshe, jeden na každou část modelu
export class BuildingsView {
  readonly object = new THREE.Group();
  private generation = 0;

  async rebuild(towns: readonly Town[]): Promise<void> {
    const generation = ++this.generation;
    const groups = new Map<string, { kit: Kit; model: string; facade: number; matrices: THREE.Matrix4[] }>();

    for (const town of towns) {
      for (const b of town.buildings) {
        const kit = kitFor(b.model);
        const facade = facadeAt(kit, b.x, b.y);
        const key = `${kit}/${b.model}/${facade}`;
        let group = groups.get(key);
        if (!group) {
          group = { kit, model: b.model, facade, matrices: [] };
          groups.set(key, group);
        }
        group.matrices.push(
          new THREE.Matrix4()
            .makeTranslation(b.x + 0.5, 0, b.y + 0.5)
            .multiply(new THREE.Matrix4().makeRotationY(b.rotation)),
        );
      }
    }

    const meshes: THREE.InstancedMesh[] = [];
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const parts = await loadFacade(group.kit, group.model, group.facade);
        for (const part of parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, group.matrices.length);
          const m = new THREE.Matrix4();
          group.matrices.forEach((placement, i) => {
            mesh.setMatrixAt(i, m.multiplyMatrices(placement, part.matrix));
          });
          mesh.computeBoundingSphere();
          meshes.push(mesh);
        }
      }),
    );

    // Mezitím mohl začít novější rebuild
    if (generation !== this.generation) return;
    for (const old of this.object.children as THREE.InstancedMesh[]) old.dispose();
    this.object.clear();
    if (meshes.length > 0) this.object.add(...meshes);
  }
}
