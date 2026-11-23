import { INDUSTRY_IDLE_YEARS, INDUSTRY_WELL_SERVED } from '../game/balance';
import { CARGOS } from '../game/cargo';
import type { GameDate } from '../game/clock';
import { Game } from '../game/game';
import { INDUSTRY_SIZE, INDUSTRY_TYPES, type Industry } from '../world/industry';
import { barChart } from './chart';
import { h } from './dom';
import type { WindowManager } from './windows';

const tonnes = (value: number): string => `${Math.round(value).toLocaleString('cs-CZ')} t`;
const list = (names: string[]): string => (names.length > 0 ? names.join(', ') : 'žádné');

// Popisky posledních count uzavřených měsíců (nejstarší první): „3/51“
function monthLabels(date: GameDate, count: number): string[] {
  const current = date.year * 12 + date.month;
  return Array.from({ length: count }, (_, i) => {
    const m = current - count + i;
    return `${(m % 12) + 1}/${String(Math.floor(m / 12)).slice(-2)}`;
  });
}

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
      if (type.production) {
        const served = `při odvozu aspoň ${Math.round(INDUSTRY_WELL_SERVED * 100)} % spíš stoupá`;
        hints.push(
          game.economy === 'frozen'
            ? 'Výroba se nemění (zmrazená ekonomika).'
            : game.economy === 'smooth'
              ? `Výroba se mění po malých krocích (o 4–23 %), ${served}. Vyčerpaný závod ohlásí uzavření.`
              : `Výroba občas skokem stoupne nebo klesne, ${served}. Vyčerpaný závod ohlásí uzavření.`,
        );
      }
    }
    if (type.accepts.length > 0) {
      const stations = game.world.rail
        .primaries()
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
        hints.push(
          `Z dovezeného nákladu vyrobí následující měsíc stejně tun (${CARGOS[type.produces].genitive}). ` +
            `Bez dodávek déle než ${INDUSTRY_IDLE_YEARS} let může závod zaniknout.`,
        );
      }
    }
    const history = industry.history ?? [];
    const chart =
      type.produces && history.length > 0
        ? [
            h('h4', {}, 'Výroba a odvoz po měsících'),
            barChart(
              monthLabels(game.clock.date, history.length),
              [
                { label: 'Výroba', color: '#8a8f98', values: history.map((m) => m.production) },
                { label: 'Odvezeno', color: CARGOS[type.produces].color, values: history.map((m) => m.transported) },
              ],
              (v) => `${Math.round(v)} t`,
            ),
          ]
        : [];
    return h(
      'div',
      { className: 'form' },
      ...(industry.closing
        ? [h('div', { className: 'form__hint warning' }, 'Závod ohlásil uzavření – na konci měsíce zanikne.')]
        : []),
      h(
        'table',
        { className: 'table' },
        ...rows.map(([label, value]) => h('tr', {}, h('td', {}, label), h('td', {}, value))),
      ),
      ...chart,
      h('div', { className: 'form__hint' }, hints.join(' ')),
    );
  };

  const refresh = (): void => {
    if (windows.isOpen(id)) windows.update(id, render());
  };
  // Nástupiště se mění denně (příliv), to stačí i na obnovu odvozu
  const unsubscribe = [
    game.events.on('trainsChanged', refresh),
    game.events.on('stationsChanged', refresh),
    game.events.on('industriesChanged', () => {
      if (!game.world.industries.includes(industry)) windows.close(id);
      else refresh();
    }),
  ];
  const half = INDUSTRY_SIZE / 2;
  windows.open(id, industry.name, render(), {
    width: 440,
    onClose: () => unsubscribe.forEach((off) => off()),
    locate: () => focus(industry.x + half, industry.y + half),
  });
}
