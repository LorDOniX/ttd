import { formatDate } from '../game/clock';
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
}

// Horní lišta s ikonami a spodní stavová lišta
export class Hud {
  private readonly dateEl = h('span', { className: 'statusbar__date' });
  private readonly companyEl = h('strong');
  private readonly newsEl = h('span', { className: 'statusbar__news' });
  private readonly moneyEl = h('span', { className: 'statusbar__money' });
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

    const button = (icon: string, title: string, onClick?: () => void): HTMLButtonElement => {
      const b = h('button', { className: 'toolbar__button', title, textContent: icon });
      if (onClick) b.addEventListener('click', onClick);
      else b.disabled = true;
      return b;
    };

    const rotate = button('🔄', 'Otočit pohled o 90° (pravé tlačítko opačně)', () => actions.rotateView(1));
    rotate.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      actions.rotateView(-1);
    });

    const toolbar = h(
      'div',
      { className: 'toolbar' },
      pause,
      button('💾', 'Uložit / načíst hru', actions.openSaveLoad),
      button('⚙️', 'Nastavení', actions.openSettings),
      button('💰', 'Finance', actions.openFinance),
      button('🚂', 'Stavba železnice', actions.openRailBuild),
      button('🛣️', 'Stavba silnic', actions.openRoadBuild),
      rotate,
    );

    const statusbar = h(
      'div',
      { className: 'statusbar' },
      this.dateEl,
      h('span', { className: 'statusbar__center' }, this.companyEl, this.newsEl),
      this.moneyEl,
    );
    root.append(toolbar, statusbar);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, button')) return;
      e.preventDefault();
      game.clock.paused = !game.clock.paused;
    });

    game.clock.events.on('day', (date) => (this.dateEl.textContent = formatDate(date)));
    game.events.on('money', (money) => this.renderMoney(money));
    game.events.on('company', (name) => (this.companyEl.textContent = name));
    game.events.on('news', (text) => this.showNews(text));

    this.dateEl.textContent = formatDate(game.clock.date);
    this.companyEl.textContent = game.companyName;
    this.renderMoney(game.money);
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
