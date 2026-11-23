import { CARGOS, type Cargo } from '../game/cargo';
import type { OrderFlags } from '../game/trains';
import { poolId, type Station } from '../world/rail';
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
  // Volby příkazů jako v OpenTTD (zatím jen vlaky): nakládání, vykládání, projet, servis v depu
  flags?: {
    get: (index: number) => OrderFlags;
    set: (index: number, patch: Omit<OrderFlags, 'depot'>) => void;
    setOrders: (orders: number[], flags: OrderFlags[]) => string | null;
    depots: () => { id: number; name: string }[];
    depotName: (depotId: number) => string;
    focusDepot: (depotId: number) => void;
    // Průjezdné body (jen vlaky): příkaz „Jet přes“ bez zastavení
    waypoints: () => { id: number; name: string }[];
    focusWaypoint: (waypointId: number) => void;
  };
  subscribe: (refresh: () => void) => (() => void)[];
  exists: () => boolean;
}

const END = -1;

// Popisky voleb příkazu za názvem zastávky, jako „[Do plna]“ v OpenTTD
function flagsText(flags: OrderFlags): string {
  const parts: string[] = [];
  if (flags.load === 'full') parts.push('Do plna');
  if (flags.load === 'none') parts.push('Nenakládat');
  if (flags.unload === 'unload') parts.push('Vyložit vše');
  if (flags.unload === 'transfer') parts.push('Překládka');
  if (flags.unload === 'none') parts.push('Nevykládat');
  if (flags.refit) parts.push(`Přestavět na ${CARGOS[flags.refit].noun}`);
  return parts.length > 0 ? `[${parts.join(', ')}]` : '';
}

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

  // Volby příkazů po řadě; u vozidel bez voleb prázdné
  const flagsOf = (): OrderFlags[] => source.orders().map((_, i) => source.flags?.get(i) ?? {});
  const save = (next: number[], nextFlags: OrderFlags[]): string | null =>
    source.flags ? source.flags.setOrders(next, nextFlags) : source.setOrders(next);

  const apply = (next: number[], nextFlags: OrderFlags[]): boolean => {
    const error = save(next, nextFlags);
    message = error;
    if (error) refresh();
    return !error;
  };

  const insert = (stationId: number, flags: OrderFlags = {}): string | null => {
    const orders = source.orders();
    const at = selected === END ? orders.length : selected;
    const next = [...orders.slice(0, at), stationId, ...orders.slice(at)];
    const current = flagsOf();
    const error = save(next, [...current.slice(0, at), flags, ...current.slice(at)]);
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
      // U spojené stanice vybere část, kam vozidlo smí (nástupiště pro vlak, zastávku pro auto…)
      pick: (station) => {
        const pool = poolId(station);
        const options = [station, ...source.stations().filter((s) => s !== station && poolId(s) === pool)];
        const part = options.find((s) => source.accepts(s) === null);
        return part ? insert(part.id) : source.accepts(station);
      },
      reject: (reason) => {
        message = reason;
        refresh();
      },
    });
  };

  function render(): HTMLElement {
    const orders = source.orders();
    const flags = flagsOf();
    if (selected >= orders.length) selected = END;
    const current = source.current();

    const row = (index: number, text: string, flagText: string): HTMLElement => {
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
        ...(flagText ? [h('span', { className: 'ottd-orders__flags' }, flagText)] : []),
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
      el.addEventListener('dblclick', () =>
        flags[index].depot
          ? source.flags?.focusDepot(orders[index])
          : flags[index].waypoint
            ? source.flags?.focusWaypoint(orders[index])
            : source.focusStation(orders[index]),
      );
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
      const nextFlags = [...flags];
      const [moved] = next.splice(from, 1);
      const [movedFlags] = nextFlags.splice(from, 1);
      const at = to > from ? to - 1 : to;
      next.splice(at, 0, moved);
      nextFlags.splice(at, 0, movedFlags);
      if (apply(next, nextFlags)) selected = at;
      refresh();
    };

    const list = h(
      'div',
      { className: 'ottd-orders__list', tabIndex: 0 },
      ...orders.map((stationId, i) => {
        if (!source.flags) {
          return row(
            i,
            `${i + 1}: Jet do ${source.stationName(stationId)}`,
            source.fullLoad(stationId) ? '[Do plna]' : '',
          );
        }
        const f = flags[i];
        if (f.depot) return row(i, `${i + 1}: Jet do ${source.flags.depotName(stationId)} na servis`, '');
        if (f.waypoint) {
          const name = source.flags.waypoints().find((w) => w.id === stationId)?.name ?? '?';
          return row(i, `${i + 1}: Jet přes ${name}`, '[průjezdný bod]');
        }
        const verb = f.via ? 'Projet' : 'Jet do';
        return row(i, `${i + 1}: ${verb} ${source.stationName(stationId)}`, f.via ? '' : flagsText(f));
      }),
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
    const flagBar = source.flags ? flagControls(source.flags) : [fullLoad];

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
    // Víc částí stejného druhu ve spojené stanici (např. dvě nástupiště) se rozliší pořadím
    const sameName = (s: Station): Station[] => stations.filter((o) => o.name === s.name);
    for (const s of stations) {
      const twins = sameName(s);
      const label = twins.length > 1 ? `${s.name} (${twins.indexOf(s) + 1})` : s.name;
      select.append(h('option', { value: String(s.id) }, label));
    }
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
      h(
        'div',
        { className: source.flags ? 'ottd-orders__bar ottd-orders__bar--flags' : 'ottd-orders__bar' },
        ...flagBar,
      ),
      h('div', { className: 'ottd-orders__bar ottd-orders__bar--main' }, skip, del, goTo, select),
      h('div', { className: warn ? 'form__hint warning' : 'form__hint' }, note),
      ...(extra ? [extra] : []),
    );

    function remove(): void {
      if (selected === END) return;
      const next = orders.filter((_, k) => k !== selected);
      const nextFlags = flags.filter((_, k) => k !== selected);
      if (apply(next, nextFlags)) refresh();
    }

    // Volby vybraného příkazu jako v OpenTTD: nakládání, vykládání, projet; a přidání servisu v depu
    function flagControls(api: NonNullable<OrdersSource['flags']>): HTMLElement[] {
      const index = selected;
      const f = index !== END ? flags[index] : undefined;
      const editable = f !== undefined && !f.depot && !f.waypoint;
      const choice = <T extends string>(
        label: string,
        title: string,
        value: T,
        values: [T, string][],
        change: (value: T) => void,
      ): HTMLElement => {
        const select = h('select', { title, disabled: !editable || f?.via === true });
        for (const [v, text] of values) select.append(h('option', { value: v, selected: v === value }, text));
        select.addEventListener('change', () => change(select.value as T));
        return h('label', { className: 'ottd-orders__choice' }, label, select);
      };
      const load = choice(
        'Nakládat',
        'Jak na vybrané zastávce nakládat',
        f?.load ?? 'normal',
        [
          ['normal', 'běžně'],
          ['full', 'do plna'],
          ['none', 'nenakládat'],
        ],
        (v) => api.set(index, { load: v === 'normal' ? undefined : v }),
      );
      const unload = choice(
        'Vykládat',
        'Jak na vybrané zastávce vykládat: překládka nechá náklad na stanici pro další vozidlo',
        f?.unload ?? 'normal',
        [
          ['normal', 'běžně'],
          ['unload', 'vyložit vše'],
          ['transfer', 'překládka'],
          ['none', 'nevykládat'],
        ],
        (v) => api.set(index, { unload: v === 'normal' ? undefined : v }),
      );
      const refit = choice(
        'Přestavět',
        'Po vyložení přestavět prázdné vagony na jiný náklad a ten naložit (za poplatek)',
        f?.refit ?? 'keep',
        [['keep', '—'], ...(Object.keys(CARGOS) as Cargo[]).map((c): [string, string] => [c, CARGOS[c].name])],
        (v) => api.set(index, { refit: v === 'keep' ? undefined : (v as Cargo) }),
      );
      const via = button(
        'Projet',
        'Stanicí projet bez zastavení (nenaloží ani nevyloží)',
        () => editable && api.set(index, { via: !f?.via }),
        !editable,
      );
      via.classList.toggle('small-button--active', f?.via === true);
      const depots = api.depots();
      const depot = h('select', { title: 'Přidat zajížďku do depa na servis', disabled: depots.length === 0 });
      depot.append(h('option', { value: '', selected: true }, 'Servis v depu ▾'));
      for (const d of depots) depot.append(h('option', { value: String(d.id) }, d.name));
      depot.addEventListener('change', () => {
        const depotId = Number(depot.value);
        depot.value = '';
        if (Number.isNaN(depotId)) return;
        const error = insert(depotId, { depot: true });
        if (error) {
          message = error;
          refresh();
        }
      });
      const waypoints = api.waypoints();
      const waypoint = h('select', {
        title: 'Přidat průjezdný bod: vlak jím projede bez zastavení, a tak si vybere trasu',
        disabled: waypoints.length === 0,
      });
      waypoint.append(h('option', { value: '', selected: true }, 'Průjezdný bod ▾'));
      for (const w of waypoints) waypoint.append(h('option', { value: String(w.id) }, w.name));
      waypoint.addEventListener('change', () => {
        const waypointId = Number(waypoint.value);
        waypoint.value = '';
        if (Number.isNaN(waypointId)) return;
        const error = insert(waypointId, { waypoint: true });
        if (error) {
          message = error;
          refresh();
        }
      });
      return [load, unload, refit, via, depot, waypoint];
    }
  }

  function refresh(): void {
    if (!windows.isOpen(id)) return;
    if (!source.exists()) windows.close(id);
    else windows.update(id, render());
  }

  const unsubscribe = [...source.subscribe(refresh), onStationPickChange(() => refresh())];
  windows.open(id, source.title, render(), {
    width: source.flags ? 480 : 380,
    onClose: () => {
      unsubscribe.forEach((off) => off());
      stopStationPick(id);
    },
  });
}
