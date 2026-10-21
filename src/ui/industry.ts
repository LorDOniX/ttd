import { CARGOS } from '../game/cargo';
import { Game } from '../game/game';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type Industry } from '../world/industry';
import { h } from './dom';
import type { WindowManager } from './windows';

const tonnes = (value: number): string => `${Math.round(value).toLocaleString('cs-CZ')} t`;
const list = (names: string[]): string => (names.length > 0 ? names.join(', ') : 'žádné');

// Okno závodu: výroba a odvoz u producenta, nástupiště s výkupem u odběratele
export function openIndustry(
  windows: WindowManager,
  game: Game,
  industry: Industry,
  focus: (x: number, z: number) => void,
): void {
  const id = `industry-${industry.id}`;
  const type = INDUSTRY_TYPES[industry.kind];
  const render = (): HTMLElement => {
    const { freight } = game;
    const rows: [string, string][] = [['Typ', type.name]];
    const hints: string[] = [];
    if (type.produces) {
      const { noun } = CARGOS[type.produces];
      const stations = freight.pickupStations(industry).map((s) => s.name);
      const share = industry.production > 0 ? Math.round((industry.lastTransported / industry.production) * 100) : 0;
      rows.push(
        ['Produkuje', noun],
        ['Výroba', `${tonnes(industry.production)} za měsíc`],
        ['Odvezeno minulý měsíc', `${tonnes(industry.lastTransported)} (${share} %)`],
        ['Odvezeno tento měsíc', tonnes(industry.transported)],
        ['Odvoz na nástupiště', list(stations)],
      );
      hints.push(
        `Náklad (${noun}) se sváží na nástupiště v dosahu, kam jezdí vlak s odpovídajícími vagony. ` +
          'Čím lepší hodnocení nástupiště, tím víc nákladu.',
      );
    }
    if (type.accepts.length > 0) {
      const stations = game.world.rail.stations
        .filter((s) => freight.industriesInReach(s).includes(industry))
        .map((s) => s.name);
      rows.push(
        ['Přijímá', type.accepts.map((t) => CARGOS[t].noun).join(', ')],
        ['Dovezeno minulý měsíc', tonnes(industry.lastReceived)],
        ['Dovezeno tento měsíc', tonnes(industry.received)],
        ['Nástupiště s výkupem', list(stations)],
      );
      hints.push('Vlak náklad vyloží a dostane zaplaceno na nástupišti, které má závod v dosahu.');
      if (type.produces) {
        hints.push(`Z dovezeného nákladu vyrobí následující měsíc stejně tun (${CARGOS[type.produces].genitive}).`);
      }
    }
    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        ...rows.map(([label, value]) => h('tr', {}, h('td', {}, label), h('td', {}, value))),
      ),
      h('div', { className: 'form__hint' }, hints.join(' ')),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen(id)) windows.update(id, render());
  };
  // Nástupiště se mění denně (příliv), to stačí i na obnovu odvozu
  const unsubscribe = [game.events.on('trainsChanged', refresh), game.events.on('stationsChanged', refresh)];
  const half = INDUSTRY_SIZE / 2;
  windows.open(id, industry.name, render(), {
    width: 320,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => focus(industry.x + half, industry.y + half),
  });
}
