import * as THREE from 'three';
import { loadModel, type Kit } from '../assets';
import { Edge, PIECES, type Axis } from '../world/rail';
import {
  TrackView,
  createDepotMesh,
  createRoadDepotMesh,
  createRoadStopMesh,
  createStationObject,
  placeDepot,
} from './rail';
import { roadAtlas, roadGeometry } from './roads';
import { SIGNAL_GREEN, SIGNAL_LAMP, SIGNAL_POLE, SIGNAL_POLE_COLOR } from './signals';

// Obrázek se zmenší na velikost ikony, větší rozlišení drží ostrost i na displejích s vyšší hustotou
const SIZE = 128;
// Stejný pohled jako ve hře: dimetrie 2:1 z rohu mapy
const ISO_DIRECTION = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();
const GRASS = 0x5f9e3c;
const TILE_DEPTH = 0.12;

export type SceneIcon = 'track' | 'station' | 'depot' | 'signal' | 'road' | 'road-stop' | 'road-depot' | 'demolish';

const material = new THREE.MeshLambertMaterial({ vertexColors: true });

// Dlaždice trávy s hranou, na které stojí stavba (souřadnice dlaždice 0..1 jako ve hře)
function tile(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, TILE_DEPTH, 1).translate(0.5, -TILE_DEPTH / 2, 0.5),
    new THREE.MeshLambertMaterial({ color: GRASS }),
  );
}

function track(axis: Axis): THREE.Object3D {
  const view = new TrackView(material);
  const [a, b] = axis === 'x' ? [Edge.W, Edge.E] : [Edge.N, Edge.S];
  view.update([{ x: 0, y: 0, piece: PIECES.findIndex(([p, q]) => p === a && q === b) }]);
  return view.object;
}

function road(axis: Axis): THREE.Mesh {
  const along = axis === 'x' ? [Edge.W, Edge.E] : [Edge.N, Edge.S];
  return new THREE.Mesh(
    roadGeometry([{ x: 0, y: 0 }], (_x, _y, edge) => along.includes(edge), 0.005),
    // Atlas se kreslí do canvasu, proto až při vykreslení ikony
    new THREE.MeshLambertMaterial({ map: roadAtlas(), alphaTest: 0.5 }),
  );
}

function signal(): THREE.Object3D {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(SIGNAL_POLE, new THREE.MeshLambertMaterial({ color: SIGNAL_POLE_COLOR })),
    new THREE.Mesh(SIGNAL_LAMP, new THREE.MeshBasicMaterial({ color: SIGNAL_GREEN })),
  );
  group.position.set(0.5, 0, 0.8);
  return group;
}

// Scény ikon nástrojů: stavby na dlaždici trávy
const SCENES: Record<SceneIcon, () => Promise<THREE.Object3D[]> | THREE.Object3D[]> = {
  track: () => [tile(), track('x')],
  station: () => [tile(), track('x'), createStationObject({ x: 0, y: 0, axis: 'x', length: 1, tracks: 1 }, material)],
  depot: () => {
    const depot = createDepotMesh(material);
    placeDepot(depot, 0, 0, Edge.S);
    return [tile(), depot];
  },
  signal: () => [tile(), track('x'), signal()],
  road: () => [tile(), road('x')],
  'road-stop': () => [tile(), road('x'), createRoadStopMesh(material, 0, 0, 'x')],
  'road-depot': () => {
    const depot = createRoadDepotMesh(material);
    placeDepot(depot, 0, 0, Edge.S);
    return [tile(), depot];
  },
  demolish: async () => [await loadModel('car kit', 'tractor-shovel')],
};

let renderer: THREE.WebGLRenderer | null = null;

function iconRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
  }
  return renderer;
}

// Vyfotí objekty izometrickou kamerou tak, aby vyplnily čtverec obrázku
function snapshot(objects: THREE.Object3D[]): string {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(10, 20, 5);
  scene.add(sun, ...objects);
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3();
  for (const object of objects) box.expandByObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera();
  camera.position.copy(center).addScaledVector(ISO_DIRECTION, 10);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  // Obrys kvádru v rovině kamery určí výřez
  const view = new THREE.Box2();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.applyMatrix4(camera.matrixWorldInverse);
    view.expandByPoint(new THREE.Vector2(corner.x, corner.y));
  }
  const mid = view.getCenter(new THREE.Vector2());
  const size = view.getSize(new THREE.Vector2());
  const half = (Math.max(size.x, size.y) / 2) * 1.04;
  camera.left = mid.x - half;
  camera.right = mid.x + half;
  camera.top = mid.y + half;
  camera.bottom = mid.y - half;
  camera.near = -100;
  camera.far = 100;
  camera.updateProjectionMatrix();

  const r = iconRenderer();
  r.render(scene, camera);
  return r.domElement.toDataURL();
}

const cache = new Map<string, Promise<string>>();

function cached(key: string, objects: () => Promise<THREE.Object3D[]> | THREE.Object3D[]): Promise<string> {
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.resolve(objects()).then(snapshot);
    cache.set(key, pending);
  }
  return pending;
}

// Obrázek ikony nástroje jako data URL; vykreslí se jednou a pak se bere z cache
export function sceneIcon(icon: SceneIcon): Promise<string> {
  return cached(icon, SCENES[icon]);
}

// Obrázek modelu z kitu (např. lokomotivy nebo auta) bez podkladu
export function modelIcon(kit: Kit, model: string): Promise<string> {
  return cached(`${kit}/${model}`, async () => [await loadModel(kit, model)]);
}

// Prvek ikony: do vykreslení (nebo když WebGL selže) ukazuje náhradní znak
export function iconElement(src: Promise<string>, fallback: string, className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = fallback;
  src.then(
    (url) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = fallback;
      img.draggable = false;
      el.replaceChildren(img);
    },
    () => {},
  );
  return el;
}

// Miniatura modelu (např. vedle názvu vlaku v přehledu); obrázek doplní, až bude vykreslený
export function modelThumb(kit: Kit, model: string, className = 'thumb'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.draggable = false;
  modelIcon(kit, model).then(
    (url) => (img.src = url),
    () => {},
  );
  return img;
}
