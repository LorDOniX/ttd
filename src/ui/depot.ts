import { MAX_WAGONS, WAGON_PRICE } from '../game/balance';
import { Game, formatMoney } from '../game/game';
import {
  CARGO_NAMES,
  formatLoad,
  isOld,
  ordersError,
  sellPrice,
  trainAge,
  trainLength,
  trainModel,
  type Cargo,
  type Train,
} from '../game/trains';
import type { Depot } from '../world/rail';
import { pointAt } from '../world/route';
import { h } from './dom';
import { formatTiles, formatYears, openTrain, shortStationsWarning, stateText } from './trainWindow';
import type { WindowManager } from './windows';

// Okno depa: nákup vlaků, vagony, vypravení na trať a prodej
export function openDepot(
  windows: WindowManager,
  game: Game,
  depot: Depot,
  focus: (x: number, z: number) => void,
): void {
  const id = `depot-${depot.id}`;
  const { fleet } = game;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  // Výběr v rozbalovacích se musí přežít obnovení okna při událostech vlaků
  let selectedModel: string | null = null;
  const pendingOrders = new Map<number, [number, number]>();

  // Výchozí nástupiště jsou dvě nejbližší k depu
  const stationsByDistance = (): { id: number; name: string }[] =>
    [...game.world.rail.stations].sort(
      (a, b) => Math.hypot(a.x - depot.x, a.y - depot.y) - Math.hypot(b.x - depot.x, b.y - depot.y),
    );

  const stationSelect = (selected: number | undefined): HTMLSelectElement => {
    const select = h('select', {});
    for (const s of stationsByDistance()) select.append(h('option', { value: String(s.id), selected: s.id === selected }, s.name));
    return select;
  };

  const trainRow = (train: Train): HTMLElement => {
    const model = trainModel(train);
    const button = (label: string, onClick: () => void, disabled = false): HTMLButtonElement => {
      const b = h('button', { className: 'small-button', disabled }, label);
      b.addEventListener('click', onClick);
      return b;
    };

    const info = h(
      'div',
      { className: 'train__info' },
      h('strong', {}, train.name),
      ` · ${model.name} · ${train.wagons} ${train.wagons === 1 ? 'vagon' : train.wagons >= 2 && train.wagons <= 4 ? 'vagony' : 'vagonů'}`,
      ` (${formatTiles(trainLength(train))})`,
      ` · ${formatLoad(train)}`,
      h('span', { className: isOld(train, game.clock.day) ? 'warning' : '' }, ` · ${formatYears(trainAge(train, game.clock.day))}`),
      h('div', { className: 'form__hint' }, stateText(game, train)),
    );
    const warning = shortStationsWarning(game, train);
    if (warning) info.append(h('div', { className: 'form__hint warning' }, warning));
    const row = h('div', { className: 'train' }, info);
    const detail = (label: string): HTMLButtonElement =>
      button(label, () => openTrain(windows, game, train, { focus, openDepot: (d) => openDepot(windows, game, d, focus) }));

    if (train.state === 'depot') {
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          button(`+ vagon (${formatMoney(WAGON_PRICE)})`, () => report(fleet.addWagon(train)), train.wagons >= MAX_WAGONS),
          button('− vagon', () => fleet.removeWagon(train), train.wagons === 0),
          button(`Prodat (${formatMoney(sellPrice(train, game.clock.day))})`, () => fleet.sell(train)),
          button(`Obnovit (${formatMoney(fleet.renewalOffer(train).cost)})`, () => report(fleet.renew(train))),
        ),
        h(
          'div',
          { className: 'train__actions' },
          'Náklad:',
          ...(Object.keys(CARGO_NAMES) as Cargo[]).map((cargo) => {
            const b = button(CARGO_NAMES[cargo], () => report(fleet.setCargo(train, cargo)));
            b.classList.toggle('small-button--active', train.cargo === cargo);
            return b;
          }),
        ),
      );
      const orders = train.orders;
      if (orders) {
        row.append(
          h('div', { className: 'form__hint' }, `Jízdní řád: ${orders.map((s) => fleet.stationName(s)).join(' → ')}`),
          h(
            'div',
            { className: 'train__actions' },
            detail('Upravit řád'),
            button('Vyjet', () => report(fleet.start(train, orders)), ordersError(orders) !== null),
          ),
        );
        return row;
      }
      // Bez řádu rychlá volba kyvadla mezi dvěma nástupišti; víc zastávek přes okno vlaku
      const stations = stationsByDistance();
      const pending = pendingOrders.get(train.id) ?? [stations[0]?.id, stations[1]?.id];
      const a = stationSelect(pending[0]);
      const b = stationSelect(pending[1]);
      const remember = (): void => {
        pendingOrders.set(train.id, [Number(a.value), Number(b.value)]);
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
          button('Vyjet', () => report(fleet.start(train, [Number(a.value), Number(b.value)])), stations.length < 2),
          detail('Více zastávek'),
        ),
      );
    } else {
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          button('Do depa', () => fleet.sendToDepot(train), train.target === -1),
          button('Najít', () => focus(...pointAt(train.path, train.pos))),
          detail('Detail'),
        ),
      );
    }
    return row;
  };

  const render = (): HTMLElement => {
    const models = fleet.available();
    const chosen = models.find((m) => m.id === selectedModel) ?? models[models.length - 1];
    const select = h('select', {});
    for (const m of models) {
      select.append(
        h(
          'option',
          { value: m.id, selected: m === chosen },
          `${m.name} – ${formatMoney(m.price)}, ${m.speed} dlaždic/den, provoz ${formatMoney(m.runningCost)}/rok`,
        ),
      );
    }
    select.addEventListener('change', () => (selectedModel = select.value));
    const buy = h('button', { className: 'small-button' }, 'Koupit');
    buy.addEventListener('click', () => report(fleet.buy(depot, models.find((m) => m.id === select.value)!)));

    const trains = fleet.inDepot(depot);
    return h(
      'div',
      { className: 'form' },
      h('div', { className: 'train__actions' }, select, buy),
      h('h4', {}, 'Vlaky'),
      ...(trains.length > 0 ? trains.map(trainRow) : [h('div', { className: 'form__hint' }, 'Depo zatím nemá žádné vlaky.')]),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen(id)) windows.update(id, render());
  };
  const unsubscribe = [game.events.on('trainsChanged', refresh), game.events.on('railChanged', refresh)];
  const options = {
    width: 460,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => focus(depot.x + 0.5, depot.y + 0.5),
  };
  windows.open(id, `Depo ${depot.id + 1}`, render(), options);
}
