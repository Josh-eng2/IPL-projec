/**
 * js/logic/challenge.js — Daily Challenge Engine
 *
 * Every calendar day (UTC) all players get the SAME challenge, selected
 * deterministically from CHALLENGES by hashing the date string. Only the
 * selection is seeded — the draft spins and season sim stay fully random,
 * so the day is a shared prompt, not a shared outcome.
 *
 * Challenge types:
 *   constraint — rules on who you may draft (era, rating cap, fans
 *                budget, excluded franchises). Enforced at pick time.
 *   objective  — a result target beyond the constraint's win floor
 *                (win total, a stat-leader line, the championship).
 *   locked     — a named star is pre-locked into their slot; draft the
 *                other four around them.
 *
 * Every challenge carries a `minWins` floor so pass/fail is always about
 * the season, never just "you finished the draft".
 *
 * Exports:
 *   todayUTC()                          → 'YYYY-MM-DD' (supports ?dailydate= dev override)
 *   getDailyChallenge(dateStr?)         → catalog entry for the day
 *   checkPickLegal(ch, player, S)      → { legal, reason } at draft time
 *   checkRosterConstraint(ch, starters) → { pass, detail } live/final roster check
 *   evaluateObjective(ch, S)            → { pass, pending, detail } post-sim
 *   dailyScore(ch, S)                   → leaderboard score for the run
 *   getLockedPlayer(ch)                 → hydrated player object or null
 */

import { DB }                  from '../data/players.js';
import { decadeFromBucketKey } from './era.js';

// Cheapest player popularity in the DB — used to prove a budget pick can
// still be completed with the remaining slots. Derived from the live DB
// (memoized) so a data regeneration can't silently break the feasibility
// math. 40 is the current floor; the constant below is only the pre-DB-load
// fallback and is deliberately conservative (never above the real minimum,
// or the feasibility check would reject legal picks).
let _minPopCache = null;
function minPopularity() {
  if (_minPopCache != null) return _minPopCache;
  if (!DB) return 35;
  let min = Infinity;
  for (const players of Object.values(DB)) {
    for (const p of players) if ((p.popularity ?? 50) < min) min = p.popularity ?? 50;
  }
  _minPopCache = Number.isFinite(min) ? min : 35;
  return _minPopCache;
}

// ── Catalog ───────────────────────────────────────────────────────────────────
// NOTE on `era` vs `allowedDecades`: `era` locks the header picker to one
// decade (spins only land there); `allowedDecades` keeps 'all'-mode spins but
// restricts which decades count as available (multi-decade windows).
// Locked `playerId`s must exist in players.json — getDailyChallenge skips
// entries whose id has drifted after a data regeneration.
// `maxRating` caps (none currently in the catalog) are on the `overall` scale
// (era-adjusted 2K rating, mean ≈87), NOT the stats-derived `rating` scale.
export const CHALLENGES = [
  // ── Draft constraints ──
  { id: 'inaugural-era',  type: 'constraint', emoji: '📼', title: 'Inaugural Era',
    desc: 'Only 2008-11 players — win 9+ matches.',
    params: { era: '2008-11', minWins: 9 } },
  { id: 'impact-era',     type: 'constraint', emoji: '💿', title: 'Impact Player Era',
    desc: 'Only 2023-25 players — win 9+ matches.',
    params: { era: '2023-25', minWins: 9 } },
  { id: 'old-guard',      type: 'constraint', emoji: '🎩', title: 'Old Guard',
    desc: 'Only 2008-15 players — win 8+ matches.',
    params: { allowedDecades: ['2008-11', '2012-15'], minWins: 8 } },
  { id: 'new-gen',        type: 'constraint', emoji: '🚀', title: 'New Gen',
    desc: 'Only 2020-25 players — win 9+ matches.',
    params: { allowedDecades: ['2020-22', '2023-25'], minWins: 9 } },
  { id: 'domestic-talent', type: 'constraint', emoji: '👎', title: 'Domestic Talent',
    desc: 'Total roster fans under 300 — win 8+ matches.',
    params: { maxPopTotal: 300, minWins: 8 } },
  { id: 'no-big-two',     type: 'constraint', emoji: '🙅', title: 'No Big Two',
    desc: 'No Mumbai Indians, no Chennai Super Kings — win 10+ matches.',
    params: { excludeTeams: ['Mumbai Indians', 'Chennai Super Kings'], minWins: 10 } },

  // ── Result objectives ──
  { id: 'win-11',         type: 'objective', emoji: '🎯', title: '11-Win Season',
    desc: 'Any XI — win at least 11 matches.',
    params: { minWins: 11 } },
  { id: 'win-12',         type: 'objective', emoji: '🏔️', title: 'Air Rare',
    desc: 'Any XI — win at least 12 matches.',
    params: { minWins: 12 } },
  { id: 'boundary-machine', type: 'objective', emoji: '🔥', title: 'Boundary Machine',
    desc: 'A starter must average 42+ runs this season — and win 8+ matches.',
    params: { minWins: 8, starterRuns: 42 } },
  { id: 'strike-force',   type: 'objective', emoji: '🖐️', title: 'Strike Force',
    desc: 'Your bowlers must combine for 5+ wickets per match — and win 8+ matches.',
    params: { minWins: 8, teamWkts: 5 } },
  { id: 'all-star-xi',    type: 'objective', emoji: '⭐', title: 'All-Star XI',
    desc: 'Average 92+ Team Rating and win 9+ matches.',
    params: { minWins: 9, minRating: 92 } },
  { id: 'wire-to-wire',   type: 'objective', emoji: '⚡', title: 'Wire to Wire',
    desc: 'Put together a 10-match win streak at some point in the season.',
    params: { minWins: 8, minStreak: 10 } },

  // ── Locked-player builds ──
  { id: 'build-around-kohli',  type: 'locked', emoji: '👑', title: 'King Kohli',
    desc: "Virat Kohli ('16 RCB) is locked in the middle order. Build around him — win 10+ matches.",
    params: { playerId: 'kohli_16', pos: 'MID', minWins: 10 } },
  { id: 'build-around-dhoni',  type: 'locked', emoji: '🧊', title: "Thala's Call",
    desc: "MS Dhoni ('11 CSK) is locked behind the stumps. Win 10+ matches.",
    params: { playerId: 'dhoni_11', pos: 'WK', minWins: 10 } },
  { id: 'build-around-bumrah', type: 'locked', emoji: '🎯', title: 'Yorker King',
    desc: "Jasprit Bumrah ('20 MI) is locked as the pace spearhead. Win 10+ matches.",
    params: { playerId: 'bumrah_20', pos: 'PACE', minWins: 10 } },
  { id: 'build-around-gayle',  type: 'locked', emoji: '💪', title: 'Universe Boss',
    desc: "Chris Gayle ('13 RCB) is locked to open the innings. Win 10+ matches.",
    params: { playerId: 'gayle_13', pos: 'OPEN', minWins: 10 } },
];

// ── Date & seeded selection ───────────────────────────────────────────────────

/**
 * Today's UTC date as 'YYYY-MM-DD'. A `?dailydate=YYYY-MM-DD` query param
 * overrides it, but ONLY on a local dev host — in production that override
 * was a cheat door (scout tomorrow's board/challenge, replay any date,
 * submit to another day's leaderboard).
 */
export function todayUTC() {
  try {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      const o = new URLSearchParams(window.location.search).get('dailydate');
      if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
    }
  } catch (_) { /* non-browser context */ }
  return new Date().toISOString().slice(0, 10);
}

/** UTC day before the given 'YYYY-MM-DD'. */
function yesterdayOf(dateStr) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}

/** xmur3 string hash → non-negative 32-bit int. Deterministic across sessions. */
function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Raw catalog index for a date — before repeat-avoidance and validity checks. */
const rawIndex = dateStr => hashStr(dateStr) % CHALLENGES.length;

/**
 * A date's catalog index after repeat-avoidance. Each day must be bumped off
 * the previous day's index *after its own bump*, not off its raw hash: when
 * yesterday collided and got bumped forward, today's raw index could land
 * exactly on yesterday's final challenge and a raw-vs-raw comparison never
 * saw it — a back-to-back repeat roughly every ~80 days, the very thing the
 * avoidance logic exists to prevent. Bumps chain (a bumped day shifts what
 * its successor must avoid), so the exact value is computed by replaying the
 * bump rule forward from a fixed horizon; 32 days is exact unless every one
 * of 32 consecutive raw hashes chain-collides, which is effectively never.
 * Pure function of the date string — identical on every client.
 */
function finalIndexFor(dateStr) {
  const HORIZON = 32;
  const dates = [dateStr];
  for (let i = 0; i < HORIZON; i++) dates.push(yesterdayOf(dates[dates.length - 1]));
  dates.reverse(); // oldest → newest
  let prev = rawIndex(dates[0]); // anchor: beyond the horizon, treat raw as final
  for (let i = 1; i < dates.length; i++) {
    let idx = rawIndex(dates[i]);
    if (idx === prev) idx = (idx + 1) % CHALLENGES.length;
    prev = idx;
  }
  return prev;
}

/**
 * The day's challenge. Deterministic: same date → same entry for everyone.
 * Skips (a) yesterday's challenge, so no back-to-back repeats, and
 * (b) locked entries whose playerId is missing from the DB (data drift).
 * Memoized per date — render paths call this every frame, and the locked-id
 * validity check scans the whole player DB.
 */
const _challengeCache = new Map();
export function getDailyChallenge(dateStr = todayUTC()) {
  if (_challengeCache.has(dateStr)) return _challengeCache.get(dateStr);
  const avoid = finalIndexFor(yesterdayOf(dateStr));
  let idx = rawIndex(dateStr);
  if (idx === avoid) idx = (idx + 1) % CHALLENGES.length; // == finalIndexFor(dateStr)
  let found = CHALLENGES[idx]; // fallback — unreachable unless the whole catalog is broken
  for (let tries = 0; tries < CHALLENGES.length; tries++) {
    const j = (idx + tries) % CHALLENGES.length;
    // Skipping a broken locked entry must not walk back onto yesterday's
    // challenge — that would reintroduce the back-to-back repeat the
    // pre-loop adjustment exists to prevent.
    if (j === avoid) continue;
    const ch = CHALLENGES[j];
    if (ch.type === 'locked' && !getLockedPlayer(ch)) {
      console.warn(`[daily] locked player ${ch.params.playerId} missing from DB — skipping ${ch.id}`);
      continue;
    }
    found = ch;
    break;
  }
  // Don't cache pre-DB-load lookups — a locked entry could be wrongly skipped.
  if (DB) _challengeCache.set(dateStr, found);
  return found;
}

// ── Locked-player lookup ──────────────────────────────────────────────────────

/**
 * Hydrates a locked challenge's player from the DB, with team + decade
 * attached exactly like a drafted player gets (events.js placePlayer).
 * Returns null when the id no longer exists (players.json regenerated).
 */
export function getLockedPlayer(challenge) {
  const id = challenge?.params?.playerId;
  if (!id || !DB) return null;
  for (const [key, players] of Object.entries(DB)) {
    const p = players.find(x => x.id === id);
    if (p) return { ...p, team: key.split('_')[0], decade: decadeFromBucketKey(key) };
  }
  return null;
}

// ── Draft-time legality ───────────────────────────────────────────────────────

/**
 * Whether a player may be drafted under the day's rules. `player` should
 * carry `team`/`decade` (attach from the current spin when checking board
 * entries). `filled` = starters already on the roster.
 *
 * @returns {{ legal: boolean, reason: string|null }}
 */
export function checkPickLegal(challenge, player, filled = []) {
  const P = challenge?.params;
  if (!P) return { legal: true, reason: null };

  if (P.maxRating != null && (player.overall ?? 82) > P.maxRating) {
    return { legal: false, reason: `Rated ${player.overall} — today's cap is ${P.maxRating}` };
  }
  if (P.excludeTeams && player.team && P.excludeTeams.includes(player.team)) {
    return { legal: false, reason: `No ${player.team} players today` };
  }
  if (P.allowedDecades && player.decade && !P.allowedDecades.includes(player.decade)) {
    return { legal: false, reason: `${player.decade} is outside today's window` };
  }
  if (P.maxPopTotal != null) {
    // Block picks that make the budget mathematically impossible: current sum
    // + this player + a floor-priced player in every remaining slot.
    const sum       = filled.reduce((s, p) => s + (p.popularity ?? 50), 0);
    const remaining = Math.max(0, 5 - filled.length - 1);
    if (sum + (player.popularity ?? 50) + remaining * minPopularity() >= P.maxPopTotal) {
      return { legal: false, reason: `Too many fans — busts the ${P.maxPopTotal} budget` };
    }
  }
  return { legal: true, reason: null };
}

/**
 * Roster-level constraint status — drives the live draft banner and is
 * re-checked at sim time. With pick blocking active this should always pass,
 * but a fail is soft: the season still simulates, the challenge just fails.
 */
export function checkRosterConstraint(challenge, starters) {
  const P = challenge?.params;
  if (!P) return { pass: true, detail: '' };

  if (P.maxPopTotal != null) {
    const sum = starters.reduce((s, p) => s + (p.popularity ?? 50), 0);
    return sum < P.maxPopTotal
      ? { pass: true,  detail: `Fans ${sum} / ${P.maxPopTotal}` }
      : { pass: false, detail: `Fans ${sum} — over the ${P.maxPopTotal} budget` };
  }
  if (P.maxRating != null) {
    const bad = starters.find(p => (p.overall ?? 82) > P.maxRating);
    return bad
      ? { pass: false, detail: `${bad.name} (${bad.overall} OVR) breaks the ${P.maxRating} cap` }
      : { pass: true,  detail: `All starters under ${P.maxRating + 1} OVR` };
  }
  if (P.excludeTeams) {
    const bad = starters.find(p => p.team && P.excludeTeams.includes(p.team));
    return bad
      ? { pass: false, detail: `${bad.name} plays for the ${bad.team}` }
      : { pass: true,  detail: `No ${P.excludeTeams.join('/')} players` };
  }
  if (P.allowedDecades) {
    const bad = starters.find(p => p.decade && !P.allowedDecades.includes(p.decade));
    return bad
      ? { pass: false, detail: `${bad.name} (${bad.decade}) is outside the window` }
      : { pass: true,  detail: `All picks inside ${P.allowedDecades.join(' · ')}` };
  }
  return { pass: true, detail: '' };
}

// ── Post-sim evaluation ───────────────────────────────────────────────────────

/**
 * Pass/fail for the day, decided at the end of the league stage (the
 * daily board deliberately captures the shared 14-match run only — playoffs
 * stay out of it, matching markDailyPlayed's lock-at-sim-time rule).
 *
 * Reads S.result (wins, playerStats, simTotals, avgRating, longestStreak)
 * and S.roster.
 */
export function evaluateObjective(challenge, S) {
  const P = challenge?.params;
  const r = S.result;
  if (!P || !r) return { pass: false, detail: 'No season result' };

  const failures = [];

  const roster = checkRosterConstraint(challenge, Object.values(S.roster || {}).filter(Boolean));
  if (!roster.pass) failures.push(roster.detail);

  if (r.wins < (P.minWins ?? 0)) failures.push(`Won ${r.wins} — needed ${P.minWins}`);

  if (P.starterRuns != null) {
    const best = (r.playerStats || []).reduce((m, l) => Math.max(m, l.runs), 0);
    if (best < P.starterRuns) failures.push(`Top scorer averaged ${best.toFixed(1)} — needed ${P.starterRuns}+`);
  }
  if (P.teamWkts != null && (r.simTotals?.wkts ?? 0) < P.teamWkts) {
    failures.push(`Bowlers took ${(r.simTotals?.wkts ?? 0).toFixed(1)}/match — needed ${P.teamWkts}+`);
  }
  if (P.minRating != null && (r.avgRating ?? 0) < P.minRating) {
    failures.push(`Team Rating ${Math.round(r.avgRating ?? 0)} — needed ${P.minRating}+`);
  }
  if (P.minStreak != null && (r.longestStreak ?? 0) < P.minStreak) {
    failures.push(`Longest streak ${r.longestStreak ?? 0} — needed ${P.minStreak}`);
  }

  return failures.length
    ? { pass: false, detail: failures[0] }
    : { pass: true,  detail: 'Challenge complete!' };
}

/**
 * Leaderboard score for the day's run: wins always count, passing the
 * challenge stacks a bonus on top.
 */
export function dailyScore(challenge, S) {
  const wins = S.result?.wins ?? 0;
  return wins * 10 + (evaluateObjective(challenge, S).pass ? 200 : 0);
}
