# ARGION

ARGION is a planetary defense triage workspace for near-Earth objects. It pulls
live data from JPL services through a Node backend, ranks candidates with a
deterministic scoring model, and presents the results in a build-free frontend
that can run either against live data or an embedded offline sample.

At a glance, this repo gives you:

- a live Scout-backed asteroid triage queue
- per-object scoring, observability, and orbit context
- AI-assisted risk summaries and operator Q&A through Anthropic
- local snapshotting and feed sync jobs for longitudinal analysis
- a single-file browser console for demos, ops, and exploration

## Architecture

The repository has two main parts:

- `backend/`: the only layer allowed to talk directly to JPL
- `frontend/`: the standalone ARGION workbench in `index.html`

```text
Argion/
├── backend/
│   ├── src/
│   │   ├── server.js           # Express API consumed by the frontend
│   │   ├── jplClient.js        # serialized JPL client
│   │   ├── schema.js           # raw Scout -> normalized object shape
│   │   ├── scorer.js           # deterministic triage score
│   │   ├── riskAnalyzer.js     # structured AI analysis and Q&A
│   │   ├── anthropicClient.js  # Anthropic Messages API wrapper
│   │   ├── snapshotPoller.js   # rolling Scout snapshots
│   │   ├── feedSync.js         # reusable feed sync logic
│   │   ├── syncFeeds.js        # one-shot / scheduled sync CLI
│   │   └── inspectScout.js     # live schema inspection helper
│   └── data/                   # generated samples, snapshots, and feed caches
└── frontend/
    └── index.html              # self-contained ARGION UI
```

## What It Does

### Backend

The backend wraps a handful of JPL data sources and exposes them through a
controlled API:

- `scout.api`: Scout / NEOCP summary and object detail
- `sentry.api`: confirmed-object impact risk list
- `cad.api`: close approach data
- `horizons.api`: heliocentric planet elements

On top of those feeds, the backend adds:

- normalization into a stable internal asteroid shape
- a deterministic priority score
- cached API routes for the frontend
- optional Anthropic-powered risk analysis and short-form operator answers
- file-based feed snapshots for later inspection or agent workflows

### Frontend

The frontend is a single `index.html` file with no build step. It can run:

- in offline demo mode using embedded sample Scout data
- in live mode against the local backend at `http://localhost:8080`

The UI includes:

- a sortable triage queue
- score breakdowns for impact, urgency, and observability
- a sky plot
- per-object inspection and AI assessment panels
- a 3D heliocentric tracking view
- a hunting workspace with facility recommendations
- an insight tab explaining the underlying scoring and planetary-defense context

## Quick Start

### 1. Install backend dependencies

Run everything from `backend/`:

```bash
cd backend
npm install
```

### 2. Create `backend/.env`

Anthropic is optional for the core queue and JPL routes, but required for AI
analysis endpoints.

```bash
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-sonnet-4-6
PORT=8080
```

The current code reads:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `PORT`

### 3. Inspect the live Scout schema

This is the safest first run when working on parsing or scoring logic:

```bash
npm run inspect
```

It fetches the live Scout summary, prints the top-level shape, and writes a
sample payload to `backend/data/sample-scout-summary.json`.

### 4. Start the API

```bash
npm run dev
```

The backend listens on `http://localhost:8080` by default.

### 5. Open the frontend

From the repo root:

```bash
open frontend/index.html
```

When the backend is reachable, the source pill in the UI switches from
`SAMPLE DATA` to `LIVE · JPL SCOUT`.

## Common Workflows

### Frontend-only demo

Use this if you just want to show the interface with no backend running:

```bash
open frontend/index.html
```

### Live frontend + live backend

Use this for current Scout data, backend-owned scoring, object detail, and AI
analysis:

```bash
cd backend
npm install
npm run dev
```

Then open `frontend/index.html`.

### Rolling Scout snapshots

Use this to build a short historical record while you are actively developing:

```bash
cd backend
npm run poll
```

This polls the Scout summary every 3 minutes and writes:

- `backend/data/snapshots/snapshot-*.json`
- `backend/data/snapshot-index.jsonl`

### Durable feed sync

Use this to keep local copies of the main JPL feeds without hitting JPL on
every analysis run.

One immediate sync:

```bash
cd backend
npm run sync:once
```

Continuous scheduler:

```bash
cd backend
npm run sync:daily
```

By default, the sync process tracks:

- `scout`
- `sentry`
- `closeApproaches`

It writes:

- `backend/data/feeds/<feed>/latest.json`
- `backend/data/feeds/<feed>/snapshot-*.json`
- `backend/data/feed-sync-manifest.json`
- `backend/data/feed-sync-log.jsonl`

## API Overview

The frontend primarily depends on these routes:

- `GET /health`
- `GET /api/scout/summary`
- `GET /api/scout/summary/scored`
- `GET /api/scout/object/:tdes`
- `GET /api/scout/object/:tdes/orbit`
- `GET /api/scout/ephemeris/:tdes`
- `GET /api/scout/object/:tdes/analysis`
- `GET /api/scout/object/:tdes/analysis/summary/stream`
- `POST /api/scout/object/:tdes/agent`
- `GET /api/planets/elements`
- `GET /api/sentry`
- `GET /api/close-approaches`
- `GET /api/feed-sync/status`

## Frontend Notes

The frontend defaults to:

```text
http://localhost:8080
```

To point the UI at a different backend host:

```js
localStorage.setItem("argion_api", "http://your-host:8080");
location.reload();
```

Important behavior notes:

- the triage UI works offline using embedded sample data
- the Tracking view loads Three.js from a CDN, so that tab needs network unless
  you vendor the library locally
- in live mode, the queue consumes backend-scored rows from
  `/api/scout/summary/scored`

## Feed Sync Options

Run these from `backend/`.

Sync only selected feeds:

```bash
node src/syncFeeds.js --feeds=scout,sentry
```

Change the schedule:

```bash
node src/syncFeeds.js --watch --interval-hours=6
```

Force a new snapshot even if the payload did not change:

```bash
node src/syncFeeds.js --force-snapshot
```

Start the watch mode without an immediate startup sync:

```bash
node src/syncFeeds.js --watch --no-startup-sync
```

## Embedded Scheduler Mode

If you already keep the API running, you can let `server.js` host the feed sync
scheduler too:

```bash
cd backend
ENABLE_JPL_SYNC_SCHEDULER=1 npm run dev
```

Optional environment variables for this mode:

- `ENABLE_JPL_SYNC_SCHEDULER=1`
- `JPL_SYNC_INTERVAL_HOURS=24`
- `JPL_SYNC_RUN_ON_START=0`
- `JPL_CLOSE_APPROACH_DIST_MAX=10LD`
- `JPL_CLOSE_APPROACH_DATE_MIN=now`
- `JPL_CLOSE_APPROACH_SORT=dist`

## Data Outputs

Useful generated files include:

- `backend/data/sample-scout-summary.json`: captured sample from `npm run inspect`
- `backend/data/snapshots/`: frequent raw Scout snapshots
- `backend/data/snapshot-index.jsonl`: append-only polling index
- `backend/data/feeds/`: latest feed payloads and timestamped snapshots
- `backend/data/feed-sync-manifest.json`: machine-readable sync status
- `backend/data/feed-sync-log.jsonl`: append-only sync history

## Operational Caveats

Only `backend/src/jplClient.js` should talk to JPL directly. Within a single
Node process, that client serializes outbound requests to avoid needlessly
hammering the upstream APIs.

That protection does not extend across separate Node processes. If you run
multiple commands at once, they can still overlap at the network level:

- `npm run dev` and `npm run poll`
- `npm run dev` and `npm run sync:daily`
- `npm run poll` and `npm run sync:daily`

If you want stricter one-process behavior, prefer:

- `ENABLE_JPL_SYNC_SCHEDULER=1 npm run dev`
- or routing background jobs through your own backend instead of separate JPL
  callers

## Current Limitations

- storage is file-based; there is no persistent database yet
- the frontend still carries mirrored offline scoring logic so the sample mode
  can rank objects without a backend
- some hunting and planning constants are still frontend-local rather than
  backend data
- the selected-object orbit view can fall back to illustrative behavior when
  live backend detail is unavailable

## Additional Docs

- `backend/README.md`: backend-focused notes and runbook details
- `frontend/README.md`: frontend-specific UX and feature notes
