/**
 * js/logic/positions.js — Dynamic Secondary Role Scanner
 *
 * Runs once after loadDatabase() populates DB.
 * Mutates player objects in-memory only — players.js is never touched.
 *
 * Each rule collects into a Set (multiple secondaries per player are valid).
 * Output is sorted by positional distance so the closest slot appears first.
 *
 * Rule Categories
 * ───────────────
 * OPEN  Power Opener     : explosive strike rate / Power Hitter archetype  → MID
 * MID   Top-Order Anchor : high-volume run scorer / Anchor archetype       → OPEN
 * MID   Keeping Cover     : fielding impact / Complete Cricketer archetype  → WK
 * WK    Floater           : blazing SR, lower runs — pinch-hits up the order → MID
 * PACE  Containment Arm   : elite economy / Strike Bowler archetype        → SPIN
 * PACE  All-Round Finisher: bat-and-ball threat / Complete Cricketer        → MID
 * SPIN  Enforcer          : elite wicket-taking / Death Bowler archetype    → PACE
 */

import { DB } from '../data/players.js';

// Positional rank used for distance-sorting secondary slots
const POS_RANK = { OPEN: 0, MID: 1, WK: 2, PACE: 3, SPIN: 4 };

/**
 * Appends a `secondaryPos` array to every player object in DB.
 * Safe to call multiple times — always overwrites.
 */
export function applySecondaryPositions() {
  if (!DB) return;
  for (const players of Object.values(DB)) {
    for (const p of players) {
      p.secondaryPos = deriveSecondary(p);
    }
  }
}

/**
 * Returns a sorted secondary-slot array for a single player.
 * Slots closest to the player's natural role appear first.
 *
 * @param {object} p  Player object from DB
 * @returns {string[]}
 */
function deriveSecondary(p) {
  const arch = p.archetype || '';
  const sec  = new Set();

  switch (p.pos) {

    // ── Opening Batter ────────────────────────────────────────────────────
    case 'OPEN':
      // Power Opener: blistering strike rate translates straight to the
      // middle order as a finisher-in-waiting → MID
      if (p.sr > 155 || arch === 'Power Hitter' || arch === 'Finisher') sec.add('MID');
      break;

    // ── Middle-Order Batter ───────────────────────────────────────────────
    case 'MID':
      // Top-Order Anchor: builds a full innings, translates to opening → OPEN
      if (p.runs > 40 || arch === 'Anchor') sec.add('OPEN');
      // Keeping Cover: strong fielding hands, can slot in behind the stumps → WK
      if (p.field > 0.8 || arch === 'Complete Cricketer') sec.add('WK');
      break;

    // ── Wicketkeeper-Batter ───────────────────────────────────────────────
    case 'WK':
      // Floater: high strike rate, lower volume — a pinch-hitter up the order → MID
      if (p.sr > 150 || arch === 'Finisher') sec.add('MID');
      break;

    // ── Pace Bowler ───────────────────────────────────────────────────────
    case 'PACE':
      // Containment Arm: elite economy reads like a spinner's control → SPIN
      if (p.econ > 6.5 || arch === 'Strike Bowler') sec.add('SPIN');
      // All-Round Finisher: genuine bat-and-ball threat → MID
      if (p.runs > 20 || arch === 'Complete Cricketer') sec.add('MID');
      break;

    // ── Spin Bowler ───────────────────────────────────────────────────────
    case 'SPIN':
      // Enforcer: elite strike/economy numbers translate to a new-ball role → PACE
      if (p.wkts > 1.3 || p.econ > 6.5 || arch === 'Death Bowler') sec.add('PACE');
      break;
  }

  // Sort secondaries by proximity to natural slot (ascending distance)
  const myRank = POS_RANK[p.pos] ?? 2;
  return [...sec].sort(
    (a, b) => Math.abs(POS_RANK[a] - myRank) - Math.abs(POS_RANK[b] - myRank)
  );
}
