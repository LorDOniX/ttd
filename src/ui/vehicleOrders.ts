import type { Station } from '../world/rail';
import { h } from './dom';
import { onStationPickChange, startStationPick, stationPick, stopStationPick } from './stationPicker';
import type { WindowManager } from './windows';

// Jízdní řád vozidla libovolného druhu pro společné okno řádu
export interface OrdersSource {
  // Id okna řádu, např. train-orders-3
  id: string;
  title: string;
  // „Vlak 1“ v liště výběru zastávky
  vehicleName: () => string;
  // Slovník: nástupiště / zastávka / letiště / přístav
  stopNoun: string;
  orders: () => number[];
  // Zastávka, ke které vozidlo právě jede nebo u které stojí; −1 = jede do depa nebo stojí v něm
  current: () => number;
  fullLoad: (stationId: number) => boolean;
  stationName: (stationId: number) => string;
  // Zastávky, které vozidlo může obsluhovat (rozbalovací seznam „Jet do“)
  stations: () => Station[];
  // null = vozidlo zastávku obsluhovat může, jinak důvod
  accepts: (station: Station) => string | null;
  setOrders: (orders: number[]) => string | null;
  toggleFullLoad: (stationId: number) => void;
  // Přeskočení na zastávku; canSkip = false např. ve vozidle v depu
  canSkip: () => boolean;
  skipTo: (index: number) => void;
  // Problém celého řádu (nepropojené zastávky…) nebo null
  problem: (orders: number[]) => string | null;
  hint: string;
  focusStation: (stationId: number) => void;
  // Doplňky pod řádem (sdílení řádu u vlaků)
  extra?: () => HTMLElement | null;
  subscribe: (refresh: () => void) => (() => void)[];
  exists: () => boolean;
}

const END = -1;

function button(label: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = h('button', { className: 'small-button', title, disabled }, label);
  b.addEventListener('click', onClick);
  return b;
}

// Okno jízdního řádu podle OpenTTD: seznam příkazů „Jet do …“ s ▶▶ u aktuálního, výběr řádku,
// Přeskočit / Smazat / Jet do (výběr zastávky v mapě), Do plna pro vybranou zastávku, přetahování řádků
export function openOrders(windows: WindowManager, source: OrdersSource): void {
  const { id } = source;
  if (windows.raise(id)) return;
  // Vybraný řádek; END = „Konec řádu“ (nové zastávky se přidávají před vybraný řádek)
  let selected = END;
  let message: string | null = null;
  let dragFrom: number | null = null;

  const apply = (next: number[]): boolean => {
    const error = source.setOrders(next);
    message = error;
    if (error) refresh();
    return !error;
  };

  const insert = (stationId: number): string | null => {
    const orders = source.orders();
    const at = selected === END ? orders.length : selected;
    const next = [...orders.slice(0, at), stationId, ...orders.slice(at)];
    const error = source.setOrders(next);
    if (error) return error;
    if (selected !== END) selected++;
    message = null;
    refresh();
    return null;
  };

  const picking = (): boolean => stationPick()?.owner === id;
  const togglePick = (): void => {
    if (picking()) {
      stopStationPick(id);
      return;
    }
    message = null;
    startStationPick({
      owner: id,
      prompt: `${source.vehicleName()}: klikněte na ${source.stopNoun} v mapě, kam má jet`,
      pick: (station) => source.accepts(station) ?? insert(station.id),
      reject: (reason) => {
        message = reason;
        refresh();
      },
    });
  };

  function render(): HTMLElement {
    const orders = source.orders();
    if (selected >= orders.length) selected = END;
    const current = source.current();

    const row = (index: number, text: string, flags: string): HTMLElement => {
      const el = h(
        'div',
        {
          className: [
            'ottd-orders__row',
            index === selected ? 'ottd-orders__row--selected' : '',
            index !== END && index === current ? 'ottd-orders__row--current' : '',
          ]
            .filter(Boolean)
            .join(' '),
          title: index === END ? '' : 'Dvojklikem zobrazit na mapě, přetažením přesunout',
        },
        h('span', { className: 'ottd-orders__marker' }, index !== END && index === current ? '▶▶' : ''),
        h('span', { className: 'ottd-orders__text' }, text),
        ...(flags ? [h('span', { className: 'ottd-orders__flags' }, flags)] : []),
      );
      el.addEventListener('click', () => {
        selected = index;
        message = null;
        refresh();
      });
      if (index === END) {
        el.addEventListener('dragover', (e) => e.preventDefault());
        el.addEventListener('drop', () => move(orders.length));
        return el;
      }
      el.draggable = true;
      el.addEventListener('dblclick', () => source.focusStation(orders[index]));
      el.addEventListener('dragstart', (e) => {
        dragFrom = index;
        e.dataTransfer?.setData('text/plain', String(index));
      });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        move(index);
      });
      return el;
    };

    // Přesune přetažený řádek před cílový řádek
    const move = (to: number): void => {
      const from = dragFrom;
      dragFrom = null;
      if (from === null || from === to || from + 1 === to) return;
      const next = [...orders];
      const [moved] = next.splice(from, 1);
      const at = to > from ? to - 1 : to;
      next.splice(at, 0, moved);
      if (apply(next)) selected = at;
      refresh();
    };

    const list = h(
      'div',
      { className: 'ottd-orders__list', tabIndex: 0 },
      ...orders.map((stationId, i) =>
        row(i, `${i + 1}: Jet do ${source.stationName(stationId)}`, source.fullLoad(stationId) ? '[Do plna]' : ''),
      ),
      row(END, '– – Konec řádu – –', ''),
    );
    list.addEventListener('keydown', (e) => {
      // Šipky a Delete patří seznamu, ne zkratkám hry (posun mapy, zavření oken)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Delete') e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...orders.map((_, i) => i), END];
        const at = rows.indexOf(selected);
        selected = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
        refresh();
      } else if (e.key === 'Delete' && selected !== END) {
        remove();
      }
    });

    const chosen = selected !== END ? orders[selected] : undefined;
    const fullLoad = button(
      'Do plna',
      'Na vybrané zastávce počkat, dokud se vozidlo nenaplní',
      () => chosen !== undefined && source.toggleFullLoad(chosen),
      chosen === undefined,
    );
    fullLoad.classList.toggle('small-button--active', chosen !== undefined && source.fullLoad(chosen));

    const skipTarget = selected !== END && selected !== current ? selected : (current + 1) % Math.max(1, orders.length);
    const skip = button(
      'Přeskočit',
      selected !== END && selected !== current
        ? 'Jet rovnou na vybranou zastávku'
        : 'Přeskočit aktuální zastávku a jet na další',
      () => source.skipTo(skipTarget),
      !source.canSkip() || orders.length < 2,
    );
    const del = button('Smazat', 'Smazat vybraný příkaz (Delete)', () => remove(), selected === END);
    const goTo = button(
      'Jet do',
      `Přidat zastávku kliknutím na ${source.stopNoun} v mapě (před vybraný řádek); Esc výběr ukončí`,
      togglePick,
    );
    goTo.classList.toggle('small-button--active', picking());
    goTo.classList.add('ottd-orders__goto');

    // Rozbalovací náhrada klikání do mapy
    const stations = source.stations().sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    const select = h('select', { title: 'Přidat zastávku ze seznamu', disabled: stations.length === 0 });
    select.append(h('option', { value: '', selected: true }, '▾'));
    for (const s of stations) select.append(h('option', { value: String(s.id) }, s.name));
    select.addEventListener('change', () => {
      const stationId = Number(select.value);
      select.value = '';
      if (!Number.isNaN(stationId)) {
        const error = insert(stationId);
        if (error) {
          message = error;
          refresh();
        }
      }
    });

    // Odmítnutí má přednost, při výběru v mapě nápověda k výběru, jinak problém řádu nebo obecná nápověda
    const problem = picking() ? null : orders.length > 0 ? source.problem(orders) : null;
    const pickInfo = `Klikněte v mapě na ${source.stopNoun}. Přidá se ${selected === END ? 'na konec řádu' : `před příkaz ${selected + 1}`}. Esc nebo „Jet do“ výběr ukončí.`;
    const note = message ?? (picking() ? pickInfo : (problem ?? source.hint));
    const warn = message !== null || problem !== null;
    const extra = source.extra?.() ?? null;
    return h(
      'div',
      { className: 'ottd-orders' },
      list,
      h('div', { className: 'ottd-orders__bar' }, fullLoad),
      h('div', { className: 'ottd-orders__bar ottd-orders__bar--main' }, skip, del, goTo, select),
      h('div', { className: warn ? 'form__hint warning' : 'form__hint' }, note),
      ...(extra ? [extra] : []),
    );

    function remove(): void {
      if (selected === END) return;
      const next = orders.filter((_, k) => k !== selected);
      if (apply(next)) refresh();
    }
  }

  function refresh(): void {
    if (!windows.isOpen(id)) return;
    if (!source.exists()) windows.close(id);
    else windows.update(id, render());
  }

  const unsubscribe = [...source.subscribe(refresh), onStationPickChange(() => refresh())];
  windows.open(id, source.title, render(), {
    width: 380,
    onClose: () => {
      unsubscribe.forEach((off) => off());
      stopStationPick(id);
    },
  });
}
