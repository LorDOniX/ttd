import { cityCarName, trafficDays, type CityCar } from '../game/cityTraffic';
import type { Game } from '../game/game';
import { vehiclePoint } from '../game/roadVehicles';
import { h } from './dom';
import type { WindowManager } from './windows';

export interface CityCarActions {
  car: (id: number) => CityCar | null;
  relocate: (id: number) => boolean;
  focus: (x: number, z: number) => void;
}

// Okno městského auta; zaseknuté auto jde odstranit, objeví se jinde v témže městě
export function openCityCar(windows: WindowManager, game: Game, car: CityCar, actions: CityCarActions): void {
  const id = `city-car-${car.id}`;
  const townName = game.world.towns[car.townId]?.name ?? '';
  let message = '';
  const render = (): HTMLElement => {
    const days = Math.floor(trafficDays(car.stuckSeconds));
    const state = days >= 1 ? `Stojí ${days} ${days === 1 ? 'den' : days < 5 ? 'dny' : 'dní'}` : 'Jede';
    const remove = h(
      'button',
      { className: 'small-button', title: 'Auto zmizí a objeví se na jiném místě ve městě' },
      'Odstranit auto',
    );
    remove.addEventListener('click', () => {
      if (actions.relocate(car.id)) {
        windows.close(id);
        return;
      }
      message = 'Ve městě teď není jinde volné místo, zkuste to později.';
      windows.update(id, render());
    });
    return h(
      'div',
      { className: 'form' },
      h(
        'table',
        { className: 'table' },
        h('tr', {}, h('td', {}, 'Město'), h('td', {}, townName)),
        h('tr', {}, h('td', {}, 'Stav'), h('td', {}, state)),
      ),
      h('div', { className: 'train__actions' }, remove),
      h(
        'div',
        { className: 'form__hint' },
        message || 'Uvízne-li auto v provozu, odstraňte ho: objeví se na jiném místě v témže městě.',
      ),
    );
  };

  const refresh = (): void => {
    if (!windows.isOpen(id)) return;
    if (actions.car(car.id) !== car) windows.close(id);
    else windows.update(id, render());
  };
  const unsubscribe = game.clock.events.on('day', refresh);
  windows.open(id, cityCarName(car.model), render(), {
    width: 300,
    onClose: unsubscribe,
    locate: () => {
      const p = vehiclePoint(car.path, car.pos);
      actions.focus(p.x, p.y);
    },
  });
}
