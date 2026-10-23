import * as THREE from 'three';

// Druh svislé plochy: bez oken, zeď s okny po patrech, prosklený panel s příčkami
export enum Surface {
  Plain = 0,
  Wall = 1,
  Glass = 2,
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

// Rozměry v normalizované budově (dlaždice = 1): výška patra, rozteč oken a příček a velikost okna
const FLOOR = 0.15;
const COLUMN = 0.13;
const MULLION = 0.07;
const WINDOW = [0.07, 0.085];
// Užší nebo nižší plochy (pásky, nástavby na střeše) okna nedostanou
const MIN_WALL = [0.3, 0.14];

const SHADER_VERTEX = /* glsl */ `
attribute vec4 facade;
attribute float facadeSurface;
varying vec4 vFacade;
varying float vFacadeSurface;
`;

// vFacade: poloha na ploše od jejího levého dolního rohu (xy) a rozměry plochy (zw)
const SHADER_FRAGMENT = /* glsl */ `
varying vec4 vFacade;
varying float vFacadeSurface;

float facadeHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// 1 uvnitř obdélníku s polovičními rozměry size kolem středu, změkčené na šířku pixelu
float facadeBox(vec2 d, vec2 size, vec2 pixel) {
  vec2 inside = smoothstep(size + pixel * 0.5, size - pixel * 0.5, d);
  return inside.x * inside.y;
}

void applyFacade(inout vec3 color) {
  vec2 size = vFacade.zw;
  vec2 pixel = fwidth(vFacade.xy);
  if (vFacadeSurface < 1.5) {
    if (size.x < ${MIN_WALL[0]} || size.y < ${MIN_WALL[1]}) return;
    vec2 cells = max(vec2(1.0), floor(size / vec2(${COLUMN}, ${FLOOR}) + 0.3));
    vec2 cell = size / cells;
    vec2 id = floor(vFacade.xy / cell);
    vec2 local = vFacade.xy - id * cell;
    vec2 pane = min(vec2(${WINDOW[0] / 2}, ${WINDOW[1] / 2}), cell * vec2(0.32, 0.3));
    vec2 d = abs(local - cell * vec2(0.5, 0.55));
    float glass = facadeBox(d, pane, pixel);
    float frame = facadeBox(d, pane + 0.008, pixel);
    // Sklo světlá ke kraji okna a každé okno má trochu jiný odlesk
    float shine = facadeHash(id + floor(size * 100.0)) * 0.5 + (local.y - cell.y * 0.55 + pane.y) / (pane.y * 2.0) * 0.5;
    vec3 tint = mix(vec3(0.07, 0.11, 0.2), vec3(0.2, 0.3, 0.45), shine);
    color = mix(color, color * 0.62, frame - glass);
    color = mix(color, tint, glass);
  } else {
    vec2 cells = max(vec2(1.0), floor(size / vec2(${MULLION}, ${FLOOR}) + 0.5));
    vec2 cell = size / cells;
    vec2 local = mod(vFacade.xy, cell);
    vec2 edge = min(local, cell - local);
    vec2 bar = smoothstep(vec2(0.007) + pixel * 0.5, vec2(0.007) - pixel * 0.5, edge);
    color = mix(color * vec3(0.8, 0.88, 1.05), vec3(0.6), max(bar.x, bar.y) * 0.75);
  }
}
`;

const windowMaterials = new Map<THREE.Material, THREE.Material>();

// Kopie materiálu, která na plochy s atributem facade dokreslí okna
function windowMaterial(material: THREE.Material): THREE.Material {
  let result = windowMaterials.get(material);
  if (!result) {
    result = material.clone();
    result.onBeforeCompile = (shader) => {
      shader.vertexShader =
        SHADER_VERTEX +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvFacade = facade;\nvFacadeSurface = facadeSurface;',
        );
      shader.fragmentShader =
        SHADER_FRAGMENT +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nif (vFacadeSurface > 0.5) applyFacade(diffuseColor.rgb);',
        );
    };
    result.customProgramCacheKey = () => 'facade-windows';
    windowMaterials.set(material, result);
  }
  return result;
}

const key = (v: THREE.Vector3): string =>
  `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;

// Doplní dílům modelu atributy pro okna: svislé plochy podle druhu z palety (surface podle UV) se rozdělí
// na souvislé rovinné plochy a každý vrchol dostane polohu na své ploše a její rozměry
export function addWindows(parts: Part[], surface: (u: number, v: number) => Surface): Part[] {
  return parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const triangles = position.count / 3;
    const facade = new Float32Array(position.count * 4);
    const kinds = new Float32Array(position.count);

    // Body v normalizované budově, vodorovná souřadnice podél plochy a výška
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i++)
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(part.matrix));
    const along = new Float32Array(position.count);

    // Trojúhelníky stejného směru a druhu spojené společným vrcholem tvoří jednu rovinnou plochu (union-find)
    const parent = Array.from({ length: triangles }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const byVertex = new Map<string, number>();
    const kindOf = new Int8Array(triangles);
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    for (let t = 0; t < triangles; t++) {
      const [a, b, c] = [points[t * 3], points[t * 3 + 1], points[t * 3 + 2]];
      // Normála z polohy vrcholů, normály vrcholů jsou na zaoblených hranách modelu skloněné
      const n = edge1.subVectors(b, a).cross(edge2.subVectors(c, a)).normalize();
      if (Math.abs(n.y) > 0.1) continue;
      let u = 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        u += uv.getX(t * 3 + k) / 3;
        v += uv.getY(t * 3 + k) / 3;
      }
      const kind = surface(u, v);
      if (kind === Surface.Plain) continue;
      kindOf[t] = kind;
      // Směr plochy po stupních, aby drobné nepřesnosti nerozdělily jednu stěnu
      const degrees = (Math.round((Math.atan2(n.x, n.z) * 180) / Math.PI) + 360) % 360;
      const angle = (degrees * Math.PI) / 180;
      const [nx, nz] = [Math.sin(angle), Math.cos(angle)];
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        // Vodorovná osa plochy vede zleva doprava při pohledu zvenku
        along[i] = points[i].x * nz - points[i].z * nx;
        const vertexKey = `${kind}|${degrees}|${key(points[i])}`;
        const other = byVertex.get(vertexKey);
        if (other === undefined) byVertex.set(vertexKey, t);
        else parent[find(t)] = find(other);
      }
    }

    const bounds = new Map<number, [number, number, number, number]>();
    for (let t = 0; t < triangles; t++) {
      if (!kindOf[t]) continue;
      const root = find(t);
      const b = bounds.get(root) ?? [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        b[0] = Math.min(b[0], along[i]);
        b[1] = Math.min(b[1], points[i].y);
        b[2] = Math.max(b[2], along[i]);
        b[3] = Math.max(b[3], points[i].y);
      }
      bounds.set(root, b);
    }
    for (let t = 0; t < triangles; t++) {
      if (!kindOf[t]) continue;
      const [u0, y0, u1, y1] = bounds.get(find(t))!;
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        facade.set([along[i] - u0, points[i].y - y0, u1 - u0, y1 - y0], i * 4);
        kinds[i] = kindOf[t];
      }
    }

    geometry.setAttribute('facade', new THREE.BufferAttribute(facade, 4));
    geometry.setAttribute('facadeSurface', new THREE.BufferAttribute(kinds, 1));
    const material = Array.isArray(part.material) ? part.material.map(windowMaterial) : windowMaterial(part.material);
    return { ...part, geometry, material };
  });
}
