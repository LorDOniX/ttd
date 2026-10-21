import { ROAD_VEHICLE_LIFETIME_YEARS } from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import {
  formatVehicleLoad,
  isOldVehicle,
  roadVehicleModel,
  vehicleAge,
  vehicleCargo,
  vehicleRunningCost,
  vehicleSellPrice,
  type RoadVehicle,
} from '../game/roadVehicles';
import type { Depot, Station } from '../world/rail';
import { h } from './dom';
import { formatYears } from './trainWindow';
import type { WindowManager } from './windows';

export interface VehicleLinks {
  focus: (x: number, z: number) => void;
  openRoadDepot: (depot: Depot) => void;
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

// Seznam zastávek s posunem, odebráním a přidáním; změny platí hned
function ordersEditor(game: Game, vehicle: RoadVehicle, choice: { station: number | null }): HTMLElement {
  const { roadFleet } = game;
  const orders = vehicle.orders ?? [];
  const apply = (next: number[]): void => {
    const error = roadFleet.setOrders(vehicle, next);
    if (error) game.news(error);
  };
  const moved = (i: number, j: number): number[] => {
    const next = [...orders];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const heading = vehicle.state !== 'depot' && vehicle.target >= 0 ? vehicle.target : -1;
  const rows = orders.map((stationId, i) => {
    const full = smallButton(
      'Do plna',
      () => roadFleet.toggleFullLoad(vehicle, stationId),
      false,
      'Auto na této zastávce počká, dokud nebude plné',
    );
    full.classList.toggle('small-button--active', vehicle.fullLoad.includes(stationId));
    return h(
      'div',
      { className: i === heading ? 'orders__row orders__row--current' : 'orders__row' },
      h('span', {}, `${i + 1}. ${roadFleet.stationName(stationId)}`),
      smallButton('↑', () => apply(moved(i, i - 1)), i === 0, 'Posunout výš'),
      smallButton('↓', () => apply(moved(i, i + 1)), i === orders.length - 1, 'Posunout níž'),
      smallButton('✕', () => apply(orders.filter((_, k) => k !== i)), false, 'Odebrat zastávku'),
      full,
    );
  });
  const stops = roadStops(game).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  const select = h('select', {});
  for (const s of stops) select.append(h('option', { value: String(s.id), selected: s.id === choice.station }, s.name));
  select.addEventListener('change', () => (choice.station = Number(select.value)));
  const add = smallButton('Přidat', () => apply([...orders, Number(select.value)]), stops.length === 0);
  return h(
    'div',
    { className: 'orders' },
    ...(rows.length > 0 ? rows : [h('div', { className: 'form__hint' }, 'Žádné zastávky.')]),
    h('div', { className: 'train__actions' }, select, add),
    h(
      'div',
      { className: 'form__hint' },
      'Auto objíždí zastávky dokola, na každé vyloží a naloží náklad. Zastavuje jen na zastávkách aut.',
    ),
  );
}

// Okno auta: stav, náklad, hospodaření, jízdní řád a akce
export function openRoadVehicle(windows: WindowManager, game: Game, vehicle: RoadVehicle, links: VehicleLinks): void {
  const id = `vehicle-${vehicle.id}`;
  const { roadFleet } = game;
  const choice = { station: null as number | null };
  const render = (): HTMLElement => {
    const model = roadVehicleModel(vehicle);
    const today = game.clock.day;
    const old = isOldVehicle(vehicle, today);
    const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, label), h('td', { className }, value));
    const table = h(
      'table',
      { className: 'table' },
      row('Model', `${model.name} (${model.year})`),
      row('Stav', vehicleStateText(game, vehicle)),
      row('Náklad', formatVehicleLoad(vehicle), 'num'),
      row('Rychlost', `${speedText(model.speed)} dlaždic/den`, 'num'),
      row(
        'Stáří',
        `${formatYears(vehicleAge(vehicle, today))} z ${ROAD_VEHICLE_LIFETIME_YEARS}${old ? ' – po životnosti' : ''}`,
        old ? 'num warning' : 'num',
      ),
      row('Provoz ročně', formatMoney(0 - vehicleRunningCost(vehicle, today)), 'num'),
      row('Příjmy letos', formatMoney(vehicle.income), 'num'),
      row('Provoz letos', formatMoney(0 - vehicle.costs), 'num'),
      row('Zisk letos', formatMoney(vehicle.income - vehicle.costs), 'num strong'),
      row('Zisk loni', formatMoney(vehicle.lastIncome - vehicle.lastCosts), 'num'),
      row('Prodejní cena', formatMoney(vehicleSellPrice(vehicle, today)), 'num'),
    );
    const actions = h(
      'div',
      { className: 'train__actions' },
      smallButton(
        'Do garáže',
        () => roadFleet.sendToDepot(vehicle),
        vehicle.state === 'depot' || vehicle.target === -1,
      ),
      smallButton('Otevřít garáž', () => {
        const depot = roadFleet.depot(vehicle);
        if (depot) links.openRoadDepot(depot);
      }),
    );
    if (vehicle.state === 'depot' && vehicle.orders) {
      const orders = vehicle.orders;
      actions.append(
        smallButton('Vyjet', () => {
          const error = roadFleet.start(vehicle, orders);
          if (error) game.news(error);
        }),
      );
    }
    return h(
      'div',
      { className: 'form' },
      table,
      actions,
      h('h4', {}, 'Jízdní řád'),
      ordersEditor(game, vehicle, choice),
    );
  };

  const refresh = (): void => {
    if (!windows.isOpen(id)) return;
    if (!roadFleet.vehicles.includes(vehicle)) windows.close(id);
    else windows.update(id, render());
  };
  const unsubscribe = [game.events.on('vehiclesChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open(id, vehicle.name, render(), {
    width: 360,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => {
      const p = roadFleet.position(vehicle);
      if (p) links.focus(p.x, p.y);
    },
  });
}

// Okno garáže: nákup aut, vypravení na trasu mezi dvěma zastávkami a prodej
export function openRoadDepot(windows: WindowManager, game: Game, depot: Depot, links: VehicleLinks): void {
  const id = `road-depot-${depot.id}`;
  const { roadFleet } = game;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  let selectedModel: string | null = null;
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
    // Výchozí volba: nejnovější autobus
    const chosen =
      models.find((m) => m.id === selectedModel) ?? models.filter((m) => m.cargo === 'passengers').at(-1) ?? models[0];
    const select = h('select', {});
    for (const cargo of Object.keys(CARGOS) as Cargo[]) {
      const group = h('optgroup', { label: CARGOS[cargo].name });
      for (const m of models.filter((m) => m.cargo === cargo)) {
        group.append(
          h(
            'option',
            { value: m.id, selected: m === chosen },
            `${m.name} – ${formatMoney(m.price)}, ${m.capacity} ${CARGOS[cargo].unit}, ` +
              `${speedText(m.speed)} dlaždic/den, provoz ${formatMoney(m.runningCost)}/rok`,
          ),
        );
      }
      if (group.childElementCount > 0) select.append(group);
    }
    select.addEventListener('change', () => (selectedModel = select.value));
    const buy = smallButton('Koupit', () =>
      report(
        roadFleet.buy(
          depot,
          models.find((m) => m.id === select.value)!,
        ),
      ),
    );
    const vehicles = roadFleet.inDepot(depot);
    return h(
      'div',
      { className: 'form' },
      h('div', { className: 'train__actions' }, select, buy),
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
  const render = (): HTMLElement => {
    const all = game.roadFleet.vehicles;
    if (all.length === 0) {
      return h('div', { className: 'form__hint' }, 'Zatím nemáte žádná auta. Kupují se v garáži (okno Stavba silnic).');
    }
    const today = game.clock.day;
    return h(
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
      ),
      ...all.map((v) => {
        const tr = h(
          'tr',
          { title: `Otevřít okno auta (${CARGOS[vehicleCargo(v)].name})` },
          h('td', {}, v.name),
          h('td', {}, vehicleStateText(game, v)),
          h('td', { className: isOldVehicle(v, today) ? 'num warning' : 'num' }, formatYears(vehicleAge(v, today))),
          h('td', { className: 'num' }, formatVehicleLoad(v)),
          h('td', { className: 'num' }, formatMoney(v.income - v.costs)),
        );
        tr.addEventListener('click', () => openRoadVehicle(windows, game, v, links));
        return tr;
      }),
    );
  };
  const refresh = (): void => {
    if (windows.isOpen('vehicle-list')) windows.update('vehicle-list', render());
  };
  const unsubscribe = [game.events.on('vehiclesChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open('vehicle-list', 'Auta', render(), { width: 460, onClose: () => unsubscribe.forEach((off) => off()) });
}
