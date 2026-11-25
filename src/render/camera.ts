import * as THREE from 'three';
import type { ViewState } from '../game/game';

const MIN_ZOOM = 0.25;
// Nejbližší pohled ukáže zhruba dvě dlaždice na výšku, aby byly vidět detaily postav a budov
const MAX_ZOOM = 12;
// Dimetrie 2:1 jako v OpenTTD: kamera z rohu mapy pod elevací 30°
const ISO_DIRECTION = new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize();
const ROTATION_STEP = Math.PI / 2;
const ROTATION_MS = 300;
const ROTATION_DRAG_RADIANS_PER_PIXEL = Math.PI / 360;
const ROTATION_EPSILON = 1e-6;
const UP = new THREE.Vector3(0, 1, 0);
const sphere = new THREE.Sphere();

export function nextRotationTarget(angle: number, direction: 1 | -1): number {
  const step = angle / ROTATION_STEP;
  const nearest = Math.round(step);
  if (Math.abs(step - nearest) < ROTATION_EPSILON) return (nearest + direction) * ROTATION_STEP;
  return (direction > 0 ? Math.floor(step) + 1 : Math.ceil(step) - 1) * ROTATION_STEP;
}

// Záběr jedné kamery, nebo víc kamer naráz (hlavní pohled a okénka vozidel)
export type ViewFrustums = THREE.Frustum | readonly THREE.Frustum[];

// Je koule kolem bodu aspoň zčásti v záběru některé kamery
export function inView(frustum: ViewFrustums, x: number, y: number, z: number, radius: number): boolean {
  sphere.center.set(x, y, z);
  sphere.radius = radius;
  if (frustum instanceof THREE.Frustum) return frustum.intersectsSphere(sphere);
  return frustum.some((f) => f.intersectsSphere(sphere));
}

// Směr od cíle ke kameře v izometrickém pohledu natočeném o azimuth
export function isoDirection(azimuth: number): THREE.Vector3 {
  return ISO_DIRECTION.clone().applyAxisAngle(UP, azimuth);
}

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera();
  readonly target = new THREE.Vector3();
  // Hráč smí kameru ovládat myší (zoom, posun, otáčení); úvodní obrazovka to vypíná
  interactive = true;
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly viewFrustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private panAnchor: THREE.Vector3 | null = null;
  private rotatingPointer = false;
  private pointerX = 0;
  private rotationAnimation = 0;
  // Natočení pohledu kolem svislé osy; cílové se mění po 90°, aktuální k němu plynule dobíhá
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

  // Aktuální záběr kamery pro vynechání objektů mimo obrazovku
  frustum(): THREE.Frustum {
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    return this.viewFrustum.setFromProjectionMatrix(this.viewProjection);
  }

  // Aktuální natočení pohledu (okénka vozidel se natáčejí stejně)
  get azimuthAngle(): number {
    return this.azimuth;
  }

  focus(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.updatePosition();
  }

  get view(): ViewState {
    const rotation = Math.round(this.targetAzimuth / ROTATION_STEP);
    return { x: this.target.x, z: this.target.z, zoom: this.camera.zoom, rotation: ((rotation % 4) + 4) % 4 };
  }

  restore(view: ViewState): void {
    this.rotationAnimation++;
    this.camera.zoom = THREE.MathUtils.clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
    this.camera.updateProjectionMatrix();
    this.azimuth = this.targetAzimuth = view.rotation * ROTATION_STEP;
    this.focus(view.x, view.z);
  }

  // Posun pohledu o zlomky výšky obrazovky (kladné dx doprava, dy nahoru), nezávisle na otočení a zoomu
  pan(dx: number, dy: number): void {
    const span = (2 * this.viewSize) / this.camera.zoom;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).setY(0);
    // Svislý posun na obrazovce je na zemi delší o 1 / sin(elevace) = 1 / |up|
    up.divideScalar(up.lengthSq());
    this.target.addScaledVector(right, dx * span).addScaledVector(up, dy * span);
    this.updatePosition();
  }

  // Plynulé kroužení (úvodní obrazovka): pootočí pohled o daný úhel bez animace
  spin(radians: number): void {
    this.rotationAnimation++;
    this.azimuth += radians;
    this.targetAzimuth = this.azimuth;
    this.updatePosition();
  }

  // Otočí pohled o 90° (direction 1 = po směru hodinových ručiček)
  rotate(direction: 1 | -1 = 1): void {
    this.targetAzimuth = nextRotationTarget(this.targetAzimuth, direction);
    const from = this.azimuth;
    const to = this.targetAzimuth;
    const start = performance.now();
    const animation = ++this.rotationAnimation;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / ROTATION_MS);
      // Při rychlém klikání novou animaci nepřeruší stará
      if (animation !== this.rotationAnimation) return;
      this.azimuth = from + (to - from) * (1 - (1 - t) * (1 - t));
      this.updatePosition();
      if (t < 1) requestAnimationFrame(step);
      else this.azimuth = this.targetAzimuth;
    };
    requestAnimationFrame(step);
  }

  // Nejdelší vzdálenost na zemi od středu pohledu k rohu obrazovky; při otáčení kolem středu se nemění
  visibleRadius(): number {
    const rect = this.dom.getBoundingClientRect();
    let radius = 0;
    for (const x of [rect.left, rect.right]) {
      for (const y of [rect.top, rect.bottom]) {
        const p = this.groundPoint(x, y);
        if (p) radius = Math.max(radius, Math.hypot(p.x - this.target.x, p.z - this.target.z));
      }
    }
    return radius;
  }

  // Paprsek z kamery skrz bod obrazovky
  ray(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  // Průsečík paprsku z kurzoru se zemí (y = 0)
  groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    return this.ray(clientX, clientY).ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }

  // Průsečík paprsku z kurzoru s terénem: paprsek se projde od nejvyšší výšky mapy dolů po krocích
  // a místo průniku se zpřesní půlením; na rovině je to totéž jako groundPoint
  terrainPoint(
    clientX: number,
    clientY: number,
    heightAt: (x: number, z: number) => number,
    maxHeight: number,
  ): THREE.Vector3 | null {
    const { ray } = this.ray(clientX, clientY);
    if (maxHeight <= 0 || ray.direction.y >= 0) return this.groundPoint(clientX, clientY);
    const at = (t: number): THREE.Vector3 => ray.at(t, new THREE.Vector3());
    const tTop = (maxHeight + 0.01 - ray.origin.y) / ray.direction.y;
    const tBottom = (-0.1 - ray.origin.y) / ray.direction.y;
    const step = 0.04 / Math.max(0.2, Math.hypot(ray.direction.x, ray.direction.z));
    let previous = Math.max(0, tTop);
    for (let t = previous; t <= tBottom; t += step) {
      const p = at(t);
      if (p.y <= heightAt(p.x, p.z)) {
        let lo = previous;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          const q = at(mid);
          if (q.y <= heightAt(q.x, q.z)) hi = mid;
          else lo = mid;
        }
        return at(hi);
      }
      previous = t;
    }
    return this.groundPoint(clientX, clientY);
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
        if (!this.interactive) return;
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
      if (e.button !== 2 || !this.interactive) return;
      this.dom.setPointerCapture(e.pointerId);
      this.rotatingPointer = e.shiftKey;
      this.panAnchor = this.rotatingPointer ? null : this.groundPoint(e.clientX, e.clientY);
      this.pointerX = e.clientX;
      if (this.rotatingPointer) {
        this.targetAzimuth = this.azimuth;
        this.rotationAnimation++;
      }
    });

    this.dom.addEventListener('pointermove', (e) => {
      if (this.rotatingPointer) {
        this.azimuth += (e.clientX - this.pointerX) * ROTATION_DRAG_RADIANS_PER_PIXEL;
        this.targetAzimuth = this.azimuth;
        this.pointerX = e.clientX;
        this.rotationAnimation++;
        this.updatePosition();
        return;
      }
      if (!this.panAnchor) return;
      const current = this.groundPoint(e.clientX, e.clientY);
      if (!current) return;
      this.target.add(this.panAnchor.clone().sub(current));
      this.updatePosition();
    });

    this.dom.addEventListener('pointerup', (e) => {
      if (e.button !== 2) return;
      this.rotatingPointer = false;
      this.panAnchor = null;
      if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    });

    this.dom.addEventListener('pointercancel', () => {
      this.rotatingPointer = false;
      this.panAnchor = null;
    });
  }
}
