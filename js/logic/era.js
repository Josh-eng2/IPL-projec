/**
 * js/logic/era.js — Era Pass-Through
 *
 * The NBA original rescales counting stats across decades because league
 * pace (possessions/48min) swung hard over time — a 1960s big's rebounds
 * reflect a much faster league, not necessarily more dominance.
 *
 * IPL cricket has no equivalent: every match, in every era from 2008 to
 * today, is the same 20-over format. There's no "pace" to normalize away,
 * so eraFactor() is a flat 1.0 across all eras — this module exists purely
 * so simulation.js/challenge.js can keep calling the same functions without
 * caring whether normalization is active.
 */

const ERA_FACTOR = 1;

/** Always 1 — IPL's T20 format never changes pace across eras. */
export function eraFactor(_era) {
  return ERA_FACTOR;
}

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
