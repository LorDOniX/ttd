import * as THREE from 'three';
import { assetModels } from 'virtual:asset-model-catalog';
import { loadModel, type Kit } from '../assets';
import { h } from '../ui/dom';

const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 160;

export interface GalleryModel {
  kit: string;
  name: string;
  category?: string;
  preview?: () => Promise<THREE.Object3D>;
}

function renderAsset(
  entry: GalleryModel,
  card: HTMLElement,
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
): Promise<void> {
  canvas.dataset.state = 'loading';
  card.dataset.state = 'loading';
  status.textContent = 'Načítám';
  const task = async (): Promise<void> => {
    try {
      if (!canvas.isConnected) return;
      const model = entry.preview ? await entry.preview() : await loadModel(entry.kit as Kit, entry.name);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) throw new Error('Model neobsahuje geometrii.');
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 1.8 / Math.max(size.x, size.y, size.z, 0.001);
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      model.updateMatrixWorld(true);

      scene.add(model);
      renderer.render(scene, camera);
      if (canvas.width !== PREVIEW_WIDTH || canvas.height !== PREVIEW_HEIGHT) {
        canvas.width = PREVIEW_WIDTH;
        canvas.height = PREVIEW_HEIGHT;
      }
      canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      scene.remove(model);
      canvas.dataset.state = 'ready';
      card.dataset.state = 'ready';
      status.hidden = true;
    } catch (error) {
      canvas.dataset.state = 'error';
      card.dataset.state = 'error';
      status.textContent = error instanceof Error ? error.message : 'Model se nepodařilo načíst.';
    }
  };
  return task();
}

export function runModelGallery(
  container: HTMLElement,
  models: readonly GalleryModel[],
  title: string,
  allGroupsLabel: string,
  groupNoun: string,
): void {
  document.title = title;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
  renderer.setClearColor(0xdeddd7, 1);
  renderer.domElement.className = 'model-gallery__renderer';

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x77776f, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-2.1, 2.1, 1.4, -1.4, 0.1, 100);
  camera.position.set(3.5, 2.8, 4.5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const groups = [...new Set(models.map((entry) => entry.category ?? entry.kit))];
  const search = h('input', { type: 'search', placeholder: 'Hledat model nebo sadu' });
  search.setAttribute('aria-label', 'Hledat model nebo sadu');
  const kitFilter = h(
    'select',
    {},
    h('option', { value: '' }, allGroupsLabel),
    ...groups.map((group) => h('option', { value: group }, group)),
  );
  kitFilter.setAttribute('aria-label', 'Filtrovat skupinu');
  const count = h('span', { className: 'model-gallery__count' });
  const grid = h('div', { className: 'model-gallery__grid' });
  const modelsByCard = new WeakMap<HTMLElement, GalleryModel>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = entry.target as HTMLElement;
        if (card.dataset.state) continue;
        const canvas = card.querySelector('canvas')!;
        const status = card.querySelector<HTMLElement>('.model-gallery__status')!;
        const model = modelsByCard.get(card);
        if (!model) continue;
        card.dataset.state = 'queued';
        renderQueue = renderQueue.then(() => renderAsset(model, card, canvas, status, renderer, scene, camera));
        observer.unobserve(card);
      }
    },
    { rootMargin: '500px 0px' },
  );
  let renderQueue = Promise.resolve();

  const renderGrid = (): void => {
    observer.disconnect();
    const query = search.value.trim().toLocaleLowerCase('cs');
    const selectedGroup = kitFilter.value;
    const entries = models.filter(
      (entry) =>
        (!selectedGroup || (entry.category ?? entry.kit) === selectedGroup) &&
        (!query || `${entry.name} ${entry.kit} ${entry.category ?? ''}`.toLocaleLowerCase('cs').includes(query)),
    );
    count.textContent = `${entries.length} modelů · ${selectedGroup || `${groups.length} ${groupNoun}`}`;
    grid.replaceChildren();
    for (const entry of entries) {
      const canvas = h('canvas', { width: 1, height: 1, className: 'model-gallery__preview' });
      const status = h('span', { className: 'model-gallery__status' }, 'Čeká na zobrazení');
      const card = h(
        'article',
        { className: 'model-gallery__card' },
        h('div', { className: 'model-gallery__viewport' }, canvas, status),
        h(
          'div',
          { className: 'model-gallery__identity' },
          h('strong', {}, entry.name),
          h('span', {}, entry.category ? `${entry.category} · ${entry.kit}` : entry.kit),
        ),
      );
      modelsByCard.set(card, entry);
      grid.append(card);
      observer.observe(card);
    }
    if (entries.length === 0) grid.append(h('div', { className: 'model-gallery__empty' }, 'Nic nenalezeno.'));
  };
  search.addEventListener('input', renderGrid);
  kitFilter.addEventListener('change', renderGrid);

  const header = h(
    'header',
    { className: 'model-gallery__header' },
    h('a', { className: 'model-gallery__back', href: '/' }, '← Zpět do hry'),
    h('h1', {}, title),
    count,
    h('div', { className: 'model-gallery__filters' }, search, kitFilter),
  );
  const page = h('div', { className: 'model-gallery' }, header, grid, renderer.domElement);
  container.replaceChildren(page);
  renderGrid();
}

export function runAllModels(container: HTMLElement): void {
  runModelGallery(container, assetModels, 'Modely assetů', 'Všechny sady', 'sad');
}
