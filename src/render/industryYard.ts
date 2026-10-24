import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INDUSTRY_SIZE, type IndustryKind } from '../world/industry';

const HALF = INDUSTRY_SIZE / 2;
const TEXTURE_SIZE = 128;
// Nad terénem, pod silnicemi a mřížkou
const GROUND_LIFT = 0.004;

type Rgb = readonly [number, number, number];
// Barva povrchu v bodě (x, z) areálu se středem v počátku; px, py je pixel textury pro zrnitost
type Painter = (x: number, z: number, px: number, py: number) => Rgb;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(seed, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Hladký šum 0..1 se skvrnami velikosti period
function noise(x: number, z: number, period: number, seed: number): number {
  const gx = x / period + 64;
  const gz = z / period + 64;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = smoothstep(0, 1, gx - x0);
  const fz = smoothstep(0, 1, gz - z0);
  const top = hash(x0, z0, seed) + (hash(x0 + 1, z0, seed) - hash(x0, z0, seed)) * fx;
  const bottom = hash(x0, z0 + 1, seed) + (hash(x0 + 1, z0 + 1, seed) - hash(x0, z0 + 1, seed)) * fx;
  return top + (bottom - top) * fz;
}

function rgb(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// Štěrk nebo udusaná hlína: skvrny a zrnka světlejších a tmavších kamínků
function gravel(base: number, dark: number, light: number, seed: number): Painter {
  const [b, d, l] = [rgb(base), rgb(dark), rgb(light)];
  return (x, z, px, py) => {
    const color = mix(b, d, noise(x, z, 0.5, seed) * 0.6);
    const grain = hash(px, py, seed);
    return grain < 0.12 ? mix(color, d, 0.6) : grain > 0.9 ? mix(color, l, 0.6) : color;
  };
}

// Betonové desky o hraně slab se spárami, každá trochu jiného odstínu
function paving(base: number, joint: number, slab: number, seed: number): Painter {
  const [b, j] = [rgb(base), rgb(joint)];
  return (x, z, px, py) => {
    const sx = (x + HALF) / slab;
    const sz = (z + HALF) / slab;
    const fx = sx - Math.floor(sx);
    const fz = sz - Math.floor(sz);
    if (Math.min(fx, 1 - fx, fz, 1 - fz) * slab < 0.012) return j;
    const k = 1 + (hash(Math.floor(sx), Math.floor(sz), seed) - 0.5) * 0.1 + (hash(px, py, seed) - 0.5) * 0.05;
    return shade(mix(b, j, noise(x, z, 0.3, seed) * 0.25), k);
  };
}

// Skvrny (olej, uhelný prach, rez) přes jiný povrch
function stains(painter: Painter, stain: number, strength: number, seed: number): Painter {
  const s = rgb(stain);
  return (x, z, px, py) => mix(painter(x, z, px, py), s, smoothstep(0.6, 0.85, noise(x, z, 0.45, seed)) * strength);
}

// Roztroušená zrnka jiné barvy (piliny)
function sprinkled(painter: Painter, color: number, amount: number, seed: number): Painter {
  const c = rgb(color);
  return (x, z, px, py) => (hash(px, py, seed) < amount ? mix(painter(x, z, px, py), c, 0.8) : painter(x, z, px, py));
}

// Lesní půda: hlína s mechem a opadaným jehličím
const forestFloor: Painter = (() => {
  const [soil, dark, moss, needles] = [rgb(0x5b4932), rgb(0x3e3122), rgb(0x5f7a3c), rgb(0x9a7448)];
  return (x, z, px, py) => {
    let color = mix(soil, dark, noise(x, z, 0.35, 20) * 0.5);
    color = mix(color, moss, smoothstep(0.55, 0.75, noise(x, z, 0.6, 21)) * 0.85);
    const grain = hash(px, py, 22);
    return grain > 0.9 ? mix(color, needles, 0.7) : grain < 0.06 ? mix(color, dark, 0.7) : color;
  };
})();

// Farma: vzadu travnatý dvůr, vpředu zoraná pole s brázdami napříč
const farmyard: Painter = (() => {
  const [grass, dirt, furrow, ridge] = [rgb(0x7a9a4a), rgb(0x9a8458), rgb(0x664630), rgb(0x8a6640)];
  return (x, z, px, py) => {
    const grain = (hash(px, py, 31) - 0.5) * 0.12;
    const yard = mix(grass, dirt, noise(x, z, 0.4, 30) * 0.7);
    const stripe = (z + HALF) / 0.12;
    const field = mix(stripe - Math.floor(stripe) < 0.45 ? furrow : ridge, dirt, noise(x, z, 0.5, 32) * 0.25);
    return shade(mix(yard, field, smoothstep(-0.2, 0, z)), 1 + grain);
  };
})();

const GROUNDS: Record<IndustryKind, Painter> = {
  'coal-mine': stains(gravel(0x4d4945, 0x2b2927, 0x6e6860, 1), 0x1f1d1c, 0.55, 2),
  'power-station': stains(paving(0xa19e96, 0x75736d, 0.5, 4), 0x55524c, 0.5, 5),
  forest: forestFloor,
  sawmill: sprinkled(gravel(0x8a7258, 0x6c5640, 0x9e866a, 12), 0xd9c08c, 0.18, 13),
  'oil-wells': stains(gravel(0xa38d65, 0x86704e, 0xbca67c, 14), 0x2a2622, 0.75, 15),
  refinery: stains(paving(0xb0ada5, 0x7d7a73, 0.6, 6), 0x2e2b28, 0.7, 7),
  'iron-mine': gravel(0x7d5745, 0x5a3a2c, 0xa07560, 3),
  'steel-mill': stains(gravel(0x56565a, 0x3c3c40, 0x707074, 8), 0x7a4a32, 0.6, 9),
  factory: paving(0xaaa69c, 0x807c74, 0.3, 10),
  farm: farmyard,
  'food-factory': paving(0xbdb9ad, 0x96928a, 0.375, 11),
};

const groundMaterials = new Map<IndustryKind, THREE.MeshLambertMaterial>();

function groundMaterial(kind: IndustryKind): THREE.MeshLambertMaterial {
  let material = groundMaterials.get(kind);
  if (material) return material;
  const paint = GROUNDS[kind];
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let py = 0; py < TEXTURE_SIZE; py++) {
    for (let px = 0; px < TEXTURE_SIZE; px++) {
      // Řádek 0 je u v = 0, tedy na přední straně areálu (+z)
      const x = -HALF + ((px + 0.5) / TEXTURE_SIZE) * INDUSTRY_SIZE;
      const z = HALF - ((py + 0.5) / TEXTURE_SIZE) * INDUSTRY_SIZE;
      const [r, g, b] = paint(x, z, px, py);
      pixels.set(
        [r, g, b, 255].map((c) => Math.max(0, Math.min(255, Math.round(c)))),
        (py * TEXTURE_SIZE + px) * 4,
      );
    }
  }
  const texture = new THREE.DataTexture(pixels, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  material = new THREE.MeshLambertMaterial({
    map: texture,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  groundMaterials.set(kind, material);
  return material;
}

const GROUND_GEOMETRY = new THREE.PlaneGeometry(INDUSTRY_SIZE, INDUSTRY_SIZE).rotateX(-Math.PI / 2);

// Tematický povrch pod celým areálem
export function industryGround(kind: IndustryKind): THREE.Mesh {
  const ground = new THREE.Mesh(GROUND_GEOMETRY, groundMaterial(kind));
  ground.position.y = GROUND_LIFT;
  return ground;
}

interface FenceStyle {
  // Barva sloupků, příčlí a latí
  color: number;
  height: number;
  post: number;
  spacing: number;
  // Výšky příčlí jako podíl výšky plotu
  rails?: readonly number[];
  rail?: number;
  // Rozteč svislých latí mezi sloupky
  pickets?: number;
  // Výplň mezi sloupky: zeď, prkna nebo průsvitné pletivo
  panel?: { color: number; thickness: number; opacity?: number };
}

const CHAIN_LINK: FenceStyle = {
  color: 0x8a8d8f,
  height: 0.22,
  post: 0.022,
  spacing: 0.36,
  rails: [1],
  rail: 0.012,
  panel: { color: 0xa4aaae, thickness: 0.004, opacity: 0.35 },
};
const CONCRETE_WALL: FenceStyle = {
  color: 0xb0aca2,
  height: 0.2,
  post: 0.05,
  spacing: 0.5,
  panel: { color: 0x9e9a90, thickness: 0.035 },
};

const FENCES: Record<IndustryKind, FenceStyle> = {
  'coal-mine': CHAIN_LINK,
  'power-station': CONCRETE_WALL,
  // Dřevěný plot ze dvou kulatých břeven
  forest: { color: 0x7a5a3a, height: 0.15, post: 0.03, spacing: 0.45, rails: [0.45, 0.85], rail: 0.022 },
  // Plot z prken
  sawmill: { color: 0x6e5034, height: 0.2, post: 0.03, spacing: 0.4, panel: { color: 0x9a7650, thickness: 0.018 } },
  'oil-wells': { ...CHAIN_LINK, height: 0.18 },
  refinery: CHAIN_LINK,
  'iron-mine': CHAIN_LINK,
  'steel-mill': CONCRETE_WALL,
  // Cihlová zeď s pilíři a stříškou
  factory: {
    color: 0x8a3e2c,
    height: 0.18,
    post: 0.055,
    spacing: 0.5,
    rails: [1],
    rail: 0.05,
    panel: { color: 0xa24a34, thickness: 0.04 },
  },
  // Bílá ohrada se třemi příčlemi
  farm: { color: 0xd8d2c0, height: 0.14, post: 0.025, spacing: 0.4, rails: [0.35, 0.65, 0.95], rail: 0.016 },
  // Zelené kovové zábradlí s latěmi
  'food-factory': {
    color: 0x2f6a45,
    height: 0.17,
    post: 0.02,
    spacing: 0.4,
    rails: [0.15, 0.95],
    rail: 0.012,
    pickets: 0.06,
  },
};

const FENCE_INSET = 0.04;
// Polovina šířky vjezdu na přední straně (+z)
const GATE = 0.3;

function fenceSegments(): [number, number, number, number][] {
  const e = HALF - FENCE_INSET;
  return [
    [-e, -e, e, -e],
    [e, -e, e, e],
    [-e, -e, -e, e],
    [-e, e, -GATE, e],
    [GATE, e, e, e],
  ];
}

const fenceCache = new Map<IndustryKind, { frame: THREE.Mesh; panel: THREE.Mesh | null }>();

function buildFence(style: FenceStyle): { frame: THREE.Mesh; panel: THREE.Mesh | null } {
  const frame: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  for (const [x0, z0, x1, z1] of fenceSegments()) {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const alongX = z0 === z1;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Kvádr podél celého úseku
    const bar = (thickness: number, height: number, y: number): THREE.BufferGeometry =>
      new THREE.BoxGeometry(alongX ? length : thickness, height, alongX ? thickness : length).translate(
        cx,
        y + height / 2,
        cz,
      );
    const upright = (t: number, size: number, height: number): THREE.BufferGeometry =>
      new THREE.BoxGeometry(size, height, size).translate(x0 + (x1 - x0) * t, height / 2, z0 + (z1 - z0) * t);

    const posts = Math.max(1, Math.ceil(length / style.spacing));
    for (let i = 0; i <= posts; i++) frame.push(upright(i / posts, style.post, style.height));
    for (const rail of style.rails ?? []) {
      const thickness = style.rail ?? style.post / 2;
      frame.push(bar(thickness, thickness, style.height * rail - thickness / 2));
    }
    if (style.pickets) {
      const count = Math.max(1, Math.round(length / style.pickets));
      for (let i = 1; i < count; i++) frame.push(upright(i / count, style.post * 0.4, style.height * 0.92));
    }
    if (style.panel) panels.push(bar(style.panel.thickness, style.height * 0.95, 0));
  }

  const frameMesh = new THREE.Mesh(
    mergeGeometries(frame)!,
    new THREE.MeshLambertMaterial({ color: style.color, flatShading: true }),
  );
  if (!style.panel) return { frame: frameMesh, panel: null };
  const see = style.panel.opacity !== undefined && style.panel.opacity < 1;
  const panelMesh = new THREE.Mesh(
    mergeGeometries(panels)!,
    new THREE.MeshLambertMaterial({
      color: style.panel.color,
      flatShading: true,
      transparent: see,
      opacity: style.panel.opacity ?? 1,
      depthWrite: !see,
      side: see ? THREE.DoubleSide : THREE.FrontSide,
    }),
  );
  return { frame: frameMesh, panel: panelMesh };
}

// Oplocení po obvodu areálu podle druhu závodu, s vjezdem vpředu
export function industryFence(kind: IndustryKind): THREE.Group {
  let fence = fenceCache.get(kind);
  if (!fence) {
    fence = buildFence(FENCES[kind]);
    fenceCache.set(kind, fence);
  }
  const group = new THREE.Group();
  group.add(fence.frame.clone());
  if (fence.panel) group.add(fence.panel.clone());
  return group;
}

const FLOODLIGHT_INSET = 0.14;
const FLOODLIGHT_HEIGHT = 0.6;
// Vzdálenost středu světelné skvrny reflektoru od středu areálu po každé ose
const FLOODLIGHT_REACH = 0.75;
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

// Středy skvrn čtyř reflektorů v souřadnicích areálu, pro zapečení nočního světla
export const FLOODLIGHT_POOLS: readonly THREE.Vector3[] = CORNERS.map(
  ([sx, sz]) => new THREE.Vector3(sx * FLOODLIGHT_REACH, 0, sz * FLOODLIGHT_REACH),
);

const FLOODLIGHT_POLE_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x55585a, flatShading: true });
const FLOODLIGHT_HEAD_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x8c8a80, flatShading: true });

// Sloupy v rozích s reflektorem na rameni, natočeným dolů do středu areálu
const FLOODLIGHT_GEOMETRY = (() => {
  const corner = HALF - FLOODLIGHT_INSET;
  const h = FLOODLIGHT_HEIGHT;
  const poles: THREE.BufferGeometry[] = [];
  const heads: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of CORNERS) {
    const x = sx * corner;
    const z = sz * corner;
    const yaw = Math.atan2(-sx, -sz);
    poles.push(new THREE.CylinderGeometry(0.016, 0.022, h, 6).translate(x, h / 2, z));
    poles.push(new THREE.BoxGeometry(0.06, 0.04, 0.06).translate(x, 0.02, z));
    poles.push(
      new THREE.BoxGeometry(0.014, 0.014, 0.09)
        .translate(0, h - 0.01, 0.045)
        .rotateY(yaw)
        .translate(x, 0, z),
    );
    heads.push(
      new THREE.BoxGeometry(0.1, 0.07, 0.04)
        .rotateX(0.6)
        .translate(0, h - 0.03, 0.1)
        .rotateY(yaw)
        .translate(x, 0, z),
    );
  }
  return { poles: mergeGeometries(poles)!, heads: mergeGeometries(heads)! };
})();

export function industryFloodlights(): THREE.Group {
  return new THREE.Group().add(
    new THREE.Mesh(FLOODLIGHT_GEOMETRY.poles, FLOODLIGHT_POLE_MATERIAL),
    new THREE.Mesh(FLOODLIGHT_GEOMETRY.heads, FLOODLIGHT_HEAD_MATERIAL),
  );
}

export function setFloodlightsOn(on: boolean): void {
  FLOODLIGHT_HEAD_MATERIAL.color.setHex(on ? 0xfff1cf : 0x8c8a80);
  FLOODLIGHT_HEAD_MATERIAL.emissive.setHex(on ? 0xffe2a8 : 0x000000);
  FLOODLIGHT_HEAD_MATERIAL.emissiveIntensity = on ? 2 : 0;
}
