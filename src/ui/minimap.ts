import type { Game } from '../game/game';
import type { IsoCamera } from '../render/camera';
import { MapChanges, TileType } from '../world/map';
import { pointAt } from '../world/route';
import { h } from './dom';
import type { WindowManager } from './windows';

const DISPLAY_SIZE = 256;
const OVERLAY_MS = 200;

const COLORS: Record<TileType, [number, number, number]> = {
  [TileType.Grass]: [95, 158, 60],
  [TileType.Trees]: [55, 112, 38],
  [TileType.Water]: [58, 111, 176],
  [TileType.Road]: [90, 90, 96],
  [TileType.Crossing]: [90, 90, 96],
  [TileType.Building]: [170, 170, 165],
  [TileType.Rail]: [150, 80, 40],
  [TileType.Bridge]: [168, 68, 44],
  [TileType.Station]: [255, 216, 74],
  [TileType.Depot]: [255, 122, 48],
  [TileType.Industry]: [120, 70, 110],
  [TileType.RoadStop]: [255, 216, 74],
  [TileType.RoadDepot]: [255, 122, 48],
};

// Okno s minimapou: terén, stavby, vlaky a viditelný výřez; kliknutí přesune pohled
export function openMinimap(windows: WindowManager, game: Game, camera: IsoCamera, viewport: HTMLElement): void {
  const { map } = game.world;
  const terrain = h('canvas', { width: map.width, height: map.height, className: 'minimap__canvas' });
  const overlay = h('canvas', { width: DISPLAY_SIZE, height: DISPLAY_SIZE, className: 'minimap__canvas' });
  const scale = DISPLAY_SIZE / map.width;

  const drawTerrain = (): void => {
    const ctx = terrain.getContext('2d')!;
    const image = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.tiles.length; i++) {
      const [r, g, b] = COLORS[map.tiles[i] as TileType] ?? COLORS[TileType.Grass];
      image.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
  };

  // Jen změněné dlaždice od posledního kreslení
  const changes = new MapChanges(map);
  const syncTerrain = (): void => {
    const changed = changes.take();
    if (changed === null) return drawTerrain();
    const ctx = terrain.getContext('2d')!;
    for (const i of new Set(changed)) {
      const [r, g, b] = COLORS[map.tiles[i] as TileType] ?? COLORS[TileType.Grass];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(i % map.width, Math.floor(i / map.width), 1, 1);
    }
  };

  const drawOverlay = (): void => {
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    ctx.fillStyle = '#fff';
    for (const train of game.fleet.trains) {
      if (train.state === 'depot') continue;
      const [x, y] = pointAt(train.path, train.pos);
      ctx.fillRect(x * scale - 2, y * scale - 2, 4, 4);
    }
    // Výřez obrazovky jako průmět rohů okna na zem
    const rect = viewport.getBoundingClientRect();
    const corners = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
    ].map(([cx, cy]) => camera.groundPoint(cx, cy));
    if (corners.every((c) => c)) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c!.x * scale, c!.z * scale) : ctx.lineTo(c!.x * scale, c!.z * scale)));
      ctx.closePath();
      ctx.stroke();
    }
  };

  overlay.addEventListener('click', (e) => {
    const rect = overlay.getBoundingClientRect();
    camera.focus(
      ((e.clientX - rect.left) / rect.width) * map.width,
      ((e.clientY - rect.top) / rect.height) * map.height,
    );
    drawOverlay();
  });

  drawTerrain();
  drawOverlay();
  const timer = window.setInterval(() => {
    syncTerrain();
    drawOverlay();
  }, OVERLAY_MS);

  windows.open('minimap', 'Minimapa', h('div', { className: 'minimap' }, terrain, overlay), {
    width: DISPLAY_SIZE + 18,
    onClose: () => window.clearInterval(timer),
  });
}
