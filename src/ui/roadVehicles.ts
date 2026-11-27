import { editingGroups, groupPanel, groupSelect, inGroup, validFilter, type GroupFilter } from './groups';
import { ROAD_VEHICLE_LIFETIME_YEARS } from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import {
  formatVehicleLoad,
  isOldVehicle,
  roadVehicleReliability,
  roadVehicleModel,
  vehicleAge,
  vehicleCargo,
  vehicleRunningCost,
  vehicleSellPrice,
  type RoadVehicle,
} from '../game/roadVehicles';
import { modelThumb } from '../render/icons';
import type { Depot, Station } from '../world/rail';
import { vehicleViewport } from './vehicleViewport';
import { openOrders, type OrdersSource } from './vehicleOrders';
import {
  destinationRows,
  liveWindow,
  maintenanceRows,
  openVehicleWindow,
  refitControl,
  type VehicleStatus,
} from './vehicleWindow';
import { brokenText } from '../game/reliability';
import { latenessText, openTimetableWindow, timesNote, vehicleTimetable } from './timetable';
import { h } from './dom';
import { ModelPicker } from './modelPicker';
import { formatYears } from './trainWindow';
import type { WindowManager } from './windows';

export interface VehicleLinks {
  focus: (x: number, z: number) => void;
  openRoadDepot: (depot: Depot) => void;
  // Pohled z kabiny řidiče
  ride: (vehicle: RoadVehicle) => void;
}

const speedText = (v: number): string => v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });

function roadStops(game: Game): Station[] {
  return game.world.rail.stations.filter((s) => s.kind === 'road');
}

function smallButton(label: string, onClick: () => void, disabled = false, title = ''): HTMLButtonElement {
  const b = h('button', { className: 'small-button', disabled, title }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function vehicleStateText(game: Game, vehicle: RoadVehicle): string {
  const { roadFleet } = game;
  const orders = vehicle.orders;
  const target = vehicle.target === -1 ? 'garáž' : orders ? roadFleet.stationName(orders[vehicle.target]) : '';
  if (vehicle.brokenDays > 0 && vehicle.state === 'running') return brokenText(vehicle);
  if (vehicle.servicing !== undefined && vehicle.state === 'running') return 'Jede na servis do garáže';
  switch (vehicle.state) {
    case 'depot':
      return 'V garáži';
    case 'running':
      return `Jede: ${target}`;
    case 'loading':
      if (roadFleet.isFillingUp(vehicle)) return `Nakládá do plna: ${formatVehicleLoad(vehicle)}`;
      return `Na zastávce ${target}`;
    case 'lost':
      return `Nemůže najít cestu: ${target}`;
  }
}

function roadOrders(game: Game, vehicle: RoadVehicle, links: VehicleLinks, windows: WindowManager): OrdersSource {
  const { roadFleet } = game;
  return {
    id: `vehicle-orders-${vehicle.id}`,
    title: `${vehicle.name} – jízdní řád`,
    vehicleName: () => vehicle.name,
    stopNoun: 'zastávku aut',
    orders: () => vehicle.orders ?? [],
    current: () => (vehicle.state === 'depot' ? -1 : vehicle.target),
    fullLoad: (stationId) => vehicle.fullLoad.includes(stationId),
    stationName: (stationId) => roadFleet.stationName(stationId),
    stations: () => roadStops(game),
    accepts: (station) => (station.kind === 'road' ? null : 'Auta zastavují jen na zastávkách aut.'),
    setOrders: (orders) => roadFleet.setOrders(vehicle, orders),
    toggleFullLoad: (stationId) => roadFleet.toggleFullLoad(vehicle, stationId),
    canSkip: () => vehicle.state !== 'depot',
    skipTo: (index) => roadFleet.skipTo(vehicle, index),
    problem: (orders) => roadFleet.ordersError(orders),
    hint: 'Auto objíždí zastávky dokola, na každé vyloží a naloží náklad. Zastavuje jen na zastávkách aut.',
    focusStation: (stationId) => {
      const station = game.world.rail.stations.find((s) => s.id === stationId);
      if (station) links.focus(station.x + 0.5, station.y + 0.5);
    },
    subscribe: (refresh) => [game.events.on('vehiclesChanged', refresh), game.clock.events.on('day', refresh)],
    exists: () => roadFleet.vehicles.includes(vehicle),
    openTimetable: () =>
      openTimetableWindow(
        windows,
        vehicleTimetable(game, vehicle, {
          id: `vehicle-timetable-${vehicle.id}`,
          stationName: (stationId) => roadFleet.stationName(stationId),
          inDepot: () => vehicle.state === 'depot',
          fleet: {
            setTimetable: (index, patch) => roadFleet.setTimetable(vehicle, index, patch),
            setAutofill: (on) => roadFleet.setAutofill(vehicle, on),
            clear: () => roadFleet.clearTimetable(vehicle),
          },
          exists: () => roadFleet.vehicles.includes(vehicle),
          noun: 'Auto',
        }),
      ),
    timesText: (index) => timesNote(vehicle, index),
  };
}

function roadDetails(game: Game, vehicle: RoadVehicle, links: VehicleLinks): HTMLElement {
  const { roadFleet } = game;
  const model = roadVehicleModel(vehicle);
  const today = game.clock.day;
  const old = isOldVehicle(vehicle, today);
  const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
    h('tr', {}, h('td', {}, label), h('td', { className }, value));
  const table = h(
    'table',
    { className: 'table' },
    row('Model', `${model.name} (${model.year})`),
    row('Náklad', formatVehicleLoad(vehicle), 'num'),
    ...destinationRows(game, vehicle, row),
    row('Rychlost', `${speedText(model.speed)} dlaždic/den`, 'num'),
    row('Jízdní řád', latenessText(vehicle), (vehicle.lateness ?? 0) > 0 ? 'num warning' : 'num'),
    row(
      'Stáří',
      `${formatYears(vehicleAge(vehicle, today))} z ${ROAD_VEHICLE_LIFETIME_YEARS}${old ? ' – po životnosti' : ''}`,
      old ? 'num warning' : 'num',
    ),
    ...maintenanceRows(
      game,
      vehicle,
      roadVehicleReliability(vehicle),
      (days) => roadFleet.setServiceInterval(vehicle, days),
      'Poruchy jsou vypnuté, auto do garáže na servis nejezdí.',
    ),
    row('Provoz ročně', formatMoney(0 - vehicleRunningCost(vehicle, today)), 'num'),
    row('Příjmy letos', formatMoney(vehicle.income), 'num'),
    row('Provoz letos', formatMoney(0 - vehicle.costs), 'num'),
    row('Zisk letos', formatMoney(vehicle.income - vehicle.costs), 'num strong'),
    row('Zisk loni', formatMoney(vehicle.lastIncome - vehicle.lastCosts), 'num'),
    row('Prodejní cena', formatMoney(vehicleSellPrice(vehicle, today)), 'num'),
  );
  const garage = smallButton('Otevřít garáž', () => {
    const depot = roadFleet.depot(vehicle);
    if (depot) links.openRoadDepot(depot);
  });
  return h('div', { className: 'form' }, table, h('div', { className: 'train__actions' }, garage));
}

function roadStatus(game: Game, vehicle: RoadVehicle): VehicleStatus {
  const text = vehicleStateText(game, vehicle);
  if (vehicle.state === 'depot') {
    const orders = vehicle.orders;
    if (!orders || orders.length < 2) return { text: `${text} – zadejte jízdní řád`, moving: false };
    return {
      text: `${text} – klikněte pro výjezd`,
      moving: false,
      action: {
        title: 'Vypravit auto z garáže podle jízdního řádu',
        run: () => {
          const error = game.roadFleet.start(vehicle, orders);
          if (error) game.news(error);
        },
      },
    };
  }
  return { text, moving: vehicle.state === 'running' };
}

// Okno auta podle OpenTTD: živý pohled, tlačítka vpravo, stav dole; řád a podrobnosti ve vlastních oknech
export function openRoadVehicle(windows: WindowManager, game: Game, vehicle: RoadVehicle, links: VehicleLinks): void {
  const { roadFleet } = game;
  const subscribe = (refresh: () => void): (() => void)[] => [
    game.events.on('vehiclesChanged', refresh),
    game.clock.events.on('day', refresh),
  ];
  const exists = (): boolean => roadFleet.vehicles.includes(vehicle);
  const locate = (): void => {
    const p = roadFleet.position(vehicle);
    if (p) links.focus(p.x, p.y);
  };
  const ordersId = `vehicle-orders-${vehicle.id}`;
  const detailsId = `vehicle-details-${vehicle.id}`;
  const viewport = vehicleViewport(
    () => {
      const p = roadFleet.position(vehicle);
      return p && { x: p.x, y: 0, z: p.y };
    },
    () => (vehicle.state === 'depot' ? 'V garáži' : null),
  );
  openVehicleWindow(windows, {
    id: `vehicle-${vehicle.id}`,
    title: vehicle.name,
    viewport,
    locate,
    subscribe,
    exists,
    status: () => roadStatus(game, vehicle),
    buttons: () => [
      { icon: '⌖', title: 'Vycentrovat hlavní pohled na auto', onClick: locate },
      vehicle.state === 'depot'
        ? {
            icon: '⌂',
            title: 'Otevřít garáž',
            onClick: () => {
              const depot = roadFleet.depot(vehicle);
              if (depot) links.openRoadDepot(depot);
            },
          }
        : {
            icon: '⌂',
            title: 'Poslat do garáže',
            onClick: () => roadFleet.sendToDepot(vehicle),
            disabled: vehicle.target === -1 && vehicle.servicing === undefined,
            active: vehicle.target === -1 && vehicle.servicing === undefined,
          },
      {
        icon: '☰',
        title: 'Jízdní řád',
        onClick: () => openOrders(windows, roadOrders(game, vehicle, links, windows)),
        active: windows.isOpen(ordersId),
      },
      {
        icon: 'ℹ',
        title: 'Podrobnosti a hospodaření',
        onClick: () =>
          liveWindow(windows, detailsId, `${vehicle.name} – podrobnosti`, () => roadDetails(game, vehicle, links), {
            subscribe,
            exists,
          }),
        active: windows.isOpen(detailsId),
      },
      {
        icon: '🎥',
        title: 'Pohled z kabiny řidiče',
        onClick: () => links.ride(vehicle),
        disabled: vehicle.state === 'depot',
      },
    ],
  });
}

// Okno garáže: nákup aut, vypravení na trasu mezi dvěma zastávkami a prodej
export function openRoadDepot(windows: WindowManager, game: Game, depot: Depot, links: VehicleLinks): void {
  const id = `road-depot-${depot.id}`;
  const { roadFleet } = game;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  // Výběr modelu musí přežít obnovení okna při událostech aut
  const picker = new ModelPicker();
  const pendingOrders = new Map<number, [number, number]>();

  // Výchozí zastávky jsou dvě nejbližší ke garáži
  const stopsByDistance = (): Station[] =>
    roadStops(game).sort((a, b) => Math.hypot(a.x - depot.x, a.y - depot.y) - Math.hypot(b.x - depot.x, b.y - depot.y));
  const stopSelect = (selected: number | undefined): HTMLSelectElement => {
    const select = h('select', {});
    for (const s of stopsByDistance())
      select.append(h('option', { value: String(s.id), selected: s.id === selected }, s.name));
    return select;
  };

  const vehicleRow = (vehicle: RoadVehicle): HTMLElement => {
    const model = roadVehicleModel(vehicle);
    const today = game.clock.day;
    const info = h(
      'div',
      { className: 'train__info' },
      modelThumb('car kit', model.model),
      h('strong', {}, vehicle.name),
      ` · ${model.name} · ${formatVehicleLoad(vehicle)}`,
      h(
        'span',
        { className: isOldVehicle(vehicle, today) ? 'warning' : '' },
        ` · ${formatYears(vehicleAge(vehicle, today))}`,
      ),
      h('div', { className: 'form__hint' }, vehicleStateText(game, vehicle)),
    );
    const row = h('div', { className: 'train' }, info);
    const detail = (label: string): HTMLButtonElement =>
      smallButton(label, () => openRoadVehicle(windows, game, vehicle, links));
    if (vehicle.state !== 'depot') {
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          smallButton('Do garáže', () => roadFleet.sendToDepot(vehicle), vehicle.target === -1),
          smallButton('Najít', () => {
            const p = roadFleet.position(vehicle);
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
        refitControl(game, roadFleet.refitOptions(vehicle), vehicleCargo(vehicle), roadFleet.refitCost(vehicle), (c) =>
          roadFleet.refit(vehicle, c),
        ),
        smallButton(`Prodat (${formatMoney(vehicleSellPrice(vehicle, today))})`, () => roadFleet.sell(vehicle)),
      ),
    );
    const orders = vehicle.orders;
    if (orders) {
      row.append(
        h('div', { className: 'form__hint' }, `Jízdní řád: ${orders.map((s) => roadFleet.stationName(s)).join(' → ')}`),
        h(
          'div',
          { className: 'train__actions' },
          detail('Upravit řád'),
          smallButton('Vyjet', () => report(roadFleet.start(vehicle, orders))),
        ),
      );
      return row;
    }
    const stops = stopsByDistance();
    const pending = pendingOrders.get(vehicle.id) ?? [stops[0]?.id, stops[1]?.id];
    const a = stopSelect(pending[0]);
    const b = stopSelect(pending[1]);
    const remember = (): void => {
      pendingOrders.set(vehicle.id, [Number(a.value), Number(b.value)]);
    };
    a.addEventListener('change', remember);
    b.addEventListener('change', remember);
    row.append(
      h(
        'div',
        { className: 'train__actions' },
        a,
        '↔',
        b,
        smallButton(
          'Vyjet',
          () => report(roadFleet.start(vehicle, [Number(a.value), Number(b.value)])),
          stops.length < 2,
        ),
        detail('Více zastávek'),
      ),
    );
    return row;
  };

  const render = (): HTMLElement => {
    const models = roadFleet.available();
    // Seřazené podle nákladu, aby skupiny v nabídce šly za sebou
    const cargos = Object.keys(CARGOS) as Cargo[];
    const sorted = [...models].sort((a, b) => cargos.indexOf(a.cargo) - cargos.indexOf(b.cargo));
    // Výchozí volba: nejnovější autobus
    const fallback = models.filter((m) => m.cargo === 'passengers').at(-1) ?? models[0];
    picker.setOptions(
      sorted.map((m) => ({
        value: m.id,
        kit: 'car kit',
        model: m.model,
        name: m.name,
        details:
          `${formatMoney(m.price)} · ${m.capacity} ${CARGOS[m.cargo].unit} · ` +
          `${speedText(m.speed)} dlaždic/den · provoz ${formatMoney(m.runningCost)}/rok`,
        group: CARGOS[m.cargo].name,
      })),
      fallback.id,
    );
    const buy = smallButton('Koupit', () =>
      report(
        roadFleet.buy(
          depot,
          models.find((m) => m.id === picker.value)!,
        ),
      ),
    );
    const vehicles = roadFleet.inDepot(depot);
    return h(
      'div',
      { className: 'form' },
      h('div', { className: 'train__actions' }, picker.element, buy),
      h('h4', {}, 'Auta'),
      ...(vehicles.length > 0
        ? vehicles.map(vehicleRow)
        : [h('div', { className: 'form__hint' }, 'Garáž zatím nemá žádná auta.')]),
      ...(roadStops(game).length < 2
        ? [h('div', { className: 'form__hint' }, 'Postavte aspoň dvě zastávky aut (okno Stavba silnic).')]
        : []),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen(id)) windows.update(id, render());
  };
  const unsubscribe = [game.events.on('vehiclesChanged', refresh), game.events.on('railChanged', refresh)];
  windows.open(id, `Garáž ${depot.id + 1}`, render(), {
    width: 480,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => links.focus(depot.x + 0.5, depot.y + 0.5),
  });
}

// Seznam všech aut; kliknutím na řádek se otevře okno auta
export function openVehicleList(windows: WindowManager, game: Game, links: VehicleLinks): void {
  let group: GroupFilter = 'all';
  const render = (): HTMLElement => {
    const all = game.roadFleet.vehicles;
    if (all.length === 0) {
      return h('div', { className: 'form__hint' }, 'Zatím nemáte žádná auta. Kupují se v garáži (okno Stavba silnic).');
    }
    const today = game.clock.day;
    group = validFilter(game, 'road', group);
    const panel = groupPanel(game, 'road', group, (value) => {
      group = value;
      refresh();
    });
    const table = h(
      'table',
      { className: 'table table--clickable' },
      h(
        'tr',
        {},
        h('th', {}, 'Auto'),
        h('th', {}, 'Stav'),
        h('th', { className: 'num' }, 'Stáří'),
        h('th', { className: 'num' }, 'Náklad'),
        h('th', { className: 'num' }, 'Zisk letos'),
        h('th', { className: 'table__group' }, 'Skupina'),
      ),
      ...all
        .filter((v) => inGroup(v, group))
        .map((v) => {
          const tr = h(
            'tr',
            { title: `Otevřít okno auta (${CARGOS[vehicleCargo(v)].name})` },
            h('td', { className: 'table__name' }, modelThumb('car kit', roadVehicleModel(v).model), v.name),
            h('td', {}, vehicleStateText(game, v)),
            h('td', { className: isOldVehicle(v, today) ? 'num warning' : 'num' }, formatYears(vehicleAge(v, today))),
            h('td', { className: 'num' }, formatVehicleLoad(v)),
            h('td', { className: 'num' }, formatMoney(v.income - v.costs)),
            h('td', {}, groupSelect(game, 'road', v)),
          );
          tr.addEventListener('click', () => openRoadVehicle(windows, game, v, links));
          return tr;
        }),
    );
    return h('div', { className: 'form' }, panel, table);
  };
  const refresh = (): void => {
    if (windows.isOpen('vehicle-list') && !editingGroups()) windows.update('vehicle-list', render());
  };
  const unsubscribe = [
    game.events.on('vehiclesChanged', refresh),
    game.events.on('groupsChanged', refresh),
    game.clock.events.on('day', refresh),
  ];
  windows.open('vehicle-list', 'Auta', render(), { width: 580, onClose: () => unsubscribe.forEach((off) => off()) });
}
