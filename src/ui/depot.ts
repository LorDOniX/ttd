import { MAX_WAGONS, TRAIN_SELL_REFUND, WAGON_PRICE } from '../game/balance';
import { Game, formatMoney } from '../game/game';
import { trainModel, trainValue, type Train } from '../game/trains';
import type { Depot } from '../world/rail';
import { h } from './dom';
import type { WindowManager } from './windows';

function stateText(game: Game, train: Train): string {
  const target = train.target === -1 ? 'depo' : train.orders ? game.fleet.stationName(train.orders[train.target]) : '';
  switch (train.state) {
    case 'depot':
      return 'V depu';
    case 'running':
      return `Jede: ${target}`;
    case 'loading':
      return `Ve stanici, další cíl: ${train.orders ? game.fleet.stationName(train.orders[1 - train.target]) : ''}`;
    case 'lost':
      return `Nemůže najít cestu: ${target}`;
  }
}

// Okno depa: nákup vlaků, vagony, vypravení na trať a prodej
export function openDepot(windows: WindowManager, game: Game, depot: Depot): void {
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
      h('div', { className: 'form__hint' }, stateText(game, train)),
    );
    const row = h('div', { className: 'train' }, info);

    if (train.state === 'depot') {
      const stations = stationsByDistance();
      const orders = pendingOrders.get(train.id) ?? train.orders ?? [stations[0]?.id, stations[1]?.id];
      const a = stationSelect(orders[0]);
      const b = stationSelect(orders[1]);
      const remember = (): void => {
        pendingOrders.set(train.id, [Number(a.value), Number(b.value)]);
      };
      a.addEventListener('change', remember);
      b.addEventListener('change', remember);
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          button(`+ vagon (${formatMoney(WAGON_PRICE)})`, () => report(fleet.addWagon(train)), train.wagons >= MAX_WAGONS),
          button('− vagon', () => fleet.removeWagon(train), train.wagons === 0),
          button(`Prodat (${formatMoney(trainValue(train) * TRAIN_SELL_REFUND)})`, () => fleet.sell(train)),
        ),
        h(
          'div',
          { className: 'train__actions' },
          a,
          '↔',
          b,
          button('Vyjet', () => report(fleet.start(train, [Number(a.value), Number(b.value)])), stations.length < 2),
        ),
      );
    } else {
      row.append(
        h(
          'div',
          { className: 'train__actions' },
          button('Do depa', () => fleet.sendToDepot(train), train.target === -1),
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
    if (windows.isOpen(id)) windows.open(id, `Depo ${depot.id + 1}`, render(), options);
  };
  const unsubscribe = [game.events.on('trainsChanged', refresh), game.events.on('railChanged', refresh)];
  const options = { width: 460, onClose: () => unsubscribe.forEach((off) => off()) };
  windows.open(id, `Depo ${depot.id + 1}`, render(), options);
}
