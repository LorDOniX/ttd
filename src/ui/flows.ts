import { CARGOS, type Cargo } from '../game/cargo';
import type { Game } from '../game/game';
import { FLOW_COLORS, flowColor } from '../render/flowOverlay';
import { h } from './dom';
import type { WindowManager } from './windows';

export interface FlowOverlayControl {
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export interface FlowsActions {
  overlay: FlowOverlayControl;
  // Zobrazený druh nákladu na mapě
  getCargo: () => Cargo | 'all';
  setCargo: (cargo: Cargo | 'all') => void;
  focus: (x: number, z: number) => void;
}

const percent = (ratio: number): string => `${Math.round(ratio * 100)} %`;

function swatch(color: number): HTMLElement {
  const el = h('span', {});
  el.style.cssText =
    `display:inline-block;width:12px;height:12px;margin-right:4px;vertical-align:-2px;` +
    `background:#${color.toString(16).padStart(6, '0')}`;
  return el;
}

// Okno mapy toků jako v OpenTTD: zapnutí překryvu, výběr nákladu, legenda a nejvytíženější spojení
export function openFlows(windows: WindowManager, game: Game, actions: FlowsActions): void {
  const { cargodist } = game;
  const overlay = h('input', { type: 'checkbox', checked: actions.overlay.visible });
  overlay.addEventListener('change', () => actions.overlay.setVisible(overlay.checked));
  const select = h('select', {});
  const fillSelect = (): void => {
    const cargos = cargodist.linkedCargos();
    const current = actions.getCargo();
    select.replaceChildren(
      h('option', { value: 'all', selected: current === 'all' }, 'Všechen náklad'),
      ...cargos.map((c) => h('option', { value: c, selected: c === current }, CARGOS[c].name)),
    );
  };
  select.addEventListener('change', () => {
    actions.setCargo(select.value as Cargo | 'all');
    refresh();
  });
  const legend = h(
    'div',
    { className: 'form__row' },
    ...FLOW_COLORS.flatMap((c) => [h('span', {}, swatch(c.color), c.label), ' ']),
  );
  const list = h('div', {});

  const refresh = (): void => {
    const current = actions.getCargo();
    const cargos = current === 'all' ? cargodist.linkedCargos() : [current];
    const rows = cargos
      .flatMap((cargo) => cargodist.linkLoads(cargo).map((l) => ({ cargo, ...l })))
      .sort((a, b) => b.ratio - a.ratio || b.usage - a.usage)
      .slice(0, 15)
      .map(({ cargo, link, usage, capacity, ratio }) => {
        const show = h('button', { className: 'small-button', title: 'Zaměřit spojení' }, 'Ukázat');
        const stations = game.world.rail.stations;
        const a = stations.find((s) => s.id === link.from);
        const b = stations.find((s) => s.id === link.to);
        show.addEventListener('click', () => {
          if (a && b) actions.focus((a.x + b.x) / 2 + 0.5, (a.y + b.y) / 2 + 0.5);
        });
        const name = (id: number): string => cargodist.stationName(id);
        return h(
          'tr',
          {},
          h('td', {}, `${name(link.from)} → ${name(link.to)}`),
          ...(current === 'all' ? [h('td', {}, CARGOS[cargo].name)] : []),
          h('td', { className: 'num' }, `${Math.round(usage)} / ${Math.round(capacity)}`),
          h('td', { className: 'num' }, h('span', {}, swatch(flowColor(ratio)), percent(ratio))),
          h('td', {}, show),
        );
      });
    list.replaceChildren(
      rows.length > 0
        ? h(
            'table',
            { className: 'table' },
            h(
              'tr',
              {},
              h('th', {}, 'Spojení'),
              ...(current === 'all' ? [h('th', {}, 'Náklad')] : []),
              h('th', {}, 'Převezeno / kapacita'),
              h('th', {}, 'Vytížení'),
              h('th', {}, ''),
            ),
            ...rows,
          )
        : h('div', { className: 'form__hint' }, 'Žádná vozidla zatím nejezdí mezi stanicemi podle řádu.'),
    );
  };

  fillSelect();
  refresh();
  const timer = window.setInterval(refresh, 1000);
  windows.open(
    'flows',
    'Toky nákladu',
    h(
      'div',
      { className: 'form' },
      h('label', { className: 'form__row' }, overlay, ' Zobrazit toky na mapě'),
      h('label', { className: 'form__field' }, 'Náklad', select),
      legend,
      list,
      h(
        'div',
        { className: 'form__hint' },
        'Spojení mezi stanicemi podle jízdních řádů. Převezeno: náklad, se kterým vozidla po spojení přijela ' +
          'za poslední měsíc, a jejich kapacita (dokud nikdo nejel, odhad podle řádů). Na mapě vede každý směr zvlášť ' +
          'se šipkou, šířka podle kapacity, barva podle vytížení.',
      ),
    ),
    { width: 520, onClose: () => window.clearInterval(timer) },
  );
}
