import { SUBSIDY_DURATION_MONTHS } from '../game/balance';
import { CARGOS } from '../game/cargo';
import type { Game } from '../game/game';
import { multiplierText, type Subsidy, type SubsidyEnd } from '../game/subsidies';
import { h } from './dom';
import type { WindowManager } from './windows';

// Okno dotací jako v OpenTTD: nabízené a udělené dotace; klik na zdroj nebo cíl ukáže místo na mapě
export function openSubsidies(windows: WindowManager, game: Game, focus: (x: number, z: number) => void): void {
  const { subsidies } = game;
  const place = (end: SubsidyEnd): HTMLElement => {
    const el = h('button', { className: 'subsidy__place', textContent: subsidies.endName(end) });
    el.title = 'Zobrazit na mapě';
    el.addEventListener('click', () => {
      const at = subsidies.endPosition(end);
      if (at) focus(at.x, at.y);
    });
    return el;
  };
  const row = (subsidy: Subsidy): HTMLElement =>
    h(
      'div',
      { className: 'subsidy' },
      h('span', { className: 'subsidy__dot' }),
      h(
        'div',
        {},
        h(
          'div',
          {},
          h('strong', {}, CARGOS[subsidy.cargo].name),
          ' z ',
          place(subsidy.from),
          ' do ',
          place(subsidy.to),
        ),
        h(
          'small',
          {},
          subsidy.awarded
            ? `${multiplierText(subsidies.multiplier)} jízdného do ${subsidies.untilText(subsidy)}`
            : `nabídka platí do ${subsidies.untilText(subsidy)}`,
        ),
      ),
    );
  const colored = (el: HTMLElement, subsidy: Subsidy): HTMLElement => {
    el.querySelector<HTMLElement>('.subsidy__dot')!.style.background = CARGOS[subsidy.cargo].color;
    return el;
  };
  const section = (title: string, list: Subsidy[], empty: string): HTMLElement[] => [
    h('h4', {}, title),
    list.length === 0
      ? h('div', { className: 'form__hint' }, empty)
      : h('div', { className: 'subsidy-list' }, ...list.map((s) => colored(row(s), s))),
  ];
  const render = (): HTMLElement =>
    h(
      'div',
      { className: 'form subsidies' },
      ...section('Nabízené dotace', subsidies.offers, 'Žádné nabídky.'),
      ...section('Udělené dotace', subsidies.awarded, 'Žádné.'),
      h(
        'div',
        { className: 'form__hint' },
        `Dotaci získá první dodávka ze stanice u zdroje na stanici u cíle. Pak se za tuto přepravu ` +
          `${SUBSIDY_DURATION_MONTHS / 12} rok platí ${multiplierText(subsidies.multiplier)} jízdného ` +
          '(i za náklad s překládkou). Nové nabídky přicházejí ve zprávách.',
      ),
    );
  const off = game.events.on('subsidiesChanged', () => windows.update('subsidies', render()));
  windows.open('subsidies', 'Dotace', render(), { width: 380, onClose: off });
}
