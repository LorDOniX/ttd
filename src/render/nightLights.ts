import * as THREE from 'three';
import type { Town } from '../world/town';

const MAX_STREET_LAMPS = 32;
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
  private readonly lamps: THREE.Group[] = [];
  private readonly townGlows: THREE.InstancedMesh;
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
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
    this.object.add(this.townGlows);
    for (let index = 0; index < MAX_STREET_LAMPS; index++) {
      const lamp = new THREE.Group();
      const bulb = LAMP_BULB.clone();
      bulb.position.y = 0.35;
      const light = new THREE.PointLight(0xffcf83, 2.5, 5, 2);
      light.position.y = 0.35;
      lamp.add(bulb, light);
      lamp.visible = false;
      this.lamps.push(lamp);
      this.object.add(lamp);
    }
    this.object.visible = false;
  }

  update(
    night: boolean,
    frustum: THREE.Frustum,
    cameraPosition: THREE.Vector3,
    streetLamps: readonly THREE.Vector3[],
    towns: readonly Pick<Town, 'x' | 'y' | 'radius'>[] = [],
    now = performance.now(),
  ): void {
    const nightChanged = this.lastNight !== night;
    const sourcesChanged = this.lastStreetLamps !== streetLamps || this.lastTownCount !== towns.length;
    const frustumChanged = this.hasFrustumChanged(frustum);
    if (!nightChanged && !sourcesChanged && !frustumChanged && !this.forceRefresh) return;
    if (!nightChanged && !sourcesChanged && !this.forceRefresh && now - this.lastUpdate < MIN_VIEW_UPDATE_MS) return;

    this.lastNight = night;
    this.lastStreetLamps = streetLamps;
    this.lastTownCount = towns.length;
    this.lastUpdate = now;
    this.forceRefresh = false;
    this.saveFrustum(frustum);
    this.object.visible = night;
    if (!night) {
      this.townGlows.count = 0;
      for (const lamp of this.lamps) lamp.visible = false;
      return;
    }

    const visibleTowns = towns
      .filter((town) => {
        const radius = Math.max(4, Math.min(16, town.radius * 0.75));
        VIEW_SPHERE.center.set(town.x + 0.5, 0.04, town.y + 0.5);
        VIEW_SPHERE.radius = radius;
        return frustum.intersectsSphere(VIEW_SPHERE);
      })
      .sort(
        (a, b) =>
          (a.x - cameraPosition.x) ** 2 +
          (a.y - cameraPosition.z) ** 2 -
          ((b.x - cameraPosition.x) ** 2 + (b.y - cameraPosition.z) ** 2),
      )
      .slice(0, MAX_TOWN_GLOWS);

    visibleTowns.forEach((town, index) => {
      const radius = Math.max(4, Math.min(16, town.radius * 0.75));
      this.position.set(town.x + 0.5, 0.035, town.y + 0.5);
      this.scale.set(radius, 1, radius);
      this.matrix.compose(this.position, new THREE.Quaternion(), this.scale);
      this.townGlows.setMatrixAt(index, this.matrix);
    });
    this.townGlows.count = visibleTowns.length;
    this.townGlows.instanceMatrix.needsUpdate = true;

    const visible = streetLamps
      .filter((position) => {
        VIEW_SPHERE.center.set(position.x, 0.35, position.z);
        return frustum.intersectsSphere(VIEW_SPHERE);
      })
      .sort((a, b) => a.distanceToSquared(cameraPosition) - b.distanceToSquared(cameraPosition))
      .slice(0, MAX_STREET_LAMPS);

    for (let index = 0; index < this.lamps.length; index++) {
      const lamp = this.lamps[index];
      const position = visible[index];
      lamp.visible = position !== undefined;
      if (position) lamp.position.set(position.x, position.y, position.z);
    }
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
