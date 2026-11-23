import type { Game } from '../game/game';
import { MAX_TIMETABLE_DAYS, orderFlags, type Train } from '../game/trains';
import { timetableEntry, type Timetabled } from '../game/vehicleTimetable';
import { h } from './dom';
import type { WindowManager } from './windows';

const days = (value: number): string => `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} d`;

// Stav vozidla vůči plánu: včas, nebo o kolik je pozadu
export function latenessText(vehicle: { lateness?: number }): string {
  if (vehicle.lateness === undefined) return 'bez plánu';
  return vehicle.lateness > 0 ? `zpoždění ${days(vehicle.lateness)}` : 'včas';
}

// Řádek okna časů: příkaz, plán jízdy a stání, naměřená jízda
export interface TimetableRow {
  name: string;
  travel?: number;
  wait?: number;
  measured: number | null;
  // Průjezd (průjezdný bod, projetí stanicí): bez plánu jízdy a stání
  passing: boolean;
  // U příkazu jde naplánovat stání (stanice, zastávka, letiště, přístav)
  canWait: boolean;
}

// Časy jízdního řádu libovolného vozidla pro společné okno časů
export interface TimetableSource {
  id: string;
  title: string;
  rows: () => TimetableRow[];
  // Index příkazu, ke kterému vozidlo jede nebo u kterého stojí; −1 = žádný
  current: () => number;
  lateness: () => number | undefined;
  autofill: () => boolean;
  setTimetable: (index: number, patch: { travel?: number | null; wait?: number | null }) => void;
  setAutofill: (on: boolean) => void;
  clear: () => void;
  hint: string;
  subscribe: (refresh: () => void) => (() => void)[];
  exists: () => boolean;
}

// Okno časů jízdního řádu jako „Timetable“ v OpenTTD: plánovaná doba jízdy k příkazu a stání na stanici,
// naměřené doby, automatické vyplňování a zpoždění. Vozidlo, které přijede dřív, na stanici počká.
export function openTimetableWindow(windows: WindowManager, source: TimetableSource): void {
  const { id } = source;
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
    const list = source.rows();
    if (list.length === 0) return h('div', { className: 'form__hint' }, 'Vozidlo nemá jízdní řád.');
    const planned = list.reduce((sum, r) => sum + (r.travel ?? 0) + (r.wait ?? 0), 0);
    const complete = list.every((r) => r.passing || r.travel !== undefined);
    const lastRound = list.every((r) => r.measured !== null || r.passing)
      ? list.reduce((sum, r) => sum + (r.measured ?? 0), 0)
      : null;
    const autofill = h('input', { type: 'checkbox', checked: source.autofill() });
    autofill.addEventListener('change', () => source.setAutofill(autofill.checked));
    const rows = list.map((r, i) =>
      h(
        'tr',
        { className: source.current() === i ? 'timetable__current' : '' },
        h('td', {}, `${i + 1}: ${r.name}`),
        h(
          'td',
          {},
          r.passing
            ? '—'
            : input(r.travel, 'Plánovaná doba jízdy k tomuto příkazu (dny)', (d) =>
                source.setTimetable(i, { travel: d }),
              ),
        ),
        h('td', { className: 'num' }, r.measured === null || r.passing ? '—' : days(r.measured)),
        h(
          'td',
          {},
          r.canWait
            ? input(r.wait, 'Stání na stanici aspoň (dny); jinak jen nakládka a vykládka', (d) =>
                source.setTimetable(i, { wait: d }),
              )
            : '—',
        ),
      ),
    );
    const fromMeasured = h('button', { className: 'small-button', textContent: 'Plán z naměřených' });
    fromMeasured.title = 'Naměřené doby jízdy zapsat jako plán';
    fromMeasured.disabled = list.every((r) => r.measured === null);
    fromMeasured.addEventListener('click', () => {
      list.forEach((r, i) => {
        if (r.measured !== null && !r.passing) source.setTimetable(i, { travel: r.measured });
      });
    });
    const clear = h('button', { className: 'small-button', textContent: 'Vymazat časy' });
    clear.addEventListener('click', () => source.clear());
    return h(
      'div',
      { className: 'form timetable' },
      h(
        'div',
        {},
        h('strong', {}, latenessText({ lateness: source.lateness() })),
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
      h('div', { className: 'form__hint' }, source.hint),
    );
  };
  const refresh = (): void => {
    if (!source.exists()) windows.close(id);
    else if (windows.isOpen(id) && !document.activeElement?.closest('.timetable')) windows.update(id, render());
  };
  const unsubscribe = source.subscribe(refresh);
  windows.open(id, source.title, render(), {
    width: 440,
    onClose: () => unsubscribe.forEach((off) => off()),
  });
}

// Časy vlaku: v příkazech jízdního řádu (u sdíleného řádu pro celou linku)
export function openTimetable(windows: WindowManager, game: Game, train: Train): void {
  const { fleet } = game;
  openTimetableWindow(windows, {
    id: `timetable-${train.id}`,
    title: `${train.name} – časy`,
    rows: () =>
      (train.orders ?? []).map((_, i) => {
        const f = orderFlags(train, i);
        return {
          name: fleet.orderName(train, i),
          travel: f.travel,
          wait: f.wait,
          measured: train.lastTravel?.[i] ?? null,
          passing: f.waypoint === true || f.via === true,
          canWait: !f.depot && !f.waypoint && !f.via,
        };
      }),
    current: () => (train.state !== 'depot' ? train.target : -1),
    lateness: () => train.lateness,
    autofill: () => train.autofill === true,
    setTimetable: (index, patch) => fleet.setTimetable(train, index, patch),
    setAutofill: (on) => fleet.setAutofill(train, on),
    clear: () => fleet.clearTimetable(train),
    hint:
      'Doba jízdy je plán cesty od předchozího příkazu. Vlak, který přijede dřív, na stanici počká, ' +
      'aby odjel podle plánu – tak se vlaky na lince rovnoměrně rozestoupí. Stání prodlouží pobyt na ' +
      'stanici. U sdíleného řádu platí časy pro celou linku.',
    subscribe: (refresh) => [game.events.on('trainsChanged', refresh), game.clock.events.on('day', refresh)],
    exists: () => fleet.trains.includes(train),
  });
}

// Časy auta, letadla nebo lodi
export function vehicleTimetable(
  game: Game,
  vehicle: Timetabled & { id: number; name: string; state: string; target: number },
  options: {
    id: string;
    stationName: (stationId: number) => string;
    inDepot: () => boolean;
    fleet: {
      setTimetable: (index: number, patch: { travel?: number | null; wait?: number | null }) => void;
      setAutofill: (on: boolean) => void;
      clear: () => void;
    };
    exists: () => boolean;
    noun: string;
  },
): TimetableSource {
  return {
    id: options.id,
    title: `${vehicle.name} – časy`,
    rows: () =>
      (vehicle.orders ?? []).map((stationId, i) => {
        const entry = timetableEntry(vehicle, i);
        return {
          name: options.stationName(stationId),
          travel: entry.travel,
          wait: entry.wait,
          measured: vehicle.lastTravel?.[i] ?? null,
          passing: false,
          canWait: true,
        };
      }),
    current: () => (options.inDepot() ? -1 : vehicle.target),
    lateness: () => vehicle.lateness,
    autofill: () => vehicle.autofill === true,
    setTimetable: options.fleet.setTimetable,
    setAutofill: options.fleet.setAutofill,
    clear: options.fleet.clear,
    hint:
      `Doba jízdy je plán cesty od předchozí zastávky. ${options.noun}, které přijede dřív, počká, ` +
      'aby odjelo podle plánu – tak se vozidla na lince rovnoměrně rozestoupí. Stání prodlouží pobyt.',
    subscribe: (refresh) => [game.events.on('vehiclesChanged', refresh), game.clock.events.on('day', refresh)],
    exists: options.exists,
  };
}

// Časy u příkazu pro popisek v řádu, např. „jízda 5 d, stání 2 d“
export function timesNote(vehicle: Timetabled, index: number): string {
  const { travel, wait } = timetableEntry(vehicle, index);
  return [
    travel !== undefined ? `jízda ${travel.toLocaleString('cs-CZ')} d` : '',
    wait !== undefined ? `stání ${wait.toLocaleString('cs-CZ')} d` : '',
  ]
    .filter(Boolean)
    .join(', ');
}
