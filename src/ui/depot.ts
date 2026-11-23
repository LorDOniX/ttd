import {
  MAX_WAGONS,
  TRAIN_LIFETIME_YEARS,
  TRAIN_MODELS,
  WAGON_CAPACITY,
  WAGON_PRICE,
  WAGON_RUNNING_COST,
  speedKmh,
  type TrainModel,
  REFIT_COST_PER_WAGON,
} from '../game/balance';
import { CARGOS, type Cargo } from '../game/cargo';
import { Game, formatMoney, formatMoneyShort } from '../game/game';
import {
  formatLoad,
  isOld,
  ordersError,
  sellFactor,
  sellPrice,
  trainAge,
  trainLength,
  trainModel,
  type Train,
} from '../game/trains';
import { sideImage } from '../render/icons';
import type { Depot } from '../world/rail';
import { pointAt } from '../world/route';
import { h } from './dom';
import { formatTiles, formatYears, openTrain, shortStationsWarning, stateText } from './trainWindow';
import type { WindowManager } from './windows';

// Měřítko bočních obrázků (pixelů na jednotku modelu): seznam modelů, souprava ve vlaku, velký náhled
const LIST_SCALE = 15;
const TRAIN_SCALE = 19;
const PREVIEW_SCALE = 26;
const KIT = 'train kit';

const CARGO_LIST = Object.keys(CARGOS) as Cargo[];

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

function wagonsText(n: number): string {
  return `${n} ${plural(n, 'vagon', 'vagony', 'vagonů')}`;
}

// Model i-tého vagonu: osobní podle lokomotivy, nákladní podle nákladu (střídají se po řadě)
function wagonModelName(model: TrainModel, cargo: Cargo, index: number): string {
  const models = CARGOS[cargo].wagonModels ?? [model.wagonModel];
  return models[index % models.length];
}

function capacityText(cargo: Cargo, wagons: number): string {
  return `${wagons * WAGON_CAPACITY} ${CARGOS[cargo].unit}`;
}

// Souprava z boku: lokomotiva vlevo, za ní vagony
function consistImages(model: TrainModel, cargo: Cargo, wagons: number, scale: number): HTMLImageElement[] {
  return [
    sideImage(KIT, model.model, scale, 'consist__image'),
    ...Array.from({ length: wagons }, (_, i) =>
      sideImage(KIT, wagonModelName(model, cargo, i), scale, 'consist__image'),
    ),
  ];
}

// Okno depa po vzoru OpenTTD: vlevo soupravy v depu (vagony přidat „+“, prodat „×“),
// vpravo sestavení a nákup nového vlaku s náhledem soupravy
export function openDepot(
  windows: WindowManager,
  game: Game,
  depot: Depot,
  focus: (x: number, z: number) => void,
  ride: (train: Train) => void,
): void {
  const id = `depot-${depot.id}`;
  const { fleet } = game;
  const report = (error: string | null): void => {
    if (error) game.news(error);
  };
  const pendingOrders = new Map<number, [number, number]>();
  // Nejnovější lokomotiva, kterou jde v depu koupit (elektrická jen v elektrizovaném)
  const newest = (): TrainModel => {
    const models = fleet.available().filter((m) => fleet.fitsDepot(m, depot));
    return models[models.length - 1] ?? fleet.available()[0];
  };
  // Sestava nového vlaku přežije obnovy okna
  const config = { modelId: newest().id, cargo: 'passengers' as Cargo, wagons: Math.min(3, MAX_WAGONS) };
  const openDetail = (train: Train): void =>
    openTrain(windows, game, train, { focus, ride, openDepot: (d) => openDepot(windows, game, d, focus, ride) });

  const button = (
    label: string | (string | HTMLElement)[],
    onClick: (e: MouseEvent) => void,
    options: { disabled?: boolean; title?: string; className?: string } = {},
  ): HTMLButtonElement => {
    const b = h(
      'button',
      {
        className: options.className ?? 'small-button',
        disabled: options.disabled ?? false,
        title: options.title ?? '',
      },
      ...(Array.isArray(label) ? label : [label]),
    );
    b.addEventListener('click', onClick);
    return b;
  };

  // Nástupiště seřazená od nejbližšího, ke kterému z depa vede kolej; nepropojená na konci
  const stationsByDistance = (): { id: number; name: string; connected: boolean }[] =>
    game.world.rail.stations
      .filter((s) => s.kind === undefined)
      .map((s) => ({ id: s.id, name: s.name, connected: fleet.connectedToDepot(depot, s), x: s.x, y: s.y }))
      .sort(
        (a, b) =>
          Number(b.connected) - Number(a.connected) ||
          Math.hypot(a.x - depot.x, a.y - depot.y) - Math.hypot(b.x - depot.x, b.y - depot.y),
      );

  const stationSelect = (selected: number | undefined): HTMLSelectElement => {
    const select = h('select', {});
    for (const s of stationsByDistance()) {
      const label = s.connected ? s.name : `${s.name} (bez koleje z depa)`;
      select.append(h('option', { value: String(s.id), selected: s.id === selected }, label));
    }
    return select;
  };

  // Souprava vlaku: v depu má každý vagon „×“ (prodat) a na konci „+“ (přidat vagon stejného nákladu)
  const consist = (train: Train): HTMLElement => {
    const model = trainModel(train);
    const inDepot = train.state === 'depot';
    const [loco, ...wagons] = consistImages(model, train.cargo, train.wagons, TRAIN_SCALE);
    const strip = h('div', { className: 'consist' });
    const locoCar = h('span', { className: 'consist__car', title: `${model.name} – otevřít detail vlaku` }, loco);
    locoCar.addEventListener('click', () => openDetail(train));
    strip.append(locoCar);
    wagons.forEach((img) => {
      const car = h('span', { className: 'consist__car' }, img);
      if (inDepot) {
        car.append(
          button('×', () => fleet.removeWagon(train), {
            className: 'consist__remove',
            title: `Prodat vagon (vrátí ${formatMoney(Math.round(WAGON_PRICE * sellFactor(trainAge(train, game.clock.day))))})`,
          }),
        );
      }
      strip.append(car);
    });
    if (inDepot && train.wagons < MAX_WAGONS) {
      strip.append(
        button('+', () => report(fleet.addWagon(train)), {
          className: 'consist__add',
          title: `Přidat vagon na ${CARGOS[train.cargo].noun} (${formatMoney(WAGON_PRICE)})`,
        }),
      );
    }
    return strip;
  };

  const trainCard = (train: Train): HTMLElement => {
    const model = trainModel(train);
    const inDepot = train.state === 'depot';
    const old = isOld(train, game.clock.day);
    const card = h(
      'div',
      { className: `depot-train${inDepot ? '' : ' depot-train--away'}` },
      h(
        'div',
        { className: 'depot-train__head' },
        h('strong', {}, train.name),
        h('span', {}, ` · ${model.name} · `),
        h('span', { className: old ? 'warning' : '' }, formatYears(trainAge(train, game.clock.day))),
        h('span', { className: 'depot-train__state' }, stateText(game, train)),
      ),
      consist(train),
      h(
        'div',
        { className: 'depot-train__stats' },
        `${wagonsText(train.wagons)} · ${formatLoad(train)} · ${speedKmh(model.speed)} km/h · délka ${formatTiles(trainLength(train))} · spolehlivost ${Math.round(train.reliability * 100)} %`,
      ),
    );
    const warning = shortStationsWarning(game, train);
    if (warning) card.append(h('div', { className: 'form__hint warning' }, warning));

    if (!inDepot) {
      card.append(
        h(
          'div',
          { className: 'train__actions' },
          button('Do depa', () => fleet.sendToDepot(train), { disabled: train.target === -1 }),
          button('Najít', () => focus(...pointAt(train.path, train.pos))),
          button('Detail', () => openDetail(train)),
        ),
      );
      return card;
    }

    const refitCost = train.wagons * REFIT_COST_PER_WAGON;
    const cargo = h('select', {
      title: `Přestavět všechny vagony na jiný náklad za ${formatMoney(refitCost)}; dosavadní náklad propadne`,
    });
    for (const c of CARGO_LIST) cargo.append(h('option', { value: c, selected: c === train.cargo }, CARGOS[c].name));
    cargo.addEventListener('change', () => report(fleet.setCargo(train, cargo.value as Cargo)));
    const renewal = fleet.renewalOffer(train);
    card.append(
      h(
        'div',
        { className: 'train__actions' },
        h(
          'label',
          { className: 'depot-train__cargo' },
          'Náklad ',
          cargo,
          ...(refitCost > 0 ? [h('small', {}, ` přestavba ${formatMoneyShort(refitCost)}`)] : []),
        ),
        button('Klonovat', (e) => report(cloneError(fleet.clone(train, depot, e.ctrlKey || e.metaKey))), {
          title: `Koupit stejný vlak i s jízdním řádem (${formatMoney(fleet.trainPrice(model, train.wagons))}); s Ctrl/Cmd na sdílený řád`,
        }),
        ...(renewal.model.id !== model.id || old
          ? [
              button(`Obnovit (${formatMoney(renewal.cost)})`, () => report(fleet.renew(train)), {
                title: `Vyměnit lokomotivu za ${renewal.model.name}`,
              }),
            ]
          : []),
        button(`Prodat (${formatMoney(sellPrice(train, game.clock.day))})`, () => fleet.sell(train)),
      ),
    );

    const orders = train.orders;
    if (orders) {
      card.append(
        h(
          'div',
          { className: 'train__actions' },
          h('span', { className: 'depot-train__orders' }, orders.map((_, i) => fleet.orderName(train, i)).join(' → ')),
          button('Jízdní řád', () => openDetail(train)),
          button('▶ Vyjet', () => report(fleet.start(train, orders)), {
            disabled: ordersError(orders, train.orderFlags) !== null,
            className: 'small-button small-button--go',
          }),
        ),
      );
      return card;
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
    card.append(
      stations.length < 2
        ? h('div', { className: 'form__hint' }, 'Pro vyjetí postavte aspoň dvě nástupiště spojená kolejí s depem.')
        : h(
            'div',
            { className: 'train__actions' },
            a,
            '↔',
            b,
            button('▶ Vyjet', () => report(fleet.start(train, [Number(a.value), Number(b.value)])), {
              className: 'small-button small-button--go',
            }),
            button('Více zastávek', () => openDetail(train)),
          ),
    );
    return card;
  };

  const cloneError = (result: Train | string): string | null => (typeof result === 'string' ? result : null);

  // Sestavení nového vlaku: lokomotiva, náklad, počet vagonů, náhled a souhrn
  const renderShop = (): HTMLElement => {
    const models = fleet.available();
    const model = models.find((m) => m.id === config.modelId && fleet.fitsDepot(m, depot)) ?? newest();
    config.modelId = model.id;
    const upcoming = TRAIN_MODELS.find((m) => m.year > game.clock.date.year);
    const set = (change: () => void): void => {
      change();
      pressed = false;
      refreshShop();
    };

    const list = h('div', { className: 'depot-models' });
    for (const m of [...models].reverse()) {
      // Elektrická lokomotiva jen v depu s trolejovým vedením (jako druhy kolejí v OpenTTD)
      const fits = fleet.fitsDepot(m, depot);
      list.append(
        button(
          [
            h('span', { className: 'depot-models__image' }, sideImage(KIT, m.model, LIST_SCALE, 'consist__image')),
            h(
              'span',
              { className: 'depot-models__text' },
              h('strong', {}, `${m.electric ? '⚡ ' : ''}${m.name}`),
              h(
                'small',
                {},
                fits
                  ? `${speedKmh(m.speed)} km/h · ${formatMoney(m.price)} · od ${m.year}`
                  : 'jen v elektrizovaném depu (nástroj Elektrizace)',
              ),
            ),
          ],
          () => set(() => (config.modelId = m.id)),
          {
            className: `depot-models__row${m.id === model.id ? ' depot-models__row--active' : ''}${fits ? '' : ' depot-models__row--soon'}`,
            disabled: !fits,
          },
        ),
      );
    }
    if (upcoming) {
      list.append(
        h(
          'div',
          { className: 'depot-models__row depot-models__row--soon' },
          h('span', { className: 'depot-models__image' }, sideImage(KIT, upcoming.model, LIST_SCALE, 'consist__image')),
          h(
            'span',
            { className: 'depot-models__text' },
            h('strong', {}, upcoming.name),
            h('small', {}, `dostupná od roku ${upcoming.year} · ${speedKmh(upcoming.speed)} km/h`),
          ),
        ),
      );
    }

    const cargoChips = h('div', { className: 'depot-cargo' });
    for (const c of CARGO_LIST) {
      const chip = button(
        [h('span', { className: 'depot-cargo__dot' }), CARGOS[c].name],
        () => set(() => (config.cargo = c)),
        { className: `depot-cargo__chip${c === config.cargo ? ' depot-cargo__chip--active' : ''}` },
      );
      (chip.firstChild as HTMLElement).style.background = CARGOS[c].color;
      cargoChips.append(chip);
    }

    const stepper = h(
      'div',
      { className: 'depot-stepper' },
      h('span', {}, 'Vagonů'),
      button('−', () => set(() => (config.wagons = Math.max(0, config.wagons - 1))), { disabled: config.wagons === 0 }),
      h('strong', { className: 'depot-stepper__value' }, String(config.wagons)),
      button('+', () => set(() => (config.wagons = Math.min(MAX_WAGONS, config.wagons + 1))), {
        disabled: config.wagons >= MAX_WAGONS,
      }),
      h('small', {}, `max ${MAX_WAGONS}`),
    );

    const preview = h(
      'div',
      { className: 'depot-preview' },
      h(
        'div',
        { className: 'consist consist--preview' },
        ...consistImages(model, config.cargo, config.wagons, PREVIEW_SCALE),
      ),
    );

    const price = fleet.trainPrice(model, config.wagons);
    const running = model.runningCost + config.wagons * WAGON_RUNNING_COST;
    const length = (config.wagons + 1) * 0.5;
    const stat = (label: string, value: string): HTMLElement[] => [h('dt', {}, label), h('dd', {}, value)];
    const stats = h(
      'dl',
      { className: 'depot-stats' },
      ...stat('Rychlost', `${speedKmh(model.speed)} km/h`),
      ...stat('Trať', model.electric ? '⚡ jen elektrizovaná' : 'jakákoli'),
      ...stat('Kapacita', config.wagons > 0 ? capacityText(config.cargo, config.wagons) : 'jen lokomotiva'),
      ...stat('Délka', `${formatTiles(length)} (nástupiště aspoň ${Math.ceil(length)})`),
      ...stat('Provoz', `${formatMoney(running)} / rok`),
      ...stat('Životnost', `${TRAIN_LIFETIME_YEARS} let`),
      ...stat('Spolehlivost', `${Math.round(model.reliability * 100)} %`),
      ...stat('Cena', `${formatMoney(model.price)} + ${wagonsText(config.wagons)} × ${formatMoney(WAGON_PRICE)}`),
    );
    const affordable = game.money >= price;
    const buy = button(
      `Koupit vlak · ${formatMoney(price)}`,
      () => {
        const result = fleet.buyTrain(depot, model, config.cargo, config.wagons);
        report(typeof result === 'string' ? result : null);
      },
      {
        className: `small-button small-button--go depot-buy${affordable ? '' : ' depot-buy--poor'}`,
        title: affordable ? 'Vlak se objeví v depu vlevo' : 'Nedostatek peněz',
      },
    );

    return h(
      'div',
      { className: 'depot-shop__body' },
      h('div', { className: 'depot-section' }, 'Lokomotiva'),
      list,
      h('div', { className: 'depot-section' }, 'Náklad'),
      cargoChips,
      stepper,
      preview,
      stats,
      buy,
    );
  };

  const renderTrains = (): HTMLElement[] => {
    const trains = fleet.inDepot(depot);
    // Vlaky stojící v depu nahoře, vlaky na trati pod nimi
    trains.sort((a, b) => Number(b.state === 'depot') - Number(a.state === 'depot') || a.id - b.id);
    if (trains.length === 0) {
      return [
        h(
          'div',
          { className: 'depot-empty' },
          'Depo zatím nemá žádné vlaky. Vpravo vyberte lokomotivu, náklad a počet vagonů a koupte vlak.',
        ),
      ];
    }
    return trains.map(trainCard);
  };

  const list = h('div', { className: 'depot-trains__list' });
  const shop = h('div', { className: 'depot-shop' });
  const root = h(
    'div',
    { className: 'depot' },
    h('div', { className: 'depot-trains' }, h('div', { className: 'depot-section' }, 'Vlaky depa'), list),
    h('div', { className: 'depot-shop__wrap' }, h('div', { className: 'depot-section' }, 'Nový vlak'), shop),
  );

  // Obnova počká, než hráč dokončí kliknutí nebo výběr v rozbaleném seznamu
  let pressed = false;
  let pendingList = false;
  let pendingShop = false;
  const busy = (): boolean => {
    const active = document.activeElement;
    return pressed || (active instanceof HTMLSelectElement && list.contains(active));
  };
  const flush = (): void => {
    if (busy()) return;
    if (pendingList) {
      pendingList = false;
      const scroll = list.scrollTop;
      list.replaceChildren(...renderTrains());
      list.scrollTop = scroll;
    }
    if (pendingShop) {
      pendingShop = false;
      const scroll = shop.querySelector('.depot-models')?.scrollTop ?? 0;
      shop.replaceChildren(renderShop());
      const models = shop.querySelector('.depot-models');
      if (models) models.scrollTop = scroll;
    }
  };
  const refresh = (): void => {
    pendingList = true;
    flush();
  };
  const refreshShop = (): void => {
    pendingShop = true;
    flush();
  };
  root.addEventListener('pointerdown', () => (pressed = true));
  const release = (): void => {
    pressed = false;
    setTimeout(flush);
  };
  window.addEventListener('pointerup', release);
  list.addEventListener('focusout', () => setTimeout(flush));

  list.replaceChildren(...renderTrains());
  refreshShop();
  const unsubscribe = [
    game.events.on('trainsChanged', () => {
      refresh();
      // Tlačítko koupě ukazuje, jestli na vlak stačí peníze
      refreshShop();
    }),
    game.events.on('railChanged', refresh),
    game.clock.events.on('month', refreshShop),
  ];
  windows.open(id, `Depo ${depot.id + 1}`, root, {
    onClose: () => {
      unsubscribe.forEach((off) => off());
      window.removeEventListener('pointerup', release);
    },
    locate: () => focus(depot.x + 0.5, depot.y + 0.5),
  });
}
