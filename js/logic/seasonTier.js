/**
 * Shared season-tier labels — used by the results screen AND share cards so
 * the emotional punchline never disagrees with the clipboard caption.
 *
 * Thresholds (wins out of a 14-match IPL league stage):
 *   14      → PERFECT SEASON
 *   ≥12     → Historic Season
 *   ≥11     → Championship Contender
 *   ≥7      → Playoff Contender  (aligned with playoff seeding bands)
 *   else    → Rebuild Required
 */
export function seasonTier(wins) {
  const w = Number(wins) || 0;
  if (w === 14) return { id: 'perfect',  label: 'PERFECT SEASON',         emoji: '🏆' };
  if (w >= 12)  return { id: 'historic', label: 'Historic Season',        emoji: '🔥' };
  if (w >= 11)  return { id: 'elite',    label: 'Championship Contender', emoji: '⭐' };
  if (w >= 7)   return { id: 'playoff',  label: 'Playoff Contender',      emoji: '✅' };
  return            { id: 'rebuild', label: 'Rebuild Required',       emoji: '📋' };
}
