import { MAINTENANCE_RATE } from '../game/balance';
import { trackPieceCost } from '../game/construction';
import { Game, formatMoney } from '../game/game';
import { catchmentArea, inArea } from '../game/passengers';
import { NO_OWNER, TileType, type TilePos } from '../world/map';
import { industryAt, type Industry } from '../world/industry';
import type { Depot, Station } from '../world/rail';
import { buildingAt, buildingCapacity, type Town } from '../world/town';
import { h } from './dom';
import { stationRows } from './station';
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
  [TileType.RoadStop]: 'Zastávka aut',
  [TileType.RoadDepot]: 'Garáž aut',
};

export interface TileInfoLinks {
  focus: (x: number, z: number) => void;
  openDepot: (depot: Depot) => void;
  openRoadDepot: (depot: Depot) => void;
  openTown: (town: Town) => void;
  openIndustry: (industry: Industry) => void;
  openStation: (station: Station) => void;
}

const monthly = (value: number): string => `${formatMoney(Math.round((value * MAINTENANCE_RATE) / 12))} měsíčně`;

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
    if (type === TileType.Road || type === TileType.Crossing || type === TileType.RoadStop) {
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
      rows.push(...stationRows(game, station));
      action('Otevřít stanici', () => links.openStation(station));
    }

    const depot = rail.depotAt(x, y);
    if (depot) {
      rows.push(['Vlaků z depa', String(game.fleet.inDepot(depot).length)]);
      action('Otevřít depo', () => links.openDepot(depot));
    }

    const roadDepot = rail.roadDepotAt(x, y);
    if (roadDepot) {
      rows.push(['Aut z garáže', String(game.roadFleet.inDepot(roadDepot).length)]);
      action('Otevřít garáž', () => links.openRoadDepot(roadDepot));
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
