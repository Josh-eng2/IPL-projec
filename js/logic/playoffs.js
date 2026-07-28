/**
 * js/logic/playoffs.js — Real IPL-format playoffs: Qualifier 1, Eliminator,
 * Qualifier 2, Final. Four teams, three knockout matches, every match a
 * single one-off game (never a best-of-series) — exactly how the actual
 * IPL playoff stage works.
 *
 *   Qualifier 1:  seed 1 vs seed 2  → winner books the Final directly,
 *                                     loser gets a second life in Qualifier 2
 *   Eliminator:   seed 3 vs seed 4  → loser is out, winner advances
 *   Qualifier 2:  Q1 loser vs Eliminator winner → winner meets the Final
 *   Final:        Q1 winner vs Q2 winner → champion
 */

import { simulateMatch } from './simulation.js';

export const STAGES = ['qualifier1', 'eliminator', 'qualifier2', 'final'];

export const STAGE_LABEL = {
  qualifier1: 'Qualifier 1',
  eliminator: 'Eliminator',
  qualifier2: 'Qualifier 2',
  final:      'Final',
};

/**
 * Builds the initial playoff state from a 4-team seeded field.
 * @param {object[]} seeds  4 teams, index 0 = seed 1 (from state.js buildBracket)
 * @returns {object} po
 */
export function createPlayoffState(seeds) {
  return {
    seeds,
    stage:        'qualifier1',
    matches:      {},   // stage → { teamA, teamB, won, teamScore, oppScore }
    eliminated:   false,
    eliminatedIn: null,
    champion:     false,
    championTeam: null,
    tickState:    null,
  };
}

/** The two teams facing off in the current stage, or null if the playoffs are over. */
export function currentMatchup(po) {
  const [s1, s2, s3, s4] = po.seeds;
  switch (po.stage) {
    case 'qualifier1': return [s1, s2];
    case 'eliminator':  return [s3, s4];
    case 'qualifier2': {
      const q1Loser = po.matches.qualifier1.won ? po.matches.qualifier1.teamB : po.matches.qualifier1.teamA;
      const elimWinner = po.matches.eliminator.won ? po.matches.eliminator.teamA : po.matches.eliminator.teamB;
      return [q1Loser, elimWinner];
    }
    case 'final': {
      const q1Winner = po.matches.qualifier1.won ? po.matches.qualifier1.teamA : po.matches.qualifier1.teamB;
      const q2Winner = po.matches.qualifier2.won ? po.matches.qualifier2.teamA : po.matches.qualifier2.teamB;
      return [q1Winner, q2Winner];
    }
    default: return null;
  }
}

/** Simulates the current stage's single match and returns the raw result (not yet applied). */
export function simulateCurrentMatch(po) {
  const [teamA, teamB] = currentMatchup(po);
  const { won, teamScore, oppScore } = simulateMatch(teamA.strength, teamB.strength);
  return { teamA, teamB, won, teamScore, oppScore };
}

/**
 * Applies a completed stage's result and advances to the next stage.
 * Always resolves the full bracket regardless of player elimination — a
 * Qualifier 1 loss is NOT elimination (the player gets a second life in
 * Qualifier 2); only an Eliminator, Qualifier 2, or Final loss ends the run.
 * @returns {'champion'|'eliminated'|'advanced'|'complete'}
 */
export function applyMatchResult(po, result) {
  const stage = po.stage;
  po.matches[stage] = result;
  const winner = result.won ? result.teamA : result.teamB;
  const loser  = result.won ? result.teamB : result.teamA;

  if (loser.isPlayer && !po.eliminated &&
      (stage === 'eliminator' || stage === 'qualifier2' || stage === 'final')) {
    po.eliminated   = true;
    po.eliminatedIn = STAGE_LABEL[stage];
  }

  if (stage === 'final') {
    po.championTeam = winner;
    po.champion     = !!winner.isPlayer;
    po.stage = 'complete';
    return po.champion ? 'champion' : (po.eliminated ? 'eliminated' : 'complete');
  }

  const order = ['qualifier1', 'eliminator', 'qualifier2', 'final'];
  po.stage = order[order.indexOf(stage) + 1];

  return po.eliminated ? 'eliminated' : 'advanced';
}

/**
 * Builds the display state for render.js — one row per stage with whatever
 * has been decided so far.
 * @param {object} po
 */
export function getBracketDisplayState(po) {
  const rows = STAGES.map(stage => {
    const m = po.matches[stage];
    if (m) {
      return {
        stage, label: STAGE_LABEL[stage],
        teamA: m.teamA, teamB: m.teamB,
        scoreA: m.teamScore, scoreB: m.oppScore,
        winner: m.won ? m.teamA : m.teamB,
        complete: true,
        live: false,
      };
    }
    if (po.stage === stage && po.stage !== 'complete') {
      const pair = currentMatchup(po);
      return {
        stage, label: STAGE_LABEL[stage],
        teamA: pair?.[0] ?? null, teamB: pair?.[1] ?? null,
        scoreA: null, scoreB: null, winner: null,
        complete: false,
        live: !!po.tickState,
      };
    }
    // Eliminator's teams (seed 3 vs seed 4) are fixed from the initial seeding —
    // show them even before Qualifier 1 has been played, unlike Qualifier 2 and
    // the Final, whose entrants genuinely depend on earlier results.
    if (stage === 'eliminator') {
      return {
        stage, label: STAGE_LABEL[stage],
        teamA: po.seeds[2] ?? null, teamB: po.seeds[3] ?? null,
        scoreA: null, scoreB: null, winner: null,
        complete: false,
        live: false,
      };
    }
    return { stage, label: STAGE_LABEL[stage], teamA: null, teamB: null, scoreA: null, scoreB: null, winner: null, complete: false, live: false };
  });

  return { rows, champion: po.championTeam ?? null, stage: po.stage };
}
