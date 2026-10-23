import type { TrafficHotspot } from '../game/traffic';
import { h } from './dom';
import type { WindowManager } from './windows';

export interface TrafficOverlayControl {
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export interface TrafficOverviewActions {
  hotspots: () => TrafficHotspot[];
  overlay: TrafficOverlayControl;
  focus: (x: number, z: number) => void;
  buildDetour: () => void;
}

export function openTrafficOverview(windows: WindowManager, actions: TrafficOverviewActions): void {
  const render = (): HTMLElement => {
    const overlay = h('input', { type: 'checkbox', checked: actions.overlay.visible });
    overlay.addEventListener('change', () => actions.overlay.setVisible(overlay.checked));
    const hotspots = actions.hotspots().slice(0, 12);
    const rows = hotspots.map((hotspot) => {
      const show = h('button', { className: 'small-button', title: 'Zaměřit místo' }, 'Ukázat');
      show.addEventListener('click', () => actions.focus(hotspot.x + 0.5, hotspot.y + 0.5));
      const detour = h(
        'button',
        { className: 'small-button', title: 'Zaměřit místo a zapnout stavbu silnice' },
        'Objížďka',
      );
      detour.addEventListener('click', () => {
        actions.focus(hotspot.x + 0.5, hotspot.y + 0.5);
        actions.buildDetour();
      });
      return h(
        'tr',
        {},
        h('td', {}, hotspot.townName),
        h('td', { className: 'num' }, String(hotspot.vehicles)),
        h('td', { className: 'num' }, String(hotspot.waiting)),
        h('td', {}, show, detour),
      );
    });

    const legend = h(
      'div',
      { className: 'form__row' },
      ...[
        ['#4fbd75', 'Volno'],
        ['#e4c94a', 'Mírný'],
        ['#ec8b38', 'Hustý'],
        ['#df493e', 'Zácpa'],
      ].flatMap(([color, label]) => {
        const swatch = h('span', {});
        swatch.style.cssText = `display:inline-block;width:12px;height:12px;background:${color};margin-right:4px;vertical-align:-2px`;
        return [h('span', {}, swatch, label), ' '];
      }),
    );
    const table =
      rows.length > 0
        ? h(
            'table',
            { className: 'table' },
            h('tr', {}, h('th', {}, 'Oblast'), h('th', {}, 'Auta'), h('th', {}, 'Čekají'), h('th', {}, 'Akce')),
            ...rows,
          )
        : h('div', { className: 'form__hint' }, 'Po silnicích se právě nepohybují žádná vozidla.');

    return h(
      'div',
      { className: 'form' },
      h('label', { className: 'form__row' }, overlay, ' Zobrazit vytížení na mapě'),
      legend,
      table,
    );
  };

  const timer = window.setInterval(() => windows.update('traffic', render()), 1000);
  windows.open('traffic', 'Městský provoz', render(), {
    width: 500,
    onClose: () => window.clearInterval(timer),
  });
}
