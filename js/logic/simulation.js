/**
 * js/logic/simulation.js — Season & Playoff Simulation Engine
 *
 * Starting-XI-only format: team strength comes entirely from the 5 drafted
 * starters. A sigmoid maps adjustedStrength → per-match win probability.
 *
 * Exports:
 *   simulateSeason(starters, profile?)  → full result object
 *   simulateSeries(playerStr, oppStr) → best-of-7 series result object
 *   simulateDynastySeries(playerSeason, opponent) → head-to-head shaped series result
 */

import { DB }                  from '../data/players.js';
import { TEAMS, pickCosmetic, S } from '../logic/state.js';
import { eraFactor, eraAdjustedStat, eraAdjustedLine, decadeFromBucketKey } from '../logic/era.js';
import { getModeConfig }       from '../logic/modes.js';

// ── Season length ─────────────────────────────────────────────────────────────
// A real IPL league stage: 14 matches. The perfect-run hook becomes "14-0"
// instead of the NBA original's "82-0".
export const SEASON_GAMES = 14;

// ── Sigmoid tuning knobs ──────────────────────────────────────────────────────
// SIM_K:      steepness — lower = more gradual spread between good/bad teams
// SIM_CENTER: adjustedStrength that maps to exactly 50 % win rate
// WIN_CAP:    per-match win probability ceiling — even a maxed XI can lose
//             any given night, so 14-0 is never guaranteed
const SIM_K      = 3.5;
// 1.776 = the old 1.8 center minus the retired captain-boost midpoint
// (0.008 floor + half the 0.032 mastery range). Keeps a typical XI's win
// rate identical to the pre-removal balance.
const SIM_CENTER = 1.776;
const WIN_CAP    = 0.99;

let _baselinesCache = null;

/**
 * Derives the dynamic STARTER_BASE from the live DB.
 * Treats the top ~71.4 % of players (by composite score) as the starter tier.
 * Memoized — DB never changes after startup so the sort runs at most once.
 */
function computeSimBaselines() {
  if (_baselinesCache) return _baselinesCache;
  const STATS = ['runs', 'sr', 'wkts', 'econ', 'field'];
  const all   = [];
  for (const [bucketKey, players] of Object.entries(DB)) {
    const decade = decadeFromBucketKey(bucketKey);
    for (const p of players) all.push({ ...eraAdjustedLine({ ...p, decade }) });
  }
  const score  = p => p.runs * 0.35 + p.sr * 0.20 + p.wkts * 0.20 + p.econ * 0.15 + p.field * 0.10;
  const sorted = [...all].sort((a, b) => score(b) - score(a));
  const cut    = Math.round(sorted.length * 5 / 7); // tier cut unchanged — keeps STARTER_BASE identical
  const sTier  = sorted.slice(0, cut);
  const avg    = (arr, stat) => arr.reduce((s, p) => s + p[stat], 0) / arr.length;
  _baselinesCache = {
    STARTER_BASE: Object.fromEntries(STATS.map(k => [k, avg(sTier, k) * 5])),
  };
  return _baselinesCache;
}

// ── Loss diagnosis ────────────────────────────────────────────────────────────
const STAT_LABEL = {
  runs: 'batting output',
  sr:   'strike rate',
  wkts: 'wicket-taking',
  econ: 'containment',
  field:'fielding',
};

// Which slot is most accountable for generating each stat.
const STAT_ROLE_PRIORITY = {
  runs: ['WK',   'OPEN', 'MID',  'SPIN', 'PACE'],
  sr:   ['MID',  'OPEN', 'WK',   'PACE', 'SPIN'],
  wkts: ['PACE', 'SPIN', 'MID',  'OPEN', 'WK'],
  econ: ['SPIN', 'PACE', 'MID',  'OPEN', 'WK'],
  field:['WK',   'PACE', 'MID',  'OPEN', 'SPIN'],
};

// Plain-English draft advice for each stat gap.
const STAT_DRAFT_FIX = {
  runs: 'a stronger run-scorer — look for high RUNS at the top of the order or behind the stumps',
  sr:   'a genuine finisher — look for a high-SR middle-order hitter',
  wkts: 'a strike bowler — target a pace or spin option with a high wicket rate',
  econ: 'a containing bowler — target a spin or pace option with tight economy',
  field:'a sharper fielding unit — target a keeper or athletic bowler with strong fielding',
};

/**
 * Packages the engine's balance-penalty diagnosis into a structured object
 * the UI can display verbatim.
 *
 * @param {object[]} starters
 * @param {string}   weakestStat
 * @param {number}   balancePenalty
 * @param {object}   sRatio
 * @param {object}   STARTER_BASE
 * @returns {object|null}
 */
function buildLossDiagnosis(starters, weakestStat, balancePenalty, sRatio, STARTER_BASE) {
  if (!weakestStat || !starters.length) return null;

  const statLabel      = STAT_LABEL[weakestStat] || weakestStat;
  const teamRatio      = sRatio[weakestStat];
  const perPlayerBase  = STARTER_BASE[weakestStat] / 5;
  const rolePriority   = STAT_ROLE_PRIORITY[weakestStat] || ['OPEN', 'MID', 'WK', 'PACE', 'SPIN'];

  const adj = p => eraAdjustedStat(p, weakestStat);

  const byPos = {};
  for (const p of starters) {
    if (!byPos[p.pos] || adj(p) < adj(byPos[p.pos])) byPos[p.pos] = p;
  }

  let culprit    = null;
  let culpritPos = null;

  for (const rolePos of rolePriority) {
    const p = byPos[rolePos];
    if (p && adj(p) < perPlayerBase) {
      culprit    = p;
      culpritPos = rolePos;
      break;
    }
  }

  if (!culprit) {
    for (const rolePos of rolePriority) {
      const p = byPos[rolePos];
      if (p && (!culprit || adj(p) < adj(culprit))) {
        culprit    = p;
        culpritPos = rolePos;
      }
    }
  }

  if (!culprit) {
    for (const p of starters) {
      if (!culprit || adj(p) < adj(culprit)) culprit = p;
    }
    culpritPos = culprit?.pos ?? null;
  }

  const CULPRIT_MARGIN   = 0.85;
  const culpritBelowBase = culprit ? adj(culprit) < perPlayerBase * CULPRIT_MARGIN : false;

  return {
    primaryCause:      'balance_penalty',
    statKey:           weakestStat,
    statLabel,
    teamRatio:         +teamRatio.toFixed(3),
    penaltyAmount:     +balancePenalty.toFixed(4),
    culpritId:         culprit?.id          ?? null,
    culpritName:       culprit?.name        ?? null,
    culpritPos,
    culpritStat:       culprit ? +adj(culprit).toFixed(1) : null,
    perPlayerBase:     +perPlayerBase.toFixed(1),
    culpritBelowBase,
    recommendedFix:    STAT_DRAFT_FIX[weakestStat] ?? `a stronger ${statLabel} contributor`,
  };
}

// ── Per-player season stat lines ──────────────────────────────────────────────
const PLAYER_STAT_KEYS = ['runs', 'sr', 'wkts', 'econ', 'field'];
// per-match key → season-total key
const SEASON_TOTAL_KEY = { runs: 'totalRuns', sr: 'srTotal', wkts: 'totalWkts', econ: 'econTotal', field: 'fieldTotal' };

/** Standard-normal sample via Box–Muller. */
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Generates believable per-player season lines + a stat-leader summary.
 *
 * @param {object[]} starters
 * @param {number}   winPct  team per-match win probability (0..1)
 * @returns {{ playerStats: object[], statLeaders: object, simTotals: object }}
 */
function simulatePlayerStats(starters, winPct) {
  const teamFactor = 1 + (clampNum(winPct, 0, 1) - 0.5) * 0.04; // 0.98 … 1.02
  const gp = SEASON_GAMES;

  const playerStats = starters.map(p => {
    const form = clampNum(1 + gaussian() * 0.035, 0.91, 1.09);
    const line = { id: p.id, name: p.name, pos: p.pos, gp };
    for (const k of PLAYER_STAT_KEYS) {
      const perGame = Math.max(0, (p[k] || 0) * form * teamFactor);
      const rounded = Math.round(perGame * 10) / 10;
      line[k] = rounded;
      line[SEASON_TOTAL_KEY[k]] = Math.round(rounded * gp);
    }
    return line;
  });

  const leaderFor = k => {
    let best = null;
    for (const l of playerStats) if (!best || l[k] > best[k]) best = l;
    return best ? { id: best.id, name: best.name, val: best[k] } : null;
  };
  const statLeaders = {
    batting:  leaderFor('runs'),
    striking: leaderFor('sr'),
    bowling:  leaderFor('wkts'),
    economy:  leaderFor('econ'),
    fielding: leaderFor('field'),
  };

  const simTotals = PLAYER_STAT_KEYS.reduce((acc, k) => {
    acc[k] = +playerStats.reduce((s, l) => s + l[k], 0).toFixed(1);
    return acc;
  }, {});

  return { playerStats, statLeaders, simTotals };
}

/**
 * Simulates a full 14-match IPL league stage.
 *
 * @param {object[]} starters  5 starting XI player objects
 * @param {string} [profile]   'classic' | 'bowling' | 'fans' — defaults from S.mode
 * @returns {object}
 */
export function simulateSeason(starters, profile = null) {
  const simProfile = profile || getModeConfig(S?.mode).simProfile || 'classic';

  const sumStats = arr => arr.reduce(
    (acc, p) => {
      const adj = eraAdjustedLine(p);
      return {
        runs: acc.runs + adj.runs,
        sr:   acc.sr   + adj.sr,
        wkts: acc.wkts + adj.wkts,
        econ: acc.econ + adj.econ,
        field:acc.field+ adj.field,
      };
    },
    { runs: 0, sr: 0, wkts: 0, econ: 0, field: 0 }
  );

  const sTotals = sumStats(starters);

  const { STARTER_BASE } = computeSimBaselines();

  const sRatio = {
    runs: sTotals.runs / STARTER_BASE.runs,
    sr:   sTotals.sr   / STARTER_BASE.sr,
    wkts: sTotals.wkts / STARTER_BASE.wkts,
    econ: sTotals.econ / STARTER_BASE.econ,
    field:sTotals.field/ STARTER_BASE.field,
  };

  const ratio = sRatio;

  const weights = simProfile === 'bowling'
    ? { runs: 0.10, sr: 0.10, wkts: 0.30, econ: 0.25, field: 0.25 }
    : { runs: 0.35, sr: 0.20, wkts: 0.20, econ: 0.15, field: 0.10 };

  const strength =
    ratio.runs * weights.runs +
    ratio.sr   * weights.sr   +
    ratio.wkts * weights.wkts +
    ratio.econ * weights.econ +
    ratio.field* weights.field;

  const diagEntries = simProfile === 'bowling'
    ? Object.entries(sRatio).filter(([k]) => k === 'wkts' || k === 'econ' || k === 'field')
    : Object.entries(sRatio);
  const weakestStatEntry = (diagEntries.length ? diagEntries : Object.entries(sRatio))
    .reduce((min, e) => e[1] < min[1] ? e : min);
  const weakestStat      = weakestStatEntry[0];
  const minStarterRatio  = weakestStatEntry[1];
  const balancePenalty   = minStarterRatio < 0.82 ? (0.82 - minStarterRatio) * 0.8 : 0;

  const lossDiagnosis = buildLossDiagnosis(starters, weakestStat, balancePenalty, sRatio, STARTER_BASE);

  const baseStrength = Math.max(0, strength - balancePenalty);

  // ── Popularity / Fan-Hype modifier ───────────────────────────────────────
  const POP_FLOOR   = 35;
  const POP_CEIL    = 100;
  const MUL_MIN     = simProfile === 'fans' ? 0.90 : 0.97;
  const MUL_MAX     = simProfile === 'fans' ? 1.12 : 1.04;
  const allPlayers  = starters;
  const avgPop      = allPlayers.length
    ? allPlayers.reduce((s, p) => s + (p.popularity || 50), 0) / allPlayers.length
    : 50;
  const popNorm     = Math.max(0, Math.min(1, (avgPop - POP_FLOOR) / (POP_CEIL - POP_FLOOR)));
  const popMul      = MUL_MIN + popNorm * (MUL_MAX - MUL_MIN);

  // ── Player-Rating modifier ────────────────────────────────────────────────
  const RATING_MID  = 87;
  const RATING_SPAN = 10;
  const RATING_AMP  = 0.04;
  const avgRating   = allPlayers.length
    ? allPlayers.reduce((s, p) => s + (p.overall ?? 82), 0) / allPlayers.length
    : 82;
  const ratingNorm  = Math.max(-1, Math.min(1, (avgRating - RATING_MID) / RATING_SPAN));
  const ratingMul   = 1 + ratingNorm * RATING_AMP;

  const adjustedStrength = baseStrength * popMul * ratingMul;
  const popEloDelta    = +(baseStrength * (popMul - 1)).toFixed(3);
  const ratingEloDelta = +(baseStrength * popMul * (ratingMul - 1)).toFixed(3);

  const fansM = +(Math.pow(popNorm, 1.5) * 38 + 2).toFixed(1);

  const winPct = Math.min(WIN_CAP, 1 / (1 + Math.exp(-SIM_K * (adjustedStrength - SIM_CENTER))));

  let wins = 0;
  const games = [];
  for (let i = 0; i < SEASON_GAMES; i++) {
    const won = Math.random() < winPct;
    if (won) wins++;
    games.push({ won });
  }
  wins = Math.max(0, Math.min(SEASON_GAMES, wins));
  decorateSeasonGames(games, winPct);

  const totals = { ...sTotals };

  const { playerStats, statLeaders, simTotals } = simulatePlayerStats(starters, winPct);

  const teamFielding = +(sTotals.wkts + sTotals.field).toFixed(1);

  return {
    wins,
    losses:     SEASON_GAMES - wins,
    winPct:     +(winPct * 100).toFixed(1),
    strength:   +adjustedStrength.toFixed(3),
    baseStrength: +baseStrength.toFixed(3),
    totals, ratio, sTotals,
    balancePenalty: +balancePenalty.toFixed(4), weakestStat, lossDiagnosis,
    avgPopularity: +avgPop.toFixed(1),
    popEloDelta,
    avgRating:  +avgRating.toFixed(1),
    ratingMul:  +ratingMul.toFixed(4),
    ratingEloDelta,
    playerStats, statLeaders, simTotals,
    fansM,
    games,
    simProfile,
    teamFielding,
  };
}

/**
 * Decorates a season's win/loss sequence with opponents and run totals.
 * Stronger teams (higher winPct) win bigger; losses skew close so they read
 * as heartbreakers rather than blowouts.
 */
function decorateSeasonGames(games, winPct) {
  let lastOpp = null;
  for (const g of games) {
    let opp = pickCosmetic(TEAMS);
    for (let t = 0; t < 5 && opp === lastOpp; t++) opp = pickCosmetic(TEAMS);
    lastOpp = opp;

    const r      = Math.random();
    const exp    = g.won ? Math.max(0.55, 1.6 - winPct) : 2.2;
    const margin = 2 + Math.floor(Math.pow(r, exp) * 40);   // 2–42 runs
    const base   = 150 + Math.floor(Math.random() * 45);    // 150–194

    g.opp    = opp;
    g.ps     = g.won ? base + Math.ceil(margin / 2) : base - Math.floor(margin / 2);
    g.os     = g.won ? base - Math.floor(margin / 2) : base + Math.ceil(margin / 2);
    g.margin = margin;
    g.type   = margin >= 25 ? 'blowout' : margin >= 12 ? 'solid' : 'close';
  }
}

/**
 * Simulates a head-to-head best-of-7 series between two drafted XIs.
 * Returns season stats for both teams + the series outcome.
 */
function generateGameScore(p1Strength, p2Strength) {
  const p1WinProb = 1 / (1 + Math.exp(-6 * (p1Strength - p2Strength)));
  const p1Wins    = Math.random() < p1WinProb;

  const base   = 150 + Math.floor(Math.random() * 45);   // 150–194
  const r      = Math.random();
  const margin = 2 + Math.floor(r * r * 40);              // 2–41, skewed low

  const winnerScore = base + Math.floor(margin / 2);
  const loserScore  = base - Math.ceil(margin / 2);

  return {
    p1Score: p1Wins ? winnerScore : loserScore,
    p2Score: p1Wins ? loserScore  : winnerScore,
    p1Won:   p1Wins,
  };
}

export function simulateHeadToHeadSeries(p1Starters, p2Starters) {
  const p1Season = simulateSeason(p1Starters);
  const p2Season = simulateSeason(p2Starters);

  const p1Str = p1Season.strength;
  const p2Str = p2Season.strength;

  const games = [];
  let p1Wins = 0, p2Wins = 0;
  while (p1Wins < 4 && p2Wins < 4) {
    const g = generateGameScore(p1Str, p2Str);
    if (g.p1Won) p1Wins++; else p2Wins++;
    games.push({ gameNum: games.length + 1, ...g, p1WinsAfter: p1Wins, p2WinsAfter: p2Wins });
  }

  const winner = p1Wins === 4 ? 'p1' : 'p2';
  const series = {
    playerWins: p1Wins,
    oppWins:    p2Wins,
    games:      games.map(g => g.p1Won ? 'W' : 'L'),
    won:        winner === 'p1',
  };

  return { p1Season, p2Season, games, p1Wins, p2Wins, winner, series };
}

/**
 * Best-of-7 vs a Dynasty Duel CPU legendary IPL side (no opposing roster cards).
 * Returns the same shape as simulateHeadToHeadSeries for shared series UI.
 */
export function simulateDynastySeries(playerSeason, opponent) {
  const p1Str = playerSeason.strength;
  const p2Str = opponent.strength;
  const p2Season = {
    strength: p2Str,
    avgRating: 96,
    wins: 12,
    losses: 2,
    avgPopularity: 92,
    fansM: 38,
    teamFielding: 0,
  };

  const games = [];
  let p1Wins = 0, p2Wins = 0;
  while (p1Wins < 4 && p2Wins < 4) {
    const g = generateGameScore(p1Str, p2Str);
    if (g.p1Won) p1Wins++; else p2Wins++;
    games.push({ gameNum: games.length + 1, ...g, p1WinsAfter: p1Wins, p2WinsAfter: p2Wins });
  }

  const winner = p1Wins === 4 ? 'p1' : 'p2';
  const series = {
    playerWins: p1Wins,
    oppWins:    p2Wins,
    games:      games.map(g => g.p1Won ? 'W' : 'L'),
    won:        winner === 'p1',
  };

  return { p1Season: playerSeason, p2Season, games, p1Wins, p2Wins, winner, series, opponent };
}

/**
 * Simulates a best-of-7 series (used by the 1v1 / GM vs AI modes).
 *
 * @param {number} playerStrength
 * @param {number} opponentStrength
 * @returns {{ playerWins: number, oppWins: number, games: string[], won: boolean }}
 */
export function simulateSeries(playerStrength, opponentStrength) {
  const pWin = 1 / (1 + Math.exp(-6 * (playerStrength - opponentStrength)));
  let playerWins = 0, oppWins = 0;
  const games = [];
  while (playerWins < 4 && oppWins < 4) {
    const won = Math.random() < pWin;
    if (won) playerWins++; else oppWins++;
    games.push(won ? 'W' : 'L');
  }
  return { playerWins, oppWins, games, won: playerWins === 4 };
}

/**
 * Simulates a single knockout match — used by the real IPL-format playoffs
 * (Qualifier 1 / Eliminator / Qualifier 2 / Final are all one-off matches,
 * never a series).
 *
 * @param {number} teamStrength
 * @param {number} oppStrength
 * @returns {{ won: boolean, teamScore: number, oppScore: number }}
 */
export function simulateMatch(teamStrength, oppStrength) {
  const g = generateGameScore(teamStrength, oppStrength);
  return { won: g.p1Won, teamScore: g.p1Score, oppScore: g.p2Score };
}
