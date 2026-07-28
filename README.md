# Can You Go 14-0? — Free IPL Team Generator & All-Time Roster Builder

**Can You Go 14-0?** is a free **IPL team generator** and **all-time roster builder**
that runs entirely in your browser. Spin the draft wheel — a random **IPL team generator**
that deals you a franchise and an era on every spin — draft legends from every era,
build team chemistry, pick your captain, then run the **14-match season simulator** with one
question on the line: **can you go 14-0?**

No sign-up, no download, no build step.

## How to play

1. **Spin the wheel** — the generator lands on a franchise + era combo (say, '16-19 RCB or '20-22 Mumbai Indians) and shows you that squad's players.
2. **Draft your starting five** — pick one player per round across all five slots (Opener, Middle-order, Wicketkeeper, Pace, Spin). Skips are limited, so spend them wisely.
3. **Build chemistry** — balance eras, roles, and playstyles; the XI's chemistry affects your results.
4. **Pick your captain** — each captain brings a different system and strategic bonus.
5. **Simulate 14 matches** — run the season simulator and chase a perfect **14-0** record.
6. **Make a run** — advance to the playoffs (Qualifier 1, Eliminator, Qualifier 2, Final), win the title, and collect legends in your trophy room.

## Features

- 🎲 **14-0 IPL team generator** — a randomized draft wheel; no two runs deal the same board
- 🏏 **All-time roster builder** — real legends from every IPL era, 2008 to today
- 📊 **Season simulator** — full 14-match simulation with real IPL-format playoffs
- 🧪 **Team chemistry engine** — era, role, and playstyle fit all matter
- 📅 **Daily Challenge** — one shared draft board and special rule per day, with streaks and a global leaderboard
- 🏆 **Trophy room & leaderboard** — track your best runs (local, plus an optional global leaderboard)
- 🌗 **Light / dark themes**, fully responsive on desktop, tablet, and mobile
- ⚡ **100% client-side** — vanilla JS ES modules, no backend

## FAQ

**What is Can You Go 14-0?**
A free IPL team generator, roster builder, and season simulator. You draft an all-time XI
of legends from every era using a randomized draft wheel, then simulate a 14-match season.
The goal — and the name — is finishing a perfect 14-0.

**How does the 14-0 IPL team generator work?**
Every spin randomly generates a franchise and an era (like '12-15 Chennai Super Kings or
'23-25 Gujarat Titans), and you draft one player from that combination. Repeat until all
five starting spots are filled.

**Is it free?**
Yes — completely free, no download, no sign-up. It runs in your browser on any device.

## Run it locally

Serve the repo root over HTTP (ES modules don't load reliably over `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works.

## Tech

Vanilla JavaScript (ES modules), HTML, and CSS — no backend and no build step to play.
Tailwind is compiled ahead of time into the committed `css/tailwind.css`; re-run
`scripts/build_tailwind.sh` after changing Tailwind classes. Firebase can power an optional
global leaderboard/analytics and degrades gracefully if unconfigured — see `js/utils/firebase.js`
for how to wire up your own Firebase project.

Generated assets have regeneration scripts: `scripts/build_favicon.sh` (favicon.ico from
`favicon.svg`) and `scripts/build_og_image.sh` (og-image.png from `og-image.svg`).

## Keywords

14-0 · can you go 14-0 · 14-0 team generator · 14-0 IPL team generator ·
IPL team generator · IPL simulator · IPL season simulator · IPL all-time roster builder ·
all-time IPL team · cricket simulator · fantasy IPL draft game

---

*Disclaimer: This is an unofficial fan-made game and is **not affiliated with, endorsed by,
or sponsored by the IPL**, the BCCI, or any franchise. All team and player names
are the property of their respective owners and are used for identification purposes only.*
