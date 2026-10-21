import {
  RATING_DAILY_CHANGE,
  RATING_MAX_DAILY_LEAVE,
  RATING_SPEED_FULL,
  RATING_SPEED_POINTS,
  RATING_VISIT_TIERS,
  RATING_WAITING_TIERS,
} from './balance';
import type { Cargo } from './cargo';
import type { Station } from '../world/rail';

export interface RatingParts {
  visit: number;
  speed: number;
  waiting: number;
}

// Čekající cestující nebo tuny nákladu daného druhu
export function waitingAmount(station: Station, cargo: Cargo): number {
  return cargo === 'passengers' ? station.waiting : station.freight[cargo];
}

// Body hodnocení podle doby od posledního vlaku s tímto nákladem, jeho rychlosti a množství čekajícího nákladu
export function ratingParts(station: Station, cargo: Cargo, now: number): RatingParts {
  const { lastVisit, lastSpeed } = station.ratings[cargo];
  const days = lastVisit < 0 ? Infinity : now - lastVisit;
  const amount = waitingAmount(station, cargo);
  return {
    visit: RATING_VISIT_TIERS.find((t) => days <= t.maxDays)?.points ?? 0,
    speed: RATING_SPEED_POINTS * Math.min(1, lastSpeed / RATING_SPEED_FULL),
    waiting: RATING_WAITING_TIERS.find((t) => amount <= t.max)?.points ?? 0,
  };
}

export function targetRating(station: Station, cargo: Cargo, now: number): number {
  const { visit, speed, waiting } = ratingParts(station, cargo, now);
  return visit + speed + waiting;
}

// Denní posun hodnocení k cíli, nejvýš o RATING_DAILY_CHANGE
export function updateRating(station: Station, cargo: Cargo, now: number): void {
  const entry = station.ratings[cargo];
  const delta = targetRating(station, cargo, now) - entry.rating;
  entry.rating += Math.max(-RATING_DAILY_CHANGE, Math.min(RATING_DAILY_CHANGE, delta));
}

// Vlak s nákladem stanici obsloužil
export function recordVisit(station: Station, cargo: Cargo, now: number, speed: number): void {
  const entry = station.ratings[cargo];
  entry.lastVisit = now;
  entry.lastSpeed = speed;
}

// Násobek přílivu cestujících: při 50 % beze změny, při 100 % o polovinu víc
export function inflowFactor(rating: number): number {
  return 0.5 + rating;
}

// Denní podíl čekajících, kteří odejdou; pod 50 % lineárně roste
export function leaveShare(rating: number): number {
  return rating >= 0.5 ? 0 : ((0.5 - rating) / 0.5) * RATING_MAX_DAILY_LEAVE;
}
