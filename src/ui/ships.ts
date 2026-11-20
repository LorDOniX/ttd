import { SHIP_LIFETIME_YEARS } from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import {
  formatShipLoad,
  isOldShip,
  shipAge,
  shipModel,
  shipRunningCost,
  shipSellPrice,
  type Ship,
} from '../game/ships';
import { modelThumb } from '../render/icons';
import type { Station } from '../world/rail';
import { vehicleViewport } from './vehicleViewport';
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

// Seznam přístavů řádu s posunem, odebráním a přidáním; změny platí hned
function ordersEditor(game: Game, ship: Ship, choice: { port: number | null }): HTMLElement {
  const { shipFleet } = game;
  const orders = ship.orders ?? [];
  const apply = (next: number[]): void => {
    const error = shipFleet.setOrders(ship, next);
    if (error) game.news(error);
  };
  const moved = (i: number, j: number): number[] => {
    const next = [...orders];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const heading = ship.state !== 'depot' ? ship.target : -1;
  const rows = orders.map((portId, i) => {
    const full = smallButton(
      'Do plna',
      () => shipFleet.toggleFullLoad(ship, portId),
      false,
      'Loď v tomto přístavu počká, dokud nebude plná',
    );
    full.classList.toggle('small-button--active', ship.fullLoad.includes(portId));
    return h(
      'div',
      { className: i === heading ? 'orders__row orders__row--current' : 'orders__row' },
      h('span', {}, `${i + 1}. ${shipFleet.stationName(portId)}`),
      smallButton('↑', () => apply(moved(i, i - 1)), i === 0, 'Posunout výš'),
      smallButton('↓', () => apply(moved(i, i + 1)), i === orders.length - 1, 'Posunout níž'),
      smallButton('✕', () => apply(orders.filter((_, k) => k !== i)), false, 'Odebrat přístav'),
      full,
    );
  });
  const all = ports(game).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  const select = h('select', {});
  for (const p of all) select.append(h('option', { value: String(p.id), selected: p.id === choice.port }, p.name));
  select.addEventListener('change', () => (choice.port = Number(select.value)));
  const add = smallButton('Přidat', () => apply([...orders, Number(select.value)]), all.length === 0);
  return h(
    'div',
    { className: 'orders' },
    ...(rows.length > 0 ? rows : [h('div', { className: 'form__hint' }, 'Žádné přístavy.')]),
    h('div', { className: 'train__actions' }, select, add),
    h(
      'div',
      { className: 'form__hint' },
      'Loď objíždí přístavy dokola, v každém vyloží a naloží náklad. Pluje jen po souvislé vodě a pod mosty ' +
        'neproplouvá. V zimě voda zamrzá a lodě stojí v ledu až do jara.',
    ),
  );
}

export function openShip(windows: WindowManager, game: Game, ship: Ship, links: ShipLinks): void {
  const id = `ship-${ship.id}`;
  const { shipFleet } = game;
  const choice = { port: null as number | null };
  const viewport = vehicleViewport(
    () => {
      const p = shipFleet.position(ship);
      return p && { x: p.x, y: 0, z: p.y };
    },
    () => (ship.state === 'depot' ? 'V loděnici' : null),
  );
  const render = (): HTMLElement => {
    const model = shipModel(ship);
    const today = game.clock.day;
    const old = isOldShip(ship, today);
    const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, label), h('td', { className }, value));
    const table = h(
      'table',
      { className: 'table' },
      row('Model', `${model.name} (${model.year})`),
      row('Stav', shipStateText(game, ship)),
      row('Náklad', formatShipLoad(ship), 'num'),
      row('Rychlost', `${speedText(model.speed)} dlaždic/den`, 'num'),
      row(
        'Stáří',
        `${formatYears(shipAge(ship, today))} z ${SHIP_LIFETIME_YEARS}${old ? ' – po životnosti' : ''}`,
        old ? 'num warning' : 'num',
      ),
      row('Provoz ročně', formatMoney(0 - shipRunningCost(ship, today)), 'num'),
      row('Příjmy letos', formatMoney(ship.income), 'num'),
      row('Provoz letos', formatMoney(0 - ship.costs), 'num'),
      row('Zisk letos', formatMoney(ship.income - ship.costs), 'num strong'),
      row('Zisk loni', formatMoney(ship.lastIncome - ship.lastCosts), 'num'),
      row('Prodejní cena', formatMoney(shipSellPrice(ship, today)), 'num'),
    );
    const actions = h(
      'div',
      { className: 'train__actions' },
      smallButton('Do loděnice', () => shipFleet.sendToDepot(ship), ship.state === 'depot' || ship.toDepot),
      smallButton('Otevřít loděnici', () => {
        const port = shipFleet.port(ship.state === 'depot' ? ship.depotId : ship.portId);
        if (port) links.openShipyard(port);
      }),
      smallButton('🎥 Z můstku', () => links.ride(ship), ship.state === 'depot', 'Pohled z můstku, obraz pluje s lodí'),
    );
    if (ship.state === 'depot' && ship.orders) {
      const orders = ship.orders;
      actions.append(
        smallButton('Vyplout', () => {
          const error = shipFleet.start(ship, orders);
          if (error) game.news(error);
        }),
      );
    }
    return h(
      'div',
      { className: 'form' },
      viewport.element,
      table,
      actions,
      h('h4', {}, 'Plavební řád'),
      ordersEditor(game, ship, choice),
    );
  };
  const refresh = (): void => {
    if (!windows.isOpen(id)) return;
    if (!shipFleet.ships.includes(ship)) windows.close(id);
    else windows.update(id, render());
  };
  const unsubscribe = [game.events.on('shipsChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open(id, ship.name, render(), {
    width: 360,
    onClose: () => {
      unsubscribe.forEach((off) => off());
      viewport.dispose();
    },
    locate: () => {
      const p = shipFleet.position(ship);
      if (p) links.focus(p.x, p.y);
    },
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
    return h(
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
      ),
      ...all.map((s) => {
        const tr = h(
          'tr',
          { title: 'Otevřít okno lodi' },
          h('td', { className: 'table__name' }, modelThumb('watercraft kit', shipModel(s).model), s.name),
          h('td', {}, shipStateText(game, s)),
          h('td', { className: isOldShip(s, today) ? 'num warning' : 'num' }, formatYears(shipAge(s, today))),
          h('td', { className: 'num' }, formatShipLoad(s)),
          h('td', { className: 'num' }, formatMoney(s.income - s.costs)),
        );
        tr.addEventListener('click', () => openShip(windows, game, s, links));
        return tr;
      }),
    );
  };
  const refresh = (): void => {
    if (windows.isOpen('ship-list')) windows.update('ship-list', render());
  };
  const unsubscribe = [game.events.on('shipsChanged', refresh), game.clock.events.on('day', refresh)];
  windows.open('ship-list', 'Lodě', render(), { width: 500, onClose: () => unsubscribe.forEach((off) => off()) });
}
