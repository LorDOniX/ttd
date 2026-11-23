import type { Game } from '../game/game';
import { MAX_TIMETABLE_DAYS, orderFlags, type Train } from '../game/trains';
import { h } from './dom';
import type { WindowManager } from './windows';

const days = (value: number): string => `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} d`;

// Stav vlaku vůči plánu: včas, nebo o kolik je pozadu
export function latenessText(train: Train): string {
  if (train.lateness === undefined) return 'bez plánu';
  return train.lateness > 0 ? `zpoždění ${days(train.lateness)}` : 'včas';
}

// Okno časů jízdního řádu jako „Timetable“ v OpenTTD: plánovaná doba jízdy k příkazu a stání na stanici,
// naměřené doby, automatické vyplňování a zpoždění. Vlak, který přijede dřív, na stanici počká.
export function openTimetable(windows: WindowManager, game: Game, train: Train): void {
  const { fleet } = game;
  const id = `timetable-${train.id}`;
  const input = (value: number | undefined, title: string, set: (days: number | null) => void): HTMLElement => {
    const el = h('input', {
      type: 'number',
      min: '0',
      max: String(MAX_TIMETABLE_DAYS),
      step: '0.5',
      value: value === undefined ? '' : String(value),
      title,
      className: 'timetable__input',
    });
    el.addEventListener('change', () => {
      const parsed = Number(el.value.replace(',', '.'));
      el.blur();
      set(el.value.trim() === '' || !(parsed > 0) ? null : parsed);
    });
    return el;
  };
  const render = (): HTMLElement => {
    const orders = train.orders ?? [];
    if (orders.length === 0) return h('div', { className: 'form__hint' }, 'Vlak nemá jízdní řád.');
    const flags = orders.map((_, i) => orderFlags(train, i));
    const measured = orders.map((_, i) => train.lastTravel?.[i] ?? null);
    const planned = flags.reduce((sum, f) => sum + (f.travel ?? 0) + (f.wait ?? 0), 0);
    const complete = flags.every((f) => f.waypoint || f.via || f.travel !== undefined);
    const lastRound = measured.every((m, i) => m !== null || flags[i].waypoint || flags[i].via)
      ? measured.reduce((sum: number, m) => sum + (m ?? 0), 0)
      : null;
    const autofill = h('input', { type: 'checkbox', checked: train.autofill === true });
    autofill.addEventListener('change', () => fleet.setAutofill(train, autofill.checked));
    const rows = orders.map((_, i) => {
      const f = flags[i];
      const passing = f.waypoint || f.via;
      const station = !f.depot && !f.waypoint;
      return h(
        'tr',
        { className: train.target === i && train.state !== 'depot' ? 'timetable__current' : '' },
        h('td', {}, `${i + 1}: ${fleet.orderName(train, i)}`),
        h(
          'td',
          {},
          passing
            ? '—'
            : input(f.travel, 'Plánovaná doba jízdy k tomuto příkazu (dny)', (d) =>
                fleet.setTimetable(train, i, { travel: d }),
              ),
        ),
        h('td', { className: 'num' }, measured[i] === null || passing ? '—' : days(measured[i]!)),
        h(
          'td',
          {},
          station && !f.via
            ? input(f.wait, 'Stání na stanici aspoň (dny); jinak jen nakládka a vykládka', (d) =>
                fleet.setTimetable(train, i, { wait: d }),
              )
            : '—',
        ),
      );
    });
    const fromMeasured = h('button', { className: 'small-button', textContent: 'Plán z naměřených' });
    fromMeasured.title = 'Naměřené doby jízdy zapsat jako plán';
    fromMeasured.disabled = measured.every((m) => m === null);
    fromMeasured.addEventListener('click', () => {
      measured.forEach((m, i) => {
        if (m !== null && !flags[i].waypoint && !flags[i].via) fleet.setTimetable(train, i, { travel: m });
      });
    });
    const clear = h('button', { className: 'small-button', textContent: 'Vymazat časy' });
    clear.addEventListener('click', () => fleet.clearTimetable(train));
    return h(
      'div',
      { className: 'form timetable' },
      h(
        'div',
        {},
        h('strong', {}, latenessText(train)),
        planned > 0 ? ` · celé kolo podle plánu ${days(planned)}${complete ? '' : ' (neúplný plán)'}` : '',
        lastRound !== null ? ` · naposledy jízdy ${days(lastRound)}` : '',
      ),
      h(
        'table',
        { className: 'table' },
        h(
          'tr',
          {},
          h('th', {}, 'Příkaz'),
          h('th', {}, 'Jízda'),
          h('th', { className: 'num' }, 'Naposledy'),
          h('th', {}, 'Stání'),
        ),
        ...rows,
      ),
      h('label', { className: 'form__row' }, autofill, ' Automaticky vyplňovat doby jízdy podle skutečných jízd'),
      h('div', { className: 'train__actions' }, fromMeasured, clear),
      h(
        'div',
        { className: 'form__hint' },
        'Doba jízdy je plán cesty od předchozího příkazu. Vlak, který přijede dřív, na stanici počká, ' +
          'aby odjel podle plánu – tak se vlaky na lince rovnoměrně rozestoupí. Stání prodlouží pobyt na ' +
          'stanici. U sdíleného řádu platí časy pro celou linku.',
      ),
    );
  };
  const refresh = (): void => {
    if (!fleet.trains.includes(train)) windows.close(id);
    else if (windows.isOpen(id) && !document.activeElement?.closest('.timetable')) windows.update(id, render());
  };
  const unsubscribe = [game.events.on('trainsChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open(id, `${train.name} – časy`, render(), {
    width: 440,
    onClose: () => unsubscribe.forEach((off) => off()),
  });
}
