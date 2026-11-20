import * as THREE from 'three';
import { isoDirection } from './camera';

// Bod, na který se okénko dívá: x a z na mapě, y výška (letadla)
export interface ViewTarget {
  x: number;
  y: number;
  z: number;
}

export interface MiniViewSpec {
  canvas: HTMLCanvasElement;
  // Kam se dívat; null = okénko se nepřekresluje (vozidlo zmizelo)
  target: () => ViewTarget | null;
  // Polovina výšky záběru v dlaždicích (menší = blíž)
  halfHeight: () => number;
}

interface MiniView extends MiniViewSpec {
  camera: THREE.OrthographicCamera;
  frustum: THREE.Frustum;
  renderTarget: THREE.WebGLRenderTarget | null;
  pixels: Uint8Array;
  image: ImageData | null;
  lastRender: number;
  active: boolean;
}

// Okénka vozidel se překreslují méně často než hlavní pohled, stačí to na plynulý pohyb a šetří výkon
const MINI_VIEW_INTERVAL_MS = 80;
const projection = new THREE.Matrix4();

// Malé živé pohledy na scénu (jako okno vozidla v OpenTTD): stejná scéna, vlastní kamera nad vozidlem,
// vykreslí se do textury a zkopírují do plátna v okně. Objekty se skrývají mimo záběr hlavní kamery i okének.
export class MiniViews {
  private readonly views = new Set<MiniView>();

  add(spec: MiniViewSpec): () => void {
    const camera = new THREE.OrthographicCamera();
    camera.near = -1000;
    camera.far = 1000;
    const view: MiniView = {
      ...spec,
      camera,
      frustum: new THREE.Frustum(),
      renderTarget: null,
      pixels: new Uint8Array(0),
      image: null,
      lastRender: -Infinity,
      active: false,
    };
    this.views.add(view);
    return () => {
      view.renderTarget?.dispose();
      this.views.delete(view);
    };
  }

  // Nastaví kamery okének na jejich cíle a vrátí jejich záběry (pro skrývání objektů mimo obraz)
  prepare(azimuth: number): THREE.Frustum[] {
    const frustums: THREE.Frustum[] = [];
    const direction = isoDirection(azimuth);
    for (const view of this.views) {
      const target = view.canvas.isConnected ? view.target() : null;
      view.active = target !== null && view.canvas.clientWidth > 0;
      if (!view.active || !target) continue;
      const { camera } = view;
      const half = view.halfHeight();
      const aspect = view.canvas.clientWidth / Math.max(1, view.canvas.clientHeight);
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
      camera.position.set(target.x, target.y, target.z).addScaledVector(direction, 100);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustums.push(view.frustum.setFromProjectionMatrix(projection));
    }
    return frustums;
  }

  // Překreslí okénka, která jsou na řadě; volá se po vykreslení hlavního pohledu
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, now: number, azimuth: number): void {
    const direction = isoDirection(azimuth);
    for (const view of this.views) {
      if (!view.active || now - view.lastRender < MINI_VIEW_INTERVAL_MS) continue;
      // Vozidlo se od přípravy záběru posunulo, kamera ho dožene, ať je pořád uprostřed
      const target = view.target();
      if (!target) continue;
      view.camera.position.set(target.x, target.y, target.z).addScaledVector(direction, 100);
      view.camera.updateMatrixWorld();
      view.lastRender = now;
      this.draw(view, renderer, scene);
    }
  }

  private draw(view: MiniView, renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(view.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(view.canvas.clientHeight * ratio));
    if (!view.renderTarget || view.renderTarget.width !== width || view.renderTarget.height !== height) {
      view.renderTarget?.dispose();
      view.renderTarget = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
      view.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
      view.pixels = new Uint8Array(width * height * 4);
      view.canvas.width = width;
      view.canvas.height = height;
      view.image = new ImageData(width, height);
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(view.renderTarget);
    renderer.render(scene, view.camera);
    renderer.readRenderTargetPixels(view.renderTarget, 0, 0, width, height, view.pixels);
    renderer.setRenderTarget(previous);
    // WebGL čte řádky odspodu, plátno je chce odshora
    const rowBytes = width * 4;
    const data = view.image!.data;
    for (let y = 0; y < height; y++) {
      data.set(view.pixels.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    }
    view.canvas.getContext('2d')!.putImageData(view.image!, 0, 0);
  }
}
