import {
  BRIDGE_PIECE_COST,
  DEMOLISH_REFUND,
  DEPOT_COST,
  MAX_STATION_LENGTH,
  MAX_STATION_TRACKS,
  PLATFORM_TILE_COST,
  ROAD_TILE_COST,
  SIGNAL_COST,
  TRACK_PIECE_COST,
} from '../game/balance';
import { CARGOS } from '../game/cargo';
import { stationCost, trackPieceCost } from '../game/construction';
import { Game, formatMoney } from '../game/game';
import { catchmentArea } from '../game/passengers';
import type { BuildPreview } from '../render/preview';
import { TileType, type TilePos } from '../world/map';
import { EDGE_DELTA, Edge, PIECES, defaultStationShape, opposite, type Axis, type StationShape } from '../world/rail';
import { findTrackPath, pieceAtCursor, singlePieceStep, type PathStep } from '../world/railPath';
import { findRoadPath, type RoadStep } from '../world/roadPath';
import { h } from './dom';
import type { WindowManager } from './windows';

export type BuildTool = 'track' | 'station' | 'depot' | 'signal' | 'road' | 'demolish' | 'info';

// Dlaždice pod kurzorem a poloha kurzoru uvnitř ní (0..1)
export interface PointerTile extends TilePos {
  fx: number;
  fy: number;
}

// Největší strana obdélníku pro demolici
const MAX_DEMOLISH_SIZE = 64;

// Nástroje pro stavbu a demolici včetně náhledu a ceny u kurzoru; „?“ jen zobrazuje informace
export class BuildTools {
  tool: BuildTool | null = null;
  onInspect: (tile: TilePos) => void = () => {};
  onToolChange: (tool: BuildTool | null) => void = () => {};
  private axis: Axis = 'x';
  private entrance: Edge = Edge.E;
  private dragStart: TilePos | null = null;
  private path: PathStep[] | null = null;
  private roadPath: RoadStep[] | null = null;
  private hover: PointerTile | null = null;
  private readonly tooltip = h('div', { className: 'tooltip' });
  private readonly buttons = new Map<string, Map<BuildTool, HTMLButtonElement>>();

  constructor(
    private readonly game: Game,
    private readonly windows: WindowManager,
    private readonly preview: BuildPreview,
    root: HTMLElement,
  ) {
    root.append(this.tooltip);
    // Koleje se staví postupně, náhled pod kurzorem se musí obnovit po každé změně
    game.events.on('railChanged', () => {
      if (this.tool && !this.dragStart) this.refresh();
    });
  }

  openRailWindow(): void {
    this.openToolWindow('rail-build', 'Stavba železnice', [
      [
        'track',
        '🛤️',
        'Koleje',
        'K',
        `${formatMoney(TRACK_PIECE_COST)} / dílek, most ${formatMoney(BRIDGE_PIECE_COST)}`,
      ],
      ['station', '🚉', 'Nástupiště', 'N', `${formatMoney(PLATFORM_TILE_COST)} / dílek`],
      ['depot', '🏭', 'Depo', 'D', formatMoney(DEPOT_COST)],
      ['signal', '🚦', 'Návěstidlo', 'B', `${formatMoney(SIGNAL_COST)}, znovu = odstranit`],
      ['demolish', '🧨', 'Demolice', 'X', 'vrátí 50 %'],
    ]);
  }

  openRoadWindow(): void {
    this.openToolWindow('road-build', 'Stavba silnic', [
      ['road', '🛣️', 'Silnice', 'S', `${formatMoney(ROAD_TILE_COST)} / dílek`],
      ['demolish', '🧨', 'Demolice', 'X', 'vrátí 50 %'],
    ]);
  }

  private openToolWindow(id: string, title: string, tools: [BuildTool, string, string, string, string][]): void {
    const buttons = new Map<BuildTool, HTMLButtonElement>();
    const content = h('div', { className: 'form' });
    for (const [tool, icon, label, key, price] of tools) {
      const b = h(
        'button',
        { className: 'tool-button' },
        h('span', {}, h('span', { className: 'tool-button__icon' }, icon), label, h('kbd', {}, key)),
        h('small', {}, price),
      );
      b.addEventListener('click', () => this.setTool(this.tool === tool ? null : tool));
      buttons.set(tool, b);
      content.append(b);
    }
    content.append(
      h(
        'div',
        { className: 'form__hint' },
        'Koleje, silnice a demolice: táhněte levým tlačítkem. Kliknutím položíte jeden dílek koleje ' +
          '(podle polohy kurzoru rovný nebo v rohu dlaždice zatáčku). Nástupiště: kliknutím 1×3, tažením větší. ' +
          'Návěstidla dělí trať na úseky, aby za sebou mohlo jet víc vlaků. ' +
          'R – otočit, Esc – zrušit nástroj.',
      ),
    );
    this.windows.open(id, title, content, {
      width: 320,
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
    this.onToolChange(tool);
  }

  // Zkratka: nástroj zapne i se zavřeným oknem (otevře ho), opakovaně vypne
  toggleTool(tool: BuildTool): void {
    const windowOpen = [...this.buttons.values()].some((buttons) => buttons.has(tool));
    if (!windowOpen && tool !== 'info') {
      if (tool === 'road') this.openRoadWindow();
      else this.openRailWindow();
    }
    this.setTool(this.tool === tool ? null : tool);
  }

  rotate(): void {
    if (this.tool === 'station') this.axis = this.axis === 'x' ? 'y' : 'x';
    if (this.tool === 'depot') this.entrance = (this.entrance + 1) % 4;
    this.refresh();
  }

  pointerDown(tile: PointerTile | null): void {
    if (!tile || !this.tool) return;
    this.hover = tile;
    if (this.tool === 'info') {
      this.onInspect(tile);
      return;
    }
    if (this.tool === 'signal') {
      this.report(this.game.construction.toggleSignal(tile.x, tile.y));
    } else if (this.tool === 'track' || this.tool === 'road' || this.tool === 'demolish' || this.tool === 'station') {
      this.dragStart = tile;
      this.updatePath();
    } else {
      this.report(this.game.construction.buildDepot(tile.x, tile.y, this.depotEntrance(tile)));
    }
    this.refresh();
  }

  pointerMove(tile: PointerTile | null, clientX: number, clientY: number): void {
    this.tooltip.style.left = `${clientX + 16}px`;
    this.tooltip.style.top = `${clientY + 16}px`;
    const previous = this.hover;
    this.hover = tile;
    const sameTile = tile?.x === previous?.x && tile?.y === previous?.y;
    // Na jedné dlaždici se u kolejí může změnit jen vybraný kus podle polohy kurzoru
    const samePiece =
      this.tool !== 'track' ||
      !tile ||
      !previous ||
      pieceAtCursor(tile.fx, tile.fy) === pieceAtCursor(previous.fx, previous.fy);
    if (sameTile && samePiece) return;
    if (this.dragStart) this.updatePath();
    this.refresh();
  }

  pointerUp(): void {
    if (!this.dragStart) return;
    const { construction } = this.game;
    if (this.tool === 'track' && this.path) construction.buildTrack(this.path);
    if (this.tool === 'road' && this.roadPath) construction.buildRoad(this.roadPath);
    if (this.tool === 'demolish') this.report(construction.demolish(this.demolishArea()));
    if (this.tool === 'station') {
      const shape = this.stationShape();
      if (shape) this.report(construction.buildStation(shape));
    }
    this.dragStart = null;
    this.path = null;
    this.roadPath = null;
    this.refresh();
  }

  private updatePath(): void {
    const target = this.hover ?? this.dragStart;
    if (!this.dragStart || !target) return;
    const { rail } = this.game.world;
    if (this.tool === 'track') this.path = this.trackPath(this.dragStart, target);
    if (this.tool === 'road') this.roadPath = findRoadPath(rail, this.dragStart, target);
  }

  // Tažení na stejné dlaždici (nebo klik) staví jediný kus podle polohy kurzoru
  private trackPath(start: TilePos, target: TilePos): PathStep[] | null {
    const { rail } = this.game.world;
    if (start.x !== target.x || start.y !== target.y) return findTrackPath(rail, start, target);
    const step = this.hover && singlePieceStep(rail, start, this.hover.fx, this.hover.fy);
    return step ? [step] : null;
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

  // Bez tažení výchozí 1×3 pod kurzorem; tažením obdélník, delší strana určí směr kolejí
  private stationShape(): StationShape | null {
    const start = this.dragStart;
    const end = this.hover ?? start;
    if (!start || !end || (start.x === end.x && start.y === end.y)) {
      const tile = end ?? this.hover;
      return tile ? defaultStationShape(tile.x, tile.y, this.axis) : null;
    }
    const sizeX = Math.abs(end.x - start.x) + 1;
    const sizeY = Math.abs(end.y - start.y) + 1;
    const axis: Axis = sizeX > sizeY ? 'x' : sizeY > sizeX ? 'y' : this.axis;
    const length = Math.min(axis === 'x' ? sizeX : sizeY, MAX_STATION_LENGTH);
    const tracks = Math.min(axis === 'x' ? sizeY : sizeX, MAX_STATION_TRACKS);
    const [w, hgt] = axis === 'x' ? [length, tracks] : [tracks, length];
    // Obdélník roste od začátku tažení směrem ke kurzoru
    const x0 = end.x >= start.x ? start.x : start.x - w + 1;
    const y0 = end.y >= start.y ? start.y : start.y - hgt + 1;
    const [along, across] = [Math.floor(length / 2), Math.floor(tracks / 2)];
    return axis === 'x'
      ? { x: x0 + along, y: y0 + across, axis, length, tracks }
      : { x: x0 + across, y: y0 + along, axis, length, tracks };
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

  // Co bude nové nástupiště obsluhovat: díl měst, náklad k odvozu a výkup
  private reachText(shape: StationShape): string {
    const { passengers, freight } = this.game;
    const { shares, buildings } = passengers.coverage(shape);
    const parts = [...shares].map(([town, share]) => `${town.name} ${Math.round(share * 100)} %`);
    const produced = freight.produced(shape);
    if (produced.length > 0) parts.push(produced.map((t) => CARGOS[t].noun).join(', '));
    const accepted = freight.acceptedIn(shape, buildings);
    if (accepted.length > 0) parts.push(`výkup ${accepted.map((t) => CARGOS[t].genitive).join(', ')}`);
    return parts.length > 0 ? parts.join(' · ') : 'mimo dosah města a průmyslu';
  }

  private showCatchment(shape: StationShape): void {
    const { map } = this.game.world;
    const { x0, y0, x1, y1 } = catchmentArea(shape);
    const tiles: TilePos[] = [];
    for (let y = Math.max(0, y0); y <= Math.min(map.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(map.width - 1, x1); x++) tiles.push({ x, y });
    }
    this.preview.showCatchment(tiles);
  }

  private renderButtons(): void {
    for (const buttons of this.buttons.values()) {
      for (const [tool, b] of buttons) b.classList.toggle('tool-button--active', tool === this.tool);
    }
  }

  // Náhled kolejí, vrací text s počtem nových dílků a cenou
  private showTrack(path: PathStep[]): string {
    const { map } = this.game.world;
    const fresh = path.filter((s) => s.isNew);
    const cost = fresh.reduce((sum, s) => sum + trackPieceCost(map, s.x, s.y), 0);
    const bridges = fresh.filter((s) => map.get(s.x, s.y) === TileType.Water).length;
    this.preview.showTrack(path, cost <= this.game.money);
    if (fresh.length === 0) return 'Kolej už je postavená';
    const n = fresh.length;
    const pieces = n === 1 ? 'dílek' : n <= 4 ? 'dílky' : 'dílků';
    return `${n} ${pieces}${bridges > 0 ? ` (most ${bridges})` : ''} · ${formatMoney(cost)}`;
  }

  private refresh(): void {
    const { rail } = this.game.world;
    const tile = this.hover;
    let text = '';
    this.preview.clear();

    if (this.tool === 'track' && this.dragStart) {
      if (this.path) text = this.showTrack(this.path);
      else if (tile && (tile.x !== this.dragStart.x || tile.y !== this.dragStart.y)) text = 'Trasu nelze vést';
      else text = 'Sem kolej položit nelze';
    } else if (this.tool === 'track' && tile) {
      // Bez tažení náhled kusu, který postaví kliknutí
      const step = singlePieceStep(rail, tile, tile.fx, tile.fy);
      text = step ? this.showTrack([step]) : 'Sem kolej položit nelze';
    } else if (this.tool === 'station' && tile) {
      const shape = this.stationShape();
      if (shape) {
        const ok = rail.canPlaceStation(shape);
        const cost = stationCost(shape);
        this.preview.showStation(shape, ok && this.game.money >= cost);
        this.showCatchment(shape);
        text = ok
          ? `Nástupiště ${shape.tracks}×${shape.length} · ${formatMoney(cost)} · ${this.reachText(shape)}`
          : 'Sem nástupiště postavit nelze';
      }
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
    } else if (this.tool === 'info' && tile) {
      const station = rail.stationAt(tile.x, tile.y);
      if (station) {
        this.showCatchment(station);
        text = `${station.name} – dosah nástupiště`;
      }
    } else if (this.tool === 'signal' && tile) {
      const { x, y } = tile;
      if (rail.hasSignal(x, y)) {
        this.preview.showArea([tile], 'demolish');
        text = `Odstranit návěstidlo · vrátí ${formatMoney(SIGNAL_COST * DEMOLISH_REFUND)}`;
      } else if (rail.canPlaceSignal(x, y)) {
        this.preview.showArea([tile], this.game.money >= SIGNAL_COST ? 'valid' : 'invalid');
        text = `Návěstidlo · ${formatMoney(SIGNAL_COST)}`;
      } else {
        this.preview.showArea([tile], 'invalid');
        text = 'Návěstidlo jen na rovnou kolej bez výhybky';
      }
    } else if (this.tool === 'demolish' && tile) {
      const plan = this.game.construction.demolishPlan(this.demolishArea());
      this.preview.showArea(plan.tiles, 'demolish');
      if (plan.blocked) {
        text = plan.blocked;
      } else if (plan.tiles.length > 0 && plan.cost === 0) {
        text = 'Demolice zdarma';
      } else if (plan.tiles.length > 0) {
        text = plan.cost > 0 ? `Demolice: ${formatMoney(plan.cost)}` : `Vrátí se: ${formatMoney(-plan.cost)}`;
      }
    }

    this.tooltip.textContent = text;
    this.tooltip.style.display = text ? 'block' : 'none';
  }
}
