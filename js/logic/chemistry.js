/**
 * js/logic/chemistry.js — IPL Team Chemistry Engine
 *
 * calculateChemistry(starters, coachId?, opts?)
 *
 * opts.asPlacedSlots — when set (live draft UI), score positional fit against
 * the player's placed roster slots instead of optimizeLineup.
 *   Uses coachId when provided; otherwise falls back to S.coach.
 *   Returns { chemBonus, chemScore, chemReport, chemEntries, lineupAssignment }.
 *
 *   chemBonus   — raw float added to adjustedStrength in simulation
 *   chemScore   — 0–100 display value (50 baseline; see chemScoreFromBonus)
 *   chemReport  — array of human-readable strings (🟢 synergies / 🔴 penalties)
 *   chemEntries — structured source of truth the strings are derived from:
 *                 { id, kind: 'synergy'|'penalty'|'info', family, bonus, label }
 *
 * ── Synergy families & caps ──────────────────────────────────────────────────
 * Positive synergies belong to one of four families, each with a hard cap.
 * Stacking within one identity plateaus instead of compounding linearly.
 * Penalties are never capped. When a family overflows, the overflow is
 * trimmed from chemBonus and an info line explains the cap.
 */

import { S } from '../logic/state.js';

// ── Family caps ──────────────────────────────────────────────────────────────
export const FAMILY_CAPS = {
  position:     0.22,
  batting:      0.38,
  bowling:      0.36,
  intangibles:  0.20,
};

// Global tuning knob — every positive synergy bonus is multiplied by this
// before being added to chemBonus. Penalties are unaffected.
const SYNERGY_SCALE = 0.8;

const FAMILY_LABEL = {
  position:    'Positional fit',
  batting:     'Batting',
  bowling:     'Bowling',
  intangibles: 'Intangible',
};

// Display scale: chemScore starts at 50 (empty roster / no synergies).
export const CHEM_SCORE_SCALE = 0.95;
export const CHEM_SCORE_BASE  = 50;

/** 0–100 display score for a raw chemistry bonus. Shared with simulation.js. */
export function chemScoreFromBonus(bonus) {
  const delta = (bonus / CHEM_SCORE_SCALE) * CHEM_SCORE_BASE;
  return Math.round(Math.max(0, Math.min(100, CHEM_SCORE_BASE + delta)));
}

/**
 * Player-facing chemistry tier. Empty roster (score 50) lands on Neutral.
 * @returns {{ id: string, label: string, score: number }}
 */
export function chemTier(score) {
  const sc = Math.round(Math.max(0, Math.min(100, Number(score) || 0)));
  if (sc >= 95) return { id: 'perfect',     label: 'Perfect',     score: sc };
  if (sc >= 80) return { id: 'veryStrong',  label: 'Very Strong', score: sc };
  if (sc >= 65) return { id: 'strong',      label: 'Strong',      score: sc };
  if (sc >= 45) return { id: 'neutral',     label: 'Neutral',     score: sc };
  if (sc >= 25) return { id: 'weak',        label: 'Weak',        score: sc };
  return { id: 'veryWeak', label: 'Very Weak', score: sc };
}

/** Colors for chemTier badges. Pass dark=true for dark-mode hexes. */
export function chemTierColors(tierId, dark = false) {
  const map = {
    perfect: {
      color: dark ? '#fbbf24' : '#b45309',
      bg:    dark ? 'rgba(251,191,36,0.12)' : '#fffbeb',
    },
    veryStrong: {
      color: dark ? '#4ade80' : '#15803d',
      bg:    dark ? 'rgba(34,197,94,0.12)' : '#ecfdf5',
    },
    strong: {
      color: dark ? '#4ade80' : '#16a34a',
      bg:    dark ? 'rgba(34,197,94,0.12)' : '#f0fdf4',
    },
    neutral: {
      color: dark ? '#fbbf24' : '#d97706',
      bg:    dark ? 'rgba(251,191,36,0.12)' : '#fffbeb',
    },
    weak: {
      color: dark ? '#fb923c' : '#ea580c',
      bg:    dark ? 'rgba(251,146,60,0.12)' : '#fff7ed',
    },
    veryWeak: {
      color: dark ? '#f87171' : '#dc2626',
      bg:    dark ? 'rgba(239,68,68,0.12)' : '#fef2f2',
    },
  };
  return map[tierId] || map.neutral;
}

// ── Lineup Optimizer ──────────────────────────────────────────────────────────

const FLOOR_SLOTS = ['OPEN', 'MID', 'WK', 'PACE', 'SPIN'];

const _slotOrderCache = new Map();

function slotOrders(pool, r) {
  if (r === 0) return [[]];
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    const rest = [...pool.slice(0, i), ...pool.slice(i + 1)];
    for (const sub of slotOrders(rest, r - 1)) out.push([pool[i], ...sub]);
  }
  return out;
}

function slotOrdersForCount(n) {
  if (!_slotOrderCache.has(n)) _slotOrderCache.set(n, slotOrders(FLOOR_SLOTS, n));
  return _slotOrderCache.get(n);
}

// Primary match = +3%, secondary/flex = +2%, out-of-role = +1%.
function slotFitScore(player, slot) {
  if (player.pos === slot) return 0.03;
  if ((player.secondaryPos || []).includes(slot)) return 0.02;
  return 0.01;
}

/**
 * Brute-force optimal assignment of up to 5 starters into XI slots.
 * @param {object[]} starters
 * @returns {{ assignment: object[], posBonus: number, flawless: boolean }}
 */
function optimizeLineup(starters) {
  const n = Math.min(starters.length, 5);
  if (n === 0) return { assignment: [], posBonus: 0, flawless: false };

  const players = starters.slice(0, n);

  let bestSlots = null;
  let bestScore = -Infinity;
  for (const perm of slotOrdersForCount(n)) {
    const score = players.reduce((s, p, i) => s + slotFitScore(p, perm[i]), 0);
    if (score > bestScore) { bestScore = score; bestSlots = perm; }
  }

  const assignment = [];
  let posBonus = 0;
  for (let i = 0; i < n; i++) {
    const p     = players[i];
    const slot  = bestSlots[i];
    const score = slotFitScore(p, slot);
    let fit;
    if (p.pos === slot)                              fit = 'primary';
    else if ((p.secondaryPos || []).includes(slot)) fit = 'flex';
    else                                              fit = 'oop';
    assignment.push({ slot, player: p, fit, bonus: score });
    posBonus += score;
  }

  const allPrimary = n === 5 && assignment.every(a => a.fit === 'primary');
  if (allPrimary) posBonus += 0.07;

  return { assignment, posBonus, flawless: allPrimary };
}

/**
 * Score positional fit against the player's *placed* roster slots, not the
 * engine's optimized XI. Used by the live draft chemistry panel.
 */
function placementLineup(starters, slots) {
  const n = Math.min(starters.length, slots.length, 5);
  if (n === 0) return { assignment: [], posBonus: 0, flawless: false };

  const assignment = [];
  let posBonus = 0;
  for (let i = 0; i < n; i++) {
    const p     = starters[i];
    const slot  = slots[i];
    const score = slotFitScore(p, slot);
    let fit;
    if (p.pos === slot)                              fit = 'primary';
    else if ((p.secondaryPos || []).includes(slot)) fit = 'flex';
    else                                              fit = 'oop';
    assignment.push({ slot, player: p, fit, bonus: score });
    posBonus += score;
  }

  const allPrimary = n === 5 && assignment.every(a => a.fit === 'primary');
  if (allPrimary) posBonus += 0.07;

  return { assignment, posBonus, flawless: allPrimary };
}

const SLOT_LABEL = { OPEN: 'opening slot', MID: 'middle-order slot', WK: 'keeper slot', PACE: 'pace slot', SPIN: 'spin slot' };

/**
 * @param {object[]} starters  5 starter player objects (starters-only format)
 * @param {string|null} coachId
 * @param {{ asPlacedSlots?: string[] }} [opts]
 * @returns {{ chemBonus: number, chemScore: number, chemReport: string[], chemEntries: object[], lineupAssignment: object[] }}
 */
export function calculateChemistry(starters, coachId = null, opts = {}) {
  const coach = coachId ?? ((typeof S !== 'undefined' && S.coach) ? S.coach : null);

  const sA = starters.map(p => p.archetype || '');
  const sT = starters.flatMap(p => p.traits || []);

  const entries = [];
  const add = (id, kind, family, bonus, label) => entries.push({ id, kind, family, bonus, label });
  const synergy = (id, family, bonus, label) => {
    const scaledBonus = bonus * SYNERGY_SCALE;
    const scaledLabel = label.replace(/\+\d+(?:\.\d+)?%/, `+${Math.round(scaledBonus * 100)}%`);
    add(id, 'synergy', family, scaledBonus, scaledLabel);
  };
  const penalty = (id, bonus, label) => add(id, 'penalty', null, -Math.abs(bonus), label);

  // ── PHASE 0: LINEUP OPTIMIZER (POSITIONAL FIT) ───────────────────────────────
  const { assignment, posBonus, flawless } = opts.asPlacedSlots
    ? placementLineup(starters, opts.asPlacedSlots)
    : optimizeLineup(starters);
  if (flawless) {
    synergy('flawless-xi', 'position', 0.07,
      'Flawless XI: All 5 starters playing their natural role (+7%)');
    for (const { slot, player, bonus } of assignment) {
      synergy(`fit-${slot}`, 'position', bonus,
        `Natural Fit: ${player.name} plays the natural ${SLOT_LABEL[slot]} (+3%)`);
    }
  } else {
    for (const { slot, player, fit, bonus } of assignment) {
      if (fit === 'primary') {
        synergy(`fit-${slot}`, 'position', bonus,
          `Natural Fit: ${player.name} plays the natural ${SLOT_LABEL[slot]} (+3%)`);
      } else if (fit === 'flex') {
        add(`fit-${slot}`, 'synergy', 'position', 0,
          `Flex Fit: ${player.name} (${player.pos}) covers the ${SLOT_LABEL[slot]} (0%)`);
      } else {
        penalty(`fit-${slot}`, 0.03,
          `Out of Role: ${player.name} fills the ${SLOT_LABEL[slot]} (-3%)`);
      }
    }
  }

  // ── PHASE 2: ARCHETYPE SYNERGIES ─────────────────────────────────────────────

  const hasAnchor      = sA.includes('Anchor');
  const hasPowerHitter  = sA.includes('Power Hitter');
  const hasFinisher     = sA.includes('Finisher');
  const hasDeathBowler  = sA.includes('Death Bowler');
  const hasStrikeBowler = sA.includes('Strike Bowler');
  const hasComplete     = sA.includes('Complete Cricketer');

  if (hasAnchor && hasPowerHitter) {
    synergy('powerplay-launch', 'batting', 0.08,
      'Powerplay Launch: Anchor sets the platform for the Power Hitter to cash in (+8%)');
  }

  if (hasDeathBowler && hasStrikeBowler) {
    const bonus = coach === 'rohit' ? 0.10 : 0.08;
    synergy('death-bowling-lockdown', 'bowling', bonus,
      `Death Bowling Lockdown${coach === 'rohit' ? ' ⭐ Rohit' : ''}: Wickets and containment covered every phase (+${Math.round(bonus * 100)}%)`);
  }

  const newBallPair = starters.filter(
    p => (p.pos === 'PACE' || p.pos === 'SPIN') &&
         ((p.traits || []).includes('New-Ball Specialist') || p.archetype === 'Strike Bowler')
  ).length;
  if (newBallPair >= 2) {
    const bonus = coach === 'rohit' ? 0.09 : 0.07;
    synergy('new-ball-pair', 'bowling', bonus,
      `New Ball Pair${coach === 'rohit' ? ' ⭐ Rohit' : ''}: Two front-line strike bowlers share the new ball (+${Math.round(bonus * 100)}%)`);
  }

  const sMatchWinner   = sT.filter(t => t === 'Match-Winner').length;
  const sSixHitter     = sT.filter(t => t === 'Six-Hitting Machine').length;
  if (sMatchWinner >= 1 && sSixHitter >= 2) {
    const bonus = coach === 'kohli' ? 0.09 : coach === 'warner' ? 0.09 : 0.07;
    synergy('explosive-top-order', 'batting', bonus,
      `Explosive Top Order${coach === 'kohli' ? ' ⭐ Kohli' : coach === 'warner' ? ' ⭐ Warner' : ''}: A Match-Winner unlocks multiple boundary-hitters (+${Math.round(bonus * 100)}%)`);
  }

  const spinAnchor = starters.find(
    p => (p.archetype === 'Strike Bowler' || p.archetype === 'Death Bowler') && p.wkts >= 1.4
  );
  if (spinAnchor) {
    const bonus = coach === 'warne' ? 0.09 : 0.07;
    synergy('wicket-taking-threat', 'bowling', bonus,
      `Wicket-Taking Threat${coach === 'warne' ? ' ⭐ Warne' : ''}: ${spinAnchor.name.split(' ').pop()} anchors the bowling attack (+${Math.round(bonus * 100)}%)`);
  }

  const sStrikeBowlerCount = sA.filter(a => a === 'Strike Bowler').length;
  if (sStrikeBowlerCount >= 2) {
    const bonus = coach === 'warne' ? 0.09 : 0.07;
    synergy('spin-web', 'bowling', bonus,
      `Spin Web${coach === 'warne' ? ' ⭐ Warne' : ''}: Multiple strike bowlers strangle the middle overs (+${Math.round(bonus * 100)}%)`);
  }

  const sPowerHitterCount = sA.filter(a => a === 'Power Hitter').length;
  if (hasAnchor && sPowerHitterCount >= 2) {
    const bonus = coach === 'warner' ? 0.09 : 0.07;
    synergy('pace-and-power', 'batting', bonus,
      `Pace and Power${coach === 'warner' ? ' ⭐ Warner' : ''}: High-tempo batting engine ready from ball one (+${Math.round(bonus * 100)}%)`);
  }

  if (sSixHitter >= 3) {
    const bonus = coach === 'kohli' ? 0.08 : 0.05;
    synergy('boundary-blitz', 'batting', bonus,
      `Boundary Blitz${coach === 'kohli' ? ' ⭐ Kohli' : ''}: 3+ Six-Hitting Machines in the XI overload the boundary riders (+${Math.round(bonus * 100)}%)`);
  }

  const stretchFinisher = starters.find(
    p => (p.pos === 'WK' || p.pos === 'MID') && p.archetype === 'Finisher'
  );
  if (stretchFinisher) {
    const bonus = coach === 'kohli' ? 0.08 : 0.05;
    synergy('finishers-instinct', 'batting', bonus,
      `Finisher's Instinct${coach === 'kohli' ? ' ⭐ Kohli' : ''}: ${stretchFinisher.name.split(' ').pop()} closes out the innings (+${Math.round(bonus * 100)}%)`);
  }

  const anchorTop      = starters.find(p => p.archetype === 'Anchor' && p.runs > 35);
  const finisherBottom = starters.find(p => p.archetype === 'Finisher' && p.sr  > 150);
  if (anchorTop && finisherBottom) {
    const bonus = coach === 'dhoni' ? 0.09 : 0.07;
    synergy('anchor-and-aggressor', 'batting', bonus,
      `Anchor & Aggressor${coach === 'dhoni' ? ' ⭐ Dhoni' : ''}: Platform-builder and finisher fully synchronized (+${Math.round(bonus * 100)}%)`);
  }

  const teamCounts = {};
  for (const p of starters) {
    if (p.team) teamCounts[p.team] = (teamCounts[p.team] || 0) + 1;
  }
  if (Object.values(teamCounts).some(count => count >= 3)) {
    synergy('homegrown-core', 'intangibles', 0.05,
      'Homegrown Core: Shared franchise dressing room yields a chemistry boost (+5%)');
  }

  const sLockdownBowler = sT.filter(t => t === 'Lockdown Bowler').length;
  if (sLockdownBowler >= 2) {
    const bonus = (coach === 'rohit' || coach === 'warne' || coach === 'pandya') ? 0.10 : 0.07;
    synergy('all-format-bowling', 'bowling', bonus,
      `All-Format Bowling Unit${coach === 'rohit' ? ' ⭐ Rohit' : coach === 'warne' ? ' ⭐ Warne' : coach === 'pandya' ? ' ⭐ Pandya' : ''}: Baseline containment pressure across the attack (+${Math.round(bonus * 100)}%)`);
  }

  const helioAnchor = starters.find(p => p.archetype === 'Anchor' && p.runs > 42);
  const otherStartersScoring = starters.filter(p => p.archetype !== 'Anchor' && p.sr > 130);
  if (
    helioAnchor &&
    starters.filter(p => p.archetype === 'Anchor').length === 1 &&
    otherStartersScoring.length === 4
  ) {
    synergy('build-around-the-anchor', 'batting', 0.07,
      `Build Around the Anchor: Innings cleanly centered around ${helioAnchor.name.split(' ').pop()} (+7%)`);
  }

  const startingPace = starters.find(p => p.pos === 'PACE');
  const startingSpin = starters.find(p => p.pos === 'SPIN');
  if (startingPace?.archetype === 'Death Bowler' && startingSpin?.archetype === 'Death Bowler') {
    const bonus = coach === 'rohit' ? 0.08 : 0.05;
    synergy('death-overs-lockdown', 'bowling', bonus,
      `Death Overs Lockdown${coach === 'rohit' ? ' ⭐ Rohit' : ''}: Both frontline bowlers close out the innings (+${Math.round(bonus * 100)}%)`);
  }

  const eliteBatters = starters.filter(p => p.runs > 38);
  if (eliteBatters.length >= 2) {
    const bonus = coach === 'kohli' ? 0.09 : coach === 'dhoni' ? 0.09 : 0.07;
    synergy('dynamic-duo', 'batting', bonus,
      `Dynamic Duo${coach === 'kohli' ? ' ⭐ Kohli' : coach === 'dhoni' ? ' ⭐ Dhoni' : ''}: Explosive top-order partnership active (+${Math.round(bonus * 100)}%)`);
  }

  // ── PHASE 3: TRAIT SYNERGIES ─────────────────────────────────────────────────

  const sTChaseMaster   = sT.filter(t => t === 'Chase Master').length;
  const sTTeamMan       = sT.filter(t => t === 'Team Man').length;
  const sTClutch        = sT.filter(t => t === 'Clutch').length;
  const sTEnforcer      = sT.filter(t => t === 'Enforcer').length;
  const sTCaptainMat    = sT.filter(t => t === 'Captain Material').length;
  const sTSpinWizard    = sT.filter(t => t === 'Spin Wizard').length;
  const sTStrikeRotator = sT.filter(t => t === 'Strike Rotator').length;
  const sTBigMatch      = sT.filter(t => t === 'Big-Match Player').length;
  const sTNewBall       = sT.filter(t => t === 'New-Ball Specialist').length;
  const sTPowerplaySpec = sT.filter(t => t === 'Powerplay Specialist').length;
  const sTImpactSub     = sT.filter(t => t === 'Impact Sub').length;
  const sTDeathSpec     = sT.filter(t => t === 'Death-Over Specialist').length;

  if (sTChaseMaster >= 2) {
    synergy('icy-finishers', 'intangibles', 0.05,
      `Icy Finishers: ${sTChaseMaster} Chase Masters in the XI thrive with the game in the balance (+5%)`);
  }

  if (sTTeamMan >= 2) {
    synergy('dressing-room-unity', 'intangibles', 0.06,
      'Dressing Room Unity: 2+ Team Men in the XI — selfless core frees the stars (+6%)');
  }

  if (sTClutch >= 4) {
    synergy('big-match-temperament', 'intangibles', 0.06,
      `Big-Match Temperament: ${sTClutch} clutch performers in the XI — built for the knockouts (+6%)`);
  }

  if (sTEnforcer >= 1) {
    synergy('hustle-in-the-field', 'intangibles', 0.05,
      'Hustle in the Field: An Enforcer on the roster — direct hits and diving stops generate extra pressure (+5%)');
  }

  if (sTCaptainMat >= 1 && sMatchWinner >= 1) {
    const bonus = coach === 'gambhir' ? 0.09 : 0.07;
    synergy('captains-composure', 'intangibles', bonus,
      `Captain's Composure${coach === 'gambhir' ? ' ⭐ Gambhir' : ''}: Match-Winner backed by real tactical leadership (+${Math.round(bonus * 100)}%)`);
  }

  if (sTSpinWizard >= 2) {
    synergy('twin-spin-threat', 'bowling', 0.07,
      `Twin Spin Threat: ${sTSpinWizard} Spin Wizards choke the middle overs from both ends (+7%)`);
  }

  if (sTStrikeRotator >= 1 && sTPowerplaySpec >= 2) {
    synergy('powerplay-precision', 'batting', 0.06,
      'Powerplay Precision: A Strike Rotator keeps the board ticking while the Powerplay Specialists cash in (+6%)');
  }

  if (sTBigMatch >= 2) {
    const bonus = coach === 'rohit' ? 0.08 : 0.06;
    synergy('finals-pedigree', 'intangibles', bonus,
      `Finals Pedigree${coach === 'rohit' ? ' ⭐ Rohit' : ''}: ${sTBigMatch} Big-Match Players raise their game in the knockouts (+${Math.round(bonus * 100)}%)`);
  }

  if (sTNewBall >= 1 && sTDeathSpec >= 1) {
    const bonus = coach === 'rohit' ? 0.08 : 0.06;
    synergy('both-ends-covered', 'bowling', bonus,
      `Both Ends Covered${coach === 'rohit' ? ' ⭐ Rohit' : ''}: New-ball breakthroughs and death-overs control in the same XI (+${Math.round(bonus * 100)}%)`);
  }

  if (sTImpactSub >= 1 && (sMatchWinner >= 1 || sTCaptainMat >= 1)) {
    synergy('x-factor-substitute', 'batting', 0.04,
      'X-Factor Substitute: A genuine floater gives the XI a tactical trump card late in the game (+4%)');
  }

  // ── PHASE 4: PENALTIES ───────────────────────────────────────────────────────

  if (!hasDeathBowler && starters.length >= 5) {
    penalty('no-death-bowling', 0.06,
      'No Death Bowling: No Death Bowler in the XI — the last few overs leak runs uncontested (-6%)');
  }

  if (!hasAnchor && !hasComplete && starters.length >= 5) {
    penalty('fragile-middle-order', 0.05,
      'Fragile Middle Order: No Anchor and no Complete Cricketer — one wicket and the innings can collapse (-5%)');
  }

  const bowlSlots  = starters.filter(p => p.pos === 'PACE' || p.pos === 'SPIN');
  const bowlWkts   = bowlSlots.reduce((s, p) => s + p.wkts, 0);
  if (bowlSlots.length === 2 && !hasDeathBowler && bowlWkts < 2.0) {
    penalty('all-bat-no-ball', 0.07,
      `All Bat, No Ball: Frontline bowlers combine for only ${bowlWkts.toFixed(1)} wkts/match with no Death Bowler in sight (-7%)`);
  }

  const archCounts = sA.reduce((acc, a) => { if (a) acc[a] = (acc[a] || 0) + 1; return acc; }, {});
  const dominantArch = Object.entries(archCounts).find(([a, n]) => n >= 4 && a !== 'Complete Cricketer');
  if (dominantArch) {
    penalty('one-dimensional-xi', 0.06,
      `One-Dimensional XI: ${dominantArch[1]} starters share the ${dominantArch[0]} archetype — one plan, easy to bowl/bat against (-6%)`);
  }

  const starterPosCounts = starters.reduce((acc, p) => {
    acc[p.pos] = (acc[p.pos] || 0) + 1; return acc;
  }, {});
  if (Object.values(starterPosCounts).some(n => n >= 3) && !logjamResolvable(starters)) {
    penalty('positional-logjam', 0.12,
      'Positional Logjam: 3+ starters play the same role — team balance breaks down (-12%)');
  }

  if (sTChaseMaster === 0 && starters.length >= 5) {
    penalty('no-finishing-power', 0.06,
      'No Finishing Power: No Chase Master in the XI — close chases stay a coin flip (-6%)');
  }

  const sTPowerplaySpecCount = sT.filter(t => t === 'Powerplay Specialist').length;
  if (sTPowerplaySpecCount === 0 && !hasPowerHitter && starters.length >= 5) {
    penalty('powerplay-panic', 0.05,
      'Powerplay Panic: No Powerplay Specialist and no Power Hitter — the first six overs go to waste (-5%)');
  }

  if (sTSpinWizard === 0 && !hasStrikeBowler && starters.length >= 5) {
    penalty('spin-blind-spot', 0.05,
      'Spin Blind Spot: No genuine spin threat in the XI — flat tracks get punished (-5%)');
  }

  if (sMatchWinner >= 3 && coach !== 'dhoni') {
    let amt = coach === 'kohli' ? 0.03 : coach === 'pandya' ? 0 : 0.07;
    if (amt > 0) {
      penalty('ego-clash', amt,
        `Ego Clash${coach === 'kohli' ? ' (softened by Kohli)' : ''}: Too many alpha Match-Winners in the XI (-${Math.round(amt * 100)}%)`);
    }
  }

  const weakFielders = starters.filter(p => p.field < 0.4).length;
  if (weakFielders >= 3) {
    penalty('fielding-liabilities', 0.04,
      'Fielding Liabilities: 3+ starters are well below par in the field — chances go down (-4%)');
  }

  const weakBattingStarters = starters.filter(p => p.runs < 15).length;
  if (weakBattingStarters >= 3) {
    penalty('batting-black-hole', 0.07,
      'Batting Black Hole: 3+ starters average under 15 runs/match, killing the scoreboard (-7%)');
  }

  // ── FAMILY CAPS + FINAL SCORE ────────────────────────────────────────────────
  let chemBonus = 0;
  const familySums = {};
  for (const e of entries) {
    if (e.kind === 'synergy') familySums[e.family] = (familySums[e.family] || 0) + e.bonus;
    else if (e.kind === 'penalty') chemBonus += e.bonus;
  }
  for (const [family, sum] of Object.entries(familySums)) {
    const cap = FAMILY_CAPS[family] ?? Infinity;
    if (sum > cap + 1e-9) {
      chemBonus += cap;
      add(`cap-${family}`, 'info', family, 0,
        `${FAMILY_LABEL[family]} synergies maxed: capped at +${Math.round(cap * 100)}% — diversify the XI to gain more`);
    } else {
      chemBonus += sum;
    }
  }

  const chemScore  = chemScoreFromBonus(chemBonus);
  const chemReport = entries.map(e => (e.kind === 'penalty' ? '🔴 ' : '🟢 ') + e.label);
  return { chemBonus, chemScore, chemReport, chemEntries: entries, lineupAssignment: assignment };
}

/**
 * Returns true if a positional logjam (3+ starters at the same slot) can be
 * resolved by sliding one or more players to their secondary slot.
 * @param {object[]} starters
 * @returns {boolean}
 */
function logjamResolvable(starters) {
  const posOptions = starters.map(p => [p.pos, ...(p.secondaryPos || [])]);

  function tryAssign(idx, counts) {
    if (idx === posOptions.length) {
      return Object.values(counts).every(n => n < 3);
    }
    for (const pos of posOptions[idx]) {
      counts[pos] = (counts[pos] || 0) + 1;
      if (tryAssign(idx + 1, counts)) {
        counts[pos]--;
        return true;
      }
      counts[pos]--;
    }
    return false;
  }

  return tryAssign(0, {});
}
