/**
 * js/logic/state.js — Global Game State & Configuration Constants
 *
 * Exports:
 *   • All static config constants (TEAMS, DECADES, COACHES, TEAM_COLORS, …)
 *   • `S`          — the live, mutable game-state object (ES module live binding)
 *   • `startGame`  — resets / initialises S for a new draft session
 *   • `pick`       — tiny array-random-pick utility used across multiple modules
 *   • `getPlayerSeed` / `buildBracket` — playoff seeding helpers
 *   • `getUtcDateString` / `seedDailyRng` / `clearDailyRng` — Daily Challenge PRNG
 */

import { getLockedPlayer, todayUTC } from './challenge.js';

// ── Static configuration ──────────────────────────────────────────────────────

export const TEAMS = [
  'Mumbai Indians','Chennai Super Kings','Royal Challengers Bengaluru','Kolkata Knight Riders',
  'Delhi Capitals','Punjab Kings','Rajasthan Royals','Sunrisers Hyderabad',
  'Gujarat Titans','Lucknow Super Giants',
];

// IPL "eras" replace NBA decades — five multi-year windows spanning the
// league's history from its 2008 launch to today.
export const DECADES = ['2008-11','2012-15','2016-19','2020-22','2023-25'];

// Starting XI core, per user spec: 2 Batters, 1 Wicketkeeper, 2 Bowlers.
// OPEN/MID mirror PG/SG (both "batter" roles, distinct slots); PACE/SPIN
// mirror PF/C (both "bowler" roles, distinct slots) — same 5-slot shape
// as the NBA original, so the rest of the engine (sim, draft) carries over
// structurally unchanged.
export const POSITIONS     = ['OPEN','MID','WK','PACE','SPIN'];
export const ALL_POSITIONS  = [...POSITIONS]; // starters-only format — no bench
export const TOTAL_ROUNDS   = 5;

/**
 * Snake draft pick order for 1v1 (10 total picks, 5 per player).
 * Pattern: 1-2-2-1-1-2-2-1-1-2
 * Indexed by overall pick number (0 = first pick).
 * Eliminates the structural first-pick advantage of strict alternation.
 */
export const SNAKE_ORDER = [1, 2, 2, 1, 1, 2, 2, 1, 1, 2];

export const ERA_DESC = {
  '2008-11': 'Warne · Gilchrist · Sehwag',
  '2012-15': 'Gambhir · Chris Gayle · Dhoni',
  '2016-19': 'Kohli · Warner · Bumrah',
  '2020-22': 'Rohit · KL Rahul · Rashid Khan',
  '2023-25': 'Gill · Head · Narine',
};

export const TEAM_COLORS = {
  'Mumbai Indians':               { bg: '#004BA0', accent: '#D1AB3E' },
  'Chennai Super Kings':          { bg: '#FFFF3C', accent: '#0081E9' },
  'Royal Challengers Bengaluru':  { bg: '#EC1C24', accent: '#000000' },
  'Kolkata Knight Riders':        { bg: '#2E0854', accent: '#FFB81C' },
  'Delhi Capitals':               { bg: '#17479E', accent: '#EF1C25' },
  'Punjab Kings':                 { bg: '#ED1B24', accent: '#A7A9AC' },
  'Rajasthan Royals':             { bg: '#254AA5', accent: '#EA1A85' },
  'Sunrisers Hyderabad':          { bg: '#FF822A', accent: '#000000' },
  'Gujarat Titans':               { bg: '#1B2133', accent: '#B4A469' },
  'Lucknow Super Giants':         { bg: '#00458E', accent: '#A72056' },
};

export const ARCHETYPE_STYLE = {
  'Anchor':             { bg: '#dbeafe', text: '#1d4ed8' },
  'Power Hitter':       { bg: '#fef3c7', text: '#92400e' },
  'Strike Bowler':      { bg: '#f3e8ff', text: '#6d28d9' },
  'Finisher':           { bg: '#ede9fe', text: '#5b21b6' },
  'Death Bowler':       { bg: '#dcfce7', text: '#15803d' },
  'Complete Cricketer': { bg: '#ffedd5', text: '#9a3412' },
};

// Captains replace NBA coaches — each brings a tactical system tied to a
// real IPL era, mirroring the coach-system bonus structure 1:1.
export const COACHES = [
  {
    id:     'warne',
    name:   'Shane Warne',
    era:    '2008-11',
    system: 'Spin Web',
    desc:   'Spin-first — Spin Wizard and Lockdown Bowler bonuses amplified; bowling-control penalties negated.',
    accent: '#4ade80',
  },
  {
    id:     'gambhir',
    name:   'Gautam Gambhir',
    era:    '2012-15',
    system: 'Fearless Cricket',
    desc:   'Backs young match-winners — Captain Material and X-Factor bonuses amplified ×1.5.',
    accent: '#0369a1',
  },
  {
    id:     'dhoni',
    name:   'MS Dhoni',
    era:    '2012-15',
    system: 'Ice-Cool Calm',
    desc:   'Composure under pressure — Chase Master and Clutch bonuses amplified ×1.5; Chasing Jitters penalty negated.',
    accent: '#f87171',
  },
  {
    id:     'kohli',
    name:   'Virat Kohli',
    era:    '2016-19',
    system: 'Aggressive Intent',
    desc:   'Star-driven — Explosive Top Order and Six-Hitting Machine bonuses amplified ×1.5; Ego Clash penalty softened to −2%.',
    accent: '#c084fc',
  },
  {
    id:     'warner',
    name:   'David Warner',
    era:    '2020-22',
    system: 'Boundary Blitz',
    desc:   'Powerplay-first — Powerplay Specialist and Six-Hitting Machine bonuses amplified ×1.5.',
    accent: '#60a5fa',
  },
  {
    id:     'rohit',
    name:   'Rohit Sharma',
    era:    '2020-22',
    system: 'Big-Match Temperament',
    desc:   'Knockout-tested — Death-Over Specialist and New-Ball Specialist bonuses amplified; Death-Overs Panic penalty heightened.',
    accent: '#fbbf24',
  },
  {
    id:     'pandya',
    name:   'Hardik Pandya',
    era:    '2023-25',
    system: 'Calm Under Fire',
    desc:   'Balance-first — Complete Cricketer and Team Man bonuses amplified ×1.5; Ego Clash penalty fully negated.',
    accent: '#34d399',
  },
];

// ── Playoff CPU opponents ─────────────────────────────────────────────────────
// Legendary IPL title-winning squads — used as Dynasty Duel opponents and to
// fill out the playoff field alongside the player's team.

export const CPU_TEAMS = [
  { name: '10 CSK',   strength: 2.38 },
  { name: '19 MI',    strength: 2.37 },
  { name: '11 CSK',   strength: 2.25 },
  { name: '15 MI',    strength: 2.20 },
  { name: '13 MI',    strength: 2.15 },
  { name: '21 CSK',   strength: 2.00 },
  { name: '23 CSK',   strength: 1.95 },
  { name: '17 MI',    strength: 1.94 },
  { name: '20 MI',    strength: 1.93 },
  { name: '16 SRH',   strength: 1.92 },
  { name: '22 GT',    strength: 1.91 },
  { name: '08 RR',    strength: 1.90 },
  { name: '12 KKR',   strength: 1.89 },
  { name: '14 KKR',   strength: 1.88 },
  { name: '24 KKR',   strength: 1.87 },
];

// ── Utility ───────────────────────────────────────────────────────────────────

// mulberry32 — fast, deterministic 32-bit PRNG. Powers the Daily Challenge:
// pick() is the single choke point every draft-random call goes through
// (team/decade spins, skip re-rolls), so seeding just this one generator
// off the UTC calendar date makes the entire draft sequence identical for
// every player who plays that day, with no other call site needing to know
// about it. Real gameplay (Math.random() elsewhere, e.g. season simulation)
// is untouched — only which teams/decades/players get OFFERED is seeded,
// not how a season actually plays out.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

let _seededRng = null;

/**
 * Today's UTC calendar date as 'YYYY-MM-DD' — the Daily Challenge boundary is
 * a global instant, not per-timezone midnight. Delegates to challenge.js
 * todayUTC() so the seeded board and the day's challenge can never disagree
 * about what "today" is (the two implementations drifted apart once before).
 */
export function getUtcDateString() {
  return todayUTC();
}

/** Seeds pick() deterministically off a date string — same draft sequence for every player that day. */
export function seedDailyRng(dateStr) {
  _seededRng = mulberry32(hashStringToSeed(dateStr));
}

/** Restores pick() to real randomness. Called on every draft (re)start so a seed never leaks into solo/blind/1v1. */
export function clearDailyRng() {
  _seededRng = null;
}

/** Pick a random element from an array — seeded during the Daily Challenge, real-random otherwise. */
export const pick = arr => arr[Math.floor((_seededRng ? _seededRng() : Math.random()) * arr.length)];

/**
 * Cosmetic-only random pick — NEVER seeded. Slot-machine tumble frames and
 * other purely visual noise must use this instead of pick(): a cosmetic call
 * that goes through the seeded generator consumes a draw from the Daily
 * Challenge's deterministic stream, and the number of those calls varies with
 * DOM state and render count (mid-spin re-renders, missing elements), which
 * silently desyncs the "same board for everyone" guarantee between players.
 */
export const pickCosmetic = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Playoff helpers ───────────────────────────────────────────────────────────

/**
 * Returns a playoff seed (1–4) based on the league-stage win total out of
 * a 14-match IPL season. Mirrors real IPL points-table qualification: the
 * top 4 teams advance regardless of how the rest of the table finished.
 * @param {number} wins
 * @returns {number}
 */
export function getPlayerSeed(wins) {
  if (wins >= 12) return 1;
  if (wins >= 10) return 2;
  if (wins >= 8)  return 3;
  return 4;
}

/**
 * Builds the 4-team playoff field (real IPL format: Qualifier 1, Eliminator,
 * Qualifier 2, Final — no best-of-series, every match is a single knockout).
 * The player occupies their seed slot; remaining 3 slots are filled by the
 * top legendary CPU squads sorted by strength.
 *
 * @param {number} playerSeed       1–4
 * @param {number} playerStrength   adjusted Elo-like strength number
 * @returns {object[]}  four seeded teams, index 0 = seed 1
 */
export function buildBracket(playerSeed, playerStrength) {
  const cpuSorted = [...CPU_TEAMS].sort((a, b) => b.strength - a.strength);
  const seeds = Array(4).fill(null);
  seeds[playerSeed - 1] = { name: 'Your Team', strength: playerStrength, isPlayer: true };

  let cpuIdx = 0;
  for (let i = 0; i < 4; i++) {
    if (!seeds[i]) seeds[i] = { ...cpuSorted[cpuIdx++], isPlayer: false };
  }
  return seeds;
}

// ── Mutable game state (ES module live binding) ───────────────────────────────
//
// Rules:
//   • Always access S via the named import — never destructure it at the
//     module top level, since startGame() replaces the entire object.
//   • All modules that read S must do so inside function bodies, not at
//     module-init time, so they always pick up the live reference.

/** @type {object} */
export let S = {
  phase:          'mode-select', // 'mode-select' | 'more-modes' | 'drafting' | 'season-sim' | 'results' | 'playoffs' | 'trophy-room' | 'series-result'
  mode:           null,          // 'solo' | '1v1'
  currentPlayer:  1,             // 1 or 2 (1v1 only)
  p1:             null,          // snapshot of P1 after sequential draft (old 1v1 flow — kept for compat)
  seriesResult:   null,
  coach:          null,
  selectedEra:    null,
  // 1v1 alternating draft state (set by startGame1v1)
  p1Coach: null, p1Era: null, p2Coach: null, p2Era: null,
  p1Roster: null, p2Roster: null,
  p1Round: 0, p2Round: 0,
  draftLog: [],
};

/**
 * Resets S to a fresh drafting state.
 * Called by the events module when a coach + era have been selected.
 *
 * @param {string} era  e.g. '1990s' or 'all'
 */
export function startGame(era = 'all') {
  const coach         = S.coach;         // preserve the coach selected in the previous phase
  const mode          = S.mode;
  const currentPlayer = S.currentPlayer;
  const p1            = S.p1;
  const dailyChallenge = S.dailyChallenge ?? null; // daily mode context survives the reset
  const dailyDate      = S.dailyDate      ?? null;
  const dynastyOpponent = S.dynastyOpponent ?? null;
  // Skips: daily/dynasty-duel = 0; classic-like = 1
  const skipBudget = (mode === 'daily' || mode === 'dynasty-duel') ? 0 : 1;
  S = {
    phase:            'drafting',
    coach,
    coachLocked:      false,   // locks on the first spin — commit before you see players
    coachPickerOpen:  false,
    eraLocked:        false,   // locks on the first spin — same moment as coach
    eraPickerOpen:    false,
    mode,
    currentPlayer,
    p1,
    seriesResult:     null,
    seriesRevealedCount: 0,
    selectedEra:      era,
    gameId:           crypto.randomUUID(),
    round:            0,
    usedDecades:      [],
    usedPlayerIds:    [],
    draftedPlayerNames: new Set(), // names of players currently on the roster (blocks cross-era clones)
    teamSkips:        skipBudget,
    decadeSkips:      skipBudget,
    drySpins:         0,        // consecutive boards without a star+ player (pity timer)

    spinState:        'idle',   // 'idle' | 'spinning' | 'done'
    currentSpin:      null,     // { team, decade }
    availablePlayers: [],
    draftBoard:       [],       // pick board — all available players from the current spin's team/decade
    selectedPlayer:   null,
    roster: { OPEN: null, MID: null, WK: null, PACE: null, SPIN: null },
    result:  null,
    playoffs: null,
    teamName: '',
    runSaved: false,
    globalScoreSubmitted: false,
    globalSubmitError:    null,
    globalSubmittedChampion: false,

    // Paced season reveal
    seasonGames:     [],
    seasonRevealIdx: 0,
    seasonPaused:    false,
    rivalTease:      false,  // Rivalry Night banner currently showing
    rivalTeased:     false,  // one-shot guard — tease fires once per season

    // Daily Challenge context (null outside daily runs)
    dailyChallenge,
    dailyDate,
    dailyResult: null,       // { pass, pending, detail, streak } — set at sim time

    // Dynasty Duel / More Modes extras
    dynastyOpponent,
    dynastyDuelResult: null,
  };

  // Locked-player daily challenges start with the star already in their slot,
  // registered exactly like a drafted pick (id/name/decade dedup all apply).
  if (dailyChallenge?.type === 'locked') {
    const locked = getLockedPlayer(dailyChallenge);
    if (locked) {
      const pos = dailyChallenge.params.pos;
      S.roster[pos] = locked;
      S.usedPlayerIds.push(locked.id);
      S.draftedPlayerNames.add(locked.name);
      if (locked.decade) S.usedDecades.push(locked.decade);
    }
  }
}

/**
 * Initialises S for a 1v1 or GM vs AI alternating draft.
 * Called after coaches/eras are set on S.
 */
export function startGame1v1() {
  const { p1Coach, p1Era, p2Coach, p2Era } = S;
  const mode = S.mode === 'gm-ai' ? 'gm-ai' : '1v1';
  const isAi = mode === 'gm-ai';
  S = {
    phase:    'drafting',
    mode,
    currentPlayer: 1,
    p1Coach, p1Era, p2Coach, p2Era,
    p1Roster: { OPEN: null, MID: null, WK: null, PACE: null, SPIN: null },
    p2Roster: { OPEN: null, MID: null, WK: null, PACE: null, SPIN: null },
    p1Round:  0,
    p2Round:  0,
    draftLog: [],
    eraLocked:     false,
    eraPickerOpen: false,
    coachLocked:   false,
    coachPickerOpen: false,

    // Shared draft-pool tracking
    gameId:    crypto.randomUUID(),
    usedDecades: [],
    usedPlayerIds: [],
    draftedPlayerNames: new Set(),
    // Per-player skip budgets — AI never skips
    p1TeamSkips: 1, p1DecadeSkips: 1,
    p2TeamSkips: isAi ? 0 : 1,
    p2DecadeSkips: isAi ? 0 : 1,
    drySpins:   0,
    spinState:  'idle',
    currentSpin: null,
    availablePlayers: [],
    draftBoard: [],
    selectedPlayer: null,

    // Solo-mode fields kept to avoid undefined refs
    roster: { OPEN: null, MID: null, WK: null, PACE: null, SPIN: null },
    round: 0,
    result: null,
    playoffs: null,
    teamName: '',
    runSaved: false,
    globalScoreSubmitted: false,
    globalSubmitError: null,
    globalSubmittedChampion: false,
    teamSkips: 0,
    decadeSkips: 0,
    seriesResult: null,
    seriesRevealedCount: 0,
    p1: null,
    selectedEra: p1Era || 'all',
    coach: isAi ? p1Coach : null,
    dynastyOpponent: null,
    dynastyDuelResult: null,
  };
}
