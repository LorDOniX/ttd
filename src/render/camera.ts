import * as THREE from 'three';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
// Dimetrie 2:1 jako v OpenTTD: kamera z rohu mapy pod elevací 30°
const ISO_DIRECTION = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera();
  readonly target = new THREE.Vector3();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  private panAnchor: THREE.Vector3 | null = null;

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
    this.camera.position.copy(this.target).addScaledVector(ISO_DIRECTION, 100);
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
