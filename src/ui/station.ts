import { stationCost } from '../game/construction';
import { CARGOS, CARGO_TYPES, transferWaiting, type Cargo } from '../game/cargo';
import { Game, formatMoney } from '../game/game';
import {
  AIRPORT_TYPES,
  MAINTENANCE_RATE,
  STATION_SPREAD,
  TOWN_ACCEPTS_MIN_BUILDINGS,
  roadVehicleKit,
} from '../game/balance';
import { aircraftModel, type Aircraft } from '../game/aircraft';
import { shipModel, type Ship } from '../game/ships';
import { ratingParts, targetRating, waitingAmount } from '../game/rating';
import { roadVehicleModel, type RoadVehicle } from '../game/roadVehicles';
import { servesStation, trainModel, type Train } from '../game/trains';
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
  // Náklad z překládky čeká na další vozidlo zvlášť
  const transfer = Math.floor(transferWaiting(station, cargo));
  const extra = transfer > 0 ? ` + ${transfer} z překládky` : '';
  return cargo === 'passengers' ? `čeká ${amount}${extra}` : `${amount} t${extra}`;
}

// Cargodist: čekající náklad podle cíle a spojení ze stanice s kapacitou za měsíc
function distributionRows(game: Game, station: Station): [string, string][] {
  const { cargodist } = game;
  return stationCargos(game, station).flatMap((c): [string, string][] => {
    if (!cargodist.enabled(c)) return [];
    const linked = cargodist.linksFrom(station, c);
    const waiting = waitingAmount(station, c) + transferWaiting(station, c);
    // Druh, který odtud nic neveze a nic nečeká, okno nezahlcuje
    if (linked.length === 0 && Math.floor(waiting) <= 0) return [];
    const links = linked.map((l) => `${cargodist.stationName(l.to)} ${Math.round(l.capacity)}`).join(', ');
    return [
      [`${CARGOS[c].name} – cíle`, cargodist.waitingText(station, c, waitingAmount(station, c))],
      [`${CARGOS[c].name} – spojení`, links ? `${links} (kapacita za měsíc)` : 'žádné'],
    ];
  });
}

// Popis části stanice: „nástupiště 2×5“, „zastávka aut“, „malé letiště 5×4“, „přístav se 2 kotvišti“
export function partLabel(part: Station): string {
  if (part.kind === 'road') return 'zastávka aut';
  if (part.kind === 'air')
    return `${AIRPORT_TYPES[part.airport ?? 'small'].name.toLowerCase()} ${part.length}×${part.tracks}`;
  if (part.kind === 'water') return 'přístav se 2 kotvišti';
  return `nástupiště ${part.tracks}×${part.length}`;
}

// Vozidla, která mají část stanice v řádu
function servingVehicles(
  game: Game,
  part: Station,
): { trains: Train[]; vehicles: RoadVehicle[]; aircraft: Aircraft[]; ships: Ship[] } {
  return {
    trains: part.kind ? [] : game.fleet.trains.filter((t) => servesStation(t, part.id)),
    vehicles: part.kind === 'road' ? game.roadFleet.vehicles.filter((v) => v.orders?.includes(part.id)) : [],
    aircraft: part.kind === 'air' ? game.airFleet.aircraft.filter((p) => p.orders?.includes(part.id)) : [],
    ships: part.kind === 'water' ? game.shipFleet.ships.filter((s) => s.orders?.includes(part.id)) : [],
  };
}

// Řádky s přehledem stanice (i spojené ze všech částí) pro okno stanice i informace o dlaždici
export function stationRows(game: Game, station: Station): [string, string][] {
  const now = game.clock.now;
  const parts = game.world.rail.membersOf(station);
  const onlyRail = parts.every((part) => !part.kind);
  const served = [
    ...new Set(
      parts.flatMap((part) => {
        const v = servingVehicles(game, part);
        return [...v.trains, ...v.vehicles, ...v.aircraft, ...v.ships].map((t) => t.name);
      }),
    ),
  ];
  const reach = [...game.passengers.townShares(station)].map(([t, share]) => `${t.name} (${percent(share)})`);
  const industries = game.freight.industriesInReach(station).map((i) => i.name);
  const accepted = game.freight.accepted(station).map((t) => CARGOS[t].noun);
  const towns = reach.length > 0;
  const maintenance = parts.reduce((sum, part) => sum + stationCost(part), 0) * MAINTENANCE_RATE;
  return [
    ['Název', station.name],
    [parts.length > 1 ? 'Části' : 'Typ', parts.map(partLabel).join(', ')],
    ...stationCargos(game, station).map((c): [string, string] => {
      const { rating, lastVisit } = station.ratings[c];
      const ratingInfo = ratingParts(station, c, now);
      const visit = lastVisit < 0 ? 'nikdy' : `před ${Math.floor(now - lastVisit)} dny`;
      return [
        CARGOS[c].name,
        `${waitingText(station, c)} · hodnocení ${percent(rating)} → ` +
          `${percent(targetRating(station, c, now, game.authority.stationBonus(station)))} ` +
          `(${onlyRail ? 'vlak' : 'návštěva'} ${visit} ${percent(ratingInfo.visit)}, rychlost ${percent(ratingInfo.speed)}, ` +
          `čekající ${percent(ratingInfo.waiting)})`,
      ];
    }),
    ...distributionRows(game, station),
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
    ['Obsluhují', served.length > 0 ? served.join(', ') : 'nikdo'],
    ['Údržba', `${formatMoney(maintenance / 12)} měsíčně`],
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
    openAircraft?: (plane: Aircraft) => void;
    openHangar?: (airport: Station) => void;
    openShip?: (ship: Ship) => void;
    openShipyard?: (port: Station) => void;
  },
): void {
  // Okno patří celé spojené stanici (hlavní části); zbouráním hlavní části ho převezme další část
  let primary = game.world.rail.primaryOf(station);
  const id = `station-${primary.id}`;
  const render = (): HTMLElement => {
    const parts = game.world.rail.membersOf(primary);
    const serving = parts.map((part) => servingVehicles(game, part));
    const trains = serving.flatMap((v) => v.trains);
    const vehicles = serving.flatMap((v) => v.vehicles);
    const aircraft = serving.flatMap((v) => v.aircraft);
    const ships = serving.flatMap((v) => v.ships);
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
          modelThumb(roadVehicleKit(roadVehicleModel(v)), roadVehicleModel(v).model),
          v.name,
        );
        b.addEventListener('click', () => links.openVehicle(v));
        return b;
      }),
      ...aircraft.map((p) => {
        const b = h(
          'button',
          { className: 'small-button small-button--thumb' },
          modelThumb('airplanes', aircraftModel(p).model),
          p.name,
        );
        b.addEventListener('click', () => links.openAircraft?.(p));
        return b;
      }),
      ...ships.map((s) => {
        const b = h(
          'button',
          { className: 'small-button small-button--thumb' },
          modelThumb('watercraft kit', shipModel(s).model),
          s.name,
        );
        b.addEventListener('click', () => links.openShip?.(s));
        return b;
      }),
    ];
    for (const part of parts) {
      if (part.kind === 'water' && links.openShipyard) {
        const b = h('button', { className: 'small-button' }, '⚓ Loděnice');
        b.addEventListener('click', () => links.openShipyard!(part));
        buttons.push(b);
      }
      if (part.kind === 'air' && links.openHangar) {
        const b = h('button', { className: 'small-button' }, '🛩️ Hangár');
        b.addEventListener('click', () => links.openHangar!(part));
        buttons.push(b);
      }
    }
    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        ...stationRows(game, primary)
          .filter(([label]) => !label.startsWith('Obsluhují'))
          .map(([label, value]) => h('tr', {}, h('td', {}, label), h('td', {}, value))),
      ),
      h('h4', {}, 'Vozidla'),
      buttons.length > 0
        ? h('div', { className: 'train__actions' }, ...buttons)
        : h('div', { className: 'form__hint' }, 'Stanici zatím žádné vozidlo neobsluhuje.'),
      h(
        'div',
        { className: 'form__hint' },
        'Hodnocení každého druhu nákladu roste s častými a rychlými vlaky a klesá, když náklad čeká dlouho. ' +
          'Čím vyšší hodnocení, tím víc cestujících a nákladu na stanici přijde. ' +
          'Nástupiště, zastávku, letiště nebo přístav postavené vedle stanice (s Ctrl kamkoli do ' +
          `${STATION_SPREAD} polí) k ní připojíte: části sdílejí jméno, náklad i hodnocení a dosah se sčítá.`,
      ),
    );
  };
  const refresh = (): void => {
    const { rail } = game.world;
    if (!rail.stations.includes(primary)) {
      // Hlavní část zbořena: okno převezme část, která stanici převzala
      const heir = rail.stations.find((s) => s.name === primary.name && s.joinedTo === undefined);
      if (!heir) {
        windows.close(id);
        return;
      }
      primary = heir;
    }
    if (windows.isOpen(id)) windows.update(id, render());
  };
  const unsubscribe = [
    game.events.on('stationsChanged', refresh),
    game.events.on('trainsChanged', refresh),
    game.events.on('vehiclesChanged', refresh),
    game.events.on('aircraftChanged', refresh),
    game.events.on('shipsChanged', refresh),
  ];
  windows.open(id, primary.name, render(), {
    width: 420,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => links.focus(primary.x + 0.5, primary.y + 0.5),
  });
}
