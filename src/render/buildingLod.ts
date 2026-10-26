import * as THREE from 'three';

interface LodSource {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

// Buněk výškové mapy na delší stranu půdorysu; buňka je při oddálení menší než dva pixely
const CELLS = 10;
// Plochy s menší svislou složkou normály jsou stěny (stejný práh jako u sněhu)
const STEEP = 0.3;
// Nižší sloupce (podesty na zemi) se nekreslí
const MIN_HEIGHT = 0.004;
// Směry stěn: +x, −x, +z, −z
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface Swatch {
  u: number;
  v: number;
  area: number;
}

const uvKey = (u: number, v: number): number => Math.round(u * 4096) * 8192 + Math.round(v * 4096);

// Zjednodušený model pro oddálený pohled: výšková mapa půdorysu z kvádrových sloupců. Střechy berou barvu
// z nejvyšší plochy nad buňkou, stěny z největší svislé plochy daného směru u kraje sloupce. Barvy zůstávají
// jako UV do palety modelu, takže přebarvení fasád a materiály fungují beze změny.
export function createLodGeometry(parts: readonly LodSource[]): THREE.BufferGeometry | null {
  const points: THREE.Vector3[] = [];
  const uvs: [number, number][] = [];
  for (const { geometry, matrix } of parts) {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    if (!position || !uv) continue;
    const count = geometry.index ? geometry.index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      let u = 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const vertex = geometry.index ? geometry.index.getX(i + k) : i + k;
        points.push(new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(matrix));
        u += uv.getX(vertex) / 3;
        v += uv.getY(vertex) / 3;
      }
      uvs.push([u, v]);
    }
  }
  if (points.length === 0) return null;

  const box = new THREE.Box3().setFromPoints(points);
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const nx = Math.max(1, Math.round(((box.max.x - box.min.x) / span) * CELLS));
  const nz = Math.max(1, Math.round(((box.max.z - box.min.z) / span) * CELLS));
  const cellX = (box.max.x - box.min.x) / nx;
  const cellZ = (box.max.z - box.min.z) / nz;
  const x0 = box.min.x;
  const z0 = box.min.z;
  const at = (i: number, j: number): number => j * nx + i;
  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < nz;

  const height = new Float32Array(nx * nz);
  const top = new Int32Array(nx * nz).fill(-1);
  const sides = Array.from({ length: nx * nz * 4 }, () => new Map<number, Swatch>());
  const normal = new THREE.Vector3();
  const edge = new THREE.Vector3();

  for (let t = 0; t < uvs.length; t++) {
    const [a, b, c] = [points[t * 3], points[t * 3 + 1], points[t * 3 + 2]];
    normal.subVectors(b, a).cross(edge.subVectors(c, a));
    const area = normal.length() / 2;
    if (area === 0) continue;
    normal.normalize();

    if (Math.abs(normal.y) < STEEP) {
      // Stěna patří sloupci kousek za ní, uvnitř budovy
      const horizontal = Math.hypot(normal.x, normal.z);
      const cx = (a.x + b.x + c.x) / 3 - (normal.x / horizontal) * cellX * 0.5;
      const cz = (a.z + b.z + c.z) / 3 - (normal.z / horizontal) * cellZ * 0.5;
      const i = THREE.MathUtils.clamp(Math.floor((cx - x0) / cellX), 0, nx - 1);
      const j = THREE.MathUtils.clamp(Math.floor((cz - z0) / cellZ), 0, nz - 1);
      const direction = Math.abs(normal.x) > Math.abs(normal.z) ? (normal.x > 0 ? 0 : 1) : normal.z > 0 ? 2 : 3;
      const [u, v] = uvs[t];
      const swatches = sides[at(i, j) * 4 + direction];
      const key = uvKey(u, v);
      const swatch = swatches.get(key);
      if (swatch) swatch.area += area;
      else swatches.set(key, { u, v, area });
      continue;
    }
    if (normal.y < 0) continue;

    // Nejvyšší plocha nad středem buňky určí výšku a barvu střechy
    const minI = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) / cellX - 0.5));
    const maxI = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / cellX - 0.5));
    const minJ = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - z0) / cellZ - 0.5));
    const maxJ = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / cellZ - 0.5));
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const px = x0 + (i + 0.5) * cellX;
        const pz = z0 + (j + 0.5) * cellZ;
        const wa = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
        const wb = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
        const wc = 1 - wa - wb;
        if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
        const y = wa * a.y + wb * b.y + wc * c.y;
        const cell = at(i, j);
        if (top[cell] < 0 || y > height[cell]) {
          height[cell] = y;
          top[cell] = t;
        }
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const quadUvs: number[] = [];
  const indices: number[] = [];
  // Obdélník ze čtyř rohů po obvodu; pořadí trojúhelníků se otočí podle normály, aby mířil ven
  const quad = (corners: number[][], n: readonly number[], [u, v]: readonly [number, number]): void => {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...n);
      quadUvs.push(u, v);
    }
    const [p, q, r] = corners.map((corner) => new THREE.Vector3(...corner));
    const facing = q
      .sub(p)
      .cross(r.sub(p))
      .dot(new THREE.Vector3(...n));
    if (facing >= 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const topUv = (cell: number): [number, number] => uvs[top[cell]];
  const solid = (cell: number): boolean => top[cell] >= 0 && height[cell] > MIN_HEIGHT;
  const roofKey = (cell: number): string => `${height[cell].toFixed(4)}|${uvKey(...topUv(cell))}`;

  // Střechy: sousední buňky se stejnou výškou a barvou se slijí do obdélníků
  const merged = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cell = at(i, j);
      if (merged[cell] || !solid(cell)) continue;
      const key = roofKey(cell);
      const fits = (ii: number, jj: number): boolean =>
        inside(ii, jj) && !merged[at(ii, jj)] && solid(at(ii, jj)) && roofKey(at(ii, jj)) === key;
      let width = 1;
      while (fits(i + width, j)) width++;
      let depth = 1;
      while (Array.from({ length: width }, (_, k) => fits(i + k, j + depth)).every(Boolean)) depth++;
      for (let jj = j; jj < j + depth; jj++) for (let ii = i; ii < i + width; ii++) merged[at(ii, jj)] = 1;
      const y = height[cell];
      const [xa, xb] = [x0 + i * cellX, x0 + (i + width) * cellX];
      const [za, zb] = [z0 + j * cellZ, z0 + (j + depth) * cellZ];
      quad(
        [
          [xa, y, za],
          [xa, y, zb],
          [xb, y, zb],
          [xb, y, za],
        ],
        [0, 1, 0],
        topUv(cell),
      );
    }
  }

  // Barva stěny: největší svislá plocha daného směru ve sloupci nebo dvou za ním (pod přesahem střechy),
  // jinak barva střechy (schody šikmé střechy). Sloupce mají každý svou barvu, okna a příčky tak zůstanou
  // naznačené pruhy.
  const wallUv = (i: number, j: number, direction: number): [number, number] => {
    const [dx, dz] = DIRECTIONS[direction];
    let best: Swatch | null = null;
    for (let step = 0; step < 3; step++) {
      const [ii, jj] = [i - dx * step, j - dz * step];
      if (!inside(ii, jj)) break;
      for (const swatch of sides[at(ii, jj) * 4 + direction].values())
        if (!best || swatch.area > best.area) best = swatch;
    }
    return best ? [best.u, best.v] : topUv(at(i, j));
  };

  // Stěny tam, kde je soused nižší; navazující se stejnou výškou a barvou se slijí
  DIRECTIONS.forEach(([dx, dz], direction) => {
    const alongX = dx === 0;
    const lines = alongX ? nz : nx;
    const length = alongX ? nx : nz;
    for (let line = 0; line < lines; line++) {
      let run: { start: number; end: number; bottom: number; top: number; uv: [number, number] } | null = null;
      const flush = (): void => {
        if (!run) return;
        const { start, end, bottom, top: y, uv } = run;
        if (alongX) {
          const z = z0 + (line + (dz > 0 ? 1 : 0)) * cellZ;
          const [xa, xb] = [x0 + start * cellX, x0 + end * cellX];
          quad(
            [
              [xa, bottom, z],
              [xb, bottom, z],
              [xb, y, z],
              [xa, y, z],
            ],
            [0, 0, dz],
            uv,
          );
        } else {
          const x = x0 + (line + (dx > 0 ? 1 : 0)) * cellX;
          const [za, zb] = [z0 + start * cellZ, z0 + end * cellZ];
          quad(
            [
              [x, bottom, za],
              [x, bottom, zb],
              [x, y, zb],
              [x, y, za],
            ],
            [dx, 0, 0],
            uv,
          );
        }
        run = null;
      };
      for (let k = 0; k < length; k++) {
        const [i, j] = alongX ? [k, line] : [line, k];
        const cell = at(i, j);
        const neighbour = inside(i + dx, j + dz) && solid(at(i + dx, j + dz)) ? height[at(i + dx, j + dz)] : 0;
        if (!solid(cell) || height[cell] - neighbour <= MIN_HEIGHT) {
          flush();
          continue;
        }
        const uv = wallUv(i, j, direction);
        if (
          run &&
          run.end === k &&
          run.bottom === neighbour &&
          run.top === height[cell] &&
          uvKey(...run.uv) === uvKey(...uv)
        ) {
          run.end = k + 1;
        } else {
          flush();
          run = { start: k, end: k + 1, bottom: neighbour, top: height[cell], uv };
        }
      }
      flush();
    }
  });

  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(quadUvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
