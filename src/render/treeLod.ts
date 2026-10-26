import * as THREE from 'three';

// Vrstvy průřezu se berou kousek od spodku a vršku, kde má díl ještě skutečnou šířku
const EDGE_INSET = 0.04;
// Užší vršek než tento podíl největšího poloměru se sbíhá do špičky
const APEX_RATIO = 0.3;

// Vzdálenost průřezu dílu ve výšce y od svislé osy (nejširší místo); 0, když díl touto výškou neprochází
function crossSection(points: readonly THREE.Vector3[], y: number, cx: number, cz: number): number {
  let radius = 0;
  for (let t = 0; t + 2 < points.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = points[t + k];
      const b = points[t + ((k + 1) % 3)];
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      const s = (y - a.y) / (b.y - a.y);
      radius = Math.max(radius, Math.hypot(a.x + (b.x - a.x) * s - cx, a.z + (b.z - a.z) * s - cz));
    }
  }
  return radius;
}

// Zjednodušený díl stromu pro oddálený pohled: hranol se `sides` stěnami a `levels` vrstvami kolem svislé osy
// dílu, vrstvy mají poloměr podle průřezu modelu. Spodek zůstává otevřený, kamera se dívá shora.
export function createLatheGeometry(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  sides: number,
  levels: number,
): THREE.BufferGeometry | null {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute('position');
  const points = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix),
  );
  if (source !== geometry) source.dispose();
  if (points.length < 3) return null;

  const box = new THREE.Box3().setFromPoints(points);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const height = box.max.y - box.min.y;
  if (height <= 0) return null;
  const rings = Array.from({ length: levels }, (_, i) => {
    const y = box.min.y + (height * i) / (levels - 1);
    const at = THREE.MathUtils.clamp(y, box.min.y + height * EDGE_INSET, box.max.y - height * EDGE_INSET);
    return { y, radius: crossSection(points, at, cx, cz) };
  });
  const widest = Math.max(...rings.map((ring) => ring.radius));
  if (widest === 0) return null;
  const apex = rings[levels - 1].radius < widest * APEX_RATIO;

  const ring = (i: number, k: number): THREE.Vector3 => {
    const angle = (k / sides) * Math.PI * 2;
    const { y, radius } = rings[i];
    return new THREE.Vector3(cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius);
  };
  const tip = new THREE.Vector3(cx, box.max.y, cz);
  const vertices: THREE.Vector3[] = [];
  // Trojúhelníky po směru, ve kterém míří ven (proti směru hodinových ručiček zvenku)
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    vertices.push(a, c, b);
  };
  const lastRing = apex ? levels - 2 : levels - 1;
  for (let i = 0; i < lastRing; i++) {
    for (let k = 0; k < sides; k++) {
      const [a, b, c, d] = [ring(i, k), ring(i, k + 1), ring(i + 1, k + 1), ring(i + 1, k)];
      triangle(a, b, c);
      triangle(a, c, d);
    }
  }
  for (let k = 0; k < sides; k++) {
    if (apex) triangle(ring(lastRing, k), ring(lastRing, k + 1), tip);
    // Plochý vršek jako vějíř z prvního vrcholu
    else if (k > 0 && k < sides - 1) triangle(ring(lastRing, 0), ring(lastRing, k), ring(lastRing, k + 1));
  }

  const result = new THREE.BufferGeometry().setFromPoints(vertices);
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}
