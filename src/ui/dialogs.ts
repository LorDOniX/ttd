import { formatDate } from '../game/clock';
import { Game, formatMoney } from '../game/game';
import { PENDING_LOAD_KEY, parseSave, serializeGame } from '../game/save';
import { trainModel } from '../game/trains';
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
    const { income, expenses, passengers } = game.thisYear;
    const count = (label: string, value: number): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, label), h('td', { className: 'num' }, value.toLocaleString('cs-CZ')));
    const table = h(
      'table',
      { className: 'table' },
      h('tr', {}, h('th', { colSpan: 2 }, `Rok ${year}`)),
      count('Přepraveno cestujících', passengers),
      row('Příjmy', income),
      row('Výdaje', 0 - expenses),
      row('Zisk', income - expenses, true),
    );
    if (game.lastYear) {
      const last = game.lastYear;
      table.append(
        h('tr', {}, h('th', { colSpan: 2 }, `Rok ${year - 1}`)),
        count('Přepraveno cestujících', last.passengers),
        row('Příjmy', last.income),
        row('Výdaje', 0 - last.expenses),
        row('Zisk', last.income - last.expenses, true),
      );
    }

    const trains = game.fleet.trains;
    const money = (value: number, strong = false): HTMLTableCellElement =>
      h('td', { className: strong ? 'num strong' : 'num' }, formatMoney(value));
    const vehicles =
      trains.length === 0
        ? h('div', { className: 'form__hint' }, 'Zatím nemáte žádné vlaky.')
        : h(
            'table',
            { className: 'table' },
            h(
              'tr',
              {},
              h('th', {}, 'Vlak'),
              h('th', { className: 'num' }, 'Příjmy'),
              h('th', { className: 'num' }, 'Provoz'),
              h('th', { className: 'num' }, 'Zisk'),
              h('th', { className: 'num' }, 'Loni'),
            ),
            ...trains.map((t) =>
              h(
                'tr',
                {},
                h('td', {}, `${t.name} (${trainModel(t).name})`),
                money(t.income),
                money(0 - t.costs),
                money(t.income - t.costs, true),
                money(t.lastIncome - t.lastCosts),
              ),
            ),
          );
    return h(
      'div',
      {},
      table,
      h('h4', {}, 'Dopravní prostředky (letos)'),
      vehicles,
      h('div', { className: 'finance__balance' }, 'Stav účtu: ', h('strong', {}, formatMoney(game.money))),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen('finance')) windows.open('finance', 'Finance', render(), options);
  };
  const unsubscribe = [
    game.events.on('money', refresh),
    game.events.on('trainsChanged', refresh),
    game.clock.events.on('month', refresh),
  ];
  const options = { width: 460, onClose: () => unsubscribe.forEach((off) => off()) };
  windows.open('finance', 'Finance', render(), options);
}

export function openSaveLoad(windows: WindowManager, game: Game, seedText: string): void {
  const status = h('div', { className: 'form__hint' });

  const save = h('button', { className: 'tool-button' }, h('span', {}, 'Uložit hru'), h('small', {}, 'JSON'));
  save.addEventListener('click', () => {
    const json = JSON.stringify(serializeGame(game, seedText));
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: `ttd-${formatDate(game.clock.date).replace(/\.?\s+/g, '-')}.json` });
    // Některé prohlížeče stáhnou jen odkaz vložený do dokumentu a s ještě platnou URL
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status.textContent = 'Hra uložena.';
  });

  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      parseSave(text);
      if (!window.confirm('Načíst uloženou hru? Neuložený postup se ztratí.')) return;
      // Načtená hra se postaví po novém načtení stránky, aby nezůstal starý stav scény
      sessionStorage.setItem(PENDING_LOAD_KEY, text);
      location.reload();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Hru se nepodařilo načíst.';
    } finally {
      input.value = '';
    }
  });
  const load = h('button', { className: 'tool-button' }, h('span', {}, 'Načíst hru'), h('small', {}, 'JSON'));
  load.addEventListener('click', () => input.click());

  windows.open('save-load', 'Uložit / načíst', h('div', { className: 'form' }, save, load, input, status), {
    width: 260,
  });
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
