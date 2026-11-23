import { SERVICE_INTERVAL_STEP } from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { formatMoney, type Game } from '../game/game';
import type { Maintained } from '../game/reliability';
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

// Řádky údržby do podrobností vozidla: spolehlivost, poslední servis a interval servisu (− / +)
export function maintenanceRows(
  game: Game,
  vehicle: Maintained,
  maxReliability: number,
  setInterval: (days: number) => void,
  offHint: string,
): HTMLTableRowElement[] {
  const row = (label: string, value: string | HTMLElement, className = ''): HTMLTableRowElement =>
    h('tr', {}, h('td', {}, label), h('td', { className }, value));
  const step = (delta: number, label: string, title: string): HTMLButtonElement => {
    const b = h('button', { className: 'small-button', title }, label);
    b.addEventListener('click', (e) => setInterval(vehicle.serviceInterval + delta * (e.shiftKey ? 5 : 1)));
    return b;
  };
  const off = game.breakdowns === 'none';
  return [
    row(
      'Spolehlivost',
      `${Math.round(vehicle.reliability * 100)} % (max ${Math.round(maxReliability * 100)} %)`,
      vehicle.reliability < maxReliability - 0.25 ? 'num warning' : 'num',
    ),
    row(
      'Poslední servis',
      `před ${Math.max(0, Math.floor(game.clock.now - vehicle.lastService))} dny · poruch od něj ${vehicle.breakdowns}`,
      'num',
    ),
    h(
      'tr',
      {},
      h('td', {}, 'Servis'),
      h(
        'td',
        { className: 'num' },
        h(
          'span',
          { className: 'service-interval' },
          step(-SERVICE_INTERVAL_STEP, '−', 'Častěji (Shift po 50 dnech)'),
          ` každých ${vehicle.serviceInterval} dní `,
          step(SERVICE_INTERVAL_STEP, '+', 'Méně často (Shift po 50 dnech)'),
        ),
        off ? h('div', { className: 'form__hint' }, offHint) : '',
      ),
    ),
  ];
}

// Výběr nákladu pro přestavbu auta, lodi nebo letadla v depu; bez možnosti přestavby nic
export function refitControl(
  game: Game,
  options: readonly Cargo[],
  current: Cargo,
  cost: number,
  refit: (cargo: Cargo) => string | null,
): HTMLElement | string {
  if (options.length < 2) return '';
  const select = h('select', {
    title: `Přestavět na jiný náklad za ${formatMoney(cost)}; náklad na palubě propadne`,
  });
  for (const c of options) select.append(h('option', { value: c, selected: c === current }, CARGOS[c].name));
  select.addEventListener('change', () => {
    const error = refit(select.value as Cargo);
    if (error) game.news(error);
  });
  return h(
    'label',
    { className: 'depot-train__cargo' },
    'Náklad ',
    select,
    h('small', {}, ` přestavba ${formatMoney(cost)}`),
  );
}
