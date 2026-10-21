import { GAME_SPEEDS, formatDate, type GameSpeed } from '../game/clock';
import { Game, formatMoney } from '../game/game';
import { h } from './dom';

const NEWS_VISIBLE_MS = 30_000;

export interface ToolbarActions {
  openSaveLoad: () => void;
  openSettings: () => void;
  openFinance: () => void;
  openRailBuild: () => void;
  openRoadBuild: () => void;
  rotateView: (direction: 1 | -1) => void;
  openMinimap: () => void;
  openTrainList: () => void;
  openVehicleList: () => void;
  openNews: () => void;
  toggleInfo: () => void;
}

// Horní lišta s ikonami a spodní stavová lišta
export class Hud {
  private readonly dateEl = h('span', { className: 'statusbar__date' });
  private readonly companyEl = h('strong');
  private readonly newsEl = h('span', { className: 'statusbar__news' });
  private readonly moneyEl = h('span', { className: 'statusbar__money' });
  private readonly infoButton: HTMLButtonElement;
  private newsTimer = 0;

  constructor(root: HTMLElement, game: Game, actions: ToolbarActions) {
    const pause = h('button', { className: 'toolbar__button', title: 'Pozastavit (mezerník)' });
    const renderPause = (paused: boolean): void => {
      pause.textContent = paused ? '▶' : '⏸';
      pause.classList.toggle('toolbar__button--active', paused);
    };
    pause.addEventListener('click', () => (game.clock.paused = !game.clock.paused));
    game.clock.events.on('pause', renderPause);
    renderPause(game.clock.paused);

    const speed = h('button', { className: 'toolbar__button toolbar__button--text', title: 'Rychlost hry (1, 2, 3)' });
    const renderSpeed = (value: GameSpeed): void => {
      speed.textContent = `×${value}`;
      speed.classList.toggle('toolbar__button--active', value > 1);
    };
    speed.addEventListener('click', () => {
      const next = (GAME_SPEEDS.indexOf(game.clock.speed) + 1) % GAME_SPEEDS.length;
      game.clock.speed = GAME_SPEEDS[next];
    });
    game.clock.events.on('speed', renderSpeed);
    renderSpeed(game.clock.speed);

    const button = (icon: string, title: string, onClick?: () => void): HTMLButtonElement => {
      const b = h('button', { className: 'toolbar__button', title, textContent: icon });
      if (onClick) b.addEventListener('click', onClick);
      else b.disabled = true;
      return b;
    };

    const rotate = button('🔄', 'Otočit pohled o 90° (Q/E, pravé tlačítko opačně)', () => actions.rotateView(1));
    rotate.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      actions.rotateView(-1);
    });

    this.infoButton = button('❓', 'Informace o dlaždici a dosah nástupiště (I)', actions.toggleInfo);

    const toolbar = h(
      'div',
      { className: 'toolbar' },
      pause,
      speed,
      button('💾', 'Uložit / načíst hru', actions.openSaveLoad),
      button('⚙️', 'Nastavení a klávesové zkratky', actions.openSettings),
      button('💰', 'Finance (F)', actions.openFinance),
      button('🚆', 'Seznam vlaků (V)', actions.openTrainList),
      button('🚌', 'Seznam aut (A)', actions.openVehicleList),
      button('📰', 'Historie zpráv (H)', actions.openNews),
      button('🚂', 'Stavba železnice (K, N, D, B, X)', actions.openRailBuild),
      button('🛣️', 'Stavba silnic, zastávek a garáží (S, Z, U)', actions.openRoadBuild),
      this.infoButton,
      rotate,
      button('🗺️', 'Minimapa (M)', actions.openMinimap),
    );

    const center = h('span', { className: 'statusbar__center', title: 'Historie zpráv' }, this.companyEl, this.newsEl);
    center.addEventListener('click', actions.openNews);
    const statusbar = h('div', { className: 'statusbar' }, this.dateEl, center, this.moneyEl);
    root.append(toolbar, statusbar);

    game.clock.events.on('day', (date) => (this.dateEl.textContent = formatDate(date)));
    game.events.on('money', (money) => this.renderMoney(money));
    game.events.on('company', (name) => (this.companyEl.textContent = name));
    game.events.on('news', (text) => this.showNews(text));

    this.dateEl.textContent = formatDate(game.clock.date);
    this.companyEl.textContent = game.companyName;
    this.renderMoney(game.money);
  }

  setInfoActive(active: boolean): void {
    this.infoButton.classList.toggle('toolbar__button--active', active);
  }

  private renderMoney(money: number): void {
    this.moneyEl.textContent = formatMoney(money);
    this.moneyEl.classList.toggle('statusbar__money--negative', money < 0);
  }

  private showNews(text: string): void {
    this.newsEl.textContent = text;
    window.clearTimeout(this.newsTimer);
    this.newsTimer = window.setTimeout(() => (this.newsEl.textContent = ''), NEWS_VISIBLE_MS);
  }
}
