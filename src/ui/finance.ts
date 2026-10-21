import { LOAN_INTEREST, LOAN_STEP, MAINTENANCE_RATE, MAX_LOAN } from '../game/balance';
import { CARGOS, FREIGHT_TYPES } from '../game/cargo';
import { EXPENSE_KINDS, Game, formatMoney, type ExpenseKind, type YearStats } from '../game/game';
import { trainModel } from '../game/trains';
import { barChart } from './chart';
import { h } from './dom';
import type { WindowManager } from './windows';

type Tab = 'overview' | 'charts' | 'trains';

const TABS: [Tab, string][] = [
  ['overview', 'Přehled'],
  ['charts', 'Grafy'],
  ['trains', 'Vlaky'],
];

const EXPENSE_LABELS: Record<ExpenseKind, string> = {
  construction: 'Stavby',
  vehicles: 'Nákup vozidel',
  running: 'Provoz vlaků',
  maintenance: 'Údržba tratí',
  interest: 'Úroky',
};

// Kolik let zpět ukazují grafy včetně letošního
const CHART_YEARS = 10;

const percent = (rate: number): string => `${Math.round(rate * 100)} %`;

// Buňka s částkou, záporná je červená
function moneyCell(
  value: number,
  format: (n: number) => string = formatMoney,
  className = 'num',
): HTMLTableCellElement {
  return h('td', { className: value < 0 ? `${className} negative` : className }, format(value));
}

function overview(game: Game): HTMLElement {
  const borrow = h('button', { className: 'small-button', textContent: `Půjčit ${formatMoney(LOAN_STEP)}` });
  const repay = h('button', { className: 'small-button', textContent: `Splatit ${formatMoney(LOAN_STEP)}` });
  borrow.disabled = game.loan + LOAN_STEP > MAX_LOAN;
  repay.disabled = game.loan < LOAN_STEP || game.money < LOAN_STEP;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  borrow.addEventListener('click', () => report(game.borrow()));
  repay.addEventListener('click', () => report(game.repay()));

  const account = h(
    'div',
    { className: 'form' },
    h('div', {}, 'Stav účtu: ', h('strong', { className: game.money < 0 ? 'negative' : '' }, formatMoney(game.money))),
    h('div', {}, `Úvěr: ${formatMoney(game.loan)} z ${formatMoney(MAX_LOAN)}`),
    h('div', { className: 'train__actions' }, borrow, repay),
    h(
      'div',
      { className: 'form__hint' },
      `Úrok ${percent(LOAN_INTEREST)} ročně: ${formatMoney(game.monthlyInterest)} měsíčně. ` +
        `Údržba tratí (${percent(MAINTENANCE_RATE)} ceny staveb ročně): ${formatMoney(game.monthlyMaintenance)} měsíčně.`,
    ),
  );

  const year = game.clock.date.year;
  const years: [string, YearStats][] = [[`${year}`, game.thisYear]];
  if (game.lastYear) years.push([`${game.lastYear.year}`, game.lastYear]);
  const cells = (value: (s: YearStats) => number, format: (n: number) => string, className: string) =>
    years.map(([, s]) => moneyCell(value(s), format, className));
  const row = (
    label: string,
    value: (s: YearStats) => number,
    className = 'num',
    format: (n: number) => string = formatMoney,
  ): HTMLTableRowElement => h('tr', {}, h('td', {}, label), ...cells(value, format, className));

  const table = h(
    'table',
    { className: 'table' },
    h('tr', {}, h('th', {}), ...years.map(([label]) => h('th', { className: 'num' }, label))),
    row(
      'Přepraveno cestujících',
      (s) => s.passengers,
      'num',
      (n) => n.toLocaleString('cs-CZ'),
    ),
    // Jen druhy, které firma v těchto letech vozila
    ...FREIGHT_TYPES.filter((type) => years.some(([, s]) => s.freight[type] > 0)).map((type) =>
      row(
        `Přepraveno ${CARGOS[type].genitive}`,
        (s) => s.freight[type],
        'num',
        (n) => `${Math.round(n).toLocaleString('cs-CZ')} t`,
      ),
    ),
    row('Příjmy', (s) => s.income),
    ...EXPENSE_KINDS.map((kind) => row(EXPENSE_LABELS[kind], (s) => 0 - s.costs[kind])),
    row('Zisk', (s) => s.income - s.expenses, 'num strong'),
  );
  return h('div', { className: 'form' }, account, table);
}

function charts(game: Game): HTMLElement {
  const year = game.clock.date.year;
  const records = [...game.history.slice(-(CHART_YEARS - 1)), { ...game.thisYear, year }];
  const labels = records.map((r) => `${r.year}`);
  const hauled = FREIGHT_TYPES.filter((type) => records.some((r) => r.freight[type] > 0));
  return h(
    'div',
    { className: 'form' },
    h('h4', {}, 'Příjmy a výdaje'),
    barChart(
      labels,
      [
        { label: 'Příjmy', color: '#6fbf5a', values: records.map((r) => r.income) },
        { label: 'Výdaje', color: '#d9675a', values: records.map((r) => r.expenses) },
      ],
      formatMoney,
    ),
    h('h4', {}, 'Přepravení cestující'),
    barChart(labels, [{ label: 'Cestující', color: '#5a8fd9', values: records.map((r) => r.passengers) }], (v) =>
      v.toLocaleString('cs-CZ'),
    ),
    h('h4', {}, 'Přepravený náklad'),
    hauled.length > 0
      ? barChart(
          labels,
          hauled.map((type) => ({
            label: CARGOS[type].name,
            color: CARGOS[type].color,
            values: records.map((r) => r.freight[type]),
          })),
          (v) => `${Math.round(v).toLocaleString('cs-CZ')} t`,
        )
      : h('div', { className: 'form__hint' }, 'Zatím žádný.'),
    h('div', { className: 'form__hint' }, `Rok ${year} zatím neskončil.`),
  );
}

function trains(game: Game): HTMLElement {
  const list = game.fleet.trains;
  if (list.length === 0) return h('div', { className: 'form__hint' }, 'Zatím nemáte žádné vlaky.');
  const money = (value: number, strong = false): HTMLTableCellElement =>
    moneyCell(value, formatMoney, strong ? 'num strong' : 'num');
  return h(
    'table',
    { className: 'table' },
    h(
      'tr',
      {},
      h('th', {}, 'Vlak (letos)'),
      h('th', { className: 'num' }, 'Příjmy'),
      h('th', { className: 'num' }, 'Provoz'),
      h('th', { className: 'num' }, 'Zisk'),
      h('th', { className: 'num' }, 'Loni'),
    ),
    ...list.map((t) =>
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
}

export function openFinance(windows: WindowManager, game: Game): void {
  let tab: Tab = 'overview';

  const render = (): HTMLElement => {
    const tabs = h(
      'div',
      { className: 'tabs' },
      ...TABS.map(([id, label]) => {
        const b = h('button', { className: 'tabs__tab', textContent: label });
        b.classList.toggle('tabs__tab--active', id === tab);
        b.addEventListener('click', () => {
          tab = id;
          refresh();
        });
        return b;
      }),
    );
    const content = tab === 'overview' ? overview(game) : tab === 'charts' ? charts(game) : trains(game);
    return h('div', {}, tabs, content);
  };

  const refresh = (): void => {
    if (windows.isOpen('finance')) windows.update('finance', render());
  };
  const unsubscribe = [
    game.events.on('money', refresh),
    game.events.on('railChanged', refresh),
    game.events.on('trainsChanged', refresh),
    game.clock.events.on('month', refresh),
  ];
  const options = { width: 460, onClose: () => unsubscribe.forEach((off) => off()) };
  windows.open('finance', 'Finance', render(), options);
}
