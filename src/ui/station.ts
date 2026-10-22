import { stationCost } from '../game/construction';
import { CARGOS, CARGO_TYPES, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import { MAINTENANCE_RATE, TOWN_ACCEPTS_MIN_BUILDINGS } from '../game/balance';
import { ratingParts, targetRating, waitingAmount } from '../game/rating';
import { roadVehicleModel, type RoadVehicle } from '../game/roadVehicles';
import { trainModel, type Train } from '../game/trains';
import { modelThumb } from '../render/icons';
import type { Station } from '../world/rail';
import { h } from './dom';
import type { WindowManager } from './windows';

const percent = (value: number): string => `${Math.round(value * 100)} %`;

// Náklad, o který na nástupišti jde: z měst a závodů v dosahu a co sem už někdy vlak vozil
export function stationCargos(game: Game, station: Station): Cargo[] {
  const towns = game.passengers.townsInReach(station).length > 0;
  const produced: readonly Cargo[] = game.freight.produced(station);
  return CARGO_TYPES.filter(
    (c) => (towns && (c === 'passengers' || c === 'mail')) || produced.includes(c) || station.ratings[c].lastVisit >= 0,
  );
}

function waitingText(station: Station, cargo: Cargo): string {
  const amount = Math.floor(waitingAmount(station, cargo));
  return cargo === 'passengers' ? `čeká ${amount}` : `${amount} t`;
}

// Řádky s přehledem nástupiště pro okno stanice i informace o dlaždici
export function stationRows(game: Game, station: Station): [string, string][] {
  const now = game.clock.now;
  const road = station.kind === 'road';
  const served = (
    road
      ? game.roadFleet.vehicles.filter((v) => v.orders?.includes(station.id))
      : game.fleet.trains.filter((t) => t.orders?.includes(station.id))
  ).map((t) => t.name);
  const reach = [...game.passengers.townShares(station)].map(([t, share]) => `${t.name} (${percent(share)})`);
  const industries = game.freight.industriesInReach(station).map((i) => i.name);
  const accepted = game.freight.accepted(station).map((t) => CARGOS[t].noun);
  const towns = reach.length > 0;
  return [
    ['Název', station.name],
    road ? ['Typ', 'Zastávka aut'] : ['Rozměr', `${station.tracks}×${station.length}`],
    ...stationCargos(game, station).map((c): [string, string] => {
      const { rating, lastVisit } = station.ratings[c];
      const parts = ratingParts(station, c, now);
      const visit = lastVisit < 0 ? 'nikdy' : `před ${Math.floor(now - lastVisit)} dny`;
      return [
        CARGOS[c].name,
        `${waitingText(station, c)} · hodnocení ${percent(rating)} → ${percent(targetRating(station, c, now))} ` +
          `(${road ? 'návštěva' : 'vlak'} ${visit} ${percent(parts.visit)}, rychlost ${percent(parts.speed)}, ` +
          `čekající ${percent(parts.waiting)})`,
      ];
    }),
    ['Výkup', accepted.length > 0 ? accepted.join(', ') : 'nic'],
    ...(towns
      ? [['Příliv cestujících za měsíc', String(Math.round(game.passengers.inflow(station)))] as [string, string]]
      : []),
    ['Města v dosahu', towns ? reach.join(', ') : 'žádná'],
    [
      'Budovy v dosahu',
      `${game.passengers.buildingsInReach(station)} (poštu a zboží vykupuje od ${TOWN_ACCEPTS_MIN_BUILDINGS})`,
    ],
    ['Průmysl v dosahu', industries.length > 0 ? industries.join(', ') : 'žádný'],
    [road ? 'Obsluhují auta' : 'Obsluhují vlaky', served.length > 0 ? served.join(', ') : 'žádná'],
    ['Údržba', `${formatMoney((stationCost(station) * MAINTENANCE_RATE) / 12)} měsíčně`],
  ];
}

// Okno stanice jako v OpenTTD: čekající náklad, hodnocení podle druhu a vlaky, které ji obsluhují
export function openStation(
  windows: WindowManager,
  game: Game,
  station: Station,
  links: {
    focus: (x: number, z: number) => void;
    openTrain: (train: Train) => void;
    openVehicle: (vehicle: RoadVehicle) => void;
  },
): void {
  const id = `station-${station.id}`;
  const road = station.kind === 'road';
  const render = (): HTMLElement => {
    const trains = game.fleet.trains.filter((t) => t.orders?.includes(station.id));
    const vehicles = game.roadFleet.vehicles.filter((v) => v.orders?.includes(station.id));
    const buttons = [
      ...trains.map((t) => {
        const b = h(
          'button',
          { className: 'small-button small-button--thumb' },
          modelThumb('train kit', trainModel(t).model),
          t.name,
        );
        b.addEventListener('click', () => links.openTrain(t));
        return b;
      }),
      ...vehicles.map((v) => {
        const b = h(
          'button',
          { className: 'small-button small-button--thumb' },
          modelThumb('car kit', roadVehicleModel(v).model),
          v.name,
        );
        b.addEventListener('click', () => links.openVehicle(v));
        return b;
      }),
    ];
    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        ...stationRows(game, station)
          .filter(([label]) => !label.startsWith('Obsluhují'))
          .map(([label, value]) => h('tr', {}, h('td', {}, label), h('td', {}, value))),
      ),
      h('h4', {}, road ? 'Auta' : 'Vlaky'),
      buttons.length > 0
        ? h('div', { className: 'train__actions' }, ...buttons)
        : h(
            'div',
            { className: 'form__hint' },
            road ? 'Zastávku zatím žádné auto neobsluhuje.' : 'Stanici zatím žádný vlak neobsluhuje.',
          ),
      h(
        'div',
        { className: 'form__hint' },
        'Hodnocení každého druhu nákladu roste s častými a rychlými vlaky a klesá, když náklad čeká dlouho. ' +
          'Čím vyšší hodnocení, tím víc cestujících a nákladu na stanici přijde.',
      ),
    );
  };
  const refresh = (): void => {
    if (!game.world.rail.stations.includes(station)) windows.close(id);
    else if (windows.isOpen(id)) windows.update(id, render());
  };
  const unsubscribe = [
    game.events.on('stationsChanged', refresh),
    game.events.on('trainsChanged', refresh),
    game.events.on('vehiclesChanged', refresh),
  ];
  windows.open(id, station.name, render(), {
    width: 420,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => links.focus(station.x + 0.5, station.y + 0.5),
  });
}
