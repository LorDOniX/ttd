import {
  DISTRIBUTION_CLASSES,
  DISTRIBUTION_CLASS_LABELS,
  DISTRIBUTION_LABELS,
  distributionModes,
  type DistributionMode,
} from '../game/cargodist';
import { AIRCRAFT_CREDITS } from './aircraft';
import { AUTHORITY_PERMIT, STATUE_COST, STATUE_STATION_BONUS } from '../game/balance';
import { ratingLabel } from '../game/authority';
import { TOWN_SUPPLY_CARGOS } from '../game/townGrowth';
import { formatDate } from '../game/clock';
import { SEASON_MODES, type SeasonMode } from '../game/seasons';
import { BREAKDOWN_LABELS, BREAKDOWN_SETTINGS, isBreakdownSetting } from '../game/reliability';
import { ECONOMY_LABELS, ECONOMY_SETTINGS, isEconomySetting } from '../game/industryLife';
import { SUBSIDY_MULTIPLIERS } from '../game/balance';
import { isSubsidyMultiplier, multiplierText } from '../game/subsidies';
import { Game, formatMoney } from '../game/game';
import { parseSave, serializeGame } from '../game/save';
import { AD_SIZES, advertise, fundBuildings, fundBuildingsCost, type AdSize } from '../game/townActions';
import type { Town, TownKind, TownSupply } from '../world/town';
import { CARGOS } from '../game/cargo';
import { h } from './dom';
import { loadTheme, saveTheme, type Theme } from './theme';
import type { WindowManager } from './windows';
import { SEASON_LABELS } from './sceneControls';

const KIND_LABELS: Record<TownKind, string> = { city: 'Město', town: 'Městečko', village: 'Vesnice' };

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
  fps: Toggle,
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

  const fpsInput = h('input', { type: 'checkbox', checked: fps.visible() });
  fpsInput.addEventListener('change', () => fps.setVisible(fpsInput.checked));

  const renewInput = h('input', { type: 'checkbox', checked: game.autoRenew });
  renewInput.addEventListener('change', () => (game.autoRenew = renewInput.checked));

  const breakdownSelect = h(
    'select',
    { title: 'Bez poruch vozidla nejezdí ani na servis' },
    ...BREAKDOWN_SETTINGS.map((b) => h('option', { value: b, selected: b === game.breakdowns }, BREAKDOWN_LABELS[b])),
  );
  breakdownSelect.addEventListener('change', () => {
    if (isBreakdownSetting(breakdownSelect.value)) game.breakdowns = breakdownSelect.value;
  });
  const economySelect = h(
    'select',
    { title: 'Plynulá: výroba se mění po malých krocích každý měsíc; původní: skoky; zmrazená: beze změn' },
    ...ECONOMY_SETTINGS.map((e) => h('option', { value: e, selected: e === game.economy }, ECONOMY_LABELS[e])),
  );
  economySelect.addEventListener('change', () => {
    if (isEconomySetting(economySelect.value)) game.economy = economySelect.value;
  });
  const subsidySelect = h(
    'select',
    {},
    ...SUBSIDY_MULTIPLIERS.map((m) =>
      h('option', { value: String(m), selected: m === game.subsidies.multiplier }, multiplierText(m)),
    ),
  );
  subsidySelect.addEventListener('change', () => {
    const value = Number(subsidySelect.value);
    if (isSubsidyMultiplier(value)) {
      game.subsidies.multiplier = value;
      game.events.emit('subsidiesChanged');
    }
  });

  // Distribuce nákladu jako v OpenTTD, zvlášť pro cestující, poštu a ostatní náklad
  const distributionFields = DISTRIBUTION_CLASSES.map((kind) => {
    const select = h(
      'select',
      {
        title:
          'Ručně: náklad jede, kam ho vozidlo doveze. Asymetricky: náklad má cílovou stanici, která ho přijímá. ' +
          'Symetricky: cestující a pošta jezdí mezi stanicemi tam i zpět.',
      },
      ...distributionModes(kind).map((mode) =>
        h('option', { value: mode, selected: mode === game.cargodist.settings[kind] }, DISTRIBUTION_LABELS[mode]),
      ),
    );
    select.addEventListener('change', () => game.cargodist.setMode(kind, select.value as DistributionMode));
    return h('label', { className: 'form__field' }, DISTRIBUTION_CLASS_LABELS[kind], select);
  });

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
    h('label', { className: 'form__row' }, fpsInput, ' Zobrazit FPS'),
    h('label', { className: 'form__row' }, renewInput, ' Automaticky obnovovat staré vlaky'),
    h('label', { className: 'form__field' }, 'Poruchy vozidel', breakdownSelect),
    h('label', { className: 'form__field' }, 'Dotace (násobek jízdného)', subsidySelect),
    h('label', { className: 'form__field' }, 'Ekonomika (změny výroby)', economySelect),
    h('h4', {}, 'Distribuce nákladu (cargodist)'),
    ...distributionFields,
    h('label', { className: 'form__field' }, 'Vzhled', themeSelect),
    h('label', { className: 'form__field' }, 'Název společnosti', nameInput),
    h('div', { className: 'form__hint' }, `Seed mapy: ${seed}`),
    h('h4', {}, 'Debug'),
    h('label', { className: 'form__field' }, 'Roční období', seasonSelect),
    h('h4', {}, 'Klávesové zkratky'),
    shortcutsHelp,
    h('h4', {}, 'Autoři'),
    h('div', { className: 'form__hint' }, `Modely Kenney (CC0, kenney.nl). ${AIRCRAFT_CREDITS}`),
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

// „120 cestujících · 8 t pošty · 30 t potravin“
function supplyText(supply: TownSupply | undefined): string {
  if (!supply) return 'nic';
  const parts = TOWN_SUPPLY_CARGOS.filter((c) => Math.round(supply[c]) > 0).map(
    (c) => `${Math.round(supply[c])} ${CARGOS[c].unit}`,
  );
  return parts.length > 0 ? parts.join(' · ') : 'nic';
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
  const render = (): HTMLElement => {
    const { authority } = game;
    const rating = authority.rating(town);
    const statue = authority.statues.has(town.id);
    const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, label), h('td', { className }, value));
    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        row('Typ', KIND_LABELS[town.kind]),
        row('Obyvatel', town.population.toLocaleString('cs-CZ'), 'num'),
        row('Budov', String(town.buildings.length), 'num'),
        row('Aktivní stanice', String(game.townGrowth.activeStations(town)), 'num'),
        row('Dovoz minulý měsíc', supplyText(town.lastSupplied), 'num'),
        row(
          'Růst',
          `${(game.townGrowth.annualRate(town) * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} % ročně`,
          'num',
        ),
        row(
          'Hodnocení společnosti',
          `${ratingLabel(rating)} (${Math.round(rating)})`,
          rating <= AUTHORITY_PERMIT ? 'num warning' : 'num',
        ),
        row('Socha společnosti', statue ? 'stojí' : 'ne', 'num'),
      ),
      h(
        'div',
        { className: 'train__actions' },
        ...(Object.keys(AD_SIZES) as AdSize[]).map((size) =>
          action(`${AD_SIZES[size].label} (${formatMoney(AD_SIZES[size].cost)})`, () => advertise(game, town, size)),
        ),
        ...(statue ? [] : [action(`Postavit sochu (${formatMoney(STATUE_COST)})`, () => authority.buildStatue(town))]),
        action(`Financovat výstavbu (${formatMoney(fundBuildingsCost(town))})`, () => fundBuildings(game, town)),
      ),
      h(
        'div',
        { className: 'form__hint' },
        'Místní úřad hodnotí, co společnost ve městě a okolí dělá: kácení stromů a bourání budov a silnic ' +
          'hodnocení snižuje, obsluhované stanice a vysazené stromy ho zvyšují (opuštěné stanice snižují). ' +
          `Při hodnocení horším než „Špatné“ město nepovolí stavbu stanic ani demolici svého majetku. ` +
          `Reklama zvedne hodnocení stanic (malá s městem v dosahu, střední a velká i v okolí). ` +
          `Socha trvale zvedne hodnocení stanic ve městě o ${Math.round(STATUE_STATION_BONUS * 100)} bodů. ` +
          'Financovaná výstavba hned přidá městu rok růstu. Město roste každý měsíc: rychleji s více ' +
          'obsluhovanými stanicemi (vozidlo v posledních 30 dnech) a s dovozem cestujících, pošty, potravin a zboží.',
      ),
    );
  };

  const off = game.events.on('townsChanged', () => {
    if (windows.isOpen(id)) windows.update(id, render());
  });
  const options = { width: 300, onClose: off, locate: () => focus(town.x + 0.5, town.y + 0.5) };
  windows.open(id, town.name, render(), options);
}
