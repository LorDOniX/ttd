import { SEASON_MODES, type SeasonMode } from '../game/seasons';
import type { GameView } from '../render/gameView';
import { h } from './dom';

export const SEASON_LABELS: Record<SeasonMode, string> = {
  auto: 'Podle kalendáře',
  spring: 'Jaro',
  summer: 'Léto',
  autumn: 'Podzim',
  winter: 'Zima',
};

const SEASON_ICONS: Record<SeasonMode, string> = {
  auto: '🗓️',
  spring: '🌷',
  summer: '🌻',
  autumn: '🍂',
  winter: '❄️',
};

// Vzhled scény (den/noc a roční období) sdílený horní lištou, Nastavením a pohledem z první osoby;
// mění jen vykreslování, ne hru (lodě zamrzají podle kalendáře)
export interface SceneControls {
  night: () => boolean;
  toggleNight: () => void;
  season: () => SeasonMode;
  setSeason: (mode: SeasonMode) => void;
  // Další (1) nebo předchozí (−1) volba ročního období
  cycleSeason: (direction: 1 | -1) => void;
  onChange: (listener: () => void) => () => void;
}

export function createSceneControls(view: GameView): SceneControls {
  const listeners = new Set<() => void>();
  const changed = (): void => listeners.forEach((listener) => listener());
  const setSeason = (mode: SeasonMode): void => {
    view.setSeasonMode(mode);
    changed();
  };
  return {
    night: () => view.nightMode,
    toggleNight: () => {
      view.toggleNightMode();
      changed();
    },
    season: () => view.selectedSeasonMode,
    setSeason,
    cycleSeason: (direction) => {
      const i = SEASON_MODES.indexOf(view.selectedSeasonMode);
      setSeason(SEASON_MODES[(i + direction + SEASON_MODES.length) % SEASON_MODES.length]);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Tlačítka den/noc a ročního období; text a stav se obnoví při každé změně, ať ji udělal kdokoli.
// withText = s popiskem (pohled z první osoby), jinak jen ikona (horní lišta)
export function sceneButtons(
  controls: SceneControls,
  className: string,
  withText: boolean,
): { night: HTMLButtonElement; season: HTMLButtonElement; dispose: () => void } {
  const night = h('button', { className, type: 'button' });
  const season = h('button', { className, type: 'button' });
  night.addEventListener('click', () => controls.toggleNight());
  season.addEventListener('click', () => controls.cycleSeason(1));
  season.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    controls.cycleSeason(-1);
  });
  const render = (): void => {
    const isNight = controls.night();
    night.textContent = withText ? (isNight ? '☾ Noc' : '☀ Den') : isNight ? '☾' : '☀';
    night.title = isNight ? 'Přepnout na den' : 'Přepnout na noc';
    night.setAttribute('aria-pressed', String(isNight));
    const mode = controls.season();
    season.textContent = withText ? `${SEASON_ICONS[mode]} ${SEASON_LABELS[mode]}` : SEASON_ICONS[mode];
    season.title = `Roční období: ${SEASON_LABELS[mode]} (klik další, pravé tlačítko předchozí)`;
    if (!withText) {
      night.classList.toggle(`${className}--active`, isNight);
      season.classList.toggle(`${className}--active`, mode !== 'auto');
    }
  };
  render();
  const dispose = controls.onChange(render);
  return { night, season, dispose };
}
