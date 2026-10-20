import { DEPOT_COST, TRACK_PIECE_COST } from '../game/balance';
import { STATION_COST } from '../game/construction';
import { Game, formatMoney } from '../game/game';
import type { BuildPreview } from '../render/preview';
import type { TilePos } from '../world/map';
import { EDGE_DELTA, Edge, PIECES, opposite, type Axis } from '../world/rail';
import { findTrackPath, type PathStep } from '../world/railPath';
import { h } from './dom';
import type { WindowManager } from './windows';

export type RailTool = 'track' | 'station' | 'depot';

const WINDOW_ID = 'rail-build';

// Nástroje pro stavbu kolejí, nástupišť a dep včetně náhledu a ceny u kurzoru
export class RailTools {
  tool: RailTool | null = null;
  private axis: Axis = 'x';
  private entrance: Edge = Edge.E;
  private dragStart: TilePos | null = null;
  private path: PathStep[] | null = null;
  private hover: TilePos | null = null;
  private readonly tooltip = h('div', { className: 'tooltip' });
  private readonly buttons = new Map<RailTool, HTMLButtonElement>();

  constructor(
    private readonly game: Game,
    private readonly windows: WindowManager,
    private readonly preview: BuildPreview,
    root: HTMLElement,
  ) {
    root.append(this.tooltip);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'Escape') this.setTool(null);
      if (e.key === 'r' || e.key === 'R') this.rotate();
    });
  }

  openWindow(): void {
    const button = (tool: RailTool, label: string, price: string): HTMLButtonElement => {
      const b = h('button', { className: 'tool-button' }, h('span', {}, label), h('small', {}, price));
      b.addEventListener('click', () => this.setTool(this.tool === tool ? null : tool));
      this.buttons.set(tool, b);
      return b;
    };
    const content = h(
      'div',
      { className: 'form' },
      button('track', 'Koleje', `${formatMoney(TRACK_PIECE_COST)} / dílek`),
      button('station', 'Nástupiště 1×3', formatMoney(STATION_COST)),
      button('depot', 'Depo', formatMoney(DEPOT_COST)),
      h('div', { className: 'form__hint' }, 'Koleje: táhněte levým tlačítkem. R – otočit, Esc – zrušit nástroj.'),
    );
    this.windows.open(WINDOW_ID, 'Stavba železnice', content, {
      width: 240,
      onClose: () => this.setTool(null),
    });
    this.renderButtons();
  }

  setTool(tool: RailTool | null): void {
    this.tool = tool;
    this.dragStart = null;
    this.path = null;
    this.renderButtons();
    this.refresh();
  }

  rotate(): void {
    if (this.tool === 'station') this.axis = this.axis === 'x' ? 'y' : 'x';
    if (this.tool === 'depot') this.entrance = (this.entrance + 1) % 4;
    this.refresh();
  }

  pointerDown(tile: TilePos | null): void {
    if (!tile || !this.tool) return;
    if (this.tool === 'track') {
      this.dragStart = tile;
      this.updatePath();
    } else if (this.tool === 'station') {
      this.report(this.game.construction.buildStation(tile.x, tile.y, this.axis));
    } else {
      this.report(this.game.construction.buildDepot(tile.x, tile.y, this.depotEntrance(tile)));
    }
    this.refresh();
  }

  pointerMove(tile: TilePos | null, clientX: number, clientY: number): void {
    this.tooltip.style.left = `${clientX + 16}px`;
    this.tooltip.style.top = `${clientY + 16}px`;
    if (tile?.x === this.hover?.x && tile?.y === this.hover?.y) return;
    this.hover = tile;
    if (this.dragStart) this.updatePath();
    this.refresh();
  }

  pointerUp(): void {
    if (!this.dragStart) return;
    if (this.path) this.game.construction.buildTrack(this.path);
    this.dragStart = null;
    this.path = null;
    this.refresh();
  }

  private updatePath(): void {
    const target = this.hover ?? this.dragStart;
    this.path = this.dragStart && target ? findTrackPath(this.game.world.rail, this.dragStart, target) : null;
  }

  // Depo se natočí vjezdem ke kolejím na sousední dlaždici, jinak podle R
  private depotEntrance(tile: TilePos): Edge {
    const { rail } = this.game.world;
    for (let edge = 0; edge < 4; edge++) {
      const [dx, dy] = EDGE_DELTA[edge];
      const back = opposite(edge);
      const connects = PIECES.some(
        ([a, b], piece) => (a === back || b === back) && rail.has(tile.x + dx, tile.y + dy, piece),
      );
      if (connects) return edge;
    }
    return this.entrance;
  }

  private report(error: string | null): void {
    if (error) this.game.news(error);
  }

  private renderButtons(): void {
    for (const [tool, b] of this.buttons) b.classList.toggle('tool-button--active', tool === this.tool);
  }

  private refresh(): void {
    const { rail } = this.game.world;
    const tile = this.hover;
    let text = '';
    this.preview.clear();

    if (this.tool === 'track' && this.dragStart) {
      if (this.path) {
        const pieces = this.path.filter((s) => s.isNew).length;
        const cost = pieces * TRACK_PIECE_COST;
        this.preview.showTrack(this.path, cost <= this.game.money);
        text = `${pieces} dílků · ${formatMoney(cost)}`;
      } else if (tile && (tile.x !== this.dragStart.x || tile.y !== this.dragStart.y)) {
        text = 'Trasu nelze vést';
      }
    } else if (this.tool === 'station' && tile) {
      const ok = rail.canPlaceStation(tile.x, tile.y, this.axis);
      this.preview.showStation(tile.x, tile.y, this.axis, ok && this.game.money >= STATION_COST);
      text = ok ? formatMoney(STATION_COST) : 'Sem nástupiště postavit nelze';
    } else if (this.tool === 'depot' && tile) {
      const ok = rail.canPlaceDepot(tile.x, tile.y);
      this.preview.showDepot(tile.x, tile.y, this.depotEntrance(tile), ok && this.game.money >= DEPOT_COST);
      text = ok ? formatMoney(DEPOT_COST) : 'Sem depo postavit nelze';
    }

    this.tooltip.textContent = text;
    this.tooltip.style.display = text ? 'block' : 'none';
  }
}
