import { Game } from '../game/game';
import { INDUSTRY_NAMES, INDUSTRY_SIZE, type Industry } from '../world/industry';
import { h } from './dom';
import type { WindowManager } from './windows';

const tonnes = (value: number): string => `${Math.round(value).toLocaleString('cs-CZ')} t`;

// Okno závodu: těžba a odvoz u dolu, nástupiště s výkupem u elektrárny
export function openIndustry(
  windows: WindowManager,
  game: Game,
  industry: Industry,
  focus: (x: number, z: number) => void,
): void {
  const id = `industry-${industry.id}`;
  const render = (): HTMLElement => {
    const { freight } = game;
    const rows: [string, string][] = [['Typ', INDUSTRY_NAMES[industry.kind]]];
    let hint: string;
    if (industry.kind === 'coal-mine') {
      const stations = freight.pickupStations(industry).map((s) => s.name);
      const share = industry.production > 0 ? Math.round((industry.lastTransported / industry.production) * 100) : 0;
      rows.push(
        ['Těžba', `${tonnes(industry.production)} za měsíc`],
        ['Odvezeno minulý měsíc', `${tonnes(industry.lastTransported)} (${share} %)`],
        ['Odvezeno tento měsíc', tonnes(industry.transported)],
        ['Odvoz na nástupiště', stations.length > 0 ? stations.join(', ') : 'žádné'],
      );
      hint =
        'Uhlí se sváží na nástupiště v dosahu dolu, kam jezdí vlak s vagony na uhlí. ' +
        'Čím lepší hodnocení nástupiště, tím víc uhlí.';
    } else {
      const stations = game.world.rail.stations
        .filter((s) => freight.industriesInReach(s, 'power-station').includes(industry))
        .map((s) => s.name);
      rows.push(['Přijímá', 'uhlí'], ['Nástupiště s výkupem', stations.length > 0 ? stations.join(', ') : 'žádné']);
      hint = 'Vlak na uhlí ho vyloží a dostane zaplaceno na nástupišti, které má elektrárnu v dosahu.';
    }
    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        ...rows.map(([label, value]) => h('tr', {}, h('td', {}, label), h('td', {}, value))),
      ),
      h('div', { className: 'form__hint' }, hint),
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
