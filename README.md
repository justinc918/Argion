# asteROIDED

`asteROIDED` is a near-Earth object triage workspace. It pulls data from JPL's
small-body / NEO services, keeps local snapshots of key feeds, and presents a
single-file operations console for reviewing and ranking candidate risks.

The current repo has two active parts:

- `backend/` -- the only code allowed to query JPL directly
- `frontend/` -- a browser-based triage console with offline sample data and
  optional live backend integration

## Repository layout

```text
asteROIDED/
├── backend/
│   ├── src/
│   │   ├── jplClient.js        # serialized JPL HTTP client
│   │   ├── server.js           # Express API for frontend / agents
│   │   ├── snapshotPoller.js   # frequent Scout snapshot collector
│   │   ├── feedSync.js         # reusable scheduled feed sync layer
│   │   ├── syncFeeds.js        # CLI for one-shot / scheduled sync jobs
│   │   └── inspectScout.js     # schema inspection helper
│   └── data/                   # generated sample data and snapshots
└── frontend/
    └── index.html              # single-file triage UI
```

## What the system does

The backend queries JPL feeds and exposes them to the rest of the project in a
controlled way:

- `scout.api` for JPL Scout / NEOCP summary data
- `sentry.api` for confirmed-object impact risk data
- `cad.api` for close-approach context

The frontend consumes that data and provides:

- a sortable triage queue
- a visible scoring breakdown
- a sky plot for quick spatial review
- an inspector for per-object metrics

## Prerequisites

- Node.js installed locally
- npm available
- network access to `https://ssd-api.jpl.nasa.gov/`

This shell does not currently have `node` available, so if you are setting up a
new environment, confirm your runtime first:

```bash
node --version
npm --version
```

## Quick start

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Inspect the live Scout schema

Run this before building parsing or ranking logic that assumes field names:

```bash
npm run inspect
```

What it does:

- fetches the current `scout.api` payload from JPL
- prints top-level keys and the first object shape
- writes a local sample to `backend/data/sample-scout-summary.json`

### 3. Start the backend API

```bash
npm run dev
```

The backend listens on `http://localhost:8080` by default.

Useful endpoints:

- `GET /health`
- `GET /api/scout/summary`
- `GET /api/scout/object/:tdes`
- `GET /api/scout/ephemeris/:tdes`
- `GET /api/sentry`
- `GET /api/close-approaches`
- `GET /api/feed-sync/status`

### 4. Open the frontend

From the repo root, open:

```bash
open frontend/index.html
```

The frontend works in two modes:

- offline demo mode using the embedded sample payload
- live mode using `http://localhost:8080/api/scout/summary`

When the backend is reachable, the source indicator in the UI flips from
`SAMPLE DATA` to `LIVE · JPL SCOUT`.

If you want to point the UI at another backend host:

```js
localStorage.setItem("asteroided_api", "http://your-host:8080");
location.reload();
```

## Usage patterns

### A. Frontend demo only

Use this when you want to show the interface without any backend running.

```bash
open frontend/index.html
```

### B. Live frontend + live backend

Use this when you want current JPL Scout data in the UI.

```bash
cd backend
npm install
npm run dev
```

Then open `frontend/index.html` in the browser.

### C. Frequent Scout snapshots during active development

Use this when you want short-interval historical snapshots for model training,
trend detection, or "what changed today" analysis.

```bash
cd backend
npm run poll
```

What it writes:

- `backend/data/snapshots/snapshot-*.json`
- `backend/data/snapshot-index.jsonl`

The current poll interval is 3 minutes.

### D. Scheduled daily feed syncs

Use this when you want a durable local copy of the main JPL feeds for an
agent/model pipeline without querying JPL on every run.

One immediate sync:

```bash
cd backend
npm run sync:once
```

Continuous daily scheduler:

```bash
cd backend
npm run sync:daily
```

The scheduled sync tracks three feeds by default:

- `scout`
- `sentry`
- `closeApproaches`

Generated outputs:

- `backend/data/feeds/<feed>/latest.json`
- `backend/data/feeds/<feed>/snapshot-*.json`
- `backend/data/feed-sync-manifest.json`
- `backend/data/feed-sync-log.jsonl`

The sync layer hashes each payload, records the last successful check, and only
writes a new timestamped snapshot when the payload changes unless you force it.

## Feed sync commands

Run from `backend/`.

Sync all configured feeds once:

```bash
npm run sync:once
```

Sync only a subset:

```bash
node src/syncFeeds.js --feeds=scout,sentry
```

Run on a custom interval:

```bash
node src/syncFeeds.js --watch --interval-hours=6
```

Force a snapshot even if the data hash is unchanged:

```bash
node src/syncFeeds.js --force-snapshot
```

Start the scheduler without an immediate startup run:

```bash
node src/syncFeeds.js --watch --no-startup-sync
```

## Running the scheduler inside the API server

If you already keep `server.js` alive, you can embed the daily sync job in that
same Node process:

```bash
cd backend
ENABLE_JPL_SYNC_SCHEDULER=1 npm run dev
```

Optional environment variables:

- `ENABLE_JPL_SYNC_SCHEDULER=1`
  Enables the built-in scheduler.
- `JPL_SYNC_INTERVAL_HOURS=24`
  Sets the scheduler interval for the embedded mode.
- `JPL_SYNC_RUN_ON_START=0`
  Waits until the first interval before the first sync.
- `JPL_CLOSE_APPROACH_DIST_MAX=10LD`
  Overrides the `cad.api` distance filter.
- `JPL_CLOSE_APPROACH_DATE_MIN=now`
  Overrides the `cad.api` minimum date.
- `JPL_CLOSE_APPROACH_SORT=dist`
  Overrides the `cad.api` sort mode.

## Data files and what they mean

- `backend/data/sample-scout-summary.json`
  A captured sample Scout payload used for schema inspection and local testing.
- `backend/data/snapshots/`
  Short-interval raw Scout snapshots from `snapshotPoller.js`.
- `backend/data/snapshot-index.jsonl`
  One JSON line per poll run with object counts and IDs.
- `backend/data/feeds/`
  Feed-specific latest payloads and timestamped change snapshots.
- `backend/data/feed-sync-manifest.json`
  Machine-readable status file for agents or monitoring.
- `backend/data/feed-sync-log.jsonl`
  Append-only history of sync attempts and changes.

## Operational notes

### JPL request discipline

The repo is intentionally structured so only `backend/src/jplClient.js` talks to
JPL directly. That client serializes outbound requests within a single Node
process to reduce the chance of hammering the API.

### Multi-process caveat

If you run multiple Node processes at once, they do not share the same in-memory
request queue. That means these combinations can still overlap:

- `npm run dev` plus `npm run poll`
- `npm run dev` plus `npm run sync:daily`
- `npm run poll` plus `npm run sync:daily`

If strict one-at-a-time JPL access matters, prefer:

- one backend process with `ENABLE_JPL_SYNC_SCHEDULER=1 npm run dev`
- or routing background jobs through your own backend endpoints instead of
  hitting JPL directly from separate processes

## Current limitations

- The ranking logic is still frontend-side; there is no backend `scorer.js` yet.
- There is no normalized internal schema module yet.
- There is no persistent database; storage is currently file-based snapshots.
- Runtime verification could not be performed in this shell because `node` is
  not installed here.

## Suggested next implementation steps

1. Move the scoring model into `backend/src/scorer.js` so ranking has a single
   source of truth.
2. Add a schema normalization layer that maps raw JPL fields into a stable
   internal object shape.
3. Persist normalized objects and score history in a real datastore if you need
   longitudinal querying beyond flat files.
4. Add alerting on feed changes, newly risky objects, or rising scores.

## Backend-specific notes

The backend-specific README remains at [backend/README.md](/Users/24williamz/Projects/asteROIDED/backend/README.md:1) if you want implementation details for the service layer only.
