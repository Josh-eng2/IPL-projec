/**
 * scripts/build_challenge_pages.mjs — generates one static page per Daily
 * Challenge into daily/<slug>.html, plus rewrites sitemap.xml.
 *
 * Why per-challenge and not per-day: the catalog holds 16 challenges on a
 * daily rotation, so a given challenge recurs roughly every two to three
 * weeks. A page per calendar day would therefore be a near-duplicate of the
 * pages for every other day that drew the same challenge — thin, duplicated
 * content at scale. One page per challenge is unique, evergreen, and gets
 * *richer* over time as its "when it has run" list grows. daily.html remains
 * the date index and links into these pages.
 *
 * The challenge data is read from the game's own modules (js/logic/challenge.js,
 * js/data/players.js) rather than duplicated here, so these pages can never
 * drift from what the game actually serves.
 *
 * Run:  node scripts/build_challenge_pages.mjs
 * Re-run after editing the CHALLENGES catalog or regenerating players.json.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// TODO: point this at the project's real deployed domain once it has one.
const ORIGIN = 'https://your-domain.example';
const OUT_DIR = join(ROOT, 'daily');

// js/data/players.js removes the loading overlay on load — stub the one DOM
// call so the module runs headlessly. Must be set before the import.
globalThis.document = { getElementById: () => null };

const playersMod = await import('../js/data/players.js');
playersMod.loadDatabase();
const DB = playersMod.DB;
if (!DB) throw new Error('player DB failed to load');

const { CHALLENGES, getDailyChallenge, getLockedPlayer } =
  await import('../js/logic/challenge.js');
const { SEASON_GAMES } = await import('../js/logic/simulation.js');

// First day the Daily Challenge existed (first commit of js/logic/challenge.js).
// Dates before this are not real history and are never generated.
const LAUNCH = new Date().toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

// ── helpers ──────────────────────────────────────────────────────────────────

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const slugify = s => String(s).toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const fmtDate = ds => new Date(ds + 'T00:00:00Z')
  .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Every date from LAUNCH through today, oldest first. */
function datesSinceLaunch() {
  const out = [];
  for (let t = Date.parse(LAUNCH + 'T00:00:00Z'); t <= Date.parse(TODAY + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const teamOf = key => key.split('_')[0];
const decadeOf = key => key.split('_')[1];

/** Writes only when content actually differs. Returns true if it wrote. */
function writeIfChanged(path, content) {
  try {
    if (readFileSync(path, 'utf8') === content) return false;
  } catch (_) { /* file doesn't exist yet */ }
  writeFileSync(path, content, 'utf8');
  return true;
}

/** Last commit date for a path, 'YYYY-MM-DD', or null outside a git checkout. */
function gitDate(relPath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relPath],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch (_) { return null; }
}

/** loc -> lastmod from the sitemap we're about to replace. */
const prevLastmod = (() => {
  const map = new Map();
  try {
    const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
      map.set(m[1], m[2]);
    }
  } catch (_) { /* first run */ }
  return map;
})();

/**
 * lastmod must reflect when the page's content last actually changed, not
 * when this script last ran — a sitemap that stamps every URL with today on
 * every build trains Google to ignore the field. So: today only if we just
 * rewrote the file, otherwise the date git last recorded a change to it.
 */
function lastmodFor(url, relPath, changed) {
  if (changed) return TODAY;
  return gitDate(relPath) || prevLastmod.get(url) || TODAY;
}

/** Real counts from the player DB, so each page states verifiable specifics. */
function poolStats(filterFn) {
  const teams = new Set();
  let players = 0;
  for (const [key, list] of Object.entries(DB)) {
    for (const p of list) {
      if (!filterFn(p, key)) continue;
      players++;
      teams.add(teamOf(key));
    }
  }
  return { players, teams: teams.size };
}

const ALL = poolStats(() => true);

/** Human-readable expansion of a challenge's params, derived from the data. */
function ruleFacts(ch) {
  const p = ch.params || {};
  const facts = [];

  if (p.era) {
    const s = poolStats((_, key) => decadeOf(key) === p.era);
    facts.push([`Era lock`, `${p.era} only — ${s.players} players across ${s.teams} franchises`]);
  }
  if (p.allowedDecades) {
    const set = new Set(p.allowedDecades);
    const s = poolStats((_, key) => set.has(decadeOf(key)));
    facts.push([`Eras allowed`, `${p.allowedDecades.join(', ')} — ${s.players} players across ${s.teams} franchises`]);
  }
  if (p.excludeTeams) {
    const set = new Set(p.excludeTeams);
    const s = poolStats((_, key) => !set.has(teamOf(key)));
    facts.push([`Franchises banned`, `${p.excludeTeams.join(', ')} — ${s.teams} of ${ALL.teams} franchises still draftable`]);
  }
  if (p.maxPopTotal != null) {
    let min = Infinity;
    for (const list of Object.values(DB)) for (const pl of list) min = Math.min(min, pl.popularity ?? 50);
    facts.push([`Fans budget`, `${p.maxPopTotal} total across all five starters (average ${Math.floor(p.maxPopTotal / 5)} each; the cheapest player in the game is ${min})`]);
  }
  if (p.starterRuns != null) facts.push([`Batting target`, `one starter must average ${p.starterRuns}+ runs per match`]);
  if (p.teamWkts != null)    facts.push([`Bowling target`, `your bowlers must combine for ${p.teamWkts}+ wickets per match`]);
  if (p.minRating != null)  facts.push([`Rating target`, `average ${p.minRating}+ Team Rating across your five starters`]);
  if (p.minStreak != null)  facts.push([`Streak target`, `a ${p.minStreak}-match win streak at some point in the season`]);
  if (p.minWins != null)    facts.push([`Win floor`, `${p.minWins} of ${SEASON_GAMES} matches`]);
  return facts;
}

/** Specific, non-generic guidance per challenge. */
const STRATEGY = {
  'inaugural-era': 'The 2008-11 era is a shallower pool than later years, so the constraint bites harder than it looks. Lock down a genuine strike bowler early — this window is stacked with batters and short on death-overs specialists.',
  'impact-era': 'The 2023-25 pool skews toward explosive top-order batting. Spacing the innings is the scarce resource: get a genuine anchor in before you spend picks on a second power hitter, or the innings collapses in the sim.',
  'old-guard': 'The 2008-15 window puts up huge top-order numbers but is thin on frontline strike bowlers by modern standards. Because the win floor here is the lowest of any constraint (8), you can afford to prioritize a balanced XI over chasing the single highest-rated player every round.',
  'new-gen': 'The 2020-25 pool is batting-rich and death-bowling-poor. Take the best available bowler early — by the later rounds you will be choosing between batters.',
  'domestic-talent': 'This is the hardest constraint in the catalog, because fan following and quality correlate. Spend most of the budget on one genuinely good starter and fill the other four from the cheapest end of the board. Balance matters more here than anywhere else: a cheap XI spread evenly across all five stat categories beats a cheap XI that is lopsided.',
  'no-big-two': 'Losing Mumbai Indians and Chennai Super Kings removes more all-time title-winning talent than any other two franchises, and the win floor is a steep 10. Target the deep non-banned dynasties — RCB, KKR, and Sunrisers all carry multiple eras.',
  'win-11': 'No draft restriction at all, so this is purely a roster-quality test. Take the highest-rated player available every round and let position need break ties.',
  'win-12': 'Only a handful of real IPL sides have ever finished a league stage 12-2 or better. You need elite talent *and* a balanced XI — a five-superstar lineup that is thin in one stat category will land a couple of wins short. Shore up your weakest stat before chasing another superstar.',
  'boundary-machine': 'You need one starter averaging 42+ runs, which means drafting a genuine number-one batter early rather than spreading talent evenly. Everything after round one should support that player, not compete with them for the strike.',
  'strike-force': '5+ combined wickets per match is a lot, so you effectively need two genuine strike bowlers, not one. Pace and spin options tagged Death Bowler or Strike Bowler carry the highest wicket rates in the database.',
  'all-star-xi': 'The only challenge where raw talent *is* the objective — averaging 92+ across all five starters is a top-quartile bar at every position. Do not spend a pick on a lovable role player; if a slot\'s best available is not elite, use a skip and wait for the next spin. Wicketkeeper and Pace have the deepest elite pools if the board gets tight.',
  'wire-to-wire': 'A 10-match streak is about consistency rather than peak talent — avoid an XI with one superstar and four weak links, since the sim punishes thin rosters over a full season.',
  'build-around-kohli': 'Kohli gives you dominant middle-order run-scoring but the other four picks should lean toward bowling depth and a genuine finisher. Do not draft a second ball-dominant Anchor.',
  'build-around-dhoni': 'Dhoni covers the keeper slot and closes out chases, which frees you to draft top-order power and a strike bowler rather than another finisher.',
  'build-around-bumrah': 'Bumrah locks the pace slot with elite death-overs control, so prioritize batting depth and a genuine spin threat. The 10-win floor is comfortably reachable if you don\'t neglect the top order.',
  'build-around-gayle': 'Gayle fills the opening slot with explosive power-hitting but limited fielding impact. Surround him with a genuine anchor and strike bowlers; a second boundary-only hitter will leave the XI batting-heavy and bowling-light.',
};

const TYPE_LABEL = {
  constraint: 'Draft constraint',
  objective:  'Season objective',
  locked:     'Locked-legend build',
};
const TYPE_BLURB = {
  constraint: 'a rule limiting who you may draft, enforced at pick time',
  objective:  'draft anyone you like — the target is a season result',
  locked:     'one superstar is pre-drafted for you; build the other four around him',
};

// ── page template ────────────────────────────────────────────────────────────

function renderPage(ch, slug, dates) {
  const facts = ruleFacts(ch);
  const locked = ch.type === 'locked' ? getLockedPlayer(ch) : null;
  const title = `${ch.title} — 14-0 Daily Challenge`;
  // Kept under ~158 chars so Google renders it in full. The suffix is dropped
  // rather than truncated mid-sentence when a long rule leaves no room.
  const suffix = ` How the ${ch.title} daily challenge works and how to clear it.`;
  const metaDesc = (ch.desc + suffix).length <= 158 ? ch.desc + suffix : ch.desc;
  if (metaDesc.length > 158) throw new Error(`meta description too long for "${ch.id}" (${metaDesc.length})`);
  const url = `${ORIGIN}/daily/${slug}.html`;

  const statLine = locked ? [
    ['RUNS', locked.runs], ['SR', locked.sr], ['WKTS', locked.wkts],
    ['ECON', locked.econ], ['FLD', locked.field],
  ].map(([k, v]) => `<span class="cp-stat"><b>${v}</b> ${k}</span>`).join('') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(metaDesc)}" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" href="../favicon.ico" sizes="48x48" />
  <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
  <meta name="robots" content="max-image-preview:large" />

  <meta property="og:type"        content="article" />
  <meta property="og:site_name"   content="Can You Go 14-0?" />
  <meta property="og:url"         content="${url}" />
  <meta property="og:title"       content="${esc(title)}" />
  <meta property="og:description" content="${esc(ch.desc)}" />
  <meta property="og:image"       content="${ORIGIN}/og-image.png" />
  <meta name="twitter:card"       content="summary_large_image" />
  <meta name="twitter:title"      content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(ch.desc)}" />
  <meta name="twitter:image"      content="${ORIGIN}/og-image.png" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
  <script>
    try { if (localStorage.getItem('nba820_theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); } catch(e){}
  </script>
  <link rel="stylesheet" href="../css/styles.css" />

  <script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: title,
  url,
  description: ch.desc,
  inLanguage: 'en',
  isPartOf: { '@type': 'WebSite', name: 'Can You Go 14-0?', url: ORIGIN + '/' },
  about: {
    '@type': 'VideoGame',
    name: 'Can You Go 14-0?',
    url: ORIGIN + '/',
    applicationCategory: 'GameApplication',
    gamePlatform: 'Web Browser',
  },
}, null, 2).split('\n').map(l => '  ' + l).join('\n')}
  </script>
</head>
<body>

  <section class="seo-content cp-page">
    <div class="seo-inner">
      <p class="cp-crumb"><a href="../daily.html">← Daily Challenge archive</a></p>

      <h1>${ch.emoji} ${esc(ch.title)}</h1>
      <p class="cp-type"><b>${TYPE_LABEL[ch.type]}</b> — ${TYPE_BLURB[ch.type]}.</p>
      <p><strong>${esc(ch.desc)}</strong></p>
      <p><a class="seo-cta" href="../">▶ Play today's challenge</a></p>

      <h2>What the rule means</h2>
      <dl class="cp-facts">
${facts.map(([k, v]) => `        <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
      </dl>
${locked ? `
      <h2>The locked player</h2>
      <div class="challenge-card cp-player">
        <div>
          <p class="title">${esc(locked.name)}</p>
          <p class="desc">${esc(locked.pos)} · ${esc(locked.team)} · ${esc(locked.decade)}${locked.archetype ? ` · ${esc(locked.archetype)}` : ''}</p>
          <p class="cp-stats">${statLine}</p>
          ${Array.isArray(locked.traits) && locked.traits.length
            ? `<p class="desc">Traits: ${locked.traits.map(esc).join(' · ')}</p>` : ''}
        </div>
      </div>
      <p>He occupies the ${esc(ch.params.pos)} slot before you draft a single player, so you are really making four picks, not five.</p>
` : ''}
      <h2>How to clear it</h2>
      <p>${esc(STRATEGY[ch.id] || '')}</p>
      <p>Every challenge is scored on the season, not the draft — finishing the roster is not a pass on its own. You get one attempt per day, and the board resets at midnight UTC.</p>

      <h2>When ${esc(ch.title)} has run</h2>
${dates.length
  ? `      <p>Every player in the world got this challenge on ${dates.length === 1 ? 'this date' : 'these dates'}:</p>
      <ul class="cp-dates">
${dates.slice().reverse().map(d => `        <li>${fmtDate(d)}</li>`).join('\n')}
      </ul>`
  : `      <p>This one has not come up yet since the Daily Challenge launched on ${fmtDate(LAUNCH)}. The rotation is seeded by date, so it will.</p>`}

      <p class="seo-links">
        <a href="../">← Back to the game</a> &middot;
        <a href="../daily.html">All daily challenges</a> &middot;
        <a href="../privacy.html">Privacy</a>
      </p>
    </div>
  </section>

</body>
</html>
`;
}

// ── build ────────────────────────────────────────────────────────────────────

const dates = datesSinceLaunch();
const byChallenge = new Map(CHALLENGES.map(c => [c.id, []]));
for (const d of dates) {
  const ch = getDailyChallenge(d);
  if (byChallenge.has(ch.id)) byChallenge.get(ch.id).push(d);
}

mkdirSync(OUT_DIR, { recursive: true });

const slugs = new Map();
for (const ch of CHALLENGES) {
  const slug = slugify(ch.title);
  if (slugs.has(slug)) throw new Error(`slug collision: "${slug}" from ${ch.id} and ${slugs.get(slug)}`);
  slugs.set(slug, ch.id);
}

const written = [];
for (const ch of CHALLENGES) {
  const slug = slugify(ch.title);
  if (!STRATEGY[ch.id]) throw new Error(`no strategy copy for challenge "${ch.id}" — add one before shipping a thin page`);
  const rel = `daily/${slug}.html`;
  const changed = writeIfChanged(join(OUT_DIR, `${slug}.html`), renderPage(ch, slug, byChallenge.get(ch.id)));
  written.push({ slug, id: ch.id, days: byChallenge.get(ch.id).length, rel, changed });
}

// ── challenge index inside daily.html ────────────────────────────────────────
// daily.html used to carry a hand-typed copy of all 16 cards, which could
// drift from the catalog. It now owns a managed block that this script fills,
// so the archive and the catalog cannot disagree.

const GROUPS = [
  ['constraint', 'Draft constraints — rules that shape who you can pick'],
  ['objective',  'Season objectives — draft anyone, hit the target'],
  ['locked',     'Locked-legend builds — one superstar is pre-drafted for you'],
];

const indexHtml = GROUPS.map(([type, heading]) => {
  const cards = CHALLENGES.filter(c => c.type === type).map(c => {
    const slug = slugify(c.title);
    return `      <div class="challenge-card"><span class="emoji">${c.emoji}</span><div>` +
      `<p class="title"><a href="daily/${slug}.html">${esc(c.title)}</a></p>` +
      `<p class="desc">${esc(c.desc)}</p></div></div>`;
  }).join('\n');
  return `      <h3>${esc(heading)}</h3>\n${cards}`;
}).join('\n\n');

const DAILY = join(ROOT, 'daily.html');
const BEGIN = '<!-- BEGIN generated:challenge-index';
const END = '<!-- END generated:challenge-index -->';
let daily = readFileSync(DAILY, 'utf8');
const bStart = daily.indexOf(BEGIN);
const bEnd = daily.indexOf(END);
if (bStart === -1 || bEnd === -1) throw new Error('challenge-index markers missing from daily.html');
const blockOpenEnd = daily.indexOf('-->', bStart) + 3;
daily = daily.slice(0, blockOpenEnd) + '\n' + indexHtml + '\n      ' + daily.slice(bEnd);
const dailyChanged = writeIfChanged(DAILY, daily);
console.log(`Challenge index in daily.html: ${dailyChanged ? 'updated' : 'unchanged'} (${CHALLENGES.length} linked cards)`);

// ── sitemap ──────────────────────────────────────────────────────────────────

const entries = [
  { loc: `${ORIGIN}/`,           rel: 'index.html', changed: false },
  { loc: `${ORIGIN}/daily.html`, rel: 'daily.html', changed: dailyChanged },
  ...written.map(w => ({ loc: `${ORIGIN}/daily/${w.slug}.html`, rel: w.rel, changed: w.changed })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/build_challenge_pages.mjs — do not edit by hand.
     lastmod is the date each page's content last changed, not the date this
     script last ran. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${lastmodFor(e.loc, e.rel, e.changed)}</lastmod>
  </url>`).join('\n')}
</urlset>
`;
const sitemapChanged = writeIfChanged(join(ROOT, 'sitemap.xml'), sitemap);

const changedPages = written.filter(w => w.changed).length;
console.log(`\n${written.length} challenge pages (${changedPages} changed this run):`);
for (const w of written) {
  console.log(`  ${w.slug}.html`.padEnd(28) + `${String(w.days).padStart(2)} day(s) run` + (w.changed ? '   [updated]' : ''));
}
console.log(`\nsitemap.xml: ${sitemapChanged ? 'updated' : 'unchanged'} (${entries.length} URLs)`);
if (!changedPages && !dailyChanged && !sitemapChanged) console.log('Nothing changed — no commit needed.');
