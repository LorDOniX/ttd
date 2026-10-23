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
