import {
  AIRPORT_TYPES,
  BRIDGE_PIECE_COST,
  DEMOLISH_REFUND,
  DEPOT_COST,
  INDUSTRY_FUND_COST,
  MAX_STATION_LENGTH,
  MAX_STATION_TRACKS,
  PLATFORM_TILE_COST,
  PORT_COST,
  ROAD_DEPOT_COST,
  ROAD_STOP_COST,
  ROAD_TILE_COST,
  SIGNAL_COST,
  STATION_LENGTH,
  STATION_SPREAD,
  ELECTRIFY_TILE_COST,
  TRACK_PIECE_COST,
  WAYPOINT_COST,
  type AirportType,
} from '../game/balance';
import { CARGOS } from '../game/cargo';
import { roadPieceCost, stationCost, trackPieceCost } from '../game/construction';
import { Game, formatMoneyShort } from '../game/game';
import { catchmentArea } from '../game/passengers';
import {
  depotIcon,
  iconElement,
  industryIcon,
  sceneIcon,
  signalIcon,
  stationIcon,
  type SceneIcon,
} from '../render/icons';
import type { BuildPreview } from '../render/preview';
import { roadConnects } from '../render/roads';
import { INDUSTRY_TYPES, industrySiteProblem, industryTiles, type IndustryKind } from '../world/industry';
import { airportShape } from '../world/airport';
import { portAt } from '../world/port';
import { TileType, type TilePos } from '../world/map';
import {
  EDGE_DELTA,
  EDGE_MID,
  Edge,
  PIECES,
  stationTiles,
  opposite,
  type Axis,
  type Station,
  type StationShape,
} from '../world/rail';
import {
  autorailLine,
  autorailPlan,
  depotLinks,
  pieceAtCursor,
  removablePieceAt,
  singlePieceStep,
  withDepotLinks,
  type AutorailPlan,
} from '../world/railPath';
import { findRoadPath, roadEdgeAtCursor, singleRoadSteps, type RoadStep } from '../world/roadPath';
import { h } from './dom';
import type { WindowManager } from './windows';
import { partLabel } from './station';

export type BuildTool =
  | 'track'
  | 'bridge'
  | 'station'
  | 'depot'
  | 'signal'
  | 'waypoint'
  | 'electrify'
  | 'road'
  | 'road-stop'
  | 'road-depot'
  | 'airport-small'
  | 'airport-large'
  | 'port'
  | 'demolish'
  | 'industry'
  | 'info';

// Nástroj letiště → velikost letiště
function airportTool(tool: BuildTool | null): AirportType | null {
  if (tool === 'airport-small') return 'small';
  return tool === 'airport-large' ? 'large' : null;
}

// Dlaždice pod kurzorem a poloha kurzoru uvnitř ní (0..1)
export interface PointerTile extends TilePos {
  fx: number;
  fy: number;
}

// Stav kláves Ctrl/Cmd (odebírání kolejí) a Shift (jen odhad ceny) jako v OpenTTD
export interface Modifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

// Nástroje s oknem voleb (orientace depa, rozměry nástupiště)
type OptionTool = 'depot' | 'road-depot' | 'station' | 'signal';
const OPTIONS_WINDOW = 'build-options';
const JOIN_WINDOW = 'station-join';

function optionTool(tool: BuildTool | null): tool is OptionTool {
  return tool === 'depot' || tool === 'road-depot' || tool === 'station' || tool === 'signal';
}

const EDGE_NAMES = ['sever', 'východ', 'jih', 'západ'];

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

// Návěstidlo k postavení: dir = hrana výjezdu u jednosměrného
interface SignalItem extends TilePos {
  dir?: Edge;
}

// Hustota návěstidel při tažení (každých N dlaždic) jako v OpenTTD
const MIN_SIGNAL_DENSITY = 1;
const MAX_SIGNAL_DENSITY = 20;

// Největší strana obdélníku pro demolici
const MAX_DEMOLISH_SIZE = 64;

// Areál 3×3 se středem pod kurzorem, vrací levý horní roh
function industrySite(tile: TilePos): TilePos {
  return { x: tile.x - 1, y: tile.y - 1 };
}

// Co závod těží nebo vykupuje, do popisku tlačítka
function industryRole(kind: IndustryKind): string {
  const { produces, accepts } = INDUSTRY_TYPES[kind];
  const parts: string[] = [];
  if (accepts.length > 0) parts.push(`vykupuje ${accepts.map((t) => CARGOS[t].genitive).join(', ')}`);
  if (produces) parts.push(`${accepts.length > 0 ? 'vyrábí' : 'těží'} ${CARGOS[produces].noun}`);
  return parts.join(', ');
}

// Nástroje pro stavbu a demolici včetně náhledu a ceny u kurzoru; „?“ jen zobrazuje informace
export class BuildTools {
  tool: BuildTool | null = null;
  onInspect: (tile: TilePos) => void = () => {};
  onToolChange: (tool: BuildTool | null) => void = () => {};
  private axis: Axis = 'x';
  private entrance: Edge = Edge.E;
  // Upřednostněná strana přístavu k vodě (R)
  private dock: Edge = Edge.S;
  // Depo (i garáž) se natočí samo ke kolejím/silnici; volbou orientace v okně se vypne
  private depotAuto = true;
  // Nástupiště: pevný rozměr z okna, nebo tažením (Drag & Drop)
  private stationLength = STATION_LENGTH;
  private stationTracks = 1;
  private stationDrag = false;
  // Návěstidla: jednosměrná a hustota při tažení
  private signalOneWay = false;
  private signalDensity = 4;
  private showCoverage = true;
  private removeMode = false;
  // Druh koleje ke stavbě jako v OpenTTD: běžná, nebo elektrizovaná (koleje, nástupiště a depa s trolejemi)
  private electricRail = false;
  private estimateMode = false;
  // Tlačítka okna voleb a jejich stav (obnovuje se při každé změně)
  private optionButtons: { el: HTMLButtonElement; active: () => boolean; disabled?: () => boolean }[] = [];
  private optionInfo: HTMLElement | null = null;
  private signalDensityValue: HTMLElement | null = null;
  // Okno voleb se při přepnutí nástroje zavírá a otevírá znovu (kvůli titulku), nástroj přitom nevypne
  private reopeningOptions = false;
  private readonly onOptionsClose = (): void => {
    this.optionButtons = [];
    this.optionInfo = null;
    this.signalDensityValue = null;
    if (!this.reopeningOptions && optionTool(this.tool)) this.setTool(null);
  };
  private dragStart: PointerTile | null = null;
  private path: AutorailPlan | null = null;
  private roadPath: RoadStep[] | null = null;
  private hover: PointerTile | null = null;
  private readonly tooltip = h('div', { className: 'tooltip' });
  private readonly buttons = new Map<string, Map<BuildTool, HTMLButtonElement>>();
  private industryKind: IndustryKind = 'coal-mine';
  private industryRotation = 0;
  private industryButtons: Map<IndustryKind, HTMLButtonElement> | null = null;

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
    const onKey = (e: KeyboardEvent): void => this.setModifiers(e);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', () => this.setModifiers({ ctrlKey: false, metaKey: false, shiftKey: false }));
  }

  // Ctrl/Cmd přepne koleje na odebírání, Shift ukáže jen cenu; náhled se obnoví hned po stisku
  setModifiers(mods: Modifiers): void {
    const remove = mods.ctrlKey || mods.metaKey;
    const estimate = mods.shiftKey;
    if (remove === this.removeMode && estimate === this.estimateMode) return;
    this.removeMode = remove;
    this.estimateMode = estimate;
    if (this.tool === 'track') {
      if (this.dragStart) this.updatePath();
      this.refresh();
    }
    // U stanic Ctrl/Cmd vybírá, ke které stanici se nová část připojí; obnoví se nápověda
    if (this.stationTool()) this.refresh();
  }

  private stationTool(): boolean {
    return (
      this.tool === 'station' || this.tool === 'road-stop' || this.tool === 'port' || airportTool(this.tool) !== null
    );
  }

  // Postaví část stanice: bez Ctrl/Cmd se připojí k sousední stanici, s ním okno s výběrem stanice
  // v dosahu spojení (jako „Join station“ v OpenTTD) nebo nové samostatné stanice
  private placeStation(tiles: TilePos[], build: (join?: number | null) => string | null): void {
    if (!this.removeMode) {
      this.report(build());
      return;
    }
    const candidates = this.game.construction.joinCandidates(tiles);
    if (candidates.length === 0) {
      this.report(build(null));
      return;
    }
    const choose = (join: number | null): void => {
      this.windows.close(JOIN_WINDOW);
      this.report(build(join));
      this.refresh();
    };
    const option = (label: string, hint: string, join: number | null): HTMLElement => {
      const b = h('button', { className: 'station-join__option' }, h('strong', {}, label), h('small', {}, hint));
      b.addEventListener('click', () => choose(join));
      return b;
    };
    const { rail } = this.game.world;
    this.windows.open(
      JOIN_WINDOW,
      'Připojit ke stanici',
      h(
        'div',
        { className: 'form station-join' },
        option('Nová samostatná stanice', 'vlastní jméno, náklad i hodnocení', null),
        ...candidates.map((station) =>
          option(station.name, rail.membersOf(station).map(partLabel).join(', '), station.id),
        ),
        h(
          'div',
          { className: 'form__hint' },
          `Části spojené stanice sdílejí jméno, čekající náklad i hodnocení a dosah se sčítá. ` +
            `Celá stanice se musí vejít do ${STATION_SPREAD}×${STATION_SPREAD} polí.`,
        ),
      ),
      { width: 300 },
    );
  }

  // Nápověda do náhledu: k jaké stanici se nová část připojí
  private joinText(tiles: TilePos[]): string {
    if (this.removeMode) return ' · Ctrl: výběr stanice k připojení';
    const station = this.game.construction.adjacentStation(tiles);
    return station ? ` · připojí se ke stanici ${station.name}` : '';
  }

  openRailWindow(): void {
    this.openToolWindow(
      'rail-build',
      'Stavba železnice',
      [
        [
          'track',
          '🛤️',
          'Koleje',
          'K',
          `${formatMoneyShort(TRACK_PIECE_COST)} / dílek, most ${formatMoneyShort(BRIDGE_PIECE_COST)}`,
        ],
        ['station', '🚉', 'Nástupiště', 'N', `${formatMoneyShort(PLATFORM_TILE_COST)} / dílek`],
        ['depot', '🏭', 'Depo', 'D', formatMoneyShort(DEPOT_COST)],
        ['bridge', '🌉', 'Most', 'J', `${formatMoneyShort(BRIDGE_PIECE_COST)} / pole`],
        ['signal', '🚦', 'Návěstidla', 'B', `${formatMoneyShort(SIGNAL_COST)} / kus`],
        ['waypoint', '🚩', 'Průjezdný bod', 'C', formatMoneyShort(WAYPOINT_COST)],
        ['electrify', '⚡', 'Elektrizace', '—', `${formatMoneyShort(ELECTRIFY_TILE_COST)} / pole`],
        ['demolish', '🧨', 'Demolice', 'X', 'vrátí 50 %'],
      ],
      'Koleje (autorail jako v OpenTTD): kliknutím položíte dílek pod kurzorem (u rohu dlaždice zatáčku), ' +
        'tažením rovný úsek nebo úhlopříčku podle směru tažení. Ctrl/Cmd odebírá koleje, Shift ukáže jen cenu. ' +
        'Depo se samo napojí na kolej před vjezdem. Nástupiště: rozměr a orientace v okně, nebo Drag & Drop. ' +
        'Most: táhněte od nájezdu k nájezdu přes koleje, silnice, vodu i trávu, provoz pod ním zůstane. ' +
        'Návěstidla dělí trať na úseky, aby za sebou mohlo jet víc vlaků. Průjezdný bod na rovné koleji ' +
        'lze dát do jízdního řádu: vlak jím projede bez zastavení (vybere tak trasu); kliknutím na bod ho odstraníte. ' +
        'Elektrizace natáhne trolejové vedení tažením přes koleje (s Ctrl/Cmd ho sundá); elektrické ' +
        'lokomotivy jezdí jen pod vedením a kupují se v elektrizovaném depu. R – otočit, Esc – zrušit nástroj.',
      this.railTypeToggle(),
    );
  }

  // Přepínač druhu koleje: s ním se koleje, nástupiště i depa staví rovnou s trolejovým vedením
  private railTypeToggle(): HTMLElement {
    const button = h('button', { className: 'small-button' });
    const sync = (): void => {
      button.textContent = this.electricRail ? '⚡ Elektrizovaná trať' : '🛤️ Běžná trať';
      button.title = this.electricRail
        ? `Koleje, nástupiště a depa se staví s trolejovým vedením (+${formatMoneyShort(ELECTRIFY_TILE_COST)} za pole)`
        : 'Koleje, nástupiště a depa se staví bez trolejí';
      button.classList.toggle('small-button--active', this.electricRail);
    };
    button.addEventListener('click', () => {
      this.electricRail = !this.electricRail;
      sync();
      this.refresh();
    });
    sync();
    return h('div', { className: 'train__actions' }, 'Druh koleje:', button);
  }

  openRoadWindow(): void {
    this.openToolWindow(
      'road-build',
      'Stavba silnic',
      [
        ['road', '🛣️', 'Silnice', 'S', `${formatMoneyShort(ROAD_TILE_COST)} / dílek`],
        ['road-stop', '🚏', 'Zastávka', 'Z', formatMoneyShort(ROAD_STOP_COST)],
        ['road-depot', '🏠', 'Garáž', 'U', formatMoneyShort(ROAD_DEPOT_COST)],
        ['demolish', '🧨', 'Demolice', 'X', 'vrátí 50 %'],
      ],
      'Silnice a demolice: táhněte levým tlačítkem. Zastávka aut jde na rovnou silnici bez křižovatky, ' +
        'garáž se natočí vjezdem k silnici. R – otočit garáž, Esc – zrušit nástroj.',
    );
  }

  openAirWindow(): void {
    const { small, large } = AIRPORT_TYPES;
    this.openToolWindow(
      'air-build',
      'Stavba letišť',
      [
        ['airport-small', '🛫', small.name, 'L', `${formatMoneyShort(small.cost)}, ${small.length}×${small.depth}`],
        [
          'airport-large',
          '🛬',
          large.name,
          'L',
          `${formatMoneyShort(large.cost)}, ${large.length}×${large.depth}, od ${large.year}`,
        ],
        ['demolish', '🧨', 'Demolice', 'X', 'vrátí 50 %'],
      ],
      `Letiště potřebuje volnou zemi. Malé má ${small.stands} stání a nepřijme velká letadla, ` +
        `velké má ${large.stands} stání. Kliknutím na letiště se otevře hangár s nákupem letadel. ` +
        'R – otočit ranvej, Esc – zrušit nástroj.',
    );
  }

  openWaterWindow(): void {
    this.openToolWindow(
      'water-build',
      'Stavba přístavů',
      [
        ['port', '⚓', 'Přístav', 'W', `${formatMoneyShort(PORT_COST)}, 2 kotviště`],
        ['demolish', '🧨', 'Demolice', 'X', 'vrátí 50 %'],
      ],
      'Přístav se staví na břeh: dvě dlaždice volné země a před nimi volná voda pro dvě kotviště. ' +
        'Lodě plují jen po souvislé vodní ploše a pod mosty neproplují. Kliknutím na přístav se otevře loděnice. ' +
        'R – otočit k vodě, Esc – zrušit nástroj.',
    );
  }

  // Okno s druhy závodů; výběr druhu zapne nástroj pro umístění areálu na mapě
  openIndustryWindow(): void {
    const buttons = new Map<IndustryKind, HTMLButtonElement>();
    const grid = h('div', { className: 'build-tools build-tools--grid' });
    for (const kind of Object.keys(INDUSTRY_TYPES) as IndustryKind[]) {
      const cost = formatMoneyShort(INDUSTRY_FUND_COST[kind]);
      const b = h(
        'button',
        { className: 'build-tool', title: `${INDUSTRY_TYPES[kind].name} – ${cost} · ${industryRole(kind)}` },
        iconElement(industryIcon(kind), '🏭', 'build-tool__icon'),
        h('span', {}, INDUSTRY_TYPES[kind].name),
        h('span', { className: 'build-tool__price' }, cost),
      );
      b.addEventListener('click', () => {
        const same = this.tool === 'industry' && this.industryKind === kind;
        this.industryKind = kind;
        this.setTool(same ? null : 'industry');
      });
      buttons.set(kind, b);
      grid.append(b);
    }
    const hint = h(
      'div',
      { className: 'build-text' },
      h(
        'div',
        { className: 'form__hint' },
        'Vyberte druh závodu a klikněte na mapu, kam se má postavit areál 3×3. Musí stát na volné zemi ' +
          'mimo města, dál od jiných závodů a kromě lesa s pásem volné země kolem. R – otočit, Esc – zrušit nástroj.',
      ),
    );
    this.windows.open('industry-fund', 'Založit průmysl', h('div', { className: 'form' }, grid, hint), {
      onClose: () => {
        this.industryButtons = null;
        if (this.tool === 'industry') this.setTool(null);
      },
    });
    this.industryButtons = buttons;
    this.renderButtons();
  }

  // Tlačítka vedle sebe (ikona, pod ní popisek), pod nimi ceny a nápověda na šířku tlačítek
  private openToolWindow(
    id: 'rail-build' | 'road-build' | 'air-build' | 'water-build',
    title: string,
    tools: [SceneIcon, string, string, string, string][],
    hint: string,
    extra?: HTMLElement,
  ): void {
    const buttons = new Map<BuildTool, HTMLButtonElement>();
    const row = h('div', { className: 'build-tools' });
    for (const [tool, icon, label, key, price] of tools) {
      const b = h(
        'button',
        { className: 'build-tool', title: `${label} (${key}) – ${price}` },
        iconElement(sceneIcon(tool), icon, 'build-tool__icon'),
        h('span', {}, label),
      );
      b.addEventListener('click', () => this.setTool(this.tool === tool ? null : tool));
      buttons.set(tool, b);
      row.append(b);
    }
    const text = h(
      'div',
      { className: 'build-text' },
      h(
        'div',
        {},
        ...tools.flatMap(([, , label, key, price], i) => [
          ...(i > 0 ? [' · '] : []),
          h('kbd', {}, key),
          ` ${label} ${price}`,
        ]),
      ),
      h('div', { className: 'form__hint' }, hint),
    );
    this.windows.open(id, title, h('div', { className: 'form' }, row, ...(extra ? [extra] : []), text), {
      onClose: () => {
        this.buttons.delete(id);
        if (this.tool && buttons.has(this.tool)) this.setTool(null);
      },
    });
    this.buttons.set(id, buttons);
    this.renderButtons();
  }

  setTool(tool: BuildTool | null): void {
    const previous = this.tool;
    this.tool = tool;
    this.dragStart = null;
    this.path = null;
    this.roadPath = null;
    if (optionTool(tool)) {
      if (tool !== previous || !this.windows.isOpen(OPTIONS_WINDOW)) this.openOptions(tool);
    } else if (this.windows.isOpen(OPTIONS_WINDOW)) {
      this.windows.close(OPTIONS_WINDOW);
    }
    this.renderButtons();
    this.refresh();
    this.onToolChange(tool);
  }

  // Okno voleb jako v OpenTTD: orientace depa, nebo orientace a rozměry nástupiště
  private openOptions(tool: OptionTool): void {
    const titles: Record<OptionTool, string> = {
      station: 'Výběr nástupiště',
      depot: 'Orientace depa',
      'road-depot': 'Orientace garáže',
      signal: 'Návěstidla',
    };
    const title = titles[tool];
    if (this.windows.isOpen(OPTIONS_WINDOW)) {
      this.reopeningOptions = true;
      this.windows.close(OPTIONS_WINDOW);
      this.reopeningOptions = false;
    }
    this.optionButtons = [];
    this.optionInfo = null;
    const content =
      tool === 'station' ? this.stationOptions() : tool === 'signal' ? this.signalOptions() : this.depotOptions(tool);
    this.windows.open(OPTIONS_WINDOW, title, content, { onClose: this.onOptionsClose });
    this.renderButtons();
  }

  private optionButton(
    content: (string | HTMLElement)[],
    title: string,
    onClick: () => void,
    active: () => boolean,
    className = 'option-button',
    disabled?: () => boolean,
  ): HTMLButtonElement {
    const b = h('button', { className, title }, ...content);
    b.addEventListener('click', () => {
      onClick();
      this.renderButtons();
      this.refresh();
    });
    this.optionButtons.push({ el: b, active, disabled });
    return b;
  }

  private depotOptions(tool: 'depot' | 'road-depot'): HTMLElement {
    const what = tool === 'depot' ? 'depa' : 'garáže';
    const grid = h('div', { className: 'option-grid option-grid--2' });
    // Pořadí jako v OpenTTD: dva vjezdy nahoře, dva dole
    for (const edge of [Edge.N, Edge.E, Edge.W, Edge.S]) {
      grid.append(
        this.optionButton(
          [iconElement(depotIcon(tool, edge), '🏭', 'option-button__icon')],
          `Vjezd ${what} na ${EDGE_NAMES[edge]}`,
          () => {
            this.entrance = edge;
            this.depotAuto = false;
          },
          () => !this.depotAuto && this.entrance === edge,
          'option-button option-button--image',
        ),
      );
    }
    const auto = this.optionButton(
      ['Natočit automaticky'],
      tool === 'depot' ? 'Vjezd ke kolejím na sousední dlaždici' : 'Vjezd k sousední silnici',
      () => (this.depotAuto = !this.depotAuto),
      () => this.depotAuto,
    );
    const hint = h(
      'div',
      { className: 'form__hint' },
      tool === 'depot'
        ? 'Když před vjezdem vede kolej kolmo, depo se na ni samo napojí výhybkami. R – otočit.'
        : 'Garáž se staví vedle silnice vjezdem k ní. R – otočit.',
    );
    return h('div', { className: 'form build-options' }, grid, auto, hint);
  }

  // Okno návěstidel jako v OpenTTD: druh a hustota při tažení
  private signalOptions(): HTMLElement {
    const kinds = h(
      'div',
      { className: 'option-grid option-grid--2' },
      this.optionButton(
        [iconElement(signalIcon(false), '🚦', 'option-button__icon option-button__icon--small'), 'Obousměrné'],
        'Cestové návěstidlo pro oba směry: vlak si před ním zarezervuje volnou cestu',
        () => (this.signalOneWay = false),
        () => !this.signalOneWay,
        'option-button option-button--image option-button--column',
      ),
      this.optionButton(
        [iconElement(signalIcon(true), '🚦', 'option-button__icon option-button__icon--small'), 'Jednosměrné'],
        'Jednosměrné cestové návěstidlo: proti šipce vlak nikdy nepojede (dvoukolejné tratě)',
        () => (this.signalOneWay = true),
        () => this.signalOneWay,
        'option-button option-button--image option-button--column',
      ),
    );
    const value = h('strong', { className: 'option-value' }, String(this.signalDensity));
    const density = h(
      'div',
      { className: 'option-stepper' },
      h('span', {}, 'Hustota při tažení'),
      this.optionButton(
        ['−'],
        'Řidší',
        () => (this.signalDensity = Math.max(MIN_SIGNAL_DENSITY, this.signalDensity - 1)),
        () => false,
        'option-button option-button--number',
      ),
      value,
      this.optionButton(
        ['+'],
        'Hustší',
        () => (this.signalDensity = Math.min(MAX_SIGNAL_DENSITY, this.signalDensity + 1)),
        () => false,
        'option-button option-button--number',
      ),
      h('span', {}, 'dlaždic'),
    );
    this.signalDensityValue = value;
    const hint = h(
      'div',
      { className: 'form__hint' },
      'Klik na kolej postaví návěstidlo (jednosměrné ve směru ke kurzoru), klik na existující ho otočí ' +
        '(obousměrné → jedním směrem → druhým). Tažením po trati postaví návěstidla po zvolené hustotě. ' +
        'Ctrl/Cmd odstraní. Návěstidla dělí trať na úseky; před každým si vlak najde volnou cestu.',
    );
    return h(
      'div',
      { className: 'form build-options' },
      h('div', { className: 'option-label' }, 'Druh'),
      kinds,
      density,
      hint,
    );
  }

  private stationOptions(): HTMLElement {
    const section = (label: string): HTMLElement => h('div', { className: 'option-label' }, label);
    const orient = h('div', { className: 'option-grid option-grid--2' });
    for (const axis of ['x', 'y'] as Axis[]) {
      orient.append(
        this.optionButton(
          [iconElement(stationIcon(axis), '🚉', 'option-button__icon')],
          axis === 'x' ? 'Nástupiště podél osy X' : 'Nástupiště podél osy Y',
          () => (this.axis = axis),
          () => this.axis === axis,
          'option-button option-button--image',
        ),
      );
    }
    const numbers = (max: number, get: () => number, set: (n: number) => void, title: string): HTMLElement => {
      const row = h('div', { className: 'option-row' });
      for (let n = 1; n <= max; n++) {
        row.append(
          this.optionButton(
            [String(n)],
            `${title} ${n}`,
            () => {
              set(n);
              this.stationDrag = false;
            },
            () => !this.stationDrag && get() === n,
            'option-button option-button--number',
            () => this.stationDrag,
          ),
        );
      }
      return row;
    };
    const tracks = numbers(
      MAX_STATION_TRACKS,
      () => this.stationTracks,
      (n) => (this.stationTracks = n),
      'Počet kolejí',
    );
    const length = numbers(
      MAX_STATION_LENGTH,
      () => this.stationLength,
      (n) => (this.stationLength = n),
      'Délka nástupiště',
    );
    const drag = this.optionButton(
      ['Drag & Drop'],
      'Rozměr nástupiště určí tažení myší',
      () => (this.stationDrag = !this.stationDrag),
      () => this.stationDrag,
    );
    const coverage = h(
      'div',
      { className: 'option-grid option-grid--2' },
      this.optionButton(
        ['Vyp'],
        'Nezobrazovat dosah',
        () => (this.showCoverage = false),
        () => !this.showCoverage,
      ),
      this.optionButton(
        ['Zap'],
        'Zobrazit dosah',
        () => (this.showCoverage = true),
        () => this.showCoverage,
      ),
    );
    this.optionInfo = h('div', { className: 'option-info' });
    return h(
      'div',
      { className: 'form build-options' },
      section('Orientace'),
      orient,
      section('Počet kolejí'),
      tracks,
      section('Délka nástupiště'),
      length,
      drag,
      section('Zobrazení dosahu'),
      coverage,
      this.optionInfo,
    );
  }

  // Zkratka: nástroj zapne i se zavřeným oknem (otevře ho), opakovaně vypne
  toggleTool(tool: BuildTool): void {
    const windowOpen = [...this.buttons.values()].some((buttons) => buttons.has(tool));
    if (!windowOpen && tool !== 'info') {
      if (tool === 'road' || tool === 'road-stop' || tool === 'road-depot') this.openRoadWindow();
      else if (airportTool(tool)) this.openAirWindow();
      else if (tool === 'port') this.openWaterWindow();
      else this.openRailWindow();
    }
    this.setTool(this.tool === tool ? null : tool);
  }

  rotate(): void {
    if (this.tool === 'station' || airportTool(this.tool)) this.axis = this.axis === 'x' ? 'y' : 'x';
    if (this.tool === 'depot' || this.tool === 'road-depot') {
      // Otočení vychází z toho, jak je depo pod kurzorem právě natočené
      if (this.hover)
        this.entrance = this.tool === 'depot' ? this.depotEntrance(this.hover) : this.roadDepotEntrance(this.hover);
      this.entrance = (this.entrance + 1) % 4;
      this.depotAuto = false;
    }
    if (this.tool === 'port') this.dock = (this.dock + 1) % 4;
    if (this.tool === 'industry') this.industryRotation = (this.industryRotation + 1) % 4;
    this.renderButtons();
    this.refresh();
  }

  pointerDown(tile: PointerTile | null, mods?: Modifiers): void {
    if (mods) this.setModifiers(mods);
    if (!tile || !this.tool) return;
    this.hover = tile;
    if (this.tool === 'info') {
      this.onInspect(tile);
      return;
    }
    if (this.tool === 'station' && !this.stationDrag) {
      const shape = this.stationShape();
      if (shape) {
        this.placeStation(stationTiles(shape), (join) =>
          this.game.construction.buildStation(shape, join, this.electricRail),
        );
      }
    } else if (
      this.tool === 'track' ||
      this.tool === 'road' ||
      this.tool === 'demolish' ||
      this.tool === 'electrify' ||
      this.tool === 'station' ||
      this.tool === 'signal' ||
      this.tool === 'bridge'
    ) {
      this.dragStart = tile;
      this.updatePath();
    } else if (this.tool === 'waypoint') {
      this.report(this.game.construction.toggleWaypoint(tile.x, tile.y));
    } else if (this.tool === 'road-stop') {
      this.placeStation([tile], (join) => this.game.construction.buildRoadStop(tile.x, tile.y, join));
    } else if (this.tool === 'port') {
      const { map, rail } = this.game.world;
      const shape = portAt(map, tile, this.dock, (x, y) => rail.isBerth(x, y));
      if (shape) this.placeStation(stationTiles(shape), (join) => this.game.construction.buildPort(shape, join));
      else this.report('Přístav jde jen na volný břeh u volné vody.');
    } else if (airportTool(this.tool)) {
      const type = airportTool(this.tool)!;
      const shape = airportShape(type, tile.x, tile.y, this.axis);
      this.placeStation(stationTiles(shape), (join) =>
        this.game.construction.buildAirport(type, tile.x, tile.y, this.axis, join),
      );
    } else if (this.tool === 'road-depot') {
      this.report(this.game.construction.buildRoadDepot(tile.x, tile.y, this.roadDepotEntrance(tile)));
    } else if (this.tool === 'industry') {
      const site = industrySite(tile);
      this.report(this.game.industryLife.fund(this.industryKind, site.x, site.y, this.industryRotation));
    } else {
      this.report(this.game.construction.buildDepot(tile.x, tile.y, this.depotEntrance(tile), this.electricRail));
    }
    this.refresh();
  }

  pointerMove(tile: PointerTile | null, clientX: number, clientY: number, mods?: Modifiers): void {
    if (mods) this.setModifiers(mods);
    this.tooltip.style.left = `${clientX + 16}px`;
    this.tooltip.style.top = `${clientY + 16}px`;
    const previous = this.hover;
    this.hover = tile;
    const sameTile = tile?.x === previous?.x && tile?.y === previous?.y;
    // Na jedné dlaždici se u kolejí může změnit jen vybraný kus a u silnice hrana podle polohy kurzoru
    const cursorPart = (t: PointerTile): number | null =>
      this.tool === 'track' ? pieceAtCursor(t.fx, t.fy) : roadEdgeAtCursor(t.fx, t.fy);
    // U návěstidla rozhoduje poloha kurzoru o směru jednosměrky
    if (this.tool === 'signal' && (this.dragStart || this.signalOneWay)) {
      if (this.dragStart) this.updatePath();
      this.refresh();
      return;
    }
    const samePiece =
      (this.tool !== 'track' && this.tool !== 'road') ||
      !tile ||
      !previous ||
      cursorPart(tile) === cursorPart(previous);
    // Délka úhlopříčky se při tažení mění i uvnitř dlaždice, podle průmětu kurzoru na ni
    if (sameTile && samePiece && !(this.tool === 'track' && this.dragStart)) return;
    if (this.dragStart) this.updatePath();
    this.refresh();
  }

  pointerUp(): void {
    if (!this.dragStart) return;
    const { construction } = this.game;
    if (this.tool === 'track' && this.path && !this.estimateMode) {
      if (this.removeMode) this.report(construction.removeTrack(this.path.steps));
      else if (this.path.steps.some((s) => s.isNew) || this.unwired(this.path.steps).length > 0)
        construction.buildTrack(this.path.steps, this.electricRail);
      else if (this.path.blocked.length > 0) this.report('Sem kolej položit nelze.');
    }
    if (this.tool === 'road' && this.roadPath) construction.buildRoad(this.roadPath);
    if (this.tool === 'signal') this.applySignals();
    if (this.tool === 'bridge') {
      const end = this.bridgeEnd();
      if (end && this.dragStart && !this.estimateMode && (end.x !== this.dragStart.x || end.y !== this.dragStart.y)) {
        this.report(construction.buildBridge(this.dragStart.x, this.dragStart.y, end.x, end.y));
      }
    }
    if (this.tool === 'demolish') this.report(construction.demolish(this.demolishArea()));
    if (this.tool === 'electrify') this.report(construction.electrify(this.demolishArea(), this.removeMode));
    if (this.tool === 'station') {
      const shape = this.stationShape();
      if (shape) {
        this.placeStation(stationTiles(shape), (join) => construction.buildStation(shape, join, this.electricRail));
      }
    }
    this.dragStart = null;
    this.path = null;
    this.roadPath = null;
    this.refresh();
  }

  private updatePath(): void {
    const target = this.hover ?? this.dragStart;
    if (!this.dragStart || !target) return;
    if (this.tool === 'track') this.path = this.trackPath(this.dragStart, target);
    if (this.tool === 'road') this.roadPath = this.roadSteps(this.dragStart, target);
  }

  // Kliknutí (tažení na stejné dlaždici) staví podle polohy kurzoru, tažení trasu
  private roadSteps(start: TilePos, target: TilePos): RoadStep[] | null {
    const { rail } = this.game.world;
    if (start.x !== target.x || start.y !== target.y) return findRoadPath(rail, start, target);
    return this.hover && singleRoadSteps(rail, start, this.hover.fx, this.hover.fy);
  }

  // Náhled silnice, vrací text s počtem nových dílků a cenou
  private showRoad(steps: RoadStep[]): string {
    const { map, rail } = this.game.world;
    const fresh = steps.filter((s) => s.isNew);
    const n = fresh.length;
    const cost = fresh.reduce((sum, s) => sum + roadPieceCost(map, s.x, s.y), 0);
    const bridges = fresh.filter((s) => map.isType(s.x, s.y, TileType.Water)).length;
    this.preview.showRoad(steps, roadConnects(map, rail), cost <= this.game.money);
    if (n === 0) return 'Silnice už je postavená';
    const pieces = n === 1 ? 'dílek' : n <= 4 ? 'dílky' : 'dílků';
    return `${n} ${pieces}${bridges > 0 ? ` (most ${bridges})` : ''} · ${formatMoneyShort(cost)}`;
  }

  // Konec mostu: kurzor přichycený na řadu nebo sloupec začátku tažení
  private bridgeEnd(): TilePos | null {
    const start = this.dragStart;
    const end = this.hover;
    if (!start || !end) return null;
    return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
  }

  // Náhled mostu; vrací text pro popisek
  private showBridge(): string {
    const start = this.dragStart;
    const end = this.bridgeEnd();
    if (!start || !end || (start.x === end.x && start.y === end.y)) {
      if (this.hover) this.preview.showArea([this.hover], 'valid');
      return 'Most: táhněte od jednoho nájezdu k druhému – přes koleje, silnice, vodu i trávu';
    }
    const plan = this.game.construction.bridgePlan(start.x, start.y, end.x, end.y);
    const dir = end.x > start.x ? Edge.E : end.x < start.x ? Edge.W : end.y > start.y ? Edge.S : Edge.N;
    if (plan.span >= 1) {
      this.preview.showBridge(
        { x: start.x, y: start.y, dir, span: plan.span },
        !plan.problem && this.game.money >= plan.cost,
      );
    } else this.preview.showArea([start, end], 'invalid');
    if (plan.problem) return plan.problem;
    const fields = plan.span === 1 ? 'pole' : plan.span <= 4 ? 'pole' : 'polí';
    const prefix = this.estimateMode ? 'Odhad: ' : '';
    return `${prefix}Most ${plan.span} ${fields} · ${formatMoneyShort(plan.cost)}`;
  }

  // Jediný kus koleje na dlaždici, kam jde návěstidlo, nebo -1
  private signalPiece(x: number, y: number): number {
    const { rail, map } = this.game.world;
    if (!map.isType(x, y, TileType.Rail) || rail.pieceCount(x, y) !== 1) return -1;
    return PIECES.findIndex((_, p) => rail.has(x, y, p));
  }

  // Návěstidla, kterých se týká kliknutí nebo tažení: jedno pod kurzorem, nebo podél tažené přímky po hustotě
  private signalPlan(): { items: SignalItem[]; single: boolean } {
    const start = this.dragStart ?? this.hover;
    const end = this.hover ?? start;
    if (!start || !end) return { items: [], single: true };
    if (start.x === end.x && start.y === end.y) {
      const piece = this.signalPiece(end.x, end.y);
      if (piece < 0 || !this.signalOneWay) return { items: [{ x: end.x, y: end.y }], single: true };
      // Jednosměrné míří k té hraně kusu, ke které je kurzor blíž
      const [a, b] = PIECES[piece];
      const dist = (e: Edge): number => Math.hypot(EDGE_MID[e][0] - end.fx, EDGE_MID[e][1] - end.fy);
      return { items: [{ x: end.x, y: end.y, dir: dist(a) <= dist(b) ? a : b }], single: true };
    }
    const line = autorailLine(start, end);
    const items: SignalItem[] = [];
    line.forEach((p, i) => {
      if (i % this.signalDensity !== 0) return;
      const piece = this.signalPiece(p.x, p.y);
      if (piece < 0 && !this.removeMode) return;
      if (this.removeMode) {
        items.push({ x: p.x, y: p.y });
        return;
      }
      // Směr tažení: hrana kusu k další dlaždici přímky (u poslední pryč od předchozí)
      const [a, b] = PIECES[piece];
      const toward = (q: TilePos | undefined): Edge | undefined =>
        q ? [a, b].find((e) => p.x + EDGE_DELTA[e][0] === q.x && p.y + EDGE_DELTA[e][1] === q.y) : undefined;
      let dir = toward(line[i + 1]);
      if (dir === undefined) {
        const back = toward(line[i - 1]);
        dir = back === undefined ? undefined : back === a ? b : a;
      }
      items.push({ x: p.x, y: p.y, dir: this.signalOneWay ? dir : undefined });
    });
    // Odstraňuje se každé návěstidlo na přímce, ne jen po hustotě
    if (this.removeMode) {
      return { items: line.filter((p) => this.game.world.rail.hasSignal(p.x, p.y)), single: false };
    }
    return { items, single: false };
  }

  private applySignals(): void {
    const { construction } = this.game;
    const { rail } = this.game.world;
    const { items, single } = this.signalPlan();
    if (this.estimateMode || items.length === 0) return;
    if (single) {
      const { x, y } = items[0];
      if (rail.hasSignal(x, y)) {
        this.report(this.removeMode ? construction.removeSignal(x, y) : construction.cycleSignal(x, y));
      } else if (!this.removeMode) {
        this.report(construction.buildSignals(items));
      }
      return;
    }
    if (this.removeMode) {
      for (const s of items) construction.removeSignal(s.x, s.y);
      return;
    }
    this.report(construction.buildSignals(items));
  }

  // Autorail: kliknutí (tažení na stejné dlaždici) staví kus pod kurzorem, tažení přímku nebo úhlopříčku;
  // s Ctrl/Cmd totéž odebírá
  private trackPath(start: PointerTile, target: PointerTile): AutorailPlan | null {
    const { rail } = this.game.world;
    if (start.x !== target.x || start.y !== target.y) {
      const plan = autorailPlan(rail, start, target, this.removeMode ? 'remove' : 'build');
      return plan.steps.length > 0 || plan.blocked.length > 0 ? plan : null;
    }
    return this.singleTrack(target);
  }

  private singleTrack(tile: PointerTile): AutorailPlan | null {
    const { rail } = this.game.world;
    if (this.removeMode) {
      const step = removablePieceAt(rail, tile);
      return step ? { steps: [step], blocked: [] } : null;
    }
    const step = singlePieceStep(rail, tile, tile.fx, tile.fy);
    return step ? { steps: withDepotLinks(rail, [step]), blocked: [] } : null;
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

  // Pevný rozměr z okna se středem pod kurzorem; v Drag & Drop obdélník tažení, orientace z okna
  private stationShape(): StationShape | null {
    const tile = this.hover ?? this.dragStart;
    if (!tile) return null;
    if (!this.stationDrag) {
      return { x: tile.x, y: tile.y, axis: this.axis, length: this.stationLength, tracks: this.stationTracks };
    }
    const start = this.dragStart ?? tile;
    const end = tile;
    const axis = this.axis;
    const sizeX = Math.abs(end.x - start.x) + 1;
    const sizeY = Math.abs(end.y - start.y) + 1;
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

  // Automaticky se depo natočí vjezdem ke kolejím: nejdřív ke koleji, která k němu už vede,
  // pak ke koleji vedoucí kolmo (napojí se výhybkami); při shodě rozhodne naposledy zvolený směr
  private depotEntrance(tile: TilePos): Edge {
    if (!this.depotAuto) return this.entrance;
    const { rail } = this.game.world;
    let best = this.entrance;
    let bestScore = 0;
    for (let i = 0; i < 4; i++) {
      const edge = ((this.entrance + i) % 4) as Edge;
      const [dx, dy] = EDGE_DELTA[edge];
      const back = opposite(edge);
      const direct = PIECES.some(
        ([a, b], piece) => (a === back || b === back) && rail.has(tile.x + dx, tile.y + dy, piece),
      );
      const score = direct ? 2 : depotLinks(rail, tile.x, tile.y, edge).length > 0 ? 1 : 0;
      if (score > bestScore) {
        best = edge;
        bestScore = score;
      }
    }
    return best;
  }

  // Garáž se natočí vjezdem k sousední silnici; u více silnic rozhodne R, bez silnice jen R
  private roadDepotEntrance(tile: TilePos): Edge {
    const { map } = this.game.world;
    if (!this.depotAuto) return this.entrance;
    const roads = [0, 1, 2, 3].filter((edge) =>
      map.isType(tile.x + EDGE_DELTA[edge][0], tile.y + EDGE_DELTA[edge][1], TileType.Road),
    );
    if (roads.length === 0 || roads.includes(this.entrance)) return this.entrance;
    return roads[0];
  }

  private report(error: string | null): void {
    if (error) this.game.news(error);
  }

  // Co bude nové nástupiště obsluhovat: díl měst, náklad k odvozu a výkup
  private reachText(shape: StationShape & Pick<Partial<Station>, 'kind' | 'airport'>): string {
    const { passengers, freight } = this.game;
    const { shares, buildings } = passengers.coverage(shape);
    const parts = [...shares].map(([town, share]) => `${town.name} ${Math.round(share * 100)} %`);
    const produced = freight.produced(shape);
    if (produced.length > 0) parts.push(produced.map((t) => CARGOS[t].noun).join(', '));
    const accepted = freight.acceptedIn(shape, buildings);
    if (accepted.length > 0) parts.push(`výkup ${accepted.map((t) => CARGOS[t].genitive).join(', ')}`);
    return parts.length > 0 ? parts.join(' · ') : 'mimo dosah města a průmyslu';
  }

  // Přijímá / dodává do okna nástupiště jako v OpenTTD
  private stationInfo(shape: StationShape | null): void {
    if (!this.optionInfo) return;
    if (!shape) {
      this.optionInfo.replaceChildren();
      return;
    }
    const { passengers, freight } = this.game;
    const { shares, buildings } = passengers.coverage(shape);
    const accepts = [
      ...(buildings > 0 ? ['cestující'] : []),
      ...freight.acceptedIn(shape, buildings).map((t) => CARGOS[t].noun),
    ];
    const supplies = [...(shares.size > 0 ? ['cestující'] : []), ...freight.produced(shape).map((t) => CARGOS[t].noun)];
    this.optionInfo.replaceChildren(
      h('div', {}, 'Přijímá: ', h('b', {}, accepts.join(', ') || 'nic')),
      h('div', {}, 'Dodává: ', h('b', {}, supplies.join(', ') || 'nic')),
    );
  }

  // Dosah podle druhu stanice; u postavené stanice dosah všech jejích částí
  private showCatchment(shape: StationShape & Pick<Partial<Station>, 'kind' | 'airport'>): void {
    if (!this.showCoverage) return;
    const { map, rail } = this.game.world;
    const seen = new Set<number>();
    const tiles: TilePos[] = [];
    for (const part of rail.catchmentParts(shape)) {
      const { x0, y0, x1, y1 } = catchmentArea(part);
      for (let y = Math.max(0, y0); y <= Math.min(map.height - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(map.width - 1, x1); x++) {
          if (seen.has(y * map.width + x)) continue;
          seen.add(y * map.width + x);
          tiles.push({ x, y });
        }
      }
    }
    this.preview.showCatchment(tiles);
  }

  private renderButtons(): void {
    for (const buttons of this.buttons.values()) {
      for (const [tool, b] of buttons) b.classList.toggle('build-tool--active', tool === this.tool);
    }
    if (this.signalDensityValue) this.signalDensityValue.textContent = String(this.signalDensity);
    for (const { el, active, disabled } of this.optionButtons) {
      el.classList.toggle('option-button--active', active());
      el.classList.toggle('option-button--disabled', disabled?.() ?? false);
    }
    for (const [kind, b] of this.industryButtons ?? []) {
      b.classList.toggle('build-tool--active', this.tool === 'industry' && kind === this.industryKind);
    }
  }

  // Náhled kolejí, vrací text s počtem dílků a cenou (při odebírání s vrácenou částkou)
  private showTrack(plan: AutorailPlan): string {
    const { map } = this.game.world;
    const prefix = this.estimateMode ? 'Odhad: ' : '';
    if (this.removeMode) {
      const n = plan.steps.length;
      this.preview.showTrackRemoval(plan.steps);
      if (n === 0) return 'Není co odebrat';
      const refund = this.game.construction.trackRemovalRefund(plan.steps);
      return `${prefix}Odebrat ${n} ${plural(n, 'dílek', 'dílky', 'dílků')} · vrátí ${formatMoneyShort(refund)}`;
    }
    const fresh = plan.steps.filter((s) => s.isNew);
    const wires = this.unwired(plan.steps).length;
    const cost = fresh.reduce((sum, s) => sum + trackPieceCost(map, s.x, s.y), 0) + wires * ELECTRIFY_TILE_COST;
    const bridges = fresh.filter((s) => map.get(s.x, s.y) === TileType.Water).length;
    this.preview.showTrack(plan.steps, cost <= this.game.money, plan.blocked);
    const blocked = plan.blocked.length > 0 ? ' · dál překážka' : '';
    if (fresh.length === 0 && wires > 0)
      return `${prefix}Trolejové vedení na ${wires} polích · ${formatMoneyShort(cost)}`;
    if (fresh.length === 0)
      return plan.steps.length > 0 ? `Kolej už je postavená${blocked}` : 'Sem kolej položit nelze';
    const n = fresh.length;
    return `${prefix}${n} ${plural(n, 'dílek', 'dílky', 'dílků')}${bridges > 0 ? ` (most ${bridges})` : ''} · ${formatMoneyShort(cost)}${blocked}`;
  }

  // Dlaždice plánu, které při stavbě elektrizované trati dostanou trolejové vedení
  private unwired(steps: readonly TilePos[]): TilePos[] {
    if (!this.electricRail) return [];
    const { rail } = this.game.world;
    const seen = new Set<string>();
    return steps.filter((s) => {
      const key = `${s.x},${s.y}`;
      if (seen.has(key) || rail.isElectrified(s.x, s.y)) return false;
      seen.add(key);
      return true;
    });
  }

  // Náhled návěstidel; vrací text pro popisek u kurzoru
  private showSignals(): string {
    const { rail } = this.game.world;
    const { items, single } = this.signalPlan();
    const prefix = this.estimateMode ? 'Odhad: ' : '';
    const kind = this.signalOneWay ? 'jednosměrné' : 'obousměrné';
    if (single && items.length === 1) {
      const { x, y } = items[0];
      if (rail.hasSignal(x, y)) {
        if (this.removeMode) {
          this.preview.showArea([items[0]], 'demolish');
          return `${prefix}Odstranit návěstidlo · vrátí ${formatMoneyShort(SIGNAL_COST * DEMOLISH_REFUND)}`;
        }
        const piece = this.signalPiece(x, y);
        const dir = rail.signalDir(x, y);
        const next =
          piece < 0
            ? undefined
            : dir === undefined
              ? PIECES[piece][1]
              : dir === PIECES[piece][1]
                ? PIECES[piece][0]
                : undefined;
        this.preview.showSignals([{ x, y, dir: next }], rail, 'valid');
        return `Kliknutím otočit na ${next === undefined ? 'obousměrné' : 'jednosměrné'} · Ctrl/Cmd odstraní`;
      }
      if (this.removeMode) return 'Tady žádné návěstidlo není';
      if (!rail.canPlaceSignal(x, y)) {
        this.preview.showArea([items[0]], 'invalid');
        return 'Návěstidlo jen na kolej bez výhybky';
      }
      this.preview.showSignals(items, rail, this.game.money >= SIGNAL_COST ? 'valid' : 'invalid');
      return `${prefix}Návěstidlo ${kind} · ${formatMoneyShort(SIGNAL_COST)}`;
    }
    if (this.removeMode) {
      this.preview.showArea(items, 'demolish');
      const n = items.length;
      return n === 0
        ? 'Na přímce žádné návěstidlo není'
        : `${prefix}Odstranit ${n} ${n === 1 ? 'návěstidlo' : n <= 4 ? 'návěstidla' : 'návěstidel'} · vrátí ${formatMoneyShort(n * SIGNAL_COST * DEMOLISH_REFUND)}`;
    }
    const placeable = items.filter((s) => rail.canPlaceSignal(s.x, s.y));
    const cost = placeable.length * SIGNAL_COST;
    this.preview.showSignals(placeable, rail, cost <= this.game.money ? 'valid' : 'invalid');
    const n = placeable.length;
    if (n === 0) return 'Tažením po koleji bez výhybek postavíte návěstidla';
    return `${prefix}${n} ${n === 1 ? 'návěstidlo' : n <= 4 ? 'návěstidla' : 'návěstidel'} ${kind} (každých ${this.signalDensity}) · ${formatMoneyShort(cost)}`;
  }

  private refresh(): void {
    const { rail } = this.game.world;
    const tile = this.hover;
    let text = '';
    this.preview.clear();

    if (this.tool === 'track' && (this.dragStart || tile)) {
      // Bez tažení náhled kusu, který postaví (nebo s Ctrl odebere) kliknutí
      const plan = this.dragStart ? this.path : tile && this.singleTrack(tile);
      if (plan) text = this.showTrack(plan);
      else text = this.removeMode ? 'Není co odebrat' : 'Sem kolej položit nelze';
    } else if (this.tool === 'station' && tile) {
      const shape = this.stationShape();
      this.stationInfo(shape);
      if (shape) {
        const ok = rail.canPlaceStation(shape);
        const cost = stationCost(shape);
        this.preview.showStation(shape, ok && this.game.money >= cost);
        this.showCatchment(shape);
        const size =
          `${shape.tracks} ${plural(shape.tracks, 'kolej', 'koleje', 'kolejí')} × ` +
          `${shape.length} ${plural(shape.length, 'dílek', 'dílky', 'dílků')}`;
        text = ok
          ? `Nástupiště ${size} · ${formatMoneyShort(cost)} · ${this.reachText(shape)}${this.joinText(stationTiles(shape))}`
          : `Nástupiště ${size} – sem postavit nelze`;
      }
    } else if (this.tool === 'depot' && tile) {
      const ok = rail.canPlaceDepot(tile.x, tile.y);
      const entrance = this.depotEntrance(tile);
      const { cost, links } = this.game.construction.depotCost(tile.x, tile.y, entrance);
      this.preview.showDepot(tile.x, tile.y, entrance, ok && this.game.money >= cost, ok ? links : []);
      text = ok
        ? `Depo · ${formatMoneyShort(cost)}${links.length > 0 ? ' · napojí se na kolej' : ''}`
        : 'Sem depo postavit nelze';
    } else if (this.tool === 'port' && tile) {
      const port = portAt(this.game.world.map, tile, this.dock, (x, y) => rail.isBerth(x, y));
      if (port) {
        const shape = { ...port, kind: 'water' as const };
        this.preview.showPort(port, this.game.money >= PORT_COST);
        this.showCatchment(shape);
        text = `Přístav · ${formatMoneyShort(PORT_COST)} · ${this.reachText(shape)}${this.joinText(stationTiles(shape))}`;
      } else {
        this.preview.showArea([tile], 'invalid');
        text = 'Přístav jde jen na volný břeh u volné vody (dvě dlaždice)';
      }
    } else if (airportTool(this.tool) && tile) {
      const type = airportTool(this.tool)!;
      const spec = AIRPORT_TYPES[type];
      const shape = { ...airportShape(type, tile.x, tile.y, this.axis), kind: 'air' as const, airport: type };
      const ok = rail.canPlaceAirport(shape);
      const allowed = this.game.clock.date.year >= spec.year;
      this.preview.showAirport(shape, type, ok && allowed && this.game.money >= spec.cost);
      this.showCatchment(shape);
      if (!allowed) text = `${spec.name} lze stavět až od roku ${spec.year}`;
      else if (!ok) {
        this.preview.showArea(stationTiles(shape), 'invalid');
        text = 'Letiště potřebuje volnou zemi bez staveb, silnic a vody';
      } else
        text = `${spec.name} · ${formatMoneyShort(spec.cost)} · ${this.reachText(shape)}${this.joinText(stationTiles(shape))}`;
    } else if (this.tool === 'waypoint' && tile) {
      const existing = rail.waypointAt(tile.x, tile.y);
      const ok = existing !== undefined || rail.waypointAxis(tile.x, tile.y) !== null;
      this.preview.showArea([tile], ok ? (existing ? 'demolish' : 'valid') : 'invalid');
      text = existing
        ? `${existing.name} – kliknutím odstranit (vrátí ${formatMoneyShort(WAYPOINT_COST * 0.5)})`
        : ok
          ? `Průjezdný bod · ${formatMoneyShort(WAYPOINT_COST)}`
          : 'Průjezdný bod jde jen na rovnou kolej bez výhybky, návěstidla a mostu';
    } else if (this.tool === 'road-stop' && tile) {
      const axis = rail.roadStopAxis(tile.x, tile.y);
      if (axis) {
        const shape = { x: tile.x, y: tile.y, axis, length: 1, tracks: 1, kind: 'road' as const };
        this.preview.showRoadStop(tile.x, tile.y, axis, this.game.money >= ROAD_STOP_COST);
        this.showCatchment(shape);
        text = `Zastávka aut · ${formatMoneyShort(ROAD_STOP_COST)} · ${this.reachText(shape)}${this.joinText([tile])}`;
      } else {
        this.preview.showArea([tile], 'invalid');
        text = 'Zastávka aut jde jen na rovnou silnici bez křižovatky';
      }
    } else if (this.tool === 'road-depot' && tile) {
      const ok = this.game.world.map.isFree(tile.x, tile.y);
      this.preview.showRoadDepot(
        tile.x,
        tile.y,
        this.roadDepotEntrance(tile),
        ok && this.game.money >= ROAD_DEPOT_COST,
      );
      text = ok ? `Garáž aut · ${formatMoneyShort(ROAD_DEPOT_COST)}` : 'Garáž jde jen na volnou dlaždici vedle silnice';
    } else if (this.tool === 'road' && this.dragStart) {
      if (this.roadPath) text = this.showRoad(this.roadPath);
      else if (tile && (tile.x !== this.dragStart.x || tile.y !== this.dragStart.y)) text = 'Silnici nelze vést';
      else text = 'Sem silnici postavit nelze';
    } else if (this.tool === 'road' && tile) {
      // Bez tažení náhled toho, co postaví kliknutí
      const steps = singleRoadSteps(rail, tile, tile.fx, tile.fy);
      if (steps) text = this.showRoad(steps);
      else if (this.game.world.map.isRoad(tile.x, tile.y)) text = 'Silnice – klikněte u okraje pro prodloužení';
      else text = 'Sem silnici postavit nelze';
    } else if (this.tool === 'info' && tile) {
      const station = rail.stationAt(tile.x, tile.y);
      if (station) {
        this.showCatchment(station);
        text = `${station.name} – dosah stanice`;
      }
    } else if (this.tool === 'signal' && tile) {
      text = this.showSignals();
    } else if (this.tool === 'bridge' && tile) {
      text = this.showBridge();
    } else if (this.tool === 'industry' && tile) {
      const { map, towns, industries } = this.game.world;
      const site = industrySite(tile);
      const problem = industrySiteProblem(map, towns, industries, this.industryKind, site.x, site.y);
      const cost = INDUSTRY_FUND_COST[this.industryKind];
      const affordable = this.game.money >= cost;
      const area = industryTiles(site).filter((t) => map.inBounds(t.x, t.y));
      this.preview.showArea(area, !problem && affordable ? 'valid' : 'invalid');
      text =
        problem ??
        `${INDUSTRY_TYPES[this.industryKind].name} · ${formatMoneyShort(cost)}${affordable ? '' : ' · nedostatek peněz'}`;
    } else if (this.tool === 'electrify' && tile) {
      const area = this.demolishArea();
      const { count, cost } = this.game.construction.electrifyCost(area, this.removeMode);
      const tracks = area.filter((t) => rail.hasTrack(t.x, t.y));
      this.preview.showArea(
        tracks.length > 0 ? tracks : area,
        count > 0 ? (this.removeMode ? 'demolish' : 'valid') : 'invalid',
      );
      text =
        count === 0
          ? this.removeMode
            ? 'Tady trolejové vedení není'
            : 'Tady není kolej bez trolejí'
          : this.removeMode
            ? `Sundat vedení z ${count} polí · vrátí ${formatMoneyShort(-cost)}`
            : `Trolejové vedení na ${count} polích · ${formatMoneyShort(cost)}`;
    } else if (this.tool === 'demolish' && tile) {
      const plan = this.game.construction.demolishPlan(this.demolishArea());
      this.preview.showArea(plan.tiles, 'demolish');
      if (plan.blocked) {
        text = plan.blocked;
      } else if (plan.tiles.length > 0 && plan.cost === 0) {
        text = 'Demolice zdarma';
      } else if (plan.tiles.length > 0) {
        text = plan.cost > 0 ? `Demolice: ${formatMoneyShort(plan.cost)}` : `Vrátí se: ${formatMoneyShort(-plan.cost)}`;
      }
    }

    this.tooltip.textContent = text;
    this.tooltip.style.display = text ? 'block' : 'none';
  }
}
