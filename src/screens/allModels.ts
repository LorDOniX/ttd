import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
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
  // Zimní varianta se sněhem, jak ji kreslí hra; chybí u modelů, které v zimě vypadají stejně
  winter?: () => Promise<THREE.Object3D>;
}

function loadEntry(entry: GalleryModel, winter: boolean): Promise<THREE.Object3D> {
  if (winter && entry.winter) return entry.winter();
  return entry.preview ? entry.preview() : loadModel(entry.kit as Kit, entry.name);
}

function renderAsset(
  entry: GalleryModel,
  winter: boolean,
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
      const model = await loadEntry(entry, winter);
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
    if (!(child instanceof THREE.Mesh) || !child.visible) return;
    const part = child.clone(false);
    child.matrixWorld.decompose(part.position, part.quaternion, part.scale);
    parts.push(grounded(part));
  });
  return parts;
}

const PALETTE_CELL = 8;

// Barvy ve vrcholech (letiště, přístav a další sestavy z kódu) se převedou na paletu jako u Kenney kitů:
// malou texturu s políčkem pro každou barvu a UV každého vrcholu uprostřed jeho políčka. Model pak jde
// přetexturovat jako ostatní a textura stáhnout zvlášť.
function bakeVertexColors(root: THREE.Object3D, name: string): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.geometry.getAttribute('color') &&
      !(child.material as THREE.MeshStandardMaterial).map
    ) {
      meshes.push(child);
    }
  });
  if (meshes.length === 0) return;
  const colors = new Map<string, number>();
  const color = new THREE.Color();
  for (const mesh of meshes) {
    const attribute = mesh.geometry.getAttribute('color');
    for (let i = 0; i < attribute.count; i++) {
      const key = color.fromBufferAttribute(attribute as THREE.BufferAttribute, i).getHexString();
      if (!colors.has(key)) colors.set(key, colors.size);
    }
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(colors.size)));
  const rows = Math.ceil(colors.size / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * PALETTE_CELL;
  canvas.height = rows * PALETTE_CELL;
  const context = canvas.getContext('2d')!;
  for (const [hex, index] of colors) {
    context.fillStyle = `#${hex}`;
    context.fillRect(
      (index % columns) * PALETTE_CELL,
      Math.floor(index / columns) * PALETTE_CELL,
      PALETTE_CELL,
      PALETTE_CELL,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `${name}-paleta`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshStandardMaterial({ name: 'paleta', map: texture, roughness: 0.9, metalness: 0 });
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    const attribute = geometry.getAttribute('color') as THREE.BufferAttribute;
    const uv = new Float32Array(attribute.count * 2);
    for (let i = 0; i < attribute.count; i++) {
      const index = colors.get(color.fromBufferAttribute(attribute, i).getHexString())!;
      // glTF i textura bez převrácení mají v = 0 nahoře
      uv[i * 2] = ((index % columns) + 0.5) / columns;
      uv[i * 2 + 1] = (Math.floor(index / columns) + 0.5) / rows;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.deleteAttribute('color');
    mesh.geometry = geometry;
    mesh.material = material;
  }
}

// glTF zná jen PBR materiály: matné Lambertovy materiály hry se převedou se zachovanou barvou a texturou
function toStandardMaterials(root: THREE.Object3D): void {
  const converted = new Map<THREE.Material, THREE.Material>();
  const convert = (material: THREE.Material): THREE.Material => {
    if (!(material instanceof THREE.MeshLambertMaterial)) return material;
    let standard = converted.get(material);
    if (!standard) {
      standard = new THREE.MeshStandardMaterial({
        name: material.name,
        color: material.color,
        map: material.map,
        vertexColors: material.vertexColors,
        transparent: material.transparent,
        opacity: material.opacity,
        side: material.side,
        roughness: 0.9,
        metalness: 0,
      });
      converted.set(material, standard);
    }
    return standard;
  };
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material) ? child.material.map(convert) : convert(child.material);
    }
  });
}

// Kopie modelu k exportu v původních souřadnicích hry (náhled ho posouvá na zem), s texturou místo barev ve vrcholech
function exportCopy(model: THREE.Object3D, name: string): THREE.Object3D {
  const copy = model.clone(true);
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  copy.scale.setScalar(1);
  copy.name = name;
  toStandardMaterials(copy);
  bakeVertexColors(copy, name);
  return copy;
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;

// Všechny textury modelu (bez opakování) s názvem slotu, např. map = barevná textura
function modelTextures(root: THREE.Object3D): { texture: THREE.Texture; slot: string }[] {
  const found = new Map<THREE.Texture, string>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = (material as Partial<Record<(typeof TEXTURE_SLOTS)[number], THREE.Texture | null>>)[slot];
        if (texture?.image && !found.has(texture)) found.set(texture, slot);
      }
    }
  });
  return [...found].map(([texture, slot]) => ({ texture, slot }));
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-');
}

function saveBlob(blob: Blob, fileName: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Model jako samostatný GLB (geometrie, pojmenované díly i textury uvnitř souboru), např. k přemodelování
async function downloadGlb(copy: THREE.Object3D, name: string): Promise<void> {
  const data = await new GLTFExporter().parseAsync(copy, { binary: true });
  saveBlob(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }), `${safeName(name)}.glb`);
}

// Textury modelu jako PNG v původním rozlišení (u více textur s názvem slotu)
async function downloadTextures(copy: THREE.Object3D, name: string): Promise<number> {
  const textures = modelTextures(copy);
  for (const [i, { texture, slot }] of textures.entries()) {
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    // Textura z dat (např. sníh) nemá obrázek, pixely se zapíšou přímo
    const data = (image as { data?: ArrayLike<number> }).data;
    if (data) context.putImageData(new ImageData(Uint8ClampedArray.from(data), image.width, image.height), 0, 0);
    else context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) continue;
    const suffix =
      textures.length > 1 ? `-${slot}${i > 0 && textures[i - 1].slot === slot ? `-${i}` : ''}` : '-textura';
    saveBlob(blob, `${safeName(name)}${suffix}.png`);
  }
  return textures.length;
}

type ViewerMode = 'assembled' | 'exploded';

const GALLERY_PAGES: [string, string][] = [
  ['all-models', 'Modely assetů'],
  ['game-assets', 'Modely použité ve hře'],
];

// Popup s velkým otáčelitelným náhledem modelu na čtvercové mřížce, sestaveným nebo rozloženým na díly
function createModelViewer(): {
  dialog: HTMLDialogElement;
  open: (entry: GalleryModel, winter: boolean) => void;
} {
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
  // Období modelu; přepínač je jen u modelů se zimní variantou
  const seasonButtons = {
    summer: h('button', { type: 'button', title: 'Model jako v létě' }, 'Léto'),
    winter: h('button', { type: 'button', title: 'Zimní varianta se sněhem, jak ji kreslí hra' }, '❄ Zima'),
  };
  const seasonSwitch = h('div', { className: 'model-viewer__modes' }, seasonButtons.summer, seasonButtons.winter);
  const exportButton = h(
    'button',
    {
      type: 'button',
      title: 'Stáhnout model jako GLB i s texturou a pojmenovanými díly (1 jednotka = 1 dlaždice u sestav hry)',
    },
    '⬇ GLB',
  );
  const texturesButton = h(
    'button',
    {
      type: 'button',
      title: 'Stáhnout textury modelu jako PNG (u sestav hry paleta barev, stejná jako uvnitř exportovaného GLB)',
    },
    '⬇ Textury',
  );
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
      seasonSwitch,
      h(
        'div',
        { className: 'model-viewer__modes' },
        modeButtons.assembled,
        modeButtons.exploded,
        exportButton,
        texturesButton,
      ),
      close,
    ),
    stage,
    info,
  );

  let model: THREE.Object3D | null = null;
  let modelName = '';
  let mode: ViewerMode = 'assembled';
  let request = 0;
  let current: GalleryModel | null = null;
  let winter = false;

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
  exportButton.addEventListener('click', () => {
    if (!model) return;
    exportButton.disabled = true;
    downloadGlb(exportCopy(model, modelName), modelName)
      .catch((error: unknown) => {
        info.textContent = `Export se nepovedl: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => (exportButton.disabled = false));
  });
  texturesButton.addEventListener('click', () => {
    if (!model) return;
    texturesButton.disabled = true;
    downloadTextures(exportCopy(model, modelName), modelName)
      .then((count) => {
        if (count === 0) info.textContent = 'Model nemá žádnou texturu.';
      })
      .catch((error: unknown) => {
        info.textContent = `Export textur se nepovedl: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => (texturesButton.disabled = false));
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    request++;
    current = null;
    model = null;
    content.clear();
  });

  // Načte model aktuálního záznamu v aktuálním období; režim zobrazení zůstává
  const load = (): void => {
    if (!current) return;
    const entry = current;
    const id = ++request;
    const seasonal = winter && entry.winter !== undefined;
    seasonSwitch.hidden = !entry.winter;
    seasonButtons.summer.classList.toggle('is-active', !seasonal);
    seasonButtons.winter.classList.toggle('is-active', seasonal);
    modelName = seasonal ? `${entry.name}-zima` : entry.name;
    info.textContent = 'Načítám…';
    model = null;
    content.clear();
    render();
    void loadEntry(entry, seasonal)
      .then((loaded) => {
        if (id !== request) return;
        model = loaded;
        show();
      })
      .catch((error: unknown) => {
        if (id !== request) return;
        info.textContent = error instanceof Error ? error.message : 'Model se nepodařilo načíst.';
      });
  };
  for (const [key, button] of Object.entries(seasonButtons)) {
    button.addEventListener('click', () => {
      if (winter === (key === 'winter')) return;
      winter = key === 'winter';
      load();
    });
  }

  const open = (entry: GalleryModel, winterVariant: boolean): void => {
    current = entry;
    winter = winterVariant;
    title.textContent = entry.name;
    subtitle.textContent = entry.category ? `${entry.category} · ${entry.kit}` : entry.kit;
    mode = 'assembled';
    dialog.showModal();
    resize();
    load();
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
  // Náhledy v zimní variantě tam, kde ji model ve hře má
  const winterToggle = h('input', { type: 'checkbox' });
  const hasWinter = models.some((entry) => entry.winter);
  const winterLabel = h('label', { className: 'model-gallery__season' }, winterToggle, '❄ Zima se sněhem');
  winterLabel.title =
    'Zobrazit zimní variantu u modelů, které ji ve hře mají (budovy, průmysl, letiště, přístav, stromy)';
  winterLabel.hidden = !hasWinter;
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
        const winter = winterToggle.checked;
        renderQueue = renderQueue.then(() => renderAsset(model, winter, card, canvas, status, renderer, scene, camera));
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
          h(
            'span',
            {},
            `${entry.category ? `${entry.category} · ${entry.kit}` : entry.kit}${entry.winter ? ' · ❄' : ''}`,
          ),
        ),
      );
      modelsByCard.set(card, entry);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Zobrazit model ${entry.name}`);
      card.addEventListener('click', () => viewer.open(entry, winterToggle.checked));
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        viewer.open(entry, winterToggle.checked);
      });
      grid.append(card);
      observer.observe(card);
    }
    if (entries.length === 0) grid.append(h('div', { className: 'model-gallery__empty' }, 'Nic nenalezeno.'));
  };
  search.addEventListener('input', renderGrid);
  kitFilter.addEventListener('change', renderGrid);
  winterToggle.addEventListener('change', renderGrid);

  const header = h(
    'header',
    { className: 'model-gallery__header' },
    h('a', { className: 'model-gallery__back', href: import.meta.env.BASE_URL }, '← Zpět do hry'),
    h('h1', {}, title),
    // Přepínání mezi pomocnými stránkami
    h(
      'nav',
      { className: 'model-gallery__pages' },
      ...GALLERY_PAGES.map(([path, label]) =>
        h(
          'a',
          {
            href: `${import.meta.env.BASE_URL}${path}`,
            className: location.pathname.endsWith(`/${path}`) ? 'is-active' : '',
          },
          label,
        ),
      ),
    ),
    count,
    h('div', { className: 'model-gallery__filters' }, search, kitFilter, winterLabel),
  );
  const page = h('div', { className: 'model-gallery' }, header, grid, renderer.domElement, viewer.dialog);
  container.replaceChildren(page);
  renderGrid();
}

export function runAllModels(container: HTMLElement): void {
  runModelGallery(container, assetModels, 'Modely assetů', 'Všechny sady', 'sad');
}
