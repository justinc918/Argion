# Frontend Note — Legacy Triage Console README

This file is retained as an older note only. The current frontend is the
`Argion` multi-tab workbench documented in [frontend/README.md](/Users/24williamz/Projects/asteROIDED/frontend/README.md:1).

The information below describes an earlier frontend state and should not be
treated as the current source of truth.

# Frontend — Triage Console

Single-file, dependency-free demo UI for the planetary-defense NEO triage stack.
Palantir/Gotham-style ops layout: watch-floor stats + all-sky plot (left),
sortable triage queue (center), per-object score inspector (right).

## Run it

**As a demo, no backend needed** — just open the file:

```bash
open frontend/index.html        # macOS
# or double-click it in a file browser
```

It ships with a baked-in NASA/JPL Scout sample (51 objects) so it works offline.

**Against the live backend** — start the backend, then reload the page:

```bash
cd backend && npm install && npm run dev   # serves http://localhost:8080
```

The page auto-detects the backend at `http://localhost:8080/api/scout/summary`.
The source pill in the top bar flips from `SAMPLE DATA` to `LIVE · JPL SCOUT`.
To point at a different host, set it once in the browser console:

```js
localStorage.setItem("asteroided_api", "http://your-host:8080"); location.reload();
```

## The scoring model is a stand-in for `backend/src/scorer.js`

The runbook lists `scorer.js` (the impact / urgency / observability priority
score) as **not built yet**. This UI implements that model client-side, fully
transparent, in section `1 · SCORING MODEL` of `index.html`:

- `WEIGHTS` — the three top-level component weights
- `TIERS` — score thresholds → CRITICAL / ELEVATED / ROUTINE / NOMINAL
- `score(o)` — three 0–100 components, each a weighted blend of named terms
- `rationale(o,s)` — the plain-English assessment line

Everything is intentionally legible so it maps 1:1 onto a real backend module.
The weights, term formulas, and tier thresholds are **demo calibrations** —
expect to tune them against real data.

## Suggested next steps (Claude Code)

- Move `score()` + `WEIGHTS` into `backend/src/scorer.js` so the score has a
  single source of truth, then have the frontend render pre-scored objects.
- Split this file into `index.html` / `app.js` / `styles.css` / `sample.js`
  if/when it grows past a quick demo.
- Add object drill-down using the backend's existing
  `/api/scout/object/:tdes` and `/api/scout/ephemeris/:tdes` routes
  (per-site observability is a natural inspector tab).
- Diff against `data/snapshots/` from `snapshotPoller.js` to flag *new* and
  *rising-priority* objects on the watch floor.
