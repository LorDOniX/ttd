import { formatDate } from '../game/clock';
import { Game } from '../game/game';
import { parseSave, serializeGame } from '../game/save';
import type { Town, TownKind } from '../world/town';
import { h } from './dom';
import type { WindowManager } from './windows';

const KIND_LABELS: Record<TownKind, string> = { city: 'Město', town: 'Městečko', village: 'Vesnice' };

export interface GridToggle {
  visible: () => boolean;
  setVisible: (visible: boolean) => void;
}

export function openSettings(
  windows: WindowManager,
  game: Game,
  grid: GridToggle,
  seed: string,
  shortcutsHelp: HTMLElement,
): void {
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
    h('h4', {}, 'Klávesové zkratky'),
    shortcutsHelp,
  );
  windows.open('settings', 'Nastavení', content, { width: 300 });
}

// Tlačítko pro výběr souboru s uloženou hrou; obsah se před předáním ověří
export function createLoadButton(
  onLoad: (text: string) => void,
  status: HTMLElement,
  confirmText: string | null,
): HTMLElement {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      parseSave(text);
      if (confirmText && !window.confirm(confirmText)) return;
      onLoad(text);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Hru se nepodařilo načíst.';
    } finally {
      input.value = '';
    }
  });
  const load = h('button', { className: 'tool-button' }, h('span', {}, 'Načíst hru'), h('small', {}, 'JSON'));
  load.addEventListener('click', () => input.click());
  return h('div', { className: 'form' }, load, input);
}

export interface SaveLoadActions {
  load: (save: string) => void;
  toTitle: () => void;
}

export function openSaveLoad(windows: WindowManager, game: Game, seedText: string, actions: SaveLoadActions): void {
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

  const load = createLoadButton(actions.load, status, 'Načíst uloženou hru? Neuložený postup se ztratí.');
  const toTitle = h('button', { className: 'tool-button' }, h('span', {}, 'Hlavní menu'), h('small', {}, 'hra se uloží'));
  toTitle.addEventListener('click', actions.toTitle);

  windows.open('save-load', 'Uložit / načíst', h('div', { className: 'form' }, save, load, toTitle, status), {
    width: 260,
  });
}

// Historie zpráv od nejnovější
export function openNewsLog(windows: WindowManager, game: Game): void {
  const render = (): HTMLElement => {
    if (game.newsLog.length === 0) return h('div', { className: 'form__hint' }, 'Zatím žádné zprávy.');
    return h(
      'div',
      { className: 'news-log' },
      ...[...game.newsLog]
        .reverse()
        .map((item) =>
          h('div', { className: 'news-log__item' }, h('small', {}, formatDate(item.date)), h('div', {}, item.text)),
        ),
    );
  };
  const off = game.events.on('news', () => windows.update('news', render()));
  windows.open('news', 'Zprávy', render(), { width: 420, onClose: off });
}

export function openTown(
  windows: WindowManager,
  game: Game,
  town: Town,
  focus: (x: number, z: number) => void,
): void {
  const id = `town-${town.id}`;
  const render = (): HTMLElement =>
    h(
      'table',
      { className: 'table' },
      h('tr', {}, h('td', {}, 'Typ'), h('td', {}, KIND_LABELS[town.kind])),
      h('tr', {}, h('td', {}, 'Obyvatel'), h('td', { className: 'num' }, town.population.toLocaleString('cs-CZ'))),
      h('tr', {}, h('td', {}, 'Budov'), h('td', { className: 'num' }, String(town.buildings.length))),
    );

  const off = game.events.on('townsChanged', () => {
    if (windows.isOpen(id)) windows.update(id, render());
  });
  const options = { width: 240, onClose: off, locate: () => focus(town.x + 0.5, town.y + 0.5) };
  windows.open(id, town.name, render(), options);
}
