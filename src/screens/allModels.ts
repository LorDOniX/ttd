import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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

// Nejmenší „hezká“ délka 1, 2 nebo 5 × 10^k, která není menší než value
function niceUp(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1e-6)));
  return [1, 2, 5, 10].map((step) => step * power).find((step) => step >= value - 1e-9)!;
}

function formatLength(value: number): string {
  return String(Number(value.toPrecision(3)));
}

// Objekt postavený dnem na zem se středem půdorysu v počátku
function grounded(object: THREE.Object3D): THREE.Group {
  // Model mohl zůstat v obalu z minulého zobrazení, jeho posun by zkreslil míru
  object.removeFromParent();
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Group();
  offset.position.set(-center.x, -box.min.y, -center.z);
  offset.add(object);
  return new THREE.Group().add(offset);
}

// Díly modelu (meshe) ve světové poloze, každý zvlášť postavený na zem
function modelParts(model: THREE.Object3D): THREE.Group[] {
  model.updateMatrixWorld(true);
  const parts: THREE.Group[] = [];
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const part = child.clone(false);
    child.matrixWorld.decompose(part.position, part.quaternion, part.scale);
    parts.push(grounded(part));
  });
  return parts;
}

type ViewerMode = 'assembled' | 'exploded';

// Popup s velkým otáčelitelným náhledem modelu na čtvercové mřížce, sestaveným nebo rozloženým na díly
function createModelViewer(): { dialog: HTMLDialogElement; open: (entry: GalleryModel) => void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xdeddd7, 1);
  renderer.domElement.className = 'model-viewer__canvas';
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x77776f, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  const content = new THREE.Group();
  scene.add(content);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  const render = (): void => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  const title = h('strong', {});
  const subtitle = h('span', {});
  const info = h('span', { className: 'model-viewer__info' });
  const modeButtons: Record<ViewerMode, HTMLButtonElement> = {
    assembled: h('button', { type: 'button' }, 'Sestavený'),
    exploded: h('button', { type: 'button' }, 'Rozložený na díly'),
  };
  const close = h('button', { type: 'button', className: 'model-viewer__close' }, '×');
  close.setAttribute('aria-label', 'Zavřít');
  const stage = h('div', { className: 'model-viewer__stage' }, renderer.domElement);
  const dialog = h(
    'dialog',
    { className: 'model-viewer' },
    h(
      'header',
      { className: 'model-viewer__header' },
      h('div', { className: 'model-viewer__title' }, title, subtitle),
      h('div', { className: 'model-viewer__modes' }, modeButtons.assembled, modeButtons.exploded),
      close,
    ),
    stage,
    info,
  );

  let model: THREE.Object3D | null = null;
  let mode: ViewerMode = 'assembled';
  let request = 0;

  const resize = (): void => {
    const { clientWidth: width, clientHeight: height } = stage;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  new ResizeObserver(resize).observe(stage);

  const show = (): void => {
    for (const [key, button] of Object.entries(modeButtons)) button.classList.toggle('is-active', key === mode);
    content.clear();
    if (!model) return;
    model.removeFromParent();
    model.updateMatrixWorld(true);
    const assembledBox = new THREE.Box3().setFromObject(model);
    const size = assembledBox.getSize(new THREE.Vector3());
    let grid: THREE.GridHelper;
    let cell: number;
    let partCount: number;
    if (mode === 'assembled') {
      const span = Math.max(size.x, size.z, 1e-3);
      cell = niceUp(span / 5);
      const divisions = 2 * Math.ceil((span * 0.75) / cell);
      grid = new THREE.GridHelper(divisions * cell, divisions, 0x77776f, 0xb5b4ac);
      content.add(grounded(model));
      partCount = modelParts(model).length;
    } else {
      const parts = modelParts(model);
      partCount = parts.length;
      const footprint = Math.max(
        1e-3,
        ...parts.map((part) => {
          const partSize = new THREE.Box3().setFromObject(part).getSize(new THREE.Vector3());
          return Math.max(partSize.x, partSize.z);
        }),
      );
      // Každý díl ve vlastním poli čtvercové mřížky, sloupců i řádků nejvýš √n
      cell = niceUp(footprint * 1.2);
      const columns = Math.max(1, Math.ceil(Math.sqrt(parts.length)));
      parts.forEach((part, i) => {
        part.position.set(
          ((i % columns) - (columns - 1) / 2) * cell,
          0,
          (Math.floor(i / columns) - (columns - 1) / 2) * cell,
        );
        content.add(part);
      });
      grid = new THREE.GridHelper(columns * cell, columns, 0x77776f, 0x77776f);
    }
    content.add(grid);
    info.textContent = [
      `${partCount} ${partCount === 1 ? 'díl' : partCount < 5 ? 'díly' : 'dílů'}`,
      `rozměry ${formatLength(size.x)} × ${formatLength(size.y)} × ${formatLength(size.z)}`,
      `1 pole mřížky = ${formatLength(cell)}`,
      'tažením otáčí, kolečkem přibližuje, pravým tlačítkem posouvá',
    ].join(' · ');

    const sphere = new THREE.Box3().setFromObject(content).getBoundingSphere(new THREE.Sphere());
    const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(1, 0.8, 1.3).normalize(), distance);
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.update();
    render();
  };

  for (const [key, button] of Object.entries(modeButtons)) {
    button.addEventListener('click', () => {
      mode = key as ViewerMode;
      show();
    });
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    request++;
    model = null;
    content.clear();
  });

  const open = (entry: GalleryModel): void => {
    const current = ++request;
    title.textContent = entry.name;
    subtitle.textContent = entry.category ? `${entry.category} · ${entry.kit}` : entry.kit;
    info.textContent = 'Načítám…';
    model = null;
    mode = 'assembled';
    content.clear();
    dialog.showModal();
    resize();
    void (entry.preview ? entry.preview() : loadModel(entry.kit as Kit, entry.name))
      .then((loaded) => {
        if (current !== request) return;
        model = loaded;
        show();
      })
      .catch((error: unknown) => {
        if (current !== request) return;
        info.textContent = error instanceof Error ? error.message : 'Model se nepodařilo načíst.';
      });
  };

  return { dialog, open };
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
  const viewer = createModelViewer();
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
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Zobrazit model ${entry.name}`);
      card.addEventListener('click', () => viewer.open(entry));
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        viewer.open(entry);
      });
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
  const page = h('div', { className: 'model-gallery' }, header, grid, renderer.domElement, viewer.dialog);
  container.replaceChildren(page);
  renderGrid();
}

export function runAllModels(container: HTMLElement): void {
  runModelGallery(container, assetModels, 'Modely assetů', 'Všechny sady', 'sad');
}
