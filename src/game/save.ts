import { isEconomySetting } from './industryLife';
import {
  AIRCRAFT_MODELS,
  AIRPORT_TYPES,
  RATING_START,
  ROAD_VEHICLE_MODELS,
  SERVICE_INTERVAL_DAYS,
  SHIP_MODELS,
  STATION_LENGTH,
  TRAIN_MODELS,
  INDUSTRY_HISTORY_MONTHS,
} from './balance';
import type { Aircraft } from './aircraft';
import type { Ship } from './ships';
import {
  CARGO_TYPES,
  FREIGHT_TYPES,
  emptyFreight,
  isCargo,
  newRatings,
  type Cargo,
  type CargoRating,
  type FreightStock,
  type TransferPacket,
  type Transfers,
} from './cargo';
import { Game, emptyYear, type ViewState, type YearRecord, type YearStats } from './game';
import type { GameDate } from './clock';
import type { Job } from './construction';
import type { RoadVehicle } from './roadVehicles';
import { isBreakdownSetting } from './reliability';
import { cleanFlags, type OrderFlags, type Train } from './trains';
import type { World } from '../world/generator';
import { INDUSTRY_SIZE, averageProduction, isIndustryKind, type Industry } from '../world/industry';
import { GameMap, TileType } from '../world/map';
import {
  RailNetwork,
  PIECES,
  stationTiles,
  type Depot,
  type Edge,
  type RailBridge,
  type Station,
  type Waypoint,
} from '../world/rail';
import { isTownLayout, type Town } from '../world/town';

// 2: úvěr, historie let a rozpad výdajů; 3: hodnocení nástupišť; 4: stáří vlaků; 5: návěstidla; 6: průmysl;
// 7: nákladní doprava uhlí; 8: čekání na plné naložení; 9: náklad podle druhů (dřív jen uhlí); 10: dodávky závodům;
// 11: den poslední dodávky; 12: hodnocení podle nákladu; 13: silniční doprava; 14: zemědělský řetězec;
// 15: letecká doprava; 16: lodní doprava
const SAVE_VERSION = 16;
const MAX_MAP_SIZE = 1024;

export interface SaveData {
  version: number;
  seed: number;
  seedText: string;
  map: { width: number; height: number; tiles: string; owner: string };
  towns: Town[];
  industries?: Industry[];
  // Hustota průmyslu z volby nové hry; starší uložení ji nemají
  industryDensity?: number;
  rail: {
    pieces: string;
    // Trolejové vedení po dlaždicích; starší uložení ho nemají
    electrified?: string;
    stations: Station[];
    depots: Depot[];
    nextStationId: number;
    nextDepotId: number;
    signals?: number[];
    // Jednosměrná návěstidla: [dlaždice, hrana výjezdu]
    signalDirs?: [number, number][];
    // Mosty nad kolejemi a silnicemi; starší uložení je nemají
    bridges?: RailBridge[];
    nextBridgeId?: number;
    // Průjezdné body; starší uložení je nemají
    waypoints?: Waypoint[];
    nextWaypointId?: number;
    roadDepots?: Depot[];
  };
  fleet: { trains: Train[]; nextId: number };
  roadFleet?: { vehicles: RoadVehicle[]; nextId: number };
  airFleet?: { aircraft: Aircraft[]; nextId: number };
  shipFleet?: { ships: Ship[]; nextId: number };
  game: {
    companyName: string;
    money: number;
    loan: number;
    thisYear: YearStats;
    history: YearRecord[];
    rngState: number;
    autoRenew?: boolean;
    breakdowns?: string;
    economy?: string;
  };
  // Dotace; starší uložení je nemají
  subsidies?: unknown;
  // Skupiny vozidel; starší uložení je nemají
  groups?: unknown;
  clock: { date: GameDate; day: number; dayProgress: number };
  // Starší uložení pohled kamery ani rozpracovanou výstavbu nemají
  view?: ViewState;
  construction?: Job[];
}

// Verze 1 měla jen lonišní rok a výdaje bez rozpadu
interface GameV1 {
  companyName: string;
  money: number;
  thisYear: Omit<YearStats, 'costs'>;
  lastYear: Omit<YearStats, 'costs'> | null;
  rngState: number;
}

function migrateV1(game: GameV1, year: number): SaveData['game'] {
  const { lastYear, ...rest } = game;
  return {
    ...rest,
    loan: 0,
    thisYear: { ...emptyYear(), ...game.thisYear },
    history: lastYear ? [{ ...emptyYear(), ...lastYear, year: year - 1 }] : [],
  };
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decode(text: string, expectedBytes: number): Uint8Array {
  const binary = atob(text);
  if (binary.length !== expectedBytes) throw new Error('Poškozená data mapy.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function serializeGame(game: Game, seedText: string): SaveData {
  const { world, clock, fleet } = game;
  const { map, rail } = world;
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    seedText,
    map: {
      width: map.width,
      height: map.height,
      tiles: encode(map.tiles),
      owner: encode(new Uint8Array(map.owner.buffer)),
    },
    towns: world.towns,
    industries: world.industries,
    industryDensity: world.industryDensity ?? 1,
    rail: {
      pieces: encode(rail.pieces),
      electrified: encode(rail.electrified),
      stations: rail.stations,
      depots: rail.depots,
      nextStationId: rail.nextStationId,
      nextDepotId: rail.nextDepotId,
      signals: [...rail.signals],
      signalDirs: [...rail.signalDirs],
      bridges: rail.bridges,
      nextBridgeId: rail.nextBridgeId,
      waypoints: rail.waypoints,
      nextWaypointId: rail.nextWaypointId,
      roadDepots: rail.roadDepots,
    },
    fleet: { trains: fleet.trains, nextId: fleet.nextId },
    roadFleet: { vehicles: game.roadFleet.vehicles, nextId: game.roadFleet.nextId },
    airFleet: { aircraft: game.airFleet.aircraft, nextId: game.airFleet.nextId },
    shipFleet: { ships: game.shipFleet.ships, nextId: game.shipFleet.nextId },
    game: {
      companyName: game.companyName,
      money: game.money,
      loan: game.loan,
      thisYear: game.thisYear,
      history: game.history,
      rngState: game.rng.state,
      autoRenew: game.autoRenew,
      breakdowns: game.breakdowns,
      economy: game.economy,
    },
    subsidies: game.subsidies.serialize(),
    groups: game.groups.serialize(),
    ...(game.view ? { view: game.view } : {}),
    ...(game.construction.busy ? { construction: [...game.construction.pending] } : {}),
    clock: { date: clock.date, day: clock.day, dayProgress: clock.dayProgress },
  };
}

// Nejvyšší spolehlivost modelu vlaku; neznámý model jako první
function modelReliability(train: Train): number {
  return TRAIN_MODELS.find((m) => m.id === train.modelId)?.reliability ?? TRAIN_MODELS[0].reliability;
}

// Náklad z překládek; neplatné balíky se zahodí, starší uložení žádný nemají
function restoreTransfers(value: unknown): Transfers {
  const transfers: Transfers = {};
  if (!isObject(value)) return transfers;
  for (const cargo of CARGO_TYPES) {
    const list = value[cargo];
    if (!Array.isArray(list)) continue;
    const packets = list.filter(
      (p): p is TransferPacket =>
        isObject(p) &&
        [p.amount, p.boardedAt, p.tiles, p.feeder].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
        (p.amount as number) > 0,
    );
    if (packets.length > 0) transfers[cargo] = packets;
  }
  return transfers;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validIndustry(value: unknown, width: number, height: number): value is Industry {
  if (!isObject(value)) return false;
  const { kind, name, x, y, rotation } = value;
  const inside = (v: unknown, size: number): boolean =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) + INDUSTRY_SIZE <= size;
  return (
    typeof kind === 'string' &&
    isIndustryKind(kind) &&
    typeof name === 'string' &&
    inside(x, width) &&
    inside(y, height) &&
    Number.isInteger(rotation)
  );
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function restoreIndustry(industry: Industry, day: number): Industry {
  // Závod ze staršího uložení nemá těžbu, dostane střední hodnotu
  return {
    ...industry,
    production: finiteOr(industry.production, averageProduction(industry.kind)),
    transported: finiteOr(industry.transported, 0),
    lastTransported: finiteOr(industry.lastTransported, 0),
    received: finiteOr(industry.received, 0),
    lastReceived: finiteOr(industry.lastReceived, 0),
    // Starší uložení: lhůta bez dodávek běží až od načtení
    lastDelivery: finiteOr(industry.lastDelivery, day),
    history: Array.isArray(industry.history)
      ? industry.history
          .filter((m) => isObject(m) && Number.isFinite(m.production) && Number.isFinite(m.transported))
          .map((m) => ({ production: m.production, transported: m.transported }))
          .slice(-INDUSTRY_HISTORY_MONTHS)
      : undefined,
    closing: industry.closing === true || undefined,
  };
}

// Zásoba nákladu podle druhu; verze 7–8 měly jen číslo `coal`
function restoreFreight(value: unknown, legacyCoal: unknown): FreightStock {
  const stock = emptyFreight();
  const saved = isObject(value) ? value : { coal: legacyCoal };
  for (const type of FREIGHT_TYPES) stock[type] = finiteOr(saved[type], 0);
  return stock;
}

const legacyCoal = (value: object): unknown => (value as { coal?: unknown }).coal;

// Hodnocení podle nákladu; starší uložení má jedno společné přímo na nástupišti
function restoreRatings(value: unknown, legacy: object): Record<Cargo, CargoRating> {
  const ratings = newRatings();
  const saved = isObject(value) ? value : {};
  for (const cargo of CARGO_TYPES) {
    const entry = isObject(saved[cargo]) ? saved[cargo] : (legacy as Record<string, unknown>);
    ratings[cargo] = {
      rating: finiteOr(entry.rating, RATING_START),
      lastVisit: finiteOr(entry.lastVisit, -1),
      lastSpeed: finiteOr(entry.lastSpeed, 0),
    };
  }
  return ratings;
}

// Kontrola struktury souboru; data pochází od uživatele, proto se neověřené nepoužijí
export function parseSave(text: string): SaveData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platný JSON.');
  }
  if (
    !isObject(data) ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, SAVE_VERSION].includes(data.version as number)
  ) {
    throw new Error('Nepodporovaná verze uložené hry.');
  }
  const { map, rail, fleet, game, clock } = data;
  if (!isObject(map) || !isObject(rail) || !isObject(fleet) || !isObject(game) || !isObject(clock)) {
    throw new Error('Neúplná uložená hra.');
  }
  const size = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_MAP_SIZE;
  if (!size(map.width) || !size(map.height)) throw new Error('Neplatná velikost mapy.');
  const strings = [map.tiles, map.owner, rail.pieces, game.companyName, data.seedText];
  const numbers = [
    data.seed,
    rail.nextStationId,
    rail.nextDepotId,
    fleet.nextId,
    game.money,
    game.rngState,
    clock.day,
    clock.dayProgress,
  ];
  const arrays = [data.towns, rail.stations, rail.depots, fleet.trains, rail.signals ?? [], data.industries ?? []];
  if (
    strings.some((s) => typeof s !== 'string') ||
    numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
    arrays.some((a) => !Array.isArray(a)) ||
    !isObject(clock.date) ||
    !isObject(game.thisYear)
  ) {
    throw new Error('Poškozená uložená hra.');
  }
  if (data.version === 1) {
    const year = Number(clock.date.year);
    return { ...data, version: SAVE_VERSION, game: migrateV1(game as unknown as GameV1, year) } as unknown as SaveData;
  }
  if (typeof game.loan !== 'number' || !Number.isFinite(game.loan) || !Array.isArray(game.history)) {
    throw new Error('Poškozená uložená hra.');
  }
  return data as unknown as SaveData;
}

export function restoreGame(data: SaveData): Game {
  const { width, height } = data.map;
  const map = new GameMap(width, height);
  map.tiles.set(decode(data.map.tiles, width * height));
  new Uint8Array(map.owner.buffer).set(decode(data.map.owner, width * height * 2));

  const rail = new RailNetwork(map);
  rail.pieces.set(decode(data.rail.pieces, width * height));
  rail.revision++;
  // Starší uložení nezná velikost nástupišť (všechna byla 1×3) ani jejich hodnocení
  rail.stations.push(
    ...data.rail.stations.map((s) => {
      const station = {
        ...s,
        length: s.length ?? STATION_LENGTH,
        tracks: s.tracks ?? 1,
        freight: restoreFreight(s.freight, legacyCoal(s)),
        ratings: restoreRatings(s.ratings, s),
        transfers: restoreTransfers(s.transfers),
      };
      // Verze 11 a starší měly jedno hodnocení pro všechen náklad
      for (const key of ['rating', 'lastVisit', 'lastSpeed']) delete (station as Record<string, unknown>)[key];
      return station;
    }),
  );
  // Letiště neznámé velikosti a přístav bez strany k vodě z cizího souboru se zahodí i se svou plochou
  for (let i = rail.stations.length - 1; i >= 0; i--) {
    const s = rail.stations[i];
    const valid =
      (s.kind !== 'air' || (s.airport !== undefined && s.airport in AIRPORT_TYPES)) &&
      (s.kind !== 'water' || (Number.isInteger(s.dock) && s.dock! >= 0 && s.dock! < 4));
    if (valid) continue;
    for (const t of stationTiles(s)) {
      if (map.isType(t.x, t.y, TileType.Airport) || map.isType(t.x, t.y, TileType.Port))
        map.set(t.x, t.y, TileType.Grass);
    }
    rail.stations.splice(i, 1);
  }
  // Části spojených stanic znovu sdílí stav s hlavní částí
  for (const s of rail.stations) if (s.joinedTo !== undefined && !Number.isInteger(s.joinedTo)) delete s.joinedTo;
  rail.relinkStations();
  rail.depots.push(...data.rail.depots);
  rail.roadDepots.push(...(Array.isArray(data.rail.roadDepots) ? data.rail.roadDepots : []));
  rail.nextStationId = data.rail.nextStationId;
  rail.nextDepotId = data.rail.nextDepotId;
  // Starší uložení návěstidla nemá; neplatné indexy se zahodí
  for (const tile of data.rail.signals ?? []) {
    if (Number.isInteger(tile) && tile >= 0 && tile < width * height) rail.signals.add(tile);
  }
  // Mosty: neplatné (mimo mapu, křížící se, nad stavbou) se zahodí
  for (const b of Array.isArray(data.rail.bridges) ? data.rail.bridges : []) {
    if (!isObject(b) || ![b.x, b.y, b.dir, b.span].every((n) => Number.isInteger(n))) continue;
    if (b.dir < 0 || b.dir > 3) continue;
    const [dx, dy] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ][b.dir];
    const x1 = b.x + (b.span + 1) * dx;
    const y1 = b.y + (b.span + 1) * dy;
    if (rail.bridgeProblem(b.x, b.y, x1, y1) === null) rail.addBridge(b.x, b.y, x1, y1).id = b.id;
  }
  rail.nextBridgeId = Math.max(finiteOr(data.rail.nextBridgeId, 0), ...rail.bridges.map((b) => b.id + 1));
  // Průjezdné body: jen na rovné koleji (neplatné se zahodí)
  for (const w of Array.isArray(data.rail.waypoints) ? data.rail.waypoints : []) {
    if (!isObject(w) || !Number.isInteger(w.x) || !Number.isInteger(w.y) || !Number.isInteger(w.id)) continue;
    if (!map.inBounds(w.x, w.y)) continue;
    const added = rail.addWaypoint(w.x, w.y, typeof w.name === 'string' ? w.name : 'Bod');
    if (added) added.id = w.id;
  }
  rail.nextWaypointId = Math.max(finiteOr(data.rail.nextWaypointId, 0), ...rail.waypoints.map((w) => w.id + 1));
  for (const entry of Array.isArray(data.rail.signalDirs) ? data.rail.signalDirs : []) {
    const [tile, dir] = Array.isArray(entry) ? entry : [-1, -1];
    if (rail.signals.has(tile) && Number.isInteger(dir) && dir >= 0 && dir < 4) rail.signalDirs.set(tile, dir as Edge);
  }

  const world: World = {
    seed: data.seed,
    map,
    // Neznámé rozložení silnic se zahodí; město pak roste v mřížce jako ve starších uloženích
    towns: data.towns.map((t) => (t.layout === undefined || isTownLayout(t.layout) ? t : { ...t, layout: undefined })),
    rail,
    // Starší uložení průmysl nemá; cizí soubor může obsahovat nesmysly
    industries: (data.industries ?? [])
      .filter((i) => validIndustry(i, width, height))
      .map((i) => restoreIndustry(i, data.clock.day)),
    industryDensity: Math.min(4, Math.max(0.1, finiteOr(data.industryDensity, 1))),
  };
  const game = new Game(world);
  game.companyName = data.game.companyName;
  game.autoRenew = data.game.autoRenew === true;
  game.breakdowns = isBreakdownSetting(data.game.breakdowns) ? data.game.breakdowns : 'normal';
  // Starší uložení měla skokové změny výroby (původní ekonomika)
  game.economy = isEconomySetting(data.game.economy) ? data.game.economy : 'original';
  game.money = data.game.money;
  game.loan = data.game.loan;
  // Přepravený náklad starší uložení nezná nebo zná jen uhlí
  const year = <T extends YearStats>(y: T): T => ({ ...y, freight: restoreFreight(y.freight, legacyCoal(y)) });
  game.thisYear = year(data.game.thisYear);
  game.history = data.game.history.map(year);
  game.rng.state = data.game.rngState;
  game.subsidies.restore(data.subsidies);
  // Trolejové vedení jen na dlaždicích s kolejí; starší uložení ho nemají – jezdí-li v nich elektrické
  // vlaky (dřív jezdily kudykoli), dostane vedení celá železnice, aby nezůstaly stát
  if (typeof data.rail.electrified === 'string') {
    const wires = decode(data.rail.electrified, width * height);
    for (let i = 0; i < wires.length; i++) if (wires[i] && rail.pieces[i]) rail.electrified[i] = 1;
  } else if (data.fleet.trains.some((t) => TRAIN_MODELS.find((m) => m.id === t.modelId)?.electric)) {
    for (let i = 0; i < rail.pieces.length; i++) if (rail.pieces[i]) rail.electrified[i] = 1;
  }
  game.clock.date = data.clock.date;
  game.clock.day = data.clock.day;
  game.clock.dayProgress = data.clock.dayProgress;
  // Starší uložení nezná stáří vlaků; nejstarší možný je vlak koupený na začátku hry
  game.fleet.trains.push(
    ...data.fleet.trains.map((saved) => {
      // Starší uložení mají místo voleb příkazů jen seznam zastávek s čekáním na plné naložení
      const { fullLoad, ...t } = saved as Train & { fullLoad?: unknown };
      const legacyFull = Array.isArray(fullLoad) ? fullLoad : [];
      const savedFlags: unknown[] = Array.isArray(t.orderFlags) ? t.orderFlags : [];
      const orderFlags: OrderFlags[] = (Array.isArray(t.orders) ? t.orders : []).map((id, i) => {
        const flags = savedFlags[i];
        if (isObject(flags)) return cleanFlags(flags as OrderFlags);
        return legacyFull.includes(id) ? { load: 'full' } : {};
      });
      return {
        ...t,
        builtDay: t.builtDay ?? 0,
        agingWarned: t.agingWarned ?? false,
        renewing: t.renewing ?? false,
        cargo: isCargo(t.cargo) ? t.cargo : ('passengers' as const),
        orderFlags,
        serviceUntil: Number.isFinite(t.serviceUntil) ? t.serviceUntil : undefined,
        feeder: Number.isFinite(t.feeder) ? t.feeder : 0,
        // Starší uložení údržbu neznají: vlak je jako po servisu
        reliability: Number.isFinite(t.reliability) ? Math.min(1, Math.max(0, t.reliability)) : modelReliability(t),
        lastService: Number.isFinite(t.lastService) ? t.lastService : data.clock.day,
        serviceInterval: Number.isFinite(t.serviceInterval) ? t.serviceInterval : SERVICE_INTERVAL_DAYS,
        brokenDays: Number.isFinite(t.brokenDays) ? Math.max(0, t.brokenDays) : 0,
        breakdowns: Number.isInteger(t.breakdowns) ? t.breakdowns : 0,
        servicing:
          isObject(t.servicing) && Number.isInteger(t.servicing.depotId) && Number.isInteger(t.servicing.resume)
            ? { depotId: t.servicing.depotId, resume: t.servicing.resume }
            : undefined,
        orderGroup: Number.isInteger(t.orderGroup) ? t.orderGroup : null,
        // Časy v jízdním řádu (starší uložení je nemají)
        departedAt: Number.isFinite(t.departedAt) ? t.departedAt : undefined,
        lateness: Number.isFinite(t.lateness) ? t.lateness : undefined,
        lastTravel: Array.isArray(t.lastTravel)
          ? t.lastTravel.map((d) => (Number.isFinite(d) ? (d as number) : null))
          : undefined,
        autofill: t.autofill === true || undefined,
      };
    }),
  );
  game.fleet.nextId = data.fleet.nextId;
  game.fleet.nextGroupId = Math.max(0, ...game.fleet.trains.map((t) => t.orderGroup ?? 0)) + 1;
  // Starší uložení auta nemá; vozidla neznámého modelu se zahodí
  const roadFleet = isObject(data.roadFleet) ? data.roadFleet : { vehicles: [], nextId: 1 };
  game.roadFleet.vehicles.push(
    ...(Array.isArray(roadFleet.vehicles) ? roadFleet.vehicles : []).filter(
      (v) => isObject(v) && ROAD_VEHICLE_MODELS.some((m) => m.id === v.modelId) && Array.isArray(v.path),
    ),
  );
  game.roadFleet.nextId = Number.isInteger(roadFleet.nextId) ? roadFleet.nextId : 1;
  // Starší uložení letadla nemá; letadla neznámého modelu nebo bez letiště se zahodí
  const airFleet = isObject(data.airFleet) ? data.airFleet : { aircraft: [], nextId: 1 };
  const airports = new Set(rail.stations.filter((s) => s.kind === 'air').map((s) => s.id));
  game.airFleet.aircraft.push(
    ...(Array.isArray(airFleet.aircraft) ? airFleet.aircraft : []).filter(
      (p) =>
        isObject(p) &&
        AIRCRAFT_MODELS.some((m) => m.id === p.modelId) &&
        Array.isArray(p.route) &&
        airports.has(p.depotId) &&
        airports.has(p.airportId),
    ),
  );
  game.airFleet.nextId = Number.isInteger(airFleet.nextId) ? airFleet.nextId : 1;
  // Starší uložení lodě nemá; lodě neznámého modelu nebo bez přístavu se zahodí
  const shipFleet = isObject(data.shipFleet) ? data.shipFleet : { ships: [], nextId: 1 };
  const ports = new Set(rail.stations.filter((s) => s.kind === 'water').map((s) => s.id));
  game.shipFleet.ships.push(
    ...(Array.isArray(shipFleet.ships) ? shipFleet.ships : []).filter(
      (s) =>
        isObject(s) &&
        SHIP_MODELS.some((m) => m.id === s.modelId) &&
        Array.isArray(s.path) &&
        ports.has(s.depotId) &&
        ports.has(s.portId),
    ),
  );
  game.shipFleet.nextId = Number.isInteger(shipFleet.nextId) ? shipFleet.nextId : 1;
  // Skupiny až po vozidlech: vozidla z neexistující skupiny se z ní vyjmou
  game.groups.restore(data.groups);
  game.view = validView(data.view);
  // Cizí soubor může obsahovat nesmysly; místo se před stavbou kontroluje znovu
  game.construction.restore((data.construction ?? []).filter((job) => validJob(job, width, height)));
  return game;
}

function validJob(job: unknown, width: number, height: number): job is Job {
  if (!isObject(job) || !isObject(job.step) || (job.kind !== 'track' && job.kind !== 'road')) return false;
  const { x, y, piece, isNew, axis } = job.step;
  const below = (v: unknown, size: number): boolean =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) < size;
  const pieceOk = job.kind === 'road' || below(piece, PIECES.length);
  // Nový dílek mostu nese osu, jinak by se nad vodou nepostavil
  const axisOk = job.kind === 'track' || axis === undefined || axis === 'x' || axis === 'y';
  return below(x, width) && below(y, height) && pieceOk && axisOk && typeof isNew === 'boolean';
}

function validView(view: unknown): ViewState | null {
  if (!isObject(view)) return null;
  const { x, z, zoom, rotation } = view;
  const numbers = [x, z, zoom, rotation].every((n) => typeof n === 'number' && Number.isFinite(n));
  return numbers && Number.isInteger(rotation) ? (view as unknown as ViewState) : null;
}
