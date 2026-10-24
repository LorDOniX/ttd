import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Town } from '../world/town';

// Pod tímto zoomem jsou světla vozidel menší než pixel
export const NIGHT_DETAIL_ZOOM = 0.7;
const LAMP_COLOR = new THREE.Color(0xffcf83);
const LAMP_LIGHT_INTENSITY = 1.6;
// Poloměr světelné skvrny lampy na zemi v dlaždicích
const LAMP_RADIUS = 1.4;
// Jas středu skvrny 0..255, rezerva na překryv sousedních lamp
const LAMP_PEAK = 200;
const LIGHT_MAP_MAX_SIZE = 2048;
const LIGHT_MAP_MAX_TEXELS_PER_TILE = 4;
const MAX_TOWN_GLOWS = 1024;
const MIN_VIEW_UPDATE_MS = 80;
const FRUSTUM_NORMAL_EPSILON = 0.002;
const FRUSTUM_DISTANCE_EPSILON = 0.3;
const VIEW_SPHERE = new THREE.Sphere(new THREE.Vector3(), 0.2);

// Barva texelu (sRGB bajty) pro každou úroveň jasu lampy
const LAMP_LUT = (() => {
  const lut = new Uint8Array(256 * 4);
  const color = new THREE.Color();
  for (let level = 0; level < 256; level++) {
    const hex = color.copy(LAMP_COLOR).multiplyScalar(level / 255).getHex();
    lut.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], level * 4);
  }
  return lut;
})();

// Sdílené všemi materiály z withLampLight, nastavuje je NightLightsView
const LAMP_UNIFORMS = {
  lampLightMap: { value: null as THREE.Texture | null },
  lampLightScale: { value: new THREE.Vector2(1, 1) },
  lampLightIntensity: { value: 0 },
};

const LAMP_VERTEX = /* glsl */ `
varying vec3 vLampWorld;
varying vec3 vLampNormal;
`;

const LAMP_VERTEX_MAIN = /* glsl */ `
vec4 lampWorld = vec4(transformed, 1.0);
vec3 lampNormal = objectNormal;
#ifdef USE_INSTANCING
lampWorld = instanceMatrix * lampWorld;
lampNormal = mat3(instanceMatrix) * lampNormal;
#endif
vLampWorld = (modelMatrix * lampWorld).xyz;
vLampNormal = mat3(modelMatrix) * lampNormal;
`;

// Stěna čelem k ulici čte světlo kousek před sebou, kde leží skvrna lampy; výš nad lampou světlo slábne
const LAMP_FRAGMENT = /* glsl */ `
uniform sampler2D lampLightMap;
uniform vec2 lampLightScale;
uniform float lampLightIntensity;
varying vec3 vLampWorld;
varying vec3 vLampNormal;

vec3 lampLightIrradiance() {
  if (lampLightIntensity <= 0.0) return vec3(0.0);
  vec3 n = normalize(vLampNormal);
  vec2 at = (vLampWorld.xz + n.xz * 0.35) * lampLightScale;
  float fade = 1.0 - smoothstep(0.1, 0.75, vLampWorld.y);
  float facing = 1.0 - max(n.y, 0.0) * 0.6;
  return texture2D(lampLightMap, at).rgb * lampLightIntensity * fade * facing;
}
`;

const lampLit = new WeakSet<THREE.Material>();

// Doplní materiálu světlo zapečených lamp podle světové polohy, nepotřebuje uv1
export function withLampLight(material: THREE.Material): void {
  if (lampLit.has(material)) return;
  lampLit.add(material);
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, LAMP_UNIFORMS);
    shader.vertexShader =
      LAMP_VERTEX +
      shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${LAMP_VERTEX_MAIN}`);
    shader.fragmentShader =
      LAMP_FRAGMENT +
      shader.fragmentShader.replace(
        '#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\nirradiance += lampLightIrradiance();',
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|lamp-light`;
  material.needsUpdate = true;
}

// Souřadnice do zapečených světel lamp: světové x, z (na mapu je přepočte repeat textury)
export function withLampLightUv(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  if (!position) return geometry;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i);
    uv[i * 2 + 1] = position.getZ(i);
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function sameLamps(a: readonly THREE.Vector3[], b: readonly THREE.Vector3[]): boolean {
  return a.length === b.length && a.every((lamp, i) => lamp.x === b[i].x && lamp.z === b[i].z);
}

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

// Světlo všech lamp je zapečené do textury přes celou mapu, kterou zem používá jako lightMap:
// shadery nepočítají žádná bodová světla a cena nezávisí na počtu lamp
export class NightLightsView {
  readonly object = new THREE.Group();
  readonly lampLight: THREE.DataTexture;
  private readonly texelsPerTile: number;
  private readonly lampLevels: Uint8Array;
  private readonly litMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly townGlows: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly frustumSnapshot = new Float64Array(24);
  private hasFrustumSnapshot = false;
  private lastNight: boolean | null = null;
  private lastStreetLamps: readonly THREE.Vector3[] | null = null;
  private bakedLamps: readonly THREE.Vector3[] = [];
  private lastTownCount = -1;
  private lastUpdate = -Infinity;
  private forceRefresh = true;

  constructor(mapWidth: number, mapHeight: number) {
    this.townGlows = new THREE.InstancedMesh(TOWN_GLOW_GEOMETRY, TOWN_GLOW_MATERIAL, MAX_TOWN_GLOWS);
    this.townGlows.count = 0;
    this.townGlows.frustumCulled = false;
    this.townGlows.renderOrder = 1;
    this.object.add(this.townGlows);
    this.object.visible = false;

    this.texelsPerTile = Math.max(
      1,
      Math.min(LIGHT_MAP_MAX_TEXELS_PER_TILE, Math.floor(LIGHT_MAP_MAX_SIZE / Math.max(mapWidth, mapHeight))),
    );
    const width = mapWidth * this.texelsPerTile;
    const height = mapHeight * this.texelsPerTile;
    this.lampLevels = new Uint8Array(width * height);
    const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.channel = 1;
    texture.repeat.set(1 / mapWidth, 1 / mapHeight);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.lampLight = texture;
    LAMP_UNIFORMS.lampLightMap.value = texture;
    LAMP_UNIFORMS.lampLightScale.value.set(1 / mapWidth, 1 / mapHeight);
    LAMP_UNIFORMS.lampLightIntensity.value = 0;
  }

  // Materiály země, na které lampy svítí; jejich geometrie potřebují uv1 z withLampLightUv
  light(...materials: THREE.MeshLambertMaterial[]): void {
    for (const material of materials) {
      material.lightMap = this.lampLight;
      material.lightMapIntensity = this.lastNight ? LAMP_LIGHT_INTENSITY : 0;
      this.litMaterials.push(material);
    }
  }

  update(
    night: boolean,
    frustum: THREE.Frustum,
    streetLamps: readonly THREE.Vector3[],
    towns: readonly Pick<Town, 'x' | 'y' | 'radius'>[] = [],
    now = performance.now(),
  ): void {
    if (this.lastStreetLamps !== streetLamps) this.bakeLamps(streetLamps);
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
    for (const material of this.litMaterials) material.lightMapIntensity = night ? LAMP_LIGHT_INTENSITY : 0;
    LAMP_UNIFORMS.lampLightIntensity.value = night ? LAMP_LIGHT_INTENSITY : 0;
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
  }

  // Přepeče světla jen při skutečné změně poloh lamp, ne při každé přestavbě silnic
  private bakeLamps(lamps: readonly THREE.Vector3[]): void {
    if (sameLamps(this.bakedLamps, lamps)) return;
    this.bakedLamps = lamps;
    const { image } = this.lampLight;
    const width = image.width;
    const height = image.height;
    const pixels = image.data as Uint8Array;
    const levels = this.lampLevels;
    levels.fill(0);
    pixels.fill(0);
    const scale = this.texelsPerTile;
    const radius = LAMP_RADIUS * scale;
    for (const lamp of lamps) {
      const cx = lamp.x * scale;
      const cz = lamp.z * scale;
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(width - 1, Math.ceil(cx + radius));
      const z0 = Math.max(0, Math.floor(cz - radius));
      const z1 = Math.min(height - 1, Math.ceil(cz + radius));
      for (let tz = z0; tz <= z1; tz++) {
        for (let tx = x0; tx <= x1; tx++) {
          const dx = tx + 0.5 - cx;
          const dz = tz + 0.5 - cz;
          const d2 = (dx * dx + dz * dz) / (radius * radius);
          if (d2 >= 1) continue;
          const i = tz * width + tx;
          const level = Math.min(255, levels[i] + Math.round((1 - d2) * (1 - d2) * LAMP_PEAK));
          levels[i] = level;
          pixels.set(LAMP_LUT.subarray(level * 4, level * 4 + 4), i * 4);
        }
      }
    }
    this.lampLight.needsUpdate = true;
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
