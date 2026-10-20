import { Game, formatMoney } from '../game/game';
import type { Town } from '../world/town';
import { h } from './dom';
import type { WindowManager } from './windows';

export interface GridToggle {
  visible: () => boolean;
  setVisible: (visible: boolean) => void;
}

export function openSettings(windows: WindowManager, game: Game, grid: GridToggle, seed: string): void {
  const gridInput = h('input', { type: 'checkbox', checked: grid.visible() });
  gridInput.addEventListener('change', () => grid.setVisible(gridInput.checked));

  const nameInput = h('input', { type: 'text', value: game.companyName, maxLength: 40 });
  const apply = (): void => game.setCompanyName(nameInput.value);
  nameInput.addEventListener('change', apply);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });

  const content = h(
    'div',
    { className: 'form' },
    h('label', { className: 'form__row' }, gridInput, ' Zobrazit mřížku'),
    h('label', { className: 'form__field' }, 'Název společnosti', nameInput),
    h('div', { className: 'form__hint' }, `Seed mapy: ${seed}`),
  );
  windows.open('settings', 'Nastavení', content, { width: 300 });
}

export function openFinance(windows: WindowManager, game: Game): void {
  const render = (): HTMLElement => {
    const row = (label: string, value: number, strong = false): HTMLTableRowElement =>
      h(
        'tr',
        {},
        h('td', {}, label),
        h('td', { className: strong ? 'num strong' : 'num' }, formatMoney(value)),
      );
    const year = game.clock.date.year;
    const { income, expenses } = game.thisYear;
    const table = h(
      'table',
      { className: 'table' },
      h('tr', {}, h('th', { colSpan: 2 }, `Rok ${year}`)),
      row('Příjmy', income),
      row('Výdaje', 0 - expenses),
      row('Zisk', income - expenses, true),
    );
    if (game.lastYear) {
      const last = game.lastYear;
      table.append(
        h('tr', {}, h('th', { colSpan: 2 }, `Rok ${year - 1}`)),
        row('Příjmy', last.income),
        row('Výdaje', 0 - last.expenses),
        row('Zisk', last.income - last.expenses, true),
      );
    }
    return h(
      'div',
      {},
      table,
      h('h4', {}, 'Dopravní prostředky'),
      h('div', { className: 'form__hint' }, 'Zatím nemáte žádné vlaky.'),
      h('div', { className: 'finance__balance' }, 'Stav účtu: ', h('strong', {}, formatMoney(game.money))),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen('finance')) windows.open('finance', 'Finance', render(), options);
  };
  const unsubscribe = [game.events.on('money', refresh), game.clock.events.on('month', refresh)];
  const options = { width: 320, onClose: () => unsubscribe.forEach((off) => off()) };
  windows.open('finance', 'Finance', render(), options);
}

export function openTown(windows: WindowManager, game: Game, town: Town): void {
  const id = `town-${town.id}`;
  const render = (): HTMLElement =>
    h(
      'table',
      { className: 'table' },
      h('tr', {}, h('td', {}, 'Typ'), h('td', {}, town.kind === 'city' ? 'Město' : 'Vesnice')),
      h('tr', {}, h('td', {}, 'Obyvatel'), h('td', { className: 'num' }, town.population.toLocaleString('cs-CZ'))),
      h('tr', {}, h('td', {}, 'Budov'), h('td', { className: 'num' }, String(town.buildings.length))),
    );

  const off = game.events.on('townsChanged', () => {
    if (windows.isOpen(id)) windows.open(id, town.name, render(), options);
  });
  const options = { width: 240, onClose: off };
  windows.open(id, town.name, render(), options);
}
