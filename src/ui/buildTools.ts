import { DEPOT_COST, ROAD_TILE_COST, TRACK_PIECE_COST } from '../game/balance';
import { STATION_COST } from '../game/construction';
import { Game, formatMoney } from '../game/game';
import type { BuildPreview } from '../render/preview';
import type { TilePos } from '../world/map';
import { EDGE_DELTA, Edge, PIECES, opposite, type Axis } from '../world/rail';
import { findTrackPath, type PathStep } from '../world/railPath';
import { findRoadPath, type RoadStep } from '../world/roadPath';
import { h } from './dom';
import type { WindowManager } from './windows';

export type BuildTool = 'track' | 'station' | 'depot' | 'road' | 'demolish';

// Největší strana obdélníku pro demolici
const MAX_DEMOLISH_SIZE = 64;

// Nástroje pro stavbu a demolici včetně náhledu a ceny u kurzoru
export class BuildTools {
  tool: BuildTool | null = null;
  private axis: Axis = 'x';
  private entrance: Edge = Edge.E;
  private dragStart: TilePos | null = null;
  private path: PathStep[] | null = null;
  private roadPath: RoadStep[] | null = null;
  private hover: TilePos | null = null;
  private readonly tooltip = h('div', { className: 'tooltip' });
  private readonly buttons = new Map<string, Map<BuildTool, HTMLButtonElement>>();

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

  openRailWindow(): void {
    this.openToolWindow('rail-build', 'Stavba železnice', [
      ['track', 'Koleje', `${formatMoney(TRACK_PIECE_COST)} / dílek`],
      ['station', 'Nástupiště 1×3', formatMoney(STATION_COST)],
      ['depot', 'Depo', formatMoney(DEPOT_COST)],
      ['demolish', 'Demolice', 'vrátí 50 %'],
    ]);
  }

  openRoadWindow(): void {
    this.openToolWindow('road-build', 'Stavba silnic', [
      ['road', 'Silnice', `${formatMoney(ROAD_TILE_COST)} / dílek`],
      ['demolish', 'Demolice', 'vrátí 50 %'],
    ]);
  }

  private openToolWindow(id: string, title: string, tools: [BuildTool, string, string][]): void {
    const buttons = new Map<BuildTool, HTMLButtonElement>();
    const content = h('div', { className: 'form' });
    for (const [tool, label, price] of tools) {
      const b = h('button', { className: 'tool-button' }, h('span', {}, label), h('small', {}, price));
      b.addEventListener('click', () => this.setTool(this.tool === tool ? null : tool));
      buttons.set(tool, b);
      content.append(b);
    }
    content.append(
      h(
        'div',
        { className: 'form__hint' },
        'Koleje, silnice a demolice: táhněte levým tlačítkem. R – otočit, Esc – zrušit nástroj.',
      ),
    );
    this.windows.open(id, title, content, {
      width: 260,
      onClose: () => {
        this.buttons.delete(id);
        if (this.tool && buttons.has(this.tool)) this.setTool(null);
      },
    });
    this.buttons.set(id, buttons);
    this.renderButtons();
  }

  setTool(tool: BuildTool | null): void {
    this.tool = tool;
    this.dragStart = null;
    this.path = null;
    this.roadPath = null;
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
    if (this.tool === 'track' || this.tool === 'road' || this.tool === 'demolish') {
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
    const { construction } = this.game;
    if (this.tool === 'track' && this.path) construction.buildTrack(this.path);
    if (this.tool === 'road' && this.roadPath) construction.buildRoad(this.roadPath);
    if (this.tool === 'demolish') this.report(construction.demolish(this.demolishArea()));
    this.dragStart = null;
    this.path = null;
    this.roadPath = null;
    this.refresh();
  }

  private updatePath(): void {
    const target = this.hover ?? this.dragStart;
    if (!this.dragStart || !target) return;
    const { rail } = this.game.world;
    if (this.tool === 'track') this.path = findTrackPath(rail, this.dragStart, target);
    if (this.tool === 'road') this.roadPath = findRoadPath(rail, this.dragStart, target);
  }

  // Obdélník mezi začátkem tažení a kurzorem, bez tažení jen dlaždice pod kurzorem
  private demolishArea(): TilePos[] {
    const a = this.dragStart ?? this.hover;
    const b = this.hover ?? a;
    if (!a || !b) return [];
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.min(Math.max(a.x, b.x), x0 + MAX_DEMOLISH_SIZE - 1);
    const y1 = Math.min(Math.max(a.y, b.y), y0 + MAX_DEMOLISH_SIZE - 1);
    const tiles: TilePos[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
    return tiles;
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
    for (const buttons of this.buttons.values()) {
      for (const [tool, b] of buttons) b.classList.toggle('tool-button--active', tool === this.tool);
    }
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
    } else if (this.tool === 'road' && this.dragStart) {
      if (this.roadPath) {
        const tiles = this.roadPath.filter((s) => s.isNew).length;
        const cost = tiles * ROAD_TILE_COST;
        this.preview.showArea(this.roadPath, cost <= this.game.money ? 'road' : 'invalid');
        text = `${tiles} dílků · ${formatMoney(cost)}`;
      } else {
        text = 'Silnici nelze vést';
      }
    } else if (this.tool === 'demolish' && tile) {
      const plan = this.game.construction.demolishPlan(this.demolishArea());
      this.preview.showArea(plan.tiles, 'demolish');
      if (plan.blocked) {
        text = plan.blocked;
      } else if (plan.tiles.length > 0) {
        text = plan.cost > 0 ? `Demolice: ${formatMoney(plan.cost)}` : `Vrátí se: ${formatMoney(-plan.cost)}`;
      }
    }

    this.tooltip.textContent = text;
    this.tooltip.style.display = text ? 'block' : 'none';
  }
}
