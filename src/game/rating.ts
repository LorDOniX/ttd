import {
  RATING_DAILY_CHANGE,
  RATING_MAX_DAILY_LEAVE,
  RATING_SPEED_FULL,
  RATING_SPEED_POINTS,
  RATING_VISIT_TIERS,
  RATING_WAITING_TIERS,
} from './balance';
import type { Station } from '../world/rail';

export interface RatingParts {
  visit: number;
  speed: number;
  waiting: number;
}

// Body hodnocení podle doby od posledního vlaku, jeho rychlosti a počtu čekajících
export function ratingParts(station: Station, now: number): RatingParts {
  const days = station.lastVisit < 0 ? Infinity : now - station.lastVisit;
  return {
    visit: RATING_VISIT_TIERS.find((t) => days <= t.maxDays)?.points ?? 0,
    speed: RATING_SPEED_POINTS * Math.min(1, station.lastSpeed / RATING_SPEED_FULL),
    waiting: RATING_WAITING_TIERS.find((t) => station.waiting <= t.max)?.points ?? 0,
  };
}

export function targetRating(station: Station, now: number): number {
  const { visit, speed, waiting } = ratingParts(station, now);
  return visit + speed + waiting;
}

// Denní posun hodnocení k cíli, nejvýš o RATING_DAILY_CHANGE
export function updateRating(station: Station, now: number): void {
  const delta = targetRating(station, now) - station.rating;
  station.rating += Math.max(-RATING_DAILY_CHANGE, Math.min(RATING_DAILY_CHANGE, delta));
}

// Násobek přílivu cestujících: při 50 % beze změny, při 100 % o polovinu víc
export function inflowFactor(rating: number): number {
  return 0.5 + rating;
}

// Denní podíl čekajících, kteří odejdou; pod 50 % lineárně roste
export function leaveShare(rating: number): number {
  return rating >= 0.5 ? 0 : ((0.5 - rating) / 0.5) * RATING_MAX_DAILY_LEAVE;
}
