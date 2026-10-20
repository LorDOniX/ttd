import { TRAIN_SELL_REFUND, WAGON_CAPACITY } from '../game/balance';
import { Game, formatMoney } from '../game/game';
import { trainModel, trainValue, type Train } from '../game/trains';
import type { Depot } from '../world/rail';
import { pointAt } from '../world/route';
import { h } from './dom';
import type { WindowManager } from './windows';

export function stateText(game: Game, train: Train): string {
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

export interface TrainLinks {
  focus: (x: number, z: number) => void;
  openDepot: (depot: Depot) => void;
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

// Okno vlaku: cíl, náklad, hospodaření a akce
export function openTrain(windows: WindowManager, game: Game, train: Train, links: TrainLinks): void {
  const id = `train-${train.id}`;
  const render = (): HTMLElement => {
    const model = trainModel(train);
    const capacity = train.wagons * WAGON_CAPACITY;
    const orders = train.orders?.map((s) => game.fleet.stationName(s)).join(' ↔ ') ?? '–';
    const row = (label: string, value: string, className = ''): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, label), h('td', { className }, value));
    const speed = (v: number): string => v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
    const table = h(
      'table',
      { className: 'table' },
      row('Model', `${model.name} (${model.year})`),
      row('Stav', stateText(game, train)),
      row('Jízdní řád', orders),
      row('Cestující', `${train.passengers} / ${capacity}`, 'num'),
      row('Rychlost', `${speed(train.speed)} / ${speed(model.speed)} dlaždic/den`, 'num'),
      row('Příjmy letos', formatMoney(train.income), 'num'),
      row('Provoz letos', formatMoney(0 - train.costs), 'num'),
      row('Zisk letos', formatMoney(train.income - train.costs), 'num strong'),
      row('Zisk loni', formatMoney(train.lastIncome - train.lastCosts), 'num'),
      row('Prodejní cena', formatMoney(trainValue(train) * TRAIN_SELL_REFUND), 'num'),
    );

    const toDepot = h('button', { className: 'small-button', textContent: 'Do depa' });
    toDepot.disabled = train.state === 'depot' || train.target === -1;
    toDepot.addEventListener('click', () => game.fleet.sendToDepot(train));
    const depot = h('button', { className: 'small-button', textContent: 'Otevřít depo' });
    depot.addEventListener('click', () => {
      const d = depotOf(game, train);
      if (d) links.openDepot(d);
    });
    return h('div', { className: 'form' }, table, h('div', { className: 'train__actions' }, toDepot, depot));
  };

  const refresh = (): void => {
    if (!windows.isOpen(id)) return;
    if (!game.fleet.trains.includes(train)) windows.close(id);
    else windows.update(id, render());
  };
  const unsubscribe = [game.events.on('trainsChanged', refresh), game.clock.events.on('day', refresh)];
  const options = {
    width: 320,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => {
      const p = trainPosition(game, train);
      if (p) links.focus(...p);
    },
  };
  windows.open(id, train.name, render(), options);
}

// Seznam všech vlaků; kliknutím na řádek se otevře okno vlaku
export function openTrainList(windows: WindowManager, game: Game, links: TrainLinks): void {
  const render = (): HTMLElement => {
    const trains = game.fleet.trains;
    if (trains.length === 0) return h('div', { className: 'form__hint' }, 'Zatím nemáte žádné vlaky.');
    return h(
      'table',
      { className: 'table table--clickable' },
      h(
        'tr',
        {},
        h('th', {}, 'Vlak'),
        h('th', {}, 'Stav'),
        h('th', { className: 'num' }, 'Cestující'),
        h('th', { className: 'num' }, 'Zisk letos'),
      ),
      ...trains.map((t) => {
        const tr = h(
          'tr',
          { title: 'Otevřít okno vlaku' },
          h('td', {}, t.name),
          h('td', {}, stateText(game, t)),
          h('td', { className: 'num' }, `${t.passengers} / ${t.wagons * WAGON_CAPACITY}`),
          h('td', { className: 'num' }, formatMoney(t.income - t.costs)),
        );
        tr.addEventListener('click', () => openTrain(windows, game, t, links));
        return tr;
      }),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen('train-list')) windows.update('train-list', render());
  };
  const unsubscribe = [game.events.on('trainsChanged', refresh), game.clock.events.on('day', refresh)];
  const options = { width: 460, onClose: () => unsubscribe.forEach((off) => off()) };
  windows.open('train-list', 'Vlaky', render(), options);
}
