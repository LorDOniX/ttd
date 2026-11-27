import * as THREE from 'three';
import { loadModel, type Kit } from '../assets';
import { EDGE_DELTA, Edge, PIECES, type Axis } from '../world/rail';
import type { IndustryKind } from '../world/industry';
import { normalizedAircraft } from './aircraft';
import { createAirportObject } from './airports';
import { createPortObject, loadPortModel } from './ports';
import { normalizedShip } from './ships';
import { createWaypointObject } from './waypoints';
import { createCatenaryIcon } from './catenary';
import { WATER_DEPTH } from './terrain';
import { moorDirection, moorPoint, portShape } from '../world/port';
import { buildIndustryPreview } from './industries';
import { AIRPORT_TYPES, type AirportType } from '../game/balance';
import { airportShape, standPoint } from '../world/airport';
import {
  TrackView,
  createDepotMesh,
  createRailBridgeObject,
  createTunnelPortal,
  createRoadDepotMesh,
  createRoadStopMesh,
  createStationObject,
  placeDepot,
} from './rail';
import { roadAtlas, roadGeometry } from './roads';
import {
  SIGNAL_ARROW,
  SIGNAL_ARROW_COLOR,
  SIGNAL_GREEN,
  SIGNAL_LAMP,
  SIGNAL_POLE,
  SIGNAL_POLE_COLOR,
  signalPlacement,
} from './signals';

// Obrázek se zmenší na velikost ikony, větší rozlišení drží ostrost i na displejích s vyšší hustotou
const SIZE = 128;
// Stejný pohled jako ve hře: dimetrie 2:1 z rohu mapy
const ISO_DIRECTION = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();
const GRASS = 0x5f9e3c;
const TILE_DEPTH = 0.12;

export type SceneIcon =
  | 'track'
  | 'bridge'
  | 'station'
  | 'depot'
  | 'signal'
  | 'waypoint'
  | 'electrify'
  | 'road'
  | 'road-stop'
  | 'road-depot'
  | 'road-bridge'
  | 'airport-small'
  | 'airport-large'
  | 'port'
  | 'demolish'
  | 'tunnel'
  | 'road-tunnel'
  | 'terraform-raise'
  | 'terraform-lower'
  | 'terraform-level'
  | 'plant-trees';

// Čtyřboký jehlan terénu (kopec nahoru, údolí dolů) na dlaždici
function hillShape(height: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(Math.SQRT1_2, Math.abs(height), 4, 1, false, Math.PI / 4),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  mesh.position.set(0.5, height / 2, 0.5);
  if (height < 0) mesh.rotation.x = Math.PI;
  return mesh;
}

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

// Letiště na trávě s letadlem na prvním stání
async function airport(type: AirportType): Promise<THREE.Object3D[]> {
  const { length, depth } = AIRPORT_TYPES[type];
  const shape = airportShape(type, Math.floor(length / 2), Math.floor(depth / 2), 'x');
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(length, TILE_DEPTH, depth).translate(length / 2, -TILE_DEPTH / 2, depth / 2),
    new THREE.MeshLambertMaterial({ color: GRASS }),
  );
  const plane = await normalizedAircraft(type === 'large' ? 'airplane-3' : 'airplane-1');
  const stand = standPoint(shape, type, 0);
  plane.position.set(stand.x, 0, stand.y);
  plane.rotation.y = Math.PI;
  return [ground, createAirportObject(shape, type, material), plane];
}

// Přístav na břehu s lodí u kotviště
async function port(): Promise<THREE.Object3D[]> {
  const shape = portShape(1, 0, 'x', Edge.S);
  const land = new THREE.Mesh(
    new THREE.BoxGeometry(2, TILE_DEPTH, 1).translate(1, -TILE_DEPTH / 2, 0.5),
    new THREE.MeshLambertMaterial({ color: GRASS }),
  );
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(2, TILE_DEPTH, 1).translate(1, -TILE_DEPTH / 2 - WATER_DEPTH, 1.5),
    new THREE.MeshLambertMaterial({ color: 0x3a6fb0 }),
  );
  const ship = await normalizedShip('ship-cargo-a');
  await loadPortModel();
  const moor = moorPoint(shape, 0);
  const dir = moorDirection(shape);
  ship.position.set(moor.x + 0.4, -WATER_DEPTH, moor.y);
  ship.rotation.y = Math.atan2(dir.x, dir.y);
  return [land, water, createPortObject(shape, material), ship];
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
  waypoint: () => [tile(), track('x'), createWaypointObject('x')],
  electrify: () => [tile(), track('x'), createCatenaryIcon()],
  // Most přes kolej: tři dlaždice, pod prostředním polem kolej napříč
  bridge: () => {
    const ground = [0, 1, 2].map((x) => {
      const t = tile();
      t.position.x = x;
      return t;
    });
    const under = track('y');
    under.position.x = 1;
    return [...ground, under, createRailBridgeObject({ x: 0, y: 0, dir: Edge.E, span: 1 }, material)];
  },
  // Silniční most přes kolej
  'road-bridge': () => {
    const ground = [0, 1, 2].map((x) => {
      const t = tile();
      t.position.x = x;
      return t;
    });
    const under = track('y');
    under.position.x = 1;
    return [...ground, under, createRailBridgeObject({ x: 0, y: 0, dir: Edge.E, span: 1 }, material, true)];
  },
  road: () => [tile(), road('x')],
  'road-stop': () => [tile(), road('x'), createRoadStopMesh(material, 0, 0, 'x')],
  'road-depot': () => {
    const depot = createRoadDepotMesh(material);
    placeDepot(depot, 0, 0, Edge.S);
    return [tile(), depot];
  },
  'airport-small': () => airport('small'),
  'airport-large': () => airport('large'),
  port,
  demolish: async () => [await loadModel('car kit', 'tractor-shovel')],
  // Portál tunelu ve svahu s kolejí (silnicí) vedoucí do ústí
  tunnel: () => [tile(), track('x'), createTunnelPortal(0, 0, Edge.E, 0)],
  'road-tunnel': () => [tile(), road('x'), createTunnelPortal(0, 0, Edge.E, 0)],
  'terraform-raise': () => [tile(), hillShape(0.55, GRASS)],
  // Strom na trávě
  'plant-trees': async () => [tile(), await loadModel('nature kit', 'tree_default')],
  // Údolí: obrácený jehlan hlíny nad dlaždicí
  'terraform-lower': () => [hillShape(-0.55, 0x8a6a45)],
  'terraform-level': () => {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.18, 1).translate(0.5, 0.09, 0.5),
      new THREE.MeshLambertMaterial({ color: GRASS }),
    );
    return [tile(), slab];
  },
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

// Depo (nebo garáž aut) natočené vjezdem k dané hraně, před vjezdem kus koleje nebo silnice
export function depotIcon(kind: 'depot' | 'road-depot', entrance: Edge): Promise<string> {
  return cached(`${kind}/${entrance}`, () => {
    const [dx, dy] = EDGE_DELTA[entrance];
    const front = tile();
    front.position.set(dx, 0, dy);
    const axis: Axis = entrance % 2 === 0 ? 'y' : 'x';
    let stub: THREE.Object3D;
    if (kind === 'depot') {
      stub = track(axis);
    } else {
      stub = road(axis);
    }
    stub.position.set(dx, 0, dy);
    const depot = kind === 'depot' ? createDepotMesh(material) : createRoadDepotMesh(material);
    placeDepot(depot, 0, 0, entrance);
    return [tile(), front, stub, depot];
  });
}

// Návěstidlo na koleji pro okno návěstidel; jednosměrné se šipkou ve směru jízdy
export function signalIcon(oneWay: boolean): Promise<string> {
  return cached(`signal/${oneWay ? 'one' : 'two'}`, () => {
    const piece = PIECES.findIndex(([p, q]) => p === Edge.W && q === Edge.E);
    const place = signalPlacement(piece, 0, 0, oneWay ? Edge.E : undefined);
    const group = new THREE.Group();
    const pole = new THREE.Mesh(SIGNAL_POLE, new THREE.MeshLambertMaterial({ color: SIGNAL_POLE_COLOR }));
    const lamp = new THREE.Mesh(SIGNAL_LAMP, new THREE.MeshBasicMaterial({ color: SIGNAL_GREEN }));
    pole.position.set(place.pole[0], 0, place.pole[1]);
    lamp.position.copy(pole.position);
    group.add(pole, lamp);
    if (place.angle !== null) {
      const arrow = new THREE.Mesh(SIGNAL_ARROW, new THREE.MeshBasicMaterial({ color: SIGNAL_ARROW_COLOR }));
      arrow.position.set(place.center[0], 0, place.center[1]);
      arrow.rotation.y = place.angle;
      group.add(arrow);
    }
    return [tile(), track('x'), group];
  });
}

// Nástupiště natočené podél osy, jako volba orientace v okně stanice
export function stationIcon(axis: Axis): Promise<string> {
  return cached(`station/${axis}`, () => {
    const shape = { x: 1, y: 1, axis, length: 3, tracks: 1 };
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(3, TILE_DEPTH, 3).translate(1.5, -TILE_DEPTH / 2, 1.5),
      new THREE.MeshLambertMaterial({ color: GRASS }),
    );
    const view = new TrackView(material);
    const piece = PIECES.findIndex(([p, q]) =>
      axis === 'x' ? p === Edge.W && q === Edge.E : p === Edge.N && q === Edge.S,
    );
    view.update([0, 1, 2].map((i) => (axis === 'x' ? { x: i, y: 1, piece } : { x: 1, y: i, piece })));
    return [ground, view.object, createStationObject(shape, material)];
  });
}

// Ikona lišty z OpenGFX (assets/ui/toolbar, 40×40 px pro zoom 2×), stejné rozhraní jako vykreslené ikony
export type ToolbarIcon =
  | 'build-road'
  | 'build-rail'
  | 'build-water'
  | 'build-air'
  | 'list-road'
  | 'list-trains'
  | 'list-ships'
  | 'list-aircraft'
  | 'industry';

export function toolbarIcon(name: ToolbarIcon): Promise<string> {
  return Promise.resolve(`${import.meta.env.BASE_URL}ui/toolbar/${name}.png`);
}

// Obrázek modelu z kitu (např. lokomotivy nebo auta) bez podkladu
export function modelIcon(kit: Kit, model: string): Promise<string> {
  return cached(`${kit}/${model}`, async () => [await loadModel(kit, model)]);
}

// Boční pohled na vozidlo jako v depu OpenTTD: čelo vlevo, mírně shora, ve stejném měřítku pro všechny modely,
// aby lokomotiva a vagony vedle sebe tvořily soupravu. Rozměry obrázku v jednotkách modelu.
export interface SideImage {
  url: string;
  width: number;
  height: number;
}

// Rozlišení bočních obrázků (pixelů na jednotku modelu); zobrazují se zmenšené
const SIDE_PX_PER_UNIT = 72;
// Kamera z boku (+X) s mírným nadhledem
const SIDE_DIRECTION = new THREE.Vector3(1, 0.32, -0.18).normalize();
const sideCache = new Map<string, Promise<SideImage>>();

function sideSnapshot(object: THREE.Object3D): SideImage {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(8, 12, 6);
  scene.add(sun, object);
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().expandByObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera();
  camera.position.copy(center).addScaledVector(SIDE_DIRECTION, 10);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const view = new THREE.Box2();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.applyMatrix4(camera.matrixWorldInverse);
    view.expandByPoint(new THREE.Vector2(corner.x, corner.y));
  }
  view.expandByScalar(0.04);
  const size = view.getSize(new THREE.Vector2());
  camera.left = view.min.x;
  camera.right = view.max.x;
  camera.top = view.max.y;
  camera.bottom = view.min.y;
  camera.near = -100;
  camera.far = 100;
  camera.updateProjectionMatrix();

  const r = iconRenderer();
  r.setSize(Math.max(1, Math.round(size.x * SIDE_PX_PER_UNIT)), Math.max(1, Math.round(size.y * SIDE_PX_PER_UNIT)));
  r.render(scene, camera);
  const url = r.domElement.toDataURL();
  r.setSize(SIZE, SIZE);
  return { url, width: size.x, height: size.y };
}

export function sideIcon(kit: Kit, model: string): Promise<SideImage> {
  const key = `${kit}/${model}`;
  let pending = sideCache.get(key);
  if (!pending) {
    pending = loadModel(kit, model).then(sideSnapshot);
    sideCache.set(key, pending);
  }
  return pending;
}

// Obrázek vozidla z boku; scale = pixelů na jednotku modelu na obrazovce (stejné pro celou soupravu)
export function sideImage(kit: Kit, model: string, scale: number, className = 'side-image'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.draggable = false;
  sideIcon(kit, model).then(
    (side) => {
      img.style.width = `${Math.round(side.width * scale)}px`;
      img.style.height = `${Math.round(side.height * scale)}px`;
      img.src = side.url;
    },
    () => {},
  );
  return img;
}

// Celý areál závodu i s povrchem a plotem
export function industryIcon(kind: IndustryKind): Promise<string> {
  return cached(`industry/${kind}`, async () => [await buildIndustryPreview(kind)]);
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
