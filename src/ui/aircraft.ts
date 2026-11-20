import { AIRCRAFT_LIFETIME_YEARS, AIRPORT_TYPES } from '../game/balance';
import { CARGOS } from '../game/cargo';
import {
  aircraftAge,
  aircraftModel,
  aircraftRunningCost,
  aircraftSellPrice,
  canUseAirport,
  formatAircraftLoad,
  isOldAircraft,
  type Aircraft,
} from '../game/aircraft';
import { Game, formatMoney } from '../game/game';
import { modelThumb } from '../render/icons';
import type { Station } from '../world/rail';
import { h } from './dom';
import { ModelPicker } from './modelPicker';
import { formatYears } from './trainWindow';
import type { WindowManager } from './windows';

export interface AircraftLinks {
  focus: (x: number, z: number) => void;
  openHangar: (airport: Station) => void;
  openStation: (airport: Station) => void;
  // Pohled z kokpitu
  ride: (plane: Aircraft) => void;
}

// Autoři modelů letadel (CC BY 3.0, Poly Pizza), viz assets/credits.md
export const AIRCRAFT_CREDITS =
  'Modely letadel: Airplane – jeremy; Airplane, Airplane, Jet – Poly by Google; licence CC BY 3.0, poly.pizza.';

const speedText = (v: number): string => v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });

function airports(game: Game): Station[] {
  return game.world.rail.airports();
}

function smallButton(label: string, onClick: () => void, disabled = false, title = ''): HTMLButtonElement {
  const b = h('button', { className: 'small-button', disabled, title }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function aircraftStateText(game: Game, plane: Aircraft): string {
  const { airFleet } = game;
  const where = airFleet.stationName(plane.airportId);
  const hangar = plane.toHangar ? ' (pak do hangáru)' : '';
  switch (plane.state) {
    case 'hangar':
      return `V hangáru: ${airFleet.stationName(plane.depotId)}`;
    case 'taxi':
      if (plane.taxiTo === 'hangar') return `Pojíždí do hangáru: ${where}`;
      return plane.taxiTo === 'runway' ? `Pojíždí k ranveji: ${where}` : `Pojíždí na stání: ${where}`;
    case 'waiting':
      return `Čeká na volnou ranvej: ${where}`;
    case 'takeoff':
      return `Vzlétá: ${where}`;
    case 'flying':
      return `Letí: ${where}${hangar}`;
    case 'holding':
      return `Krouží nad letištěm (plno): ${where}${hangar}`;
    case 'landing':
      return `Přistává: ${where}${hangar}`;
    case 'loading':
      if (airFleet.isFillingUp(plane)) return `Nakládá do plna: ${formatAircraftLoad(plane)}`;
      return `Na stání: ${where}`;
  }
}

// Seznam letišť řádu s posunem, odebráním a přidáním; změny platí hned
function ordersEditor(game: Game, plane: Aircraft, choice: { airport: number | null }): HTMLElement {
  const { airFleet } = game;
  const orders = plane.orders ?? [];
  const apply = (next: number[]): void => {
    const error = airFleet.setOrders(plane, next);
    if (error) game.news(error);
  };
  const moved = (i: number, j: number): number[] => {
    const next = [...orders];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const heading = plane.state !== 'hangar' ? plane.target : -1;
  const rows = orders.map((airportId, i) => {
    const full = smallButton(
      'Do plna',
      () => airFleet.toggleFullLoad(plane, airportId),
      false,
      'Letadlo na tomto letišti počká, dokud nebude plné',
    );
    full.classList.toggle('small-button--active', plane.fullLoad.includes(airportId));
    return h(
      'div',
      { className: i === heading ? 'orders__row orders__row--current' : 'orders__row' },
      h('span', {}, `${i + 1}. ${airFleet.stationName(airportId)}`),
      smallButton('↑', () => apply(moved(i, i - 1)), i === 0, 'Posunout výš'),
      smallButton('↓', () => apply(moved(i, i + 1)), i === orders.length - 1, 'Posunout níž'),
      smallButton('✕', () => apply(orders.filter((_, k) => k !== i)), false, 'Odebrat letiště'),
      full,
    );
  });
  const model = aircraftModel(plane);
  const usable = airports(game)
    .filter((a) => canUseAirport(model, a.airport))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  const select = h('select', {});
  for (const a of usable)
    select.append(h('option', { value: String(a.id), selected: a.id === choice.airport }, a.name));
  select.addEventListener('change', () => (choice.airport = Number(select.value)));
  const add = smallButton('Přidat', () => apply([...orders, Number(select.value)]), usable.length === 0);
  return h(
    'div',
    { className: 'orders' },
    ...(rows.length > 0 ? rows : [h('div', { className: 'form__hint' }, 'Žádná letiště.')]),
    h('div', { className: 'train__actions' }, select, add),
    h(
      'div',
      { className: 'form__hint' },
      'Letadlo létá po letištích dokola, na každém vyloží a naloží náklad. ' +
        (model.large ? 'Velké letadlo přistává jen na velkých letištích.' : ''),
    ),
  );
}

// Okno letadla: stav, náklad, hospodaření, letový řád a akce
export function openAircraft(windows: WindowManager, game: Game, plane: Aircraft, links: AircraftLinks): void {
  const id = `aircraft-${plane.id}`;
  const { airFleet } = game;
  const choice = { airport: null as number | null };
  const render = (): HTMLElement => {
    const model = aircraftModel(plane);
    const today = game.clock.day;
    const old = isOldAircraft(plane, today);
    const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, label), h('td', { className }, value));
    const table = h(
      'table',
      { className: 'table' },
      row('Model', `${model.name} (${model.year})`),
      row('Stav', aircraftStateText(game, plane)),
      row('Náklad', formatAircraftLoad(plane), 'num'),
      row('Rychlost', `${speedText(model.speed)} dlaždic/den`, 'num'),
      row(
        'Stáří',
        `${formatYears(aircraftAge(plane, today))} z ${AIRCRAFT_LIFETIME_YEARS}${old ? ' – po životnosti' : ''}`,
        old ? 'num warning' : 'num',
      ),
      row('Provoz ročně', formatMoney(0 - aircraftRunningCost(plane, today)), 'num'),
      row('Příjmy letos', formatMoney(plane.income), 'num'),
      row('Provoz letos', formatMoney(0 - plane.costs), 'num'),
      row('Zisk letos', formatMoney(plane.income - plane.costs), 'num strong'),
      row('Zisk loni', formatMoney(plane.lastIncome - plane.lastCosts), 'num'),
      row('Prodejní cena', formatMoney(aircraftSellPrice(plane, today)), 'num'),
    );
    const actions = h(
      'div',
      { className: 'train__actions' },
      smallButton('Do hangáru', () => airFleet.sendToHangar(plane), plane.state === 'hangar' || plane.toHangar),
      smallButton('Otevřít hangár', () => {
        const airport = airFleet.airport(plane.state === 'hangar' ? plane.depotId : plane.airportId);
        if (airport) links.openHangar(airport);
      }),
      smallButton(
        '🎥 Z kokpitu',
        () => links.ride(plane),
        plane.state === 'hangar',
        'Pohled z kokpitu, obraz letí s letadlem',
      ),
    );
    if (plane.state === 'hangar' && plane.orders) {
      const orders = plane.orders;
      actions.append(
        smallButton('Vyletět', () => {
          const error = airFleet.start(plane, orders);
          if (error) game.news(error);
        }),
      );
    }
    return h(
      'div',
      { className: 'form' },
      table,
      actions,
      h('h4', {}, 'Letový řád'),
      ordersEditor(game, plane, choice),
    );
  };

  const refresh = (): void => {
    if (!windows.isOpen(id)) return;
    if (!airFleet.aircraft.includes(plane)) windows.close(id);
    else windows.update(id, render());
  };
  const unsubscribe = [game.events.on('aircraftChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open(id, plane.name, render(), {
    width: 360,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => {
      const p = airFleet.position(plane);
      if (p) links.focus(p.x, p.y);
    },
  });
}

// Okno letiště: hangár s nákupem letadel a vypravením na lety, letadla, která letiště obsluhují
export function openHangar(windows: WindowManager, game: Game, airport: Station, links: AircraftLinks): void {
  const id = `hangar-${airport.id}`;
  const { airFleet } = game;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  const picker = new ModelPicker();
  const pending = new Map<number, number>();
  const spec = AIRPORT_TYPES[airport.airport ?? 'small'];

  // Výchozí cíl je nejvzdálenější letiště: dlouhé lety vynášejí nejvíc
  const destinations = (plane: Aircraft): Station[] =>
    airports(game)
      .filter((a) => a.id !== airport.id && canUseAirport(aircraftModel(plane), a.airport))
      .sort((a, b) => Math.hypot(b.x - airport.x, b.y - airport.y) - Math.hypot(a.x - airport.x, a.y - airport.y));

  const planeRow = (plane: Aircraft): HTMLElement => {
    const model = aircraftModel(plane);
    const today = game.clock.day;
    const info = h(
      'div',
      { className: 'train__info' },
      modelThumb('airplanes', model.model),
      h('strong', {}, plane.name),
      ` · ${model.name} · ${formatAircraftLoad(plane)}`,
      h(
        'span',
        { className: isOldAircraft(plane, today) ? 'warning' : '' },
        ` · ${formatYears(aircraftAge(plane, today))}`,
      ),
      h('div', { className: 'form__hint' }, aircraftStateText(game, plane)),
    );
    const row = h('div', { className: 'train' }, info);
    const detail = (label: string): HTMLButtonElement =>
      smallButton(label, () => openAircraft(windows, game, plane, links));
    if (plane.state !== 'hangar') {
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          smallButton('Do hangáru', () => airFleet.sendToHangar(plane), plane.toHangar),
          smallButton('Najít', () => {
            const p = airFleet.position(plane);
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
        smallButton(`Prodat (${formatMoney(aircraftSellPrice(plane, today))})`, () => airFleet.sell(plane)),
      ),
    );
    const orders = plane.orders;
    if (orders) {
      row.append(
        h('div', { className: 'form__hint' }, `Letový řád: ${orders.map((s) => airFleet.stationName(s)).join(' → ')}`),
        h(
          'div',
          { className: 'train__actions' },
          detail('Upravit řád'),
          smallButton('Vyletět', () => report(airFleet.start(plane, orders))),
        ),
      );
      return row;
    }
    const options = destinations(plane);
    const select = h('select', {});
    for (const a of options) {
      const tiles = Math.round(Math.hypot(a.x - airport.x, a.y - airport.y));
      select.append(
        h('option', { value: String(a.id), selected: a.id === pending.get(plane.id) }, `${a.name} (${tiles} dlaždic)`),
      );
    }
    select.addEventListener('change', () => pending.set(plane.id, Number(select.value)));
    row.append(
      h(
        'div',
        { className: 'train__actions' },
        `${airport.name} ↔`,
        select,
        smallButton(
          'Vyletět',
          () => report(airFleet.start(plane, [airport.id, Number(select.value)])),
          options.length === 0,
        ),
        detail('Více letišť'),
      ),
    );
    return row;
  };

  const render = (): HTMLElement => {
    const models = airFleet.available();
    const fallback =
      models.filter((m) => m.cargo === 'passengers' && canUseAirport(m, airport.airport)).at(-1) ?? models[0];
    picker.setOptions(
      models.map((m) => ({
        value: m.id,
        kit: 'airplanes',
        model: m.model,
        name: m.name,
        details:
          `${formatMoney(m.price)} · ${m.capacity} ${CARGOS[m.cargo].unit} · ${speedText(m.speed)} dlaždic/den · ` +
          `provoz ${formatMoney(m.runningCost)}/rok${m.large ? ' · jen velká letiště' : ''}`,
        group: CARGOS[m.cargo].name,
      })),
      fallback.id,
    );
    const buy = smallButton('Koupit', () =>
      report(
        airFleet.buy(
          airport,
          models.find((m) => m.id === picker.value)!,
        ),
      ),
    );
    const inHangar = airFleet.inHangar(airport);
    const away = airFleet.basedAt(airport).filter((p) => !inHangar.includes(p));
    const stands = airFleet.aircraft.filter((p) => p.airportId === airport.id && p.stand >= 0).length;
    return h(
      'div',
      { className: 'form' },
      h(
        'div',
        { className: 'form__hint' },
        `${spec.name} · stání ${stands} / ${spec.stands} obsazeno · čeká ${Math.floor(airport.waiting)} cestujících`,
      ),
      h(
        'div',
        { className: 'train__actions' },
        picker.element,
        buy,
        smallButton('Stanice', () => links.openStation(airport), false, 'Hodnocení a náklad letiště'),
      ),
      h('h4', {}, 'V hangáru'),
      ...(inHangar.length > 0 ? inHangar.map(planeRow) : [h('div', { className: 'form__hint' }, 'Hangár je prázdný.')]),
      ...(away.length > 0 ? [h('h4', {}, 'Létají sem'), ...away.map(planeRow)] : []),
      ...(airports(game).length < 2
        ? [h('div', { className: 'form__hint' }, 'Postavte aspoň dvě letiště (okno Stavba letišť).')]
        : []),
      h('div', { className: 'form__hint credits' }, AIRCRAFT_CREDITS),
    );
  };

  const refresh = (): void => {
    if (!game.world.rail.stations.includes(airport)) windows.close(id);
    else if (windows.isOpen(id)) windows.update(id, render());
  };
  const unsubscribe = [game.events.on('aircraftChanged', refresh), game.events.on('railChanged', refresh)];
  windows.open(id, `Letiště ${airport.name}`, render(), {
    width: 500,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => links.focus(airport.x + 0.5, airport.y + 0.5),
  });
}

// Seznam všech letadel; kliknutím na řádek se otevře okno letadla
export function openAircraftList(windows: WindowManager, game: Game, links: AircraftLinks): void {
  const render = (): HTMLElement => {
    const all = game.airFleet.aircraft;
    if (all.length === 0) {
      return h(
        'div',
        { className: 'form__hint' },
        'Zatím nemáte žádná letadla. Kupují se v hangáru letiště (okno Stavba letišť, kliknutím na letiště).',
      );
    }
    const today = game.clock.day;
    return h(
      'table',
      { className: 'table table--clickable' },
      h(
        'tr',
        {},
        h('th', {}, 'Letadlo'),
        h('th', {}, 'Stav'),
        h('th', { className: 'num' }, 'Stáří'),
        h('th', { className: 'num' }, 'Náklad'),
        h('th', { className: 'num' }, 'Zisk letos'),
      ),
      ...all.map((p) => {
        const tr = h(
          'tr',
          { title: 'Otevřít okno letadla' },
          h('td', { className: 'table__name' }, modelThumb('airplanes', aircraftModel(p).model), p.name),
          h('td', {}, aircraftStateText(game, p)),
          h('td', { className: isOldAircraft(p, today) ? 'num warning' : 'num' }, formatYears(aircraftAge(p, today))),
          h('td', { className: 'num' }, formatAircraftLoad(p)),
          h('td', { className: 'num' }, formatMoney(p.income - p.costs)),
        );
        tr.addEventListener('click', () => openAircraft(windows, game, p, links));
        return tr;
      }),
    );
  };
  const refresh = (): void => {
    if (windows.isOpen('aircraft-list')) windows.update('aircraft-list', render());
  };
  const unsubscribe = [game.events.on('aircraftChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open('aircraft-list', 'Letadla', render(), {
    width: 500,
    onClose: () => unsubscribe.forEach((off) => off()),
  });
}
