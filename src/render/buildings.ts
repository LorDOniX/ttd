import * as THREE from 'three';
import { loadScene, type Kit } from '../assets';
import type { Season } from '../game/seasons';
import type { Town } from '../world/town';
import { Surface, addWindows } from './windows';
import { withLampLight } from './nightLights';

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

// Kapacita dávky roste s rezervou, aby se buffery při růstu měst nepřestavovaly často
const GROWTH = 1.5;

interface BatchItem {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

// Jeden BatchedMesh pro díly se stejným materiálem a atributy, kreslí se jedním voláním. Geometrie se do
// dávky nahrají jen jednou, při přestavbě měst se přepisují jen instance.
export class GeometryBatch {
  readonly mesh: THREE.BatchedMesh;
  private readonly geometryIds = new Map<THREE.BufferGeometry, number>();
  private instanceIds: number[] = [];
  private vertexCapacity: number;
  private indexCapacity: number;
  private vertexCount = 0;
  private indexCount = 0;

  constructor(material: THREE.Material, items: readonly BatchItem[]) {
    const fresh = this.freshGeometries(items);
    this.vertexCapacity = Math.ceil(Math.max(1, sumVertices(fresh)) * GROWTH);
    this.indexCapacity = Math.ceil(Math.max(1, sumIndices(fresh)) * GROWTH);
    this.mesh = new THREE.BatchedMesh(
      Math.ceil(Math.max(1, items.length) * GROWTH),
      this.vertexCapacity,
      this.indexCapacity,
      material,
    );
    // Neprůhledné budovy řadit netřeba, za snímek se jen vyřadí ty mimo záběr
    this.mesh.sortObjects = false;
    this.set(items);
  }

  set(items: readonly BatchItem[]): void {
    const { mesh } = this;
    const fresh = this.freshGeometries(items);
    const vertices = this.vertexCount + sumVertices(fresh);
    const indices = this.indexCount + sumIndices(fresh);
    if (vertices > this.vertexCapacity || indices > this.indexCapacity) {
      this.vertexCapacity = Math.max(this.vertexCapacity, Math.ceil(vertices * GROWTH));
      this.indexCapacity = Math.max(this.indexCapacity, Math.ceil(indices * GROWTH));
      mesh.setGeometrySize(this.vertexCapacity, this.indexCapacity);
    }
    for (const geometry of fresh) {
      this.geometryIds.set(geometry, mesh.addGeometry(geometry));
      this.vertexCount += geometry.getAttribute('position').count;
      this.indexCount += geometry.index?.count ?? 0;
    }

    if (items.length > mesh.maxInstanceCount) mesh.setInstanceCount(Math.ceil(items.length * GROWTH));
    items.forEach(({ geometry, matrix }, i) => {
      const geometryId = this.geometryIds.get(geometry)!;
      let id = this.instanceIds[i];
      if (id === undefined) {
        id = mesh.addInstance(geometryId);
        this.instanceIds.push(id);
      } else {
        mesh.setGeometryIdAt(id, geometryId);
      }
      mesh.setMatrixAt(id, matrix);
    });
    for (const id of this.instanceIds.splice(items.length)) mesh.deleteInstance(id);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }

  private freshGeometries(items: readonly BatchItem[]): THREE.BufferGeometry[] {
    const fresh = new Set<THREE.BufferGeometry>();
    for (const { geometry } of items) if (!this.geometryIds.has(geometry)) fresh.add(geometry);
    return [...fresh];
  }
}

function sumVertices(geometries: readonly THREE.BufferGeometry[]): number {
  return geometries.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0);
}

function sumIndices(geometries: readonly THREE.BufferGeometry[]): number {
  return geometries.reduce((sum, geometry) => sum + (geometry.index?.count ?? 0), 0);
}

// Atributy a index geometrie; do jedné dávky smějí jen geometrie se stejnými
function attributeSignature(geometry: THREE.BufferGeometry): string {
  const attributes = Object.entries(geometry.attributes)
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}`)
    .sort();
  return `${attributes.join(',')}|${geometry.index ? 'indexed' : 'flat'}`;
}

// Sníh na střeše dílu; díly jsou v cache načtených fasád, takže se spočte jen jednou
const snowRoofs = new WeakMap<Part, THREE.BufferGeometry | null>();
function snowRoofOf(part: Part): THREE.BufferGeometry | null {
  let snow = snowRoofs.get(part);
  if (snow === undefined) {
    snow = createSnowRoofGeometry(part.geometry, part.matrix);
    snowRoofs.set(part, snow);
  }
  return snow;
}

// Budovy všech měst v dávkách BatchedMesh: jedna na materiál a sadu atributů a jedna se sněhem
export class BuildingsView {
  readonly object = new THREE.Group();
  private generation = 0;
  private season: Season = 'summer';
  private readonly batches = new Map<string, GeometryBatch>();
  private snow: GeometryBatch | null = null;

  setSeason(season: Season): void {
    this.season = season;
    if (this.snow) this.snow.mesh.visible = season === 'winter';
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

    const loaded = await Promise.all(
      [...groups.values()].map(async (group) => ({
        group,
        parts: await loadFacade(group.kit, group.model, group.facade),
      })),
    );
    // Mezitím mohl začít novější rebuild
    if (generation !== this.generation) return;

    // Všechny modely jednoho kitu sdílejí paletu colormap, každý soubor má ale vlastní kopii materiálu;
    // díly se proto řadí podle kitu, názvu materiálu a atributů a kreslí se prvním materiálem skupiny
    const items = new Map<string, { material: THREE.Material; items: BatchItem[] }>();
    const snowItems: BatchItem[] = [];
    for (const { group, parts } of loaded) {
      for (const part of parts) {
        // Kenney city kity mají u každého dílu jediný materiál
        if (Array.isArray(part.material)) continue;
        const key = `${group.kit}|${part.material.type}|${part.material.name}|${attributeSignature(part.geometry)}`;
        let bucket = items.get(key);
        if (!bucket) {
          bucket = { material: this.batches.get(key)?.mesh.material ?? part.material, items: [] };
          items.set(key, bucket);
        }
        const snow = snowRoofOf(part);
        for (const placement of group.matrices) {
          bucket.items.push({ geometry: part.geometry, matrix: placement.clone().multiply(part.matrix) });
          if (snow) snowItems.push({ geometry: snow, matrix: placement });
        }
      }
    }

    for (const [key, { material, items: batchItems }] of items) {
      const batch = this.batches.get(key);
      if (batch) {
        batch.set(batchItems);
        continue;
      }
      withLampLight(material);
      const created = new GeometryBatch(material, batchItems);
      this.batches.set(key, created);
      this.object.add(created.mesh);
    }
    for (const [key, batch] of this.batches) if (!items.has(key)) batch.set([]);

    if (this.snow) this.snow.set(snowItems);
    else if (snowItems.length > 0) {
      this.snow = new GeometryBatch(SNOW_MATERIAL, snowItems);
      this.snow.mesh.visible = this.season === 'winter';
      this.object.add(this.snow.mesh);
    }
  }
}
