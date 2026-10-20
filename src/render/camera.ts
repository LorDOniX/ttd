import * as THREE from 'three';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
// Dimetrie 2:1 jako v OpenTTD: kamera z rohu mapy pod elevací 30°
const ISO_DIRECTION = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();
const ROTATION_STEP = Math.PI / 4;
const ROTATION_MS = 300;
const UP = new THREE.Vector3(0, 1, 0);

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera();
  readonly target = new THREE.Vector3();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  private panAnchor: THREE.Vector3 | null = null;
  // Natočení pohledu kolem svislé osy; cílové se mění po 45°, aktuální k němu plynule dobíhá
  private azimuth = 0;
  private targetAzimuth = 0;

  constructor(
    private readonly dom: HTMLElement,
    private readonly bounds: THREE.Box2,
    private readonly viewSize = 12,
  ) {
    const center = bounds.getCenter(new THREE.Vector2());
    this.target.set(center.x, 0, center.y);
    this.camera.near = -1000;
    this.camera.far = 1000;
    this.resize();
    this.bindEvents();
  }

  resize(): void {
    const aspect = this.dom.clientWidth / this.dom.clientHeight;
    this.camera.left = -this.viewSize * aspect;
    this.camera.right = this.viewSize * aspect;
    this.camera.top = this.viewSize;
    this.camera.bottom = -this.viewSize;
    this.camera.updateProjectionMatrix();
    this.updatePosition();
  }

  focus(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.updatePosition();
  }

  // Plynulé kroužení (úvodní obrazovka): pootočí pohled o daný úhel bez animace
  spin(radians: number): void {
    this.azimuth += radians;
    this.targetAzimuth = this.azimuth;
    this.updatePosition();
  }

  // Otočí pohled o 45° (direction 1 = po směru hodinových ručiček)
  rotate(direction: 1 | -1 = 1): void {
    this.targetAzimuth += direction * ROTATION_STEP;
    const from = this.azimuth;
    const to = this.targetAzimuth;
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / ROTATION_MS);
      // Při rychlém klikání novou animaci nepřeruší stará
      if (to !== this.targetAzimuth) return;
      this.azimuth = from + (to - from) * (1 - (1 - t) * (1 - t));
      this.updatePosition();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Průsečík paprsku z kurzoru se zemí (y = 0)
  groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }

  private updatePosition(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.min.x, this.bounds.max.x);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.min.y, this.bounds.max.y);
    const direction = ISO_DIRECTION.clone().applyAxisAngle(UP, this.azimuth);
    this.camera.position.copy(this.target).addScaledVector(direction, 100);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private bindEvents(): void {
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.groundPoint(e.clientX, e.clientY);
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        this.camera.updateProjectionMatrix();
        // Zoom ke kurzoru: bod pod kurzorem zůstává na místě
        const after = this.groundPoint(e.clientX, e.clientY);
        if (before && after) {
          this.target.add(before.sub(after));
          this.updatePosition();
        }
      },
      { passive: false },
    );

    this.dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return;
      this.panAnchor = this.groundPoint(e.clientX, e.clientY);
      this.dom.setPointerCapture(e.pointerId);
    });

    this.dom.addEventListener('pointermove', (e) => {
      if (!this.panAnchor) return;
      const current = this.groundPoint(e.clientX, e.clientY);
      if (!current) return;
      this.target.add(this.panAnchor.clone().sub(current));
      this.updatePosition();
    });

    this.dom.addEventListener('pointerup', (e) => {
      if (e.button !== 2) return;
      this.panAnchor = null;
      this.dom.releasePointerCapture(e.pointerId);
    });
  }
}
