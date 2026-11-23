import { latenessText, openTimetable } from './timetable';
import { editingGroups, groupPanel, groupSelect, inGroup, validFilter, type GroupFilter } from './groups';
import { TRAIN_LIFETIME_YEARS } from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import {
  formatLoad,
  isOld,
  nextStop,
  orderFlags,
  ordersError,
  sellPrice,
  trainAge,
  trainLength,
  trainModel,
  yearlyRunningCost,
  type Train,
} from '../game/trains';
import { modelThumb } from '../render/icons';
import type { Depot } from '../world/rail';
import { pointAt } from '../world/route';
import { vehicleViewport } from './vehicleViewport';
import { openOrders, type OrdersSource } from './vehicleOrders';
import { liveWindow, maintenanceRows, openVehicleWindow, type VehicleStatus } from './vehicleWindow';
import { brokenText } from '../game/reliability';
import { h } from './dom';
import type { WindowManager } from './windows';

export function stateText(game: Game, train: Train): string {
  if (train.brokenDays > 0) return brokenText(train);
  if (train.servicing && train.state === 'running') return `Jede na servis: Depo ${train.servicing.depotId + 1}`;
  const target = train.target === -1 ? 'depo' : train.orders ? game.fleet.orderName(train, train.target) : '';
  switch (train.state) {
    case 'depot':
      return train.serviceUntil !== undefined ? 'Servis v depu' : 'V depu';
    case 'running':
      return game.fleet.isBlocked(train) ? `Čeká na volnou trať: ${target}` : `Jede: ${target}`;
    case 'loading':
      if (game.fleet.isFillingUp(train)) return `Nakládá do plna: ${formatLoad(train)}`;
      return `Ve stanici, další cíl: ${
        train.target === -1 ? 'depo' : train.orders ? game.fleet.orderName(train, nextStop(train)) : ''
      }`;
    case 'lost':
      return `Nemůže najít cestu: ${target}`;
  }
}

export interface TrainLinks {
  focus: (x: number, z: number) => void;
  openDepot: (depot: Depot) => void;
  // Pohled z kabiny strojvedoucího
  ride: (train: Train) => void;
}

export function formatYears(age: number): string {
  const n = Math.floor(age);
  return `${n} ${n === 1 ? 'rok' : n >= 2 && n <= 4 ? 'roky' : 'let'}`;
}

// Délka v dlaždicích, např. „3 dlaždice“, „3,5 dlaždice“, „5 dlaždic“
export function formatTiles(length: number): string {
  const text = length.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
  return `${text} ${Number.isInteger(length) && length >= 5 ? 'dlaždic' : 'dlaždice'}`;
}

// Upozornění, že souprava přesahuje některá nástupiště z jízdního řádu, jinak null
export function shortStationsWarning(game: Game, train: Train): string | null {
  const short = game.fleet.shortStations(train);
  if (short.length === 0) return null;
  return (
    `Vlak (${formatTiles(trainLength(train))}) je delší než nástupiště ${short.map((s) => s.name).join(', ')} – ` +
    'vagony mimo nástupiště nenaloží ani nevyloží a ocas vlaku blokuje kolej za ním.'
  );
}

function depotOf(game: Game, train: Train): Depot | undefined {
  return game.world.rail.depots.find((d) => d.id === train.depotId);
}

// Střed hlavy vlaku na trati, v depu poloha depa
function trainPosition(game: Game, train: Train): [number, number] | null {
  if (train.state !== 'depot' && train.path.length > 0) return pointAt(train.path, train.pos);
  const depot = depotOf(game, train);
  return depot ? [depot.x + 0.5, depot.y + 0.5] : null;
}

// Sdílený jízdní řád: připojení k řádu jiného vlaku nebo odpojení od linky
function sharingEditor(game: Game, train: Train, choice: { train: number | null }): HTMLElement {
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  if (train.orderGroup !== null) {
    const others = game.fleet.lineOf(train).filter((t) => t !== train);
    const leave = h('button', { className: 'small-button', textContent: 'Zrušit sdílení' });
    leave.addEventListener('click', () => game.fleet.unshareOrders(train));
    return h(
      'div',
      { className: 'train__actions' },
      `Linka ${train.orderGroup}: řád sdílí s ${others.map((t) => t.name).join(', ') || 'žádným vlakem'}`,
      leave,
    );
  }
  const candidates = game.fleet.trains.filter((t) => t !== train && t.orders);
  if (candidates.length === 0) return h('div', {});
  const select = h('select', {});
  for (const t of candidates) {
    select.append(h('option', { value: String(t.id), selected: t.id === choice.train }, t.name));
  }
  select.addEventListener('change', () => (choice.train = Number(select.value)));
  const share = h('button', {
    className: 'small-button',
    textContent: 'Sdílet řád',
    title: 'Vlak převezme jízdní řád vybraného vlaku; změna řádu pak platí pro oba',
  });
  share.addEventListener('click', () => {
    const other = game.fleet.trains.find((t) => t.id === Number(select.value));
    if (other) report(game.fleet.shareOrders(train, other));
  });
  return h('div', { className: 'train__actions' }, select, share);
}

// Jízdní řád vlaku pro společné okno řádu
function trainOrders(windows: WindowManager, game: Game, train: Train, links: TrainLinks): OrdersSource {
  const { fleet } = game;
  const shareChoice = { train: null as number | null };
  return {
    id: `train-orders-${train.id}`,
    title: `${train.name} – jízdní řád`,
    vehicleName: () => train.name,
    stopNoun: 'nástupiště',
    orders: () => train.orders ?? [],
    current: () => (train.state === 'depot' ? -1 : train.target),
    fullLoad: (stationId) => fleet.waitsForFullLoad(train, stationId),
    stationName: (stationId) => fleet.stationName(stationId),
    stations: () => game.world.rail.stations.filter((s) => s.kind === undefined),
    accepts: (station) => (station.kind === undefined ? null : 'Vlak staví jen na železničních nástupištích.'),
    setOrders: (orders) => fleet.setOrders(train, orders),
    flags: {
      get: (index) => orderFlags(train, index),
      set: (index, patch) => fleet.setOrderFlags(train, index, patch),
      setOrders: (orders, flags) => fleet.setOrders(train, orders, flags),
      depots: () => game.world.rail.depots.map((d) => ({ id: d.id, name: `Depo ${d.id + 1}` })),
      depotName: (depotId) => `depa ${depotId + 1}`,
      focusDepot: (depotId) => {
        const depot = fleet.depotById(depotId);
        if (depot) links.focus(depot.x + 0.5, depot.y + 0.5);
      },
      waypoints: () => game.world.rail.waypoints.map((w) => ({ id: w.id, name: w.name })),
      openTimetable: () => openTimetable(windows, game, train),
      focusWaypoint: (waypointId) => {
        const waypoint = fleet.waypointById(waypointId);
        if (waypoint) links.focus(waypoint.x + 0.5, waypoint.y + 0.5);
      },
    },
    toggleFullLoad: (stationId) => fleet.toggleFullLoad(train, stationId),
    canSkip: () => train.state !== 'depot' && !train.renewing,
    skipTo: (index) => fleet.skipTo(train, index),
    problem: (orders) =>
      ordersError(orders, train.orderFlags) ??
      fleet.routeError(orders, train.orderFlags) ??
      shortStationsWarning(game, train),
    hint:
      'Vlak objíždí příkazy dokola. U vybraného příkazu nastavíte nakládání (do plna, nenakládat), ' +
      'vykládání (vyložit vše, překládka pro další vozidlo, nevykládat), přestavbu prázdných vagonů ' +
      'na jiný náklad (po vyložení, za poplatek) nebo „Projet“ bez zastavení. ' +
      '„Servis v depu“ přidá zajížďku do depa, „Průjezdný bod“ cestu přes bod na trati (bez zastavení).',
    focusStation: (stationId) => {
      const station = game.world.rail.stations.find((s) => s.id === stationId);
      if (station) links.focus(station.x + 0.5, station.y + 0.5);
    },
    extra: () => sharingEditor(game, train, shareChoice),
    subscribe: (refresh) => [game.events.on('trainsChanged', refresh), game.clock.events.on('day', refresh)],
    exists: () => fleet.trains.includes(train),
  };
}

// Interval servisu s tlačítky −/+ jako v okně podrobností vozidla v OpenTTD
// Podrobnosti vlaku: model, stáří, hospodaření, obnova
function trainDetails(game: Game, train: Train, links: TrainLinks): HTMLElement {
  const model = trainModel(train);
  const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
    h('tr', {}, h('td', {}, label), h('td', { className }, value));
  const speed = (v: number): string => v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
  const today = game.clock.day;
  const old = isOld(train, today);
  const warning = shortStationsWarning(game, train);
  const table = h(
    'table',
    { className: 'table' },
    row('Model', `${model.name} (${model.year})`),
    row('Náklad', formatLoad(train), 'num'),
    row(
      'Délka',
      `${formatTiles(trainLength(train))} (${train.wagons} ${train.wagons === 1 ? 'vagon' : train.wagons >= 2 && train.wagons <= 4 ? 'vagony' : 'vagonů'})`,
      warning ? 'num warning' : 'num',
    ),
    row('Rychlost', `${speed(train.speed)} / ${speed(model.speed)} dlaždic/den`, 'num'),
    row('Jízdní řád', latenessText(train), (train.lateness ?? 0) > 0 ? 'num warning' : 'num'),
    row(
      'Stáří',
      `${formatYears(trainAge(train, today))} z ${TRAIN_LIFETIME_YEARS}${old ? ' – po životnosti' : ''}`,
      old ? 'num warning' : 'num',
    ),
    ...maintenanceRows(
      game,
      train,
      model.reliability,
      (days) => game.fleet.setServiceInterval(train, days),
      'Poruchy jsou vypnuté, vlak na servis nejezdí.',
    ),
    row('Provoz ročně', formatMoney(0 - yearlyRunningCost(train, today)), 'num'),
    row('Příjmy letos', formatMoney(train.income), 'num'),
    row('Provoz letos', formatMoney(0 - train.costs), 'num'),
    row('Zisk letos', formatMoney(train.income - train.costs), 'num strong'),
    row('Zisk loni', formatMoney(train.lastIncome - train.lastCosts), 'num'),
    row('Prodejní cena', formatMoney(sellPrice(train, today)), 'num'),
  );
  const depot = h('button', { className: 'small-button', textContent: 'Otevřít depo' });
  depot.addEventListener('click', () => {
    const d = depotOf(game, train);
    if (d) links.openDepot(d);
  });
  const offer = game.fleet.renewalOffer(train);
  const renew = h('button', {
    className: 'small-button',
    textContent: `Obnovit (${formatMoney(offer.cost)})`,
    title: `Nová lokomotiva ${offer.model.name}, vagony a jízdní řád zůstanou. Jedoucí vlak zajede do depa a pak pokračuje.`,
    disabled: train.renewing,
  });
  renew.addEventListener('click', () => {
    const error = game.fleet.requestRenewal(train);
    if (error) game.news(error);
  });
  return h(
    'div',
    { className: 'form' },
    table,
    ...(warning ? [h('div', { className: 'form__hint warning' }, warning)] : []),
    h('div', { className: 'train__actions' }, depot, renew),
  );
}

function trainStatus(game: Game, train: Train): VehicleStatus {
  const text = train.renewing ? `${stateText(game, train)} (na obnovu)` : stateText(game, train);
  if (train.state === 'depot') {
    const orders = train.orders;
    if (!orders || orders.length < 2) return { text: `${text} – zadejte jízdní řád`, moving: false };
    return {
      text: `${text} – klikněte pro výjezd`,
      moving: false,
      action: {
        title: 'Vypravit vlak z depa podle jízdního řádu',
        run: () => {
          const error = game.fleet.start(train, orders);
          if (error) game.news(error);
        },
      },
    };
  }
  const moving = train.state === 'running' && !game.fleet.isBlocked(train);
  const speed = train.speed.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
  return { text: moving ? `${text}, ${speed} dl./den` : text, moving };
}

// Okno vlaku podle OpenTTD: živý pohled, tlačítka vpravo, stav dole; řád a podrobnosti ve vlastních oknech
export function openTrain(windows: WindowManager, game: Game, train: Train, links: TrainLinks): void {
  const { fleet } = game;
  const subscribe = (refresh: () => void): (() => void)[] => [
    game.events.on('trainsChanged', refresh),
    game.clock.events.on('day', refresh),
  ];
  const exists = (): boolean => fleet.trains.includes(train);
  const locate = (): void => {
    const p = trainPosition(game, train);
    if (p) links.focus(...p);
  };
  const ordersId = `train-orders-${train.id}`;
  const detailsId = `train-details-${train.id}`;
  // Okénko se při obnově obsahu vkládá znovu tentýž prvek, obraz se tak nepřerušuje
  const viewport = vehicleViewport(
    () => {
      const p = trainPosition(game, train);
      return p && { x: p[0], y: 0, z: p[1] };
    },
    () => (train.state === 'depot' ? 'V depu' : null),
  );
  openVehicleWindow(windows, {
    id: `train-${train.id}`,
    title: train.name,
    viewport,
    locate,
    subscribe,
    exists,
    status: () => trainStatus(game, train),
    buttons: () => [
      { icon: '⌖', title: 'Vycentrovat hlavní pohled na vlak', onClick: locate },
      train.state === 'depot'
        ? {
            icon: '⌂',
            title: 'Otevřít depo',
            onClick: () => {
              const d = depotOf(game, train);
              if (d) links.openDepot(d);
            },
          }
        : {
            icon: '⌂',
            title: 'Poslat do depa',
            onClick: () => fleet.sendToDepot(train),
            disabled: train.target === -1,
            active: train.target === -1,
          },
      {
        icon: '☰',
        title: 'Jízdní řád',
        onClick: () => openOrders(windows, trainOrders(windows, game, train, links)),
        active: windows.isOpen(ordersId),
      },
      {
        icon: 'ℹ',
        title: 'Podrobnosti a hospodaření',
        onClick: () =>
          liveWindow(windows, detailsId, `${train.name} – podrobnosti`, () => trainDetails(game, train, links), {
            subscribe,
            exists,
          }),
        active: windows.isOpen(detailsId),
      },
      {
        icon: '🎥',
        title: 'Pohled z kabiny strojvedoucího',
        onClick: () => links.ride(train),
        disabled: train.state === 'depot',
      },
    ],
  });
}

// Seznam všech vlaků, filtrovatelný podle nákladu a linky; kliknutím na řádek se otevře okno vlaku
export function openTrainList(windows: WindowManager, game: Game, links: TrainLinks): void {
  let filter: Cargo | null = null;
  let line: number | null = null;
  let group: GroupFilter = 'all';
  const render = (): HTMLElement => {
    const all = game.fleet.trains;
    if (all.length === 0) return h('div', { className: 'form__hint' }, 'Zatím nemáte žádné vlaky.');
    const used = (Object.keys(CARGOS) as Cargo[]).filter((c) => all.some((t) => t.cargo === c));
    if (filter && !used.includes(filter)) filter = null;
    const lines = [...new Set(all.map((t) => t.orderGroup).filter((g): g is number => g !== null))].sort(
      (a, b) => a - b,
    );
    if (line !== null && !lines.includes(line)) line = null;
    group = validFilter(game, 'train', group);
    const trains = all.filter(
      (t) => (!filter || t.cargo === filter) && (line === null || t.orderGroup === line) && inGroup(t, group),
    );
    const panel = groupPanel(game, 'train', group, (value) => {
      group = value;
      refresh();
    });
    const filterButton = (label: string, value: Cargo | null): HTMLButtonElement => {
      const b = h('button', { className: 'small-button', textContent: label });
      b.classList.toggle('small-button--active', filter === value);
      b.addEventListener('click', () => {
        filter = value;
        refresh();
      });
      return b;
    };
    const lineButton = (label: string, value: number | null): HTMLButtonElement => {
      const b = h('button', { className: 'small-button', textContent: label });
      b.classList.toggle('small-button--active', line === value);
      b.addEventListener('click', () => {
        line = value;
        refresh();
      });
      return b;
    };
    const cargoFilters =
      used.length > 1
        ? h(
            'div',
            { className: 'train__actions' },
            'Náklad:',
            filterButton(`Vše (${all.length})`, null),
            ...used.map((c) => filterButton(`${CARGOS[c].name} (${all.filter((t) => t.cargo === c).length})`, c)),
          )
        : null;
    const lineFilters =
      lines.length > 0
        ? h(
            'div',
            { className: 'train__actions' },
            'Linka:',
            lineButton('Vše', null),
            ...lines.map((g) => lineButton(`${g} (${all.filter((t) => t.orderGroup === g).length})`, g)),
          )
        : null;
    const filters =
      cargoFilters || lineFilters
        ? h('div', { className: 'form' }, ...[cargoFilters, lineFilters].filter((f) => f !== null))
        : null;
    const table = h(
      'table',
      { className: 'table table--clickable' },
      h(
        'tr',
        {},
        h('th', {}, 'Vlak'),
        h('th', {}, 'Stav'),
        h('th', { className: 'num' }, 'Stáří'),
        h('th', { className: 'num' }, 'Náklad'),
        h('th', { className: 'num' }, 'Zisk letos'),
        h('th', { className: 'table__group' }, 'Skupina'),
      ),
      ...trains.map((t) => {
        const today = game.clock.day;
        const tr = h(
          'tr',
          { title: 'Otevřít okno vlaku' },
          h(
            'td',
            { className: 'table__name' },
            modelThumb('train kit', trainModel(t).model),
            t.orderGroup === null ? t.name : `${t.name} · linka ${t.orderGroup}`,
          ),
          h('td', {}, stateText(game, t)),
          h('td', { className: isOld(t, today) ? 'num warning' : 'num' }, formatYears(trainAge(t, today))),
          h('td', { className: 'num' }, formatLoad(t)),
          h('td', { className: 'num' }, formatMoney(t.income - t.costs)),
          h('td', {}, groupSelect(game, 'train', t)),
        );
        tr.addEventListener('click', () => openTrain(windows, game, t, links));
        return tr;
      }),
    );
    return h('div', { className: 'form' }, panel, ...(filters ? [filters] : []), table);
  };

  const refresh = (): void => {
    if (windows.isOpen('train-list') && !editingGroups()) windows.update('train-list', render());
  };
  const unsubscribe = [
    game.events.on('trainsChanged', refresh),
    game.events.on('groupsChanged', refresh),
    game.clock.events.on('day', refresh),
  ];
  const options = { width: 600, onClose: () => unsubscribe.forEach((off) => off()) };
  windows.open('train-list', 'Vlaky', render(), options);
}
