import { editingGroups, groupPanel, groupSelect, inGroup, validFilter, type GroupFilter } from './groups';
import { SHIP_LIFETIME_YEARS } from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import {
  formatShipLoad,
  isOldShip,
  shipCargo,
  shipReliability,
  shipAge,
  shipModel,
  shipRunningCost,
  shipSellPrice,
  type Ship,
} from '../game/ships';
import { modelThumb } from '../render/icons';
import type { Station } from '../world/rail';
import { vehicleViewport } from './vehicleViewport';
import { openOrders, type OrdersSource } from './vehicleOrders';
import { liveWindow, maintenanceRows, openVehicleWindow, refitControl, type VehicleStatus } from './vehicleWindow';
import { brokenText } from '../game/reliability';
import { latenessText, openTimetableWindow, timesNote, vehicleTimetable } from './timetable';
import { h } from './dom';
import { ModelPicker } from './modelPicker';
import { formatYears } from './trainWindow';
import type { WindowManager } from './windows';

export interface ShipLinks {
  focus: (x: number, z: number) => void;
  openShipyard: (port: Station) => void;
  openStation: (port: Station) => void;
  // Pohled z můstku
  ride: (ship: Ship) => void;
}

const speedText = (v: number): string => v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });

function ports(game: Game): Station[] {
  return game.world.rail.ports();
}

function smallButton(label: string, onClick: () => void, disabled = false, title = ''): HTMLButtonElement {
  const b = h('button', { className: 'small-button', disabled, title }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function shipStateText(game: Game, ship: Ship): string {
  const { shipFleet } = game;
  const where = shipFleet.stationName(ship.portId);
  const depot = ship.toDepot ? ' (pak do loděnice)' : '';
  if (shipFleet.frozen && ship.state !== 'depot') {
    return ship.state === 'loading' ? `Kotví v zamrzlém přístavu: ${where}` : `Zamrzlá v ledu, cíl ${where}${depot}`;
  }
  if (ship.brokenDays > 0 && (ship.state === 'sailing' || ship.state === 'waiting')) return brokenText(ship);
  if (ship.servicing && ship.state === 'loading') return `Servis v loděnici: ${where}`;
  switch (ship.state) {
    case 'depot':
      return `V loděnici: ${shipFleet.stationName(ship.depotId)}`;
    case 'sailing':
      return `Pluje: ${where}${depot}`;
    case 'waiting':
      return `Čeká na volné kotviště: ${where}`;
    case 'loading':
      if (shipFleet.isFillingUp(ship)) return `Nakládá do plna: ${formatShipLoad(ship)}`;
      return `Kotví: ${where}`;
    case 'lost':
      return `Nemůže najít cestu po vodě: ${where}`;
  }
}

function shipOrders(game: Game, ship: Ship, links: ShipLinks, windows: WindowManager): OrdersSource {
  const { shipFleet } = game;
  return {
    id: `ship-orders-${ship.id}`,
    title: `${ship.name} – plavební řád`,
    vehicleName: () => ship.name,
    stopNoun: 'přístav',
    orders: () => ship.orders ?? [],
    current: () => {
      if (ship.state === 'depot') return -1;
      // V přístavu je cíl už posunutý na další přístav; aktuální je ten, kde loď kotví
      const here = ship.orders?.indexOf(ship.portId) ?? -1;
      return ship.state === 'loading' && here >= 0 ? here : ship.target;
    },
    fullLoad: (portId) => ship.fullLoad.includes(portId),
    stationName: (portId) => shipFleet.stationName(portId),
    stations: () => ports(game),
    accepts: (station) => (station.kind === 'water' ? null : 'Lodě plují jen mezi přístavy.'),
    setOrders: (orders) => shipFleet.setOrders(ship, orders),
    toggleFullLoad: (portId) => shipFleet.toggleFullLoad(ship, portId),
    canSkip: () => ship.state !== 'depot' && !ship.toDepot,
    skipTo: (index) => shipFleet.skipTo(ship, index),
    problem: (orders) => shipFleet.ordersError(orders),
    hint:
      'Loď objíždí přístavy dokola, v každém vyloží a naloží náklad. Pluje jen po souvislé vodě a pod mosty ' +
      'neproplouvá. V zimě voda zamrzá a lodě stojí v ledu až do jara.',
    focusStation: (portId) => {
      const port = shipFleet.port(portId);
      if (port) links.focus(port.x + 0.5, port.y + 0.5);
    },
    subscribe: (refresh) => [game.events.on('shipsChanged', refresh), game.clock.events.on('day', refresh)],
    exists: () => shipFleet.ships.includes(ship),
    openTimetable: () =>
      openTimetableWindow(
        windows,
        vehicleTimetable(game, ship, {
          id: `ship-timetable-${ship.id}`,
          stationName: (stationId) => shipFleet.stationName(stationId),
          inDepot: () => ship.state === 'depot',
          fleet: {
            setTimetable: (index, patch) => shipFleet.setTimetable(ship, index, patch),
            setAutofill: (on) => shipFleet.setAutofill(ship, on),
            clear: () => shipFleet.clearTimetable(ship),
          },
          exists: () => shipFleet.ships.includes(ship),
          noun: 'Plavidlo',
        }),
      ),
    timesText: (index) => timesNote(ship, index),
  };
}

function shipDetails(game: Game, ship: Ship, links: ShipLinks): HTMLElement {
  const { shipFleet } = game;
  const model = shipModel(ship);
  const today = game.clock.day;
  const old = isOldShip(ship, today);
  const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
    h('tr', {}, h('td', {}, label), h('td', { className }, value));
  const table = h(
    'table',
    { className: 'table' },
    row('Model', `${model.name} (${model.year})`),
    row('Náklad', formatShipLoad(ship), 'num'),
    row('Rychlost', `${speedText(model.speed)} dlaždic/den`, 'num'),
    row('Plavební řád', latenessText(ship), (ship.lateness ?? 0) > 0 ? 'num warning' : 'num'),
    row(
      'Stáří',
      `${formatYears(shipAge(ship, today))} z ${SHIP_LIFETIME_YEARS}${old ? ' – po životnosti' : ''}`,
      old ? 'num warning' : 'num',
    ),
    ...maintenanceRows(
      game,
      ship,
      shipReliability(ship),
      (days) => shipFleet.setServiceInterval(ship, days),
      'Poruchy jsou vypnuté, loď servis v loděnici nepotřebuje.',
    ),
    row('Provoz ročně', formatMoney(0 - shipRunningCost(ship, today)), 'num'),
    row('Příjmy letos', formatMoney(ship.income), 'num'),
    row('Provoz letos', formatMoney(0 - ship.costs), 'num'),
    row('Zisk letos', formatMoney(ship.income - ship.costs), 'num strong'),
    row('Zisk loni', formatMoney(ship.lastIncome - ship.lastCosts), 'num'),
    row('Prodejní cena', formatMoney(shipSellPrice(ship, today)), 'num'),
  );
  const yard = smallButton('Otevřít loděnici', () => {
    const port = shipFleet.port(ship.state === 'depot' ? ship.depotId : ship.portId);
    if (port) links.openShipyard(port);
  });
  return h('div', { className: 'form' }, table, h('div', { className: 'train__actions' }, yard));
}

function shipStatus(game: Game, ship: Ship): VehicleStatus {
  const text = shipStateText(game, ship);
  if (ship.state === 'depot') {
    const orders = ship.orders;
    if (!orders || orders.length < 2) return { text: `${text} – zadejte plavební řád`, moving: false };
    return {
      text: `${text} – klikněte pro vyplutí`,
      moving: false,
      action: {
        title: 'Vyplout z loděnice podle plavebního řádu',
        run: () => {
          const error = game.shipFleet.start(ship, orders);
          if (error) game.news(error);
        },
      },
    };
  }
  return { text, moving: ship.state === 'sailing' && !game.shipFleet.frozen };
}

// Okno lodi podle OpenTTD: živý pohled, tlačítka vpravo, stav dole; řád a podrobnosti ve vlastních oknech
export function openShip(windows: WindowManager, game: Game, ship: Ship, links: ShipLinks): void {
  const { shipFleet } = game;
  const subscribe = (refresh: () => void): (() => void)[] => [
    game.events.on('shipsChanged', refresh),
    game.clock.events.on('day', refresh),
  ];
  const exists = (): boolean => shipFleet.ships.includes(ship);
  const locate = (): void => {
    const p = shipFleet.position(ship);
    if (p) links.focus(p.x, p.y);
  };
  const ordersId = `ship-orders-${ship.id}`;
  const detailsId = `ship-details-${ship.id}`;
  const openYard = (): void => {
    const port = shipFleet.port(ship.state === 'depot' ? ship.depotId : ship.portId);
    if (port) links.openShipyard(port);
  };
  const viewport = vehicleViewport(
    () => {
      const p = shipFleet.position(ship);
      return p && { x: p.x, y: 0, z: p.y };
    },
    () => (ship.state === 'depot' ? 'V loděnici' : null),
  );
  openVehicleWindow(windows, {
    id: `ship-${ship.id}`,
    title: ship.name,
    viewport,
    locate,
    subscribe,
    exists,
    status: () => shipStatus(game, ship),
    buttons: () => [
      { icon: '⌖', title: 'Vycentrovat hlavní pohled na loď', onClick: locate },
      ship.state === 'depot'
        ? { icon: '⌂', title: 'Otevřít loděnici', onClick: openYard }
        : {
            icon: '⌂',
            title: 'Poslat do loděnice',
            onClick: () => shipFleet.sendToDepot(ship),
            disabled: ship.toDepot,
            active: ship.toDepot,
          },
      {
        icon: '☰',
        title: 'Plavební řád',
        onClick: () => openOrders(windows, shipOrders(game, ship, links, windows)),
        active: windows.isOpen(ordersId),
      },
      {
        icon: 'ℹ',
        title: 'Podrobnosti a hospodaření',
        onClick: () =>
          liveWindow(windows, detailsId, `${ship.name} – podrobnosti`, () => shipDetails(game, ship, links), {
            subscribe,
            exists,
          }),
        active: windows.isOpen(detailsId),
      },
      {
        icon: '🎥',
        title: 'Pohled z můstku',
        onClick: () => links.ride(ship),
        disabled: ship.state === 'depot',
      },
    ],
  });
}

// Okno přístavu: loděnice s nákupem lodí a vyplutím, lodě, které přístav obsluhují
export function openShipyard(windows: WindowManager, game: Game, port: Station, links: ShipLinks): void {
  const id = `shipyard-${port.id}`;
  const { shipFleet } = game;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  const picker = new ModelPicker();
  const pending = new Map<number, number>();

  // Cíle na stejné vodě, nejvzdálenější první
  const destinations = (): Station[] =>
    ports(game)
      .filter((p) => p.id !== port.id && shipFleet.connected(port, p))
      .sort((a, b) => Math.hypot(b.x - port.x, b.y - port.y) - Math.hypot(a.x - port.x, a.y - port.y));

  const shipRow = (ship: Ship): HTMLElement => {
    const model = shipModel(ship);
    const today = game.clock.day;
    const row = h(
      'div',
      { className: 'train' },
      h(
        'div',
        { className: 'train__info' },
        modelThumb('watercraft kit', model.model),
        h('strong', {}, ship.name),
        ` · ${model.name} · ${formatShipLoad(ship)}`,
        h('span', { className: isOldShip(ship, today) ? 'warning' : '' }, ` · ${formatYears(shipAge(ship, today))}`),
        h('div', { className: 'form__hint' }, shipStateText(game, ship)),
      ),
    );
    const detail = (label: string): HTMLButtonElement => smallButton(label, () => openShip(windows, game, ship, links));
    if (ship.state !== 'depot') {
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          smallButton('Do loděnice', () => shipFleet.sendToDepot(ship), ship.toDepot),
          smallButton('Najít', () => {
            const p = shipFleet.position(ship);
            if (p) links.focus(p.x, p.y);
          }),
          detail('Detail'),
        ),
      );
      return row;
    }
    row.append(
      h(
        'div',
        { className: 'train__actions' },
        refitControl(game, shipFleet.refitOptions(ship), shipCargo(ship), shipFleet.refitCost(ship), (c) =>
          shipFleet.refit(ship, c),
        ),
        smallButton(`Prodat (${formatMoney(shipSellPrice(ship, today))})`, () => shipFleet.sell(ship)),
      ),
    );
    const orders = ship.orders;
    if (orders) {
      row.append(
        h(
          'div',
          { className: 'form__hint' },
          `Plavební řád: ${orders.map((s) => shipFleet.stationName(s)).join(' → ')}`,
        ),
        h(
          'div',
          { className: 'train__actions' },
          detail('Upravit řád'),
          smallButton('Vyplout', () => report(shipFleet.start(ship, orders))),
        ),
      );
      return row;
    }
    const options = destinations();
    const select = h('select', {});
    for (const p of options) {
      select.append(h('option', { value: String(p.id), selected: p.id === pending.get(ship.id) }, p.name));
    }
    select.addEventListener('change', () => pending.set(ship.id, Number(select.value)));
    row.append(
      h(
        'div',
        { className: 'train__actions' },
        `${port.name} ↔`,
        select,
        smallButton(
          'Vyplout',
          () => report(shipFleet.start(ship, [port.id, Number(select.value)])),
          options.length === 0,
        ),
        detail('Více přístavů'),
      ),
    );
    return row;
  };

  const render = (): HTMLElement => {
    const models = shipFleet.available();
    const cargos = Object.keys(CARGOS) as Cargo[];
    const sorted = [...models].sort((a, b) => cargos.indexOf(a.cargo) - cargos.indexOf(b.cargo));
    const fallback = models.filter((m) => m.cargo === 'passengers').at(-1) ?? models[0];
    picker.setOptions(
      sorted.map((m) => ({
        value: m.id,
        kit: 'watercraft kit',
        model: m.model,
        name: m.name,
        details:
          `${formatMoney(m.price)} · ${m.capacity} ${CARGOS[m.cargo].unit} · ${speedText(m.speed)} dlaždic/den · ` +
          `provoz ${formatMoney(m.runningCost)}/rok`,
        group: CARGOS[m.cargo].name,
      })),
      fallback.id,
    );
    const buy = smallButton('Koupit', () =>
      report(
        shipFleet.buy(
          port,
          models.find((m) => m.id === picker.value)!,
        ),
      ),
    );
    const inDepot = shipFleet.inDepot(port);
    const away = shipFleet.basedAt(port).filter((s) => !inDepot.includes(s));
    const reachable = destinations().length;
    const ice = shipFleet.frozen ? ' · voda je zamrzlá, lodě vyplují na jaře' : '';
    return h(
      'div',
      { className: 'form' },
      h(
        'div',
        { className: 'form__hint' },
        `Přístav se 2 kotvišti · čeká ${Math.floor(port.waiting)} cestujících · ` +
          (reachable > 0 ? `po vodě dosažitelné přístavy: ${reachable}` : 'žádný jiný přístav na stejné vodě') +
          ice,
      ),
      h(
        'div',
        { className: 'train__actions' },
        picker.element,
        buy,
        smallButton('Stanice', () => links.openStation(port), false, 'Hodnocení a náklad přístavu'),
      ),
      h('h4', {}, 'V loděnici'),
      ...(inDepot.length > 0 ? inDepot.map(shipRow) : [h('div', { className: 'form__hint' }, 'Loděnice je prázdná.')]),
      ...(away.length > 0 ? [h('h4', {}, 'Plují sem'), ...away.map(shipRow)] : []),
    );
  };

  const refresh = (): void => {
    if (!game.world.rail.stations.includes(port)) windows.close(id);
    else if (windows.isOpen(id)) windows.update(id, render());
  };
  const unsubscribe = [game.events.on('shipsChanged', refresh), game.events.on('railChanged', refresh)];
  windows.open(id, `Přístav ${port.name}`, render(), {
    width: 500,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => links.focus(port.x + 0.5, port.y + 0.5),
  });
}

export function openShipList(windows: WindowManager, game: Game, links: ShipLinks): void {
  let group: GroupFilter = 'all';
  const render = (): HTMLElement => {
    const all = game.shipFleet.ships;
    if (all.length === 0) {
      return h(
        'div',
        { className: 'form__hint' },
        'Zatím nemáte žádné lodě. Kupují se v loděnici přístavu (okno Stavba přístavů, kliknutím na přístav).',
      );
    }
    const today = game.clock.day;
    group = validFilter(game, 'water', group);
    const panel = groupPanel(game, 'water', group, (value) => {
      group = value;
      refresh();
    });
    const table = h(
      'table',
      { className: 'table table--clickable' },
      h(
        'tr',
        {},
        h('th', {}, 'Loď'),
        h('th', {}, 'Stav'),
        h('th', { className: 'num' }, 'Stáří'),
        h('th', { className: 'num' }, 'Náklad'),
        h('th', { className: 'num' }, 'Zisk letos'),
        h('th', { className: 'table__group' }, 'Skupina'),
      ),
      ...all
        .filter((s) => inGroup(s, group))
        .map((s) => {
          const tr = h(
            'tr',
            { title: 'Otevřít okno lodi' },
            h('td', { className: 'table__name' }, modelThumb('watercraft kit', shipModel(s).model), s.name),
            h('td', {}, shipStateText(game, s)),
            h('td', { className: isOldShip(s, today) ? 'num warning' : 'num' }, formatYears(shipAge(s, today))),
            h('td', { className: 'num' }, formatShipLoad(s)),
            h('td', { className: 'num' }, formatMoney(s.income - s.costs)),
            h('td', {}, groupSelect(game, 'water', s)),
          );
          tr.addEventListener('click', () => openShip(windows, game, s, links));
          return tr;
        }),
    );
    return h('div', { className: 'form' }, panel, table);
  };
  const refresh = (): void => {
    if (windows.isOpen('ship-list') && !editingGroups()) windows.update('ship-list', render());
  };
  const unsubscribe = [
    game.events.on('shipsChanged', refresh),
    game.events.on('groupsChanged', refresh),
    game.clock.events.on('day', refresh),
  ];
  windows.open('ship-list', 'Lodě', render(), { width: 580, onClose: () => unsubscribe.forEach((off) => off()) });
}
