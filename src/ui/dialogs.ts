import { AD_CAMPAIGN_COST, AD_RATING_BOOST } from '../game/balance';
import { formatDate } from '../game/clock';
import { SEASON_MODES, type SeasonMode } from '../game/seasons';
import { Game, formatMoney } from '../game/game';
import { parseSave, serializeGame } from '../game/save';
import { advertise, fundBuildings, fundBuildingsCost } from '../game/townActions';
import type { Town, TownKind } from '../world/town';
import { h } from './dom';
import { loadTheme, saveTheme, type Theme } from './theme';
import type { WindowManager } from './windows';

const KIND_LABELS: Record<TownKind, string> = { city: 'Město', town: 'Městečko', village: 'Vesnice' };
const SEASON_LABELS: Record<SeasonMode, string> = {
  auto: 'Podle kalendáře',
  spring: 'Jaro',
  summer: 'Léto',
  autumn: 'Podzim',
  winter: 'Zima',
};

export interface Toggle {
  visible: () => boolean;
  setVisible: (visible: boolean) => void;
}

export interface SeasonDebugControl {
  mode: SeasonMode;
  setMode: (mode: SeasonMode) => void;
}

export function openSettings(
  windows: WindowManager,
  game: Game,
  grid: Toggle,
  highlight: Toggle,
  mist: Toggle,
  seed: string,
  shortcutsHelp: HTMLElement,
  seasonDebug: SeasonDebugControl,
): void {
  const gridInput = h('input', { type: 'checkbox', checked: grid.visible() });
  gridInput.addEventListener('change', () => grid.setVisible(gridInput.checked));

  const highlightInput = h('input', { type: 'checkbox', checked: highlight.visible() });
  highlightInput.addEventListener('change', () => highlight.setVisible(highlightInput.checked));

  const mistInput = h('input', { type: 'checkbox', checked: mist.visible() });
  mistInput.addEventListener('change', () => mist.setVisible(mistInput.checked));

  const renewInput = h('input', { type: 'checkbox', checked: game.autoRenew });
  renewInput.addEventListener('change', () => (game.autoRenew = renewInput.checked));

  const theme = loadTheme();
  const themeSelect = h(
    'select',
    {},
    h('option', { value: 'light', selected: theme === 'light' }, 'Světlý'),
    h('option', { value: 'dark', selected: theme === 'dark' }, 'Tmavý'),
  );
  themeSelect.addEventListener('change', () => saveTheme(themeSelect.value as Theme));

  const seasonSelect = h(
    'select',
    {},
    ...SEASON_MODES.map((mode) =>
      h('option', { value: mode, selected: mode === seasonDebug.mode }, SEASON_LABELS[mode]),
    ),
  );
  seasonSelect.addEventListener('change', () => seasonDebug.setMode(seasonSelect.value as SeasonMode));

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
    h('label', { className: 'form__row' }, highlightInput, ' Zvýraznit dlaždici pod kurzorem'),
    h('label', { className: 'form__row' }, mistInput, ' Mlha'),
    h('label', { className: 'form__row' }, renewInput, ' Automaticky obnovovat staré vlaky'),
    h('label', { className: 'form__field' }, 'Vzhled', themeSelect),
    h('label', { className: 'form__field' }, 'Název společnosti', nameInput),
    h('div', { className: 'form__hint' }, `Seed mapy: ${seed}`),
    h('h4', {}, 'Debug'),
    h('label', { className: 'form__field' }, 'Roční období', seasonSelect),
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
  const toTitle = h(
    'button',
    { className: 'tool-button' },
    h('span', {}, 'Hlavní menu'),
    h('small', {}, 'hra se uloží'),
  );
  toTitle.addEventListener('click', actions.toTitle);

  windows.open('save-load', 'Uložit / načíst', h('div', { className: 'form' }, save, load, toTitle, status), {
    width: 260,
  });
}

// Historie zpráv od nejnovější
// Historie zpráv; zprávu s místem jde kliknutím ukázat na mapě
export function openNewsLog(windows: WindowManager, game: Game, focus: (x: number, z: number) => void): void {
  const render = (): HTMLElement => {
    if (game.newsLog.length === 0) return h('div', { className: 'form__hint' }, 'Zatím žádné zprávy.');
    return h(
      'div',
      { className: 'news-log' },
      ...[...game.newsLog].reverse().map((item) => {
        const { at } = item;
        const el = h(
          'div',
          { className: at ? 'news-log__item news-log__item--located' : 'news-log__item' },
          h('small', {}, formatDate(item.date)),
          h('div', {}, at ? `⌖ ${item.text}` : item.text),
        );
        if (at) {
          el.title = 'Zobrazit na mapě';
          el.addEventListener('click', () => focus(at.x, at.y));
        }
        return el;
      }),
    );
  };
  const off = game.events.on('news', () => windows.update('news', render()));
  windows.open('news', 'Zprávy', render(), { width: 420, onClose: off });
}

export function openTown(windows: WindowManager, game: Game, town: Town, focus: (x: number, z: number) => void): void {
  const id = `town-${town.id}`;
  const action = (label: string, run: () => string | null): HTMLButtonElement => {
    const b = h('button', { className: 'small-button', textContent: label });
    b.addEventListener('click', () => {
      const error = run();
      if (error) game.news(error);
      if (windows.isOpen(id)) windows.update(id, render());
    });
    return b;
  };
  const render = (): HTMLElement =>
    h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        h('tr', {}, h('td', {}, 'Typ'), h('td', {}, KIND_LABELS[town.kind])),
        h('tr', {}, h('td', {}, 'Obyvatel'), h('td', { className: 'num' }, town.population.toLocaleString('cs-CZ'))),
        h('tr', {}, h('td', {}, 'Budov'), h('td', { className: 'num' }, String(town.buildings.length))),
        h('tr', {}, h('td', {}, 'Obsluhované'), h('td', { className: 'num' }, town.served ? 'ano' : 'ne')),
      ),
      h(
        'div',
        { className: 'train__actions' },
        action(`Reklama (${formatMoney(AD_CAMPAIGN_COST)})`, () => advertise(game, town)),
        action(`Financovat výstavbu (${formatMoney(fundBuildingsCost(town))})`, () => fundBuildings(game, town)),
      ),
      h(
        'div',
        { className: 'form__hint' },
        `Reklama zvedne hodnocení vašich stanic ve městě o ${Math.round(AD_RATING_BOOST * 100)} bodů. ` +
          'Financovaná výstavba hned přidá městu rok růstu. Obsluhované město roste rychleji.',
      ),
    );

  const off = game.events.on('townsChanged', () => {
    if (windows.isOpen(id)) windows.update(id, render());
  });
  const options = { width: 300, onClose: off, locate: () => focus(town.x + 0.5, town.y + 0.5) };
  windows.open(id, town.name, render(), options);
}
