/**
 * js/logic/era.js — Era Pass-Through
 *
 * The NBA original rescales counting stats across decades because league
 * pace (possessions/48min) swung hard over time — a 1960s big's rebounds
 * reflect a much faster league, not necessarily more dominance.
 *
 * IPL cricket has no equivalent: every match, in every era from 2008 to
 * today, is the same 20-over format. There's no "pace" to normalize away, so
 * these are all flat pass-throughs. The module still exists as the single
 * seam where era normalization WOULD live, so simulation.js/challenge.js can
 * keep calling one set of accessors without caring whether it's active — if
 * IPL ever splits into formats that need rescaling, only this file changes.
 */

/** A single stat (runs/sr/wkts/econ/field), unscaled (pass-through). */
export function eraAdjustedStat(player, key) {
  return player?.[key] || 0;
}

const COUNTING_STATS = ['runs', 'sr', 'wkts', 'econ', 'field'];

/** All five counting stats, unscaled, as a fresh object. */
export function eraAdjustedLine(player) {
  const line = {};
  for (const k of COUNTING_STATS) line[k] = player?.[k] || 0;
  return line;
}

/** Extracts the '2016-19'-style era suffix from a "Team_2016-19" DB bucket key. */
export function decadeFromBucketKey(key) {
  return key.match(/_(\d{4}-\d{2})$/)?.[1] ?? null;
}
