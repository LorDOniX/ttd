import type { MiniViews, ViewTarget } from '../render/miniViews';
import { h } from './dom';

const MIN_HALF_HEIGHT = 1;
const MAX_HALF_HEIGHT = 8;
const DEFAULT_HALF_HEIGHT = 2.5;
const ZOOM_STEP = 1.25;

export interface VehicleViewport {
  element: HTMLElement;
  dispose: () => void;
}

interface ViewportHost {
  miniViews: MiniViews;
  focus: (x: number, z: number) => void;
}

// Nastaví hra při spuštění; okna vozidel pak okénko vytvoří samy, bez předávání přes odkazy mezi okny
let host: ViewportHost | null = null;

export function setViewportHost(next: ViewportHost | null): void {
  host = next;
}

// Živý pohled na vozidlo v jeho okně jako v OpenTTD: kamera ho sleduje ve stejném natočení jako hlavní mapa.
// Kliknutí přesune hlavní mapu na vozidlo, kolečko přibližuje. note = popisek přes obraz (např. „V depu“).
export function vehicleViewport(
  target: () => ViewTarget | null | undefined,
  note: () => string | null = () => null,
): VehicleViewport {
  const canvas = h('canvas', { className: 'vehicle-viewport__canvas' });
  const status = h('span', { className: 'vehicle-viewport__status' });
  const element = h(
    'div',
    { className: 'vehicle-viewport', title: 'Kliknutím zobrazit na mapě, kolečkem přiblížit nebo oddálit' },
    canvas,
    status,
  );
  if (!host) return { element, dispose: () => {} };
  const { miniViews, focus } = host;
  let halfHeight = DEFAULT_HALF_HEIGHT;
  let lastNote: string | null = null;
  element.addEventListener('click', () => {
    const t = target();
    if (t) focus(t.x, t.z);
  });
  element.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      halfHeight = Math.min(MAX_HALF_HEIGHT, Math.max(MIN_HALF_HEIGHT, halfHeight * factor));
    },
    { passive: false },
  );
  const remove = miniViews.add({
    canvas,
    halfHeight: () => halfHeight,
    target: () => {
      // Popisek se obnoví při každém dotazu na polohu, jen když se změnil
      const text = note();
      if (text !== lastNote) {
        lastNote = text;
        status.textContent = text ?? '';
        status.hidden = !text;
      }
      return target() ?? null;
    },
  });
  status.hidden = true;
  return { element, dispose: remove };
}
