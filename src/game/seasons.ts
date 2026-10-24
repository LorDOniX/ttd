import type { GameDate } from './clock';

export const SEASON_MODES = ['auto', 'spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonMode = (typeof SEASON_MODES)[number];
export type Season = Exclude<SeasonMode, 'auto'>;

export function seasonForDate(date: Pick<GameDate, 'month'>, mode: SeasonMode): Season {
  if (mode !== 'auto') return mode;
  if (date.month === 11 || date.month < 2) return 'winter';
  if (date.month < 5) return 'spring';
  if (date.month < 8) return 'summer';
  return 'autumn';
}

// Vzhled mezi dvěma obdobími: t = 0 je celé from, t = 1 celé to
export interface SeasonBlend {
  from: Season;
  to: Season;
  t: number;
}

const SEASON_ORDER: readonly Season[] = ['winter', 'spring', 'summer', 'autumn'];
const FIRST_MONTH: Record<Season, number> = { spring: 2, summer: 5, autumn: 8, winter: 11 };

// V automatickém režimu se během prvního měsíce období vzhled plynule mění z předchozího období
export function seasonBlendForDate(date: Pick<GameDate, 'month' | 'day'>, mode: SeasonMode): SeasonBlend {
  const to = seasonForDate(date, mode);
  if (mode !== 'auto' || date.month !== FIRST_MONTH[to]) return { from: to, to, t: 1 };
  const from = SEASON_ORDER[(SEASON_ORDER.indexOf(to) + SEASON_ORDER.length - 1) % SEASON_ORDER.length];
  return { from, to, t: Math.min(1, (date.day - 1) / 30) };
}

// Období, které v přechodu převažuje (sníh na střechách, padající listí)
export function dominantSeason(blend: SeasonBlend): Season {
  return blend.t < 0.5 ? blend.from : blend.to;
}
