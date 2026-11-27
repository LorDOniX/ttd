import * as THREE from 'three';

// Spojení na mapě toků: odkud kam (střed stanice), kapacita a převezený náklad za měsíc
export interface FlowLink {
  from: { x: number; y: number; ground: number };
  to: { x: number; y: number; ground: number };
  capacity: number;
  usage: number;
}

// Barvy vytížení jako v OpenTTD: zelená – žlutá – oranžová – červená; nevyužité spojení šedomodré
export const FLOW_COLORS = [
  { max: 0, color: 0x8fa3c0, label: 'Nevyužité' },
  { max: 0.3, color: 0x4fbd75, label: 'do 30 %' },
  { max: 0.6, color: 0xe4c94a, label: 'do 60 %' },
  { max: 0.9, color: 0xec8b38, label: 'do 90 %' },
  { max: Infinity, color: 0xdf493e, label: 'nad 90 %' },
] as const;

export function flowColor(ratio: number): number {
  if (ratio <= 0) return FLOW_COLORS[0].color;
  return FLOW_COLORS.find((c) => ratio <= c.max)!.color;
}

const SEGMENTS = 24;
// Obousměrná spojení leží vedle sebe: každý směr je posunutý doprava
const SIDE_OFFSET = 0.22;

// Šířka pásu podle kapacity: tenký pro jednotky, nejširší od zhruba 1000 za měsíc
export function flowWidth(capacity: number): number {
  return 0.1 + 0.22 * Math.min(1, Math.log10(1 + Math.max(0, capacity)) / 3);
}

// Bod oblouku v t (0–1): kvadratická křivka nad terénem, vrchol podle délky spojení
function arcPoint(link: FlowLink, t: number, side: [number, number]): THREE.Vector3 {
  const { from, to } = link;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(3, 0.4 + length * 0.12);
  const x = from.x + (to.x - from.x) * t + side[0];
  const z = from.y + (to.y - from.y) * t + side[1];
  const ground = from.ground + (to.ground - from.ground) * t;
  return new THREE.Vector3(x, ground + 0.3 + 4 * lift * t * (1 - t), z);
}

// Geometrie všech spojení: vodorovný pás po oblouku a šipka ve třech čtvrtinách délky
export function buildFlowGeometry(links: readonly FlowLink[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const push = (p: THREE.Vector3): void => {
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b);
  };
  for (const link of links) {
    const dx = link.to.x - link.from.x;
    const dz = link.to.y - link.from.y;
    const length = Math.hypot(dx, dz);
    if (length < 0.5) continue;
    // Doprava od směru jízdy (při pohledu shora)
    const nx = -dz / length;
    const nz = dx / length;
    const side: [number, number] = [nx * SIDE_OFFSET, nz * SIDE_OFFSET];
    const half = flowWidth(link.capacity) / 2;
    color.setHex(flowColor(link.capacity > 0 ? link.usage / link.capacity : 0));
    const points = Array.from({ length: SEGMENTS + 1 }, (_, i) => arcPoint(link, i / SEGMENTS, side));
    for (let i = 0; i < SEGMENTS; i++) {
      const a = points[i];
      const b = points[i + 1];
      const al = new THREE.Vector3(a.x - nx * half, a.y, a.z - nz * half);
      const ar = new THREE.Vector3(a.x + nx * half, a.y, a.z + nz * half);
      const bl = new THREE.Vector3(b.x - nx * half, b.y, b.z - nz * half);
      const br = new THREE.Vector3(b.x + nx * half, b.y, b.z + nz * half);
      push(al);
      push(ar);
      push(br);
      push(al);
      push(br);
      push(bl);
    }
    // Šipka: trojúhelník širší než pás, hrot ve směru jízdy
    const tip = arcPoint(link, 0.8, side);
    const base = arcPoint(link, 0.72, side);
    const wing = half * 2.6;
    push(new THREE.Vector3(base.x - nx * wing, base.y + 0.01, base.z - nz * wing));
    push(new THREE.Vector3(base.x + nx * wing, base.y + 0.01, base.z + nz * wing));
    push(new THREE.Vector3(tip.x, tip.y + 0.01, tip.z));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

// Mapa toků jako v OpenTTD: spojení mezi stanicemi barevně podle vytížení, nad vším ostatním
export class FlowOverlayView {
  readonly object = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private key = '';

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.object.add(this.mesh);
    this.object.visible = false;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  // Přestaví geometrii, jen když se spojení nebo jejich barvy změnily
  update(links: readonly FlowLink[]): void {
    const key = links
      .map((l) => `${l.from.x},${l.from.y}>${l.to.x},${l.to.y}:${Math.round(l.capacity)}:${Math.round(l.usage)}`)
      .join('|');
    if (key === this.key) return;
    this.key = key;
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildFlowGeometry(links);
  }
}
