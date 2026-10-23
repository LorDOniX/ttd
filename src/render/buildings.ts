import * as THREE from 'three';
import { loadScene, type Kit } from '../assets';
import type { Season } from '../game/seasons';
import type { Town } from '../world/town';
import { Surface, addWindows } from './windows';

// Největší půdorysný rozměr budovy vůči dlaždici
const FOOTPRINT = 0.86;

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

const prototypes = new Map<string, Promise<Part[]>>();

function createSnowTexture(): THREE.DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 0x5f3759df;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const shade = 228 + (seed % 28);
    pixels.set([shade - 2, shade, Math.min(255, shade + 3), 255], i * 4);
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

export const SNOW_MATERIAL = new THREE.MeshLambertMaterial({
  map: createSnowTexture(),
  color: 0xffffff,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});

export function createSnowRoofGeometry(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry | null {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute('position');
  const snowPositions: number[] = [];
  const snowNormals: number[] = [];
  const snowUvs: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i).applyMatrix4(matrix);
    b.fromBufferAttribute(position, i + 1).applyMatrix4(matrix);
    c.fromBufferAttribute(position, i + 2).applyMatrix4(matrix);
    normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (normal.y < 0.3 || (a.y + b.y + c.y) / 3 < 0.25) continue;

    for (const point of [a, b, c]) {
      const snowPoint = point.clone().addScaledVector(normal, 0.002);
      snowPositions.push(snowPoint.x, snowPoint.y, snowPoint.z);
      snowNormals.push(normal.x, normal.y, normal.z);
      snowUvs.push(snowPoint.x * 4, snowPoint.z * 4);
    }
  }
  source.dispose();
  if (snowPositions.length === 0) return null;

  const snow = new THREE.BufferGeometry();
  snow.setAttribute('position', new THREE.Float32BufferAttribute(snowPositions, 3));
  snow.setAttribute('normal', new THREE.Float32BufferAttribute(snowNormals, 3));
  snow.setAttribute('uv', new THREE.Float32BufferAttribute(snowUvs, 2));
  snow.computeBoundingSphere();
  return snow;
}

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

// Modely bez detailů mají holé stěny, okna se jim dokreslují shaderem
function needsWindows(model: string): boolean {
  return model.startsWith('low-detail-building-');
}

// Světlé stěny dostanou okna po patrech, tmavé panely příčky prosklené fasády
function windowSurface(u: number, v: number): Surface {
  const at = paletteCell(u, v);
  return at === WHITE ? Surface.Wall : at === GRAY ? Surface.Glass : Surface.Plain;
}

const windowed = new Map<string, Promise<Part[]>>();

// Okna se určují z původních barev palety, proto před přebarvením fasády
function loadWindowed(kit: Kit, model: string): Promise<Part[]> {
  if (!needsWindows(model)) return loadPrototype(kit, model);
  const key = `${kit}/${model}`;
  let pending = windowed.get(key);
  if (!pending) {
    pending = loadPrototype(kit, model).then((parts) => addWindows(parts, windowSurface));
    windowed.set(key, pending);
  }
  return pending;
}

const facades = new Map<string, Promise<Part[]>>();

function loadFacade(kit: Kit, model: string, facade: number): Promise<Part[]> {
  const scheme = FACADES[kit]?.[facade];
  if (!scheme) return loadWindowed(kit, model);
  const key = `${kit}/${model}/${facade}`;
  let pending = facades.get(key);
  if (!pending) {
    pending = loadWindowed(kit, model).then((parts) => recolor(parts, scheme));
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
  private season: Season = 'summer';
  private snowMeshes: THREE.InstancedMesh[] = [];

  setSeason(season: Season): void {
    this.season = season;
    for (const mesh of this.snowMeshes) mesh.visible = season === 'winter';
  }

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
    const snowMeshes: THREE.InstancedMesh[] = [];
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

          const snowGeometry = createSnowRoofGeometry(part.geometry, part.matrix);
          if (!snowGeometry) continue;
          const snowMesh = new THREE.InstancedMesh(snowGeometry, SNOW_MATERIAL, group.matrices.length);
          group.matrices.forEach((placement, i) => snowMesh.setMatrixAt(i, placement));
          snowMesh.instanceMatrix.needsUpdate = true;
          snowMesh.visible = this.season === 'winter';
          snowMesh.computeBoundingSphere();
          snowMeshes.push(snowMesh);
        }
      }),
    );

    // Mezitím mohl začít novější rebuild
    if (generation !== this.generation) {
      for (const mesh of meshes) mesh.dispose();
      for (const mesh of snowMeshes) {
        mesh.dispose();
        mesh.geometry.dispose();
      }
      return;
    }
    for (const old of this.object.children as THREE.InstancedMesh[]) old.dispose();
    for (const mesh of this.snowMeshes) mesh.geometry.dispose();
    this.object.clear();
    if (meshes.length > 0 || snowMeshes.length > 0) this.object.add(...meshes, ...snowMeshes);
    this.snowMeshes = snowMeshes;
  }
}
