import { h } from './dom';
import type { VehicleViewport } from './vehicleViewport';
import type { WindowManager } from './windows';

export interface VehicleButton {
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

export interface VehicleStatus {
  text: string;
  // Zelená tečka = jede, červená = stojí (v depu, ztracené, čeká)
  moving: boolean;
  // Kliknutí na stavový řádek: např. vyjetí z depa; jinak se mapa přesune na vozidlo
  action?: { title: string; run: () => void };
}

export interface VehicleWindowSpec {
  id: string;
  title: string;
  viewport: VehicleViewport;
  status: () => VehicleStatus;
  buttons: () => VehicleButton[];
  locate: () => void;
  subscribe: (refresh: () => void) => (() => void)[];
  exists: () => boolean;
}

// Okno vozidla podle OpenTTD: živý pohled, sloupec tlačítek vpravo a stavový řádek pod pohledem
export function openVehicleWindow(windows: WindowManager, spec: VehicleWindowSpec): void {
  if (windows.raise(spec.id)) {
    spec.viewport.dispose();
    return;
  }
  const render = (): HTMLElement => {
    const status = spec.status();
    const column = h(
      'div',
      { className: 'vehicle-window__buttons' },
      ...spec.buttons().map((b) => {
        const el = h('button', { className: 'vehicle-window__button', title: b.title, disabled: !!b.disabled }, b.icon);
        el.classList.toggle('vehicle-window__button--active', !!b.active);
        el.addEventListener('click', () => {
          b.onClick();
          refresh();
        });
        return el;
      }),
    );
    const bar = h(
      'button',
      {
        className: 'vehicle-window__status',
        title: status.action?.title ?? 'Zobrazit vozidlo na mapě',
      },
      h('span', {
        className: status.moving ? 'vehicle-window__dot' : 'vehicle-window__dot vehicle-window__dot--stopped',
      }),
      h('span', { className: 'vehicle-window__status-text' }, status.text),
    );
    bar.addEventListener('click', () => (status.action ? status.action.run() : spec.locate()));
    return h(
      'div',
      { className: 'vehicle-window' },
      h('div', { className: 'vehicle-window__top' }, spec.viewport.element, column),
      bar,
    );
  };
  const refresh = liveWindow(windows, spec.id, spec.title, render, spec, {
    width: 380,
    locate: spec.locate,
    onClose: () => spec.viewport.dispose(),
  });
}

// Okno s obsahem obnovovaným při událostech; samo se zavře, když jeho předmět zmizí. Vrací obnovení obsahu.
export function liveWindow(
  windows: WindowManager,
  id: string,
  title: string,
  render: () => HTMLElement,
  source: Pick<VehicleWindowSpec, 'subscribe' | 'exists'>,
  options: { width?: number; locate?: () => void; onClose?: () => void } = {},
): () => void {
  const refresh = (): void => {
    if (!windows.isOpen(id)) return;
    if (!source.exists()) windows.close(id);
    else windows.update(id, render());
  };
  if (windows.raise(id)) return refresh;
  const unsubscribe = source.subscribe(refresh);
  windows.open(id, title, render(), {
    width: options.width ?? 360,
    locate: options.locate,
    onClose: () => {
      unsubscribe.forEach((off) => off());
      options.onClose?.();
    },
  });
  return refresh;
}
