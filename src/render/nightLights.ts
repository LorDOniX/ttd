import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Town } from '../world/town';

// Pod tímto zoomem jsou lampy i světla vozidel menší než pixel, svítí jen záře měst
export const NIGHT_DETAIL_ZOOM = 0.7;
const MAX_STREET_LAMPS = 32;
const LAMP_INTENSITY = 2.5;
const LAMP_HEIGHT = 0.35;
const MAX_TOWN_GLOWS = 1024;
const MIN_VIEW_UPDATE_MS = 80;
const FRUSTUM_NORMAL_EPSILON = 0.002;
const FRUSTUM_DISTANCE_EPSILON = 0.3;
const LAMP_BULB = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xffd58a }),
);
const VIEW_SPHERE = new THREE.Sphere(new THREE.Vector3(), 0.2);

function createTownGlowTexture(): THREE.DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
      const alpha = Math.round(Math.pow(Math.max(0, 1 - distance), 2.2) * 190);
      const offset = (y * size + x) * 4;
      pixels.set([255, 225, 170, alpha], offset);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export interface LightBox {
  size: readonly [number, number, number];
  position: readonly [number, number, number];
  color: number;
}

// Světla vozidla jako jedna geometrie s barvami vrcholů: jeden draw call na vozidlo
export function lightMarkerGeometry(boxes: readonly LightBox[]): THREE.BufferGeometry {
  const color = new THREE.Color();
  const parts = boxes.map(({ size, position, color: hex }) => {
    const box = new THREE.BoxGeometry(...size).translate(...position);
    color.setHex(hex);
    const colors = new Float32Array(box.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return box;
  });
  return mergeGeometries(parts)!;
}

export const LIGHT_MARKER_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });

const TOWN_GLOW_GEOMETRY = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
const TOWN_GLOW_MATERIAL = new THREE.MeshBasicMaterial({
  map: createTownGlowTexture(),
  color: 0xffd08a,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

export class NightLightsView {
  readonly object = new THREE.Group();
  private readonly lamps: { bulb: THREE.Mesh; light: THREE.PointLight }[] = [];
  private readonly lampLayer = new THREE.Group();
  private readonly townGlows: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private lastDetailed: boolean | null = null;
  private readonly frustumSnapshot = new Float64Array(24);
  private hasFrustumSnapshot = false;
  private lastNight: boolean | null = null;
  private lastStreetLamps: readonly THREE.Vector3[] | null = null;
  private lastTownCount = -1;
  private lastUpdate = -Infinity;
  private forceRefresh = true;

  constructor() {
    this.townGlows = new THREE.InstancedMesh(TOWN_GLOW_GEOMETRY, TOWN_GLOW_MATERIAL, MAX_TOWN_GLOWS);
    this.townGlows.count = 0;
    this.townGlows.frustumCulled = false;
    this.townGlows.renderOrder = 1;
    this.object.add(this.townGlows, this.lampLayer);
    // Nevyužitá světla zůstávají ve scéně s nulovou intenzitou: změna jejich počtu by přeložila shadery všech materiálů
    for (let index = 0; index < MAX_STREET_LAMPS; index++) {
      const bulb = LAMP_BULB.clone();
      bulb.visible = false;
      const light = new THREE.PointLight(0xffcf83, 0, 5, 2);
      this.lamps.push({ bulb, light });
      this.lampLayer.add(bulb, light);
    }
    this.object.visible = false;
  }

  update(
    night: boolean,
    frustum: THREE.Frustum,
    cameraPosition: THREE.Vector3,
    zoom: number,
    streetLamps: readonly THREE.Vector3[],
    towns: readonly Pick<Town, 'x' | 'y' | 'radius'>[] = [],
    now = performance.now(),
  ): void {
    const detailed = zoom >= NIGHT_DETAIL_ZOOM;
    const nightChanged = this.lastNight !== night || this.lastDetailed !== detailed;
    const sourcesChanged = this.lastStreetLamps !== streetLamps || this.lastTownCount !== towns.length;
    const frustumChanged = this.hasFrustumChanged(frustum);
    if (!nightChanged && !sourcesChanged && !frustumChanged && !this.forceRefresh) return;
    if (!nightChanged && !sourcesChanged && !this.forceRefresh && now - this.lastUpdate < MIN_VIEW_UPDATE_MS) return;

    this.lastNight = night;
    this.lastDetailed = detailed;
    this.lastStreetLamps = streetLamps;
    this.lastTownCount = towns.length;
    this.lastUpdate = now;
    this.forceRefresh = false;
    this.saveFrustum(frustum);
    this.object.visible = night;
    if (!night) {
      this.townGlows.count = 0;
      return;
    }

    let glows = 0;
    for (const town of towns) {
      if (glows >= MAX_TOWN_GLOWS) break;
      const radius = Math.max(4, Math.min(16, town.radius * 0.75));
      VIEW_SPHERE.center.set(town.x + 0.5, 0.04, town.y + 0.5);
      VIEW_SPHERE.radius = radius;
      if (!frustum.intersectsSphere(VIEW_SPHERE)) continue;
      this.matrix.makeScale(radius, 1, radius).setPosition(town.x + 0.5, 0.035, town.y + 0.5);
      this.townGlows.setMatrixAt(glows++, this.matrix);
    }
    this.townGlows.count = glows;
    this.townGlows.instanceMatrix.needsUpdate = true;

    // Při oddálení světla ze scény zmizí úplně, shadery pak počítají bez nich (jen dvě varianty, žádné další překlady)
    this.lampLayer.visible = detailed;
    if (!detailed) return;

    VIEW_SPHERE.radius = 0.2;
    const visible = streetLamps
      .filter((position) => {
        VIEW_SPHERE.center.set(position.x, LAMP_HEIGHT, position.z);
        return frustum.intersectsSphere(VIEW_SPHERE);
      })
      .sort((a, b) => a.distanceToSquared(cameraPosition) - b.distanceToSquared(cameraPosition))
      .slice(0, MAX_STREET_LAMPS);

    this.lamps.forEach(({ bulb, light }, index) => {
      const position = visible[index];
      bulb.visible = position !== undefined;
      light.intensity = position ? LAMP_INTENSITY : 0;
      if (!position) return;
      bulb.position.set(position.x, position.y + LAMP_HEIGHT, position.z);
      light.position.copy(bulb.position);
    });
  }

  invalidate(): void {
    this.forceRefresh = true;
  }

  private hasFrustumChanged(frustum: THREE.Frustum): boolean {
    if (!this.hasFrustumSnapshot) return true;
    let offset = 0;
    for (const plane of frustum.planes) {
      const normal = plane.normal;
      if (
        Math.abs(normal.x - this.frustumSnapshot[offset]) > FRUSTUM_NORMAL_EPSILON ||
        Math.abs(normal.y - this.frustumSnapshot[offset + 1]) > FRUSTUM_NORMAL_EPSILON ||
        Math.abs(normal.z - this.frustumSnapshot[offset + 2]) > FRUSTUM_NORMAL_EPSILON ||
        Math.abs(plane.constant - this.frustumSnapshot[offset + 3]) > FRUSTUM_DISTANCE_EPSILON
      ) {
        return true;
      }
      offset += 4;
    }
    return false;
  }

  private saveFrustum(frustum: THREE.Frustum): void {
    let offset = 0;
    for (const plane of frustum.planes) {
      const normal = plane.normal;
      this.frustumSnapshot[offset] = normal.x;
      this.frustumSnapshot[offset + 1] = normal.y;
      this.frustumSnapshot[offset + 2] = normal.z;
      this.frustumSnapshot[offset + 3] = plane.constant;
      offset += 4;
    }
    this.hasFrustumSnapshot = true;
  }
}
