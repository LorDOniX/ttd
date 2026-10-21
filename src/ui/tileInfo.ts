import { MAINTENANCE_RATE, TOWN_ACCEPTS_MIN_BUILDINGS } from '../game/balance';
import { CARGOS } from '../game/cargo';
import { stationCost, trackPieceCost } from '../game/construction';
import { Game, formatMoney } from '../game/game';
import { catchmentArea, inArea } from '../game/passengers';
import { ratingParts, targetRating } from '../game/rating';
import { NO_OWNER, TileType, type TilePos } from '../world/map';
import { industryAt, type Industry } from '../world/industry';
import type { Depot } from '../world/rail';
import { buildingAt, buildingCapacity, type Town } from '../world/town';
import { h } from './dom';
import type { WindowManager } from './windows';

const TILE_NAMES: Record<TileType, string> = {
  [TileType.Grass]: 'Tráva',
  [TileType.Water]: 'Voda',
  [TileType.Road]: 'Silnice',
  [TileType.Building]: 'Budova',
  [TileType.Rail]: 'Kolej',
  [TileType.Station]: 'Nástupiště',
  [TileType.Depot]: 'Depo',
  [TileType.Crossing]: 'Železniční přejezd',
  [TileType.Trees]: 'Les',
  [TileType.Bridge]: 'Železniční most',
  [TileType.Industry]: 'Průmysl',
};

export interface TileInfoLinks {
  focus: (x: number, z: number) => void;
  openDepot: (depot: Depot) => void;
  openTown: (town: Town) => void;
  openIndustry: (industry: Industry) => void;
}

const monthly = (value: number): string => `${formatMoney(Math.round((value * MAINTENANCE_RATE) / 12))} měsíčně`;
const percent = (value: number): string => `${Math.round(value * 100)} %`;

// Okno nástroje „?“: co na dlaždici je a do dosahu kterých nástupišť patří
export function openTileInfo(windows: WindowManager, game: Game, tile: TilePos, links: TileInfoLinks): void {
  const { map, rail, towns } = game.world;
  const { x, y } = tile;

  const render = (): HTMLElement => {
    const type = map.get(x, y);
    const rows: [string, string | HTMLElement][] = [
      ['Dlaždice', `${x}, ${y}`],
      ['Typ', TILE_NAMES[type]],
    ];
    const actions: HTMLButtonElement[] = [];
    const action = (label: string, onClick: () => void): void => {
      const b = h('button', { className: 'small-button', textContent: label });
      b.addEventListener('click', onClick);
      actions.push(b);
    };

    const owner = map.getOwner(x, y);
    const town = owner === NO_OWNER ? null : towns[owner];
    if (type === TileType.Road || type === TileType.Crossing) {
      rows.push(['Vlastník silnice', town ? town.name : 'vaše společnost']);
    }
    if (type === TileType.Building && town) {
      const building = buildingAt(town, x, y);
      rows.push(['Město', town.name]);
      if (building) rows.push(['Obyvatel budovy', String(buildingCapacity(building.model))]);
    }
    if (town) action(`Město ${town.name}`, () => links.openTown(town));
    const industry = type === TileType.Industry ? industryAt(game.world.industries, x, y) : undefined;
    if (industry) {
      rows.push(['Název', industry.name]);
      action('Otevřít závod', () => links.openIndustry(industry));
    }

    if (type === TileType.Rail || type === TileType.Crossing || type === TileType.Bridge) {
      const value = rail.pieceCount(x, y) * trackPieceCost(map, x, y);
      rows.push(['Kusů kolejí', String(rail.pieceCount(x, y))], ['Údržba', monthly(value)]);
      if (rail.hasSignal(x, y)) rows.push(['Návěstidlo', 'ano']);
      const owner = game.fleet.reservations.ownerAt(x, y);
      const holder = game.fleet.trains.find((t) => t.id === owner);
      if (holder) rows.push(['Rezervuje', holder.name]);
    }

    const station = rail.stationAt(x, y);
    if (station) {
      const served = game.fleet.trains.filter((t) => t.orders?.includes(station.id)).map((t) => t.name);
      // Podíl zástavby města v dosahu určuje příliv cestujících
      const reach = [...game.passengers.townShares(station)].map(([t, share]) => `${t.name} (${percent(share)})`);
      const now = game.clock.now;
      const parts = ratingParts(station, now);
      const visit = station.lastVisit < 0 ? 'nikdy' : `před ${Math.floor(now - station.lastVisit)} dny`;
      const industries = game.freight.industriesInReach(station).map((i) => i.name);
      const accepted = game.freight.accepted(station).map((t) => CARGOS[t].noun);
      rows.push(
        ['Název', station.name],
        ['Rozměr', `${station.tracks}×${station.length}`],
        ['Čeká cestujících', String(Math.floor(station.waiting))],
        ...(game.passengers.townsInReach(station).length > 0
          ? [['Pošta k odvozu', `${Math.floor(station.freight.mail)} t`] as [string, string]]
          : []),
        ...game.freight
          .produced(station)
          .map((t): [string, string] => [`K odvozu (${CARGOS[t].noun})`, `${Math.floor(station.freight[t])} t`]),
        ['Výkup', accepted.length > 0 ? accepted.join(', ') : 'nic'],
        ['Hodnocení', `${percent(station.rating)} (směřuje k ${percent(targetRating(station, now))})`],
        [
          'Složení hodnocení',
          `poslední vlak ${visit}: ${percent(parts.visit)}, rychlost: ${percent(parts.speed)}, ` +
            `čekající: ${percent(parts.waiting)}`,
        ],
        ['Příliv za měsíc', String(Math.round(game.passengers.inflow(station)))],
        ['Města v dosahu', reach.length > 0 ? reach.join(', ') : 'žádná'],
        [
          'Budovy v dosahu',
          `${game.passengers.buildingsInReach(station)} (zboží vykupuje od ${TOWN_ACCEPTS_MIN_BUILDINGS})`,
        ],
        ['Průmysl v dosahu', industries.length > 0 ? industries.join(', ') : 'žádný'],
        ['Obsluhují vlaky', served.length > 0 ? served.join(', ') : 'žádné'],
        ['Údržba', monthly(stationCost(station))],
      );
    }

    const depot = rail.depotAt(x, y);
    if (depot) {
      rows.push(['Vlaků z depa', String(game.fleet.inDepot(depot).length)]);
      action('Otevřít depo', () => links.openDepot(depot));
    }

    const covering = rail.stations.filter((s) => inArea(catchmentArea(s), x, y)).map((s) => s.name);
    rows.push(['V dosahu nástupišť', covering.length > 0 ? covering.join(', ') : 'žádného']);

    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        ...rows.map(([label, value]) => h('tr', {}, h('td', {}, label), h('td', {}, value))),
      ),
      ...(actions.length > 0 ? [h('div', { className: 'train__actions' }, ...actions)] : []),
    );
  };

  const off = game.clock.events.on('day', () => windows.update('tile-info', render()));
  windows.open('tile-info', 'Informace o dlaždici', render(), {
    width: 320,
    onClose: off,
    locate: () => links.focus(x + 0.5, y + 0.5),
  });
}
