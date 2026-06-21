# Backend

The only thing in this repo allowed to talk to `ssd-api.jpl.nasa.gov`.
Everything else (frontend, agent layer) talks to **this server**, never to JPL directly.

## Run order (do this first, today)

```bash
npm install

# 1. Confirm what the live data actually looks like. Run this BEFORE
#    writing/trusting any parsing or scoring code -- field names in the
#    runbook are best guesses, not guarantees.
npm run inspect

# 2. Start the snapshot poller in its own terminal tab. Leave it running
#    all day in the background -- this is what gives the (optional) ML
#    model something to train on later.
npm run poll

# 3. Start the API server the frontend will actually talk to.
npm run dev
```

## Scheduled feed syncing

If you want a durable local copy of the JPL feeds for an agent/model to read
without hitting JPL on every prompt, use the feed sync scripts:

```bash
# one immediate sync of all configured feeds
npm run sync:once

# keep a process alive that re-checks the feeds every 24 hours
npm run sync:daily
```

This sync job snapshots three feeds by default:

- `scout` -- NEOCP / Scout summary (`scout.api`)
- `sentry` -- confirmed-object impact risk list (`sentry.api`)
- `closeApproaches` -- close approach feed (`cad.api`)

Generated files land under `backend/data/feeds/`:

- `feeds/<feed>/latest.json` -- latest changed payload for that feed
- `feeds/<feed>/snapshot-*.json` -- timestamped snapshots written only when
  the payload changed
- `feed-sync-manifest.json` -- last-checked / last-changed timestamps, hashes,
  record counts, and snapshot paths
- `feed-sync-log.jsonl` -- append-only sync history, one JSON line per check

Useful options:

```bash
# only sync Scout + Sentry once
node src/syncFeeds.js --feeds=scout,sentry

# change the schedule to every 6 hours
node src/syncFeeds.js --watch --interval-hours=6

# write a fresh snapshot even if the payload hash has not changed
node src/syncFeeds.js --force-snapshot
```

If you already keep `server.js` alive, you can also let the backend process
run the scheduler itself:

```bash
ENABLE_JPL_SYNC_SCHEDULER=1 npm run dev
```

Optional env vars:

- `JPL_SYNC_INTERVAL_HOURS` -- scheduler interval when embedded in `server.js`
- `JPL_SYNC_RUN_ON_START=0` -- wait until the first interval before syncing
- `JPL_CLOSE_APPROACH_DIST_MAX`, `JPL_CLOSE_APPROACH_DATE_MIN`,
  `JPL_CLOSE_APPROACH_SORT` -- override the `cad.api` query

## What's here

- `jplClient.js` -- the ONLY module that calls JPL. Serializes requests
  (fair-use rule: one at a time) and logs the response `signature` field
  so schema drift is visible immediately.
- `cache.js` -- dumb in-memory TTL cache, no DB. Keeps us from re-hitting
  JPL faster than ~60s on the summary endpoint.
- `server.js` -- Express proxy. Routes: `/api/scout/summary`,
  `/api/scout/object/:tdes`, `/api/scout/ephemeris/:tdes`, `/api/sentry`,
  `/api/close-approaches`. This is what the frontend calls.
- `snapshotPoller.js` -- standalone process, polls Scout summary every 3 min
  and writes timestamped JSON to `data/snapshots/`, plus a `data/snapshot-index.jsonl`
  one-liner-per-poll for quick scanning. Independent of `server.js` -- start
  it immediately, don't wait for the rest of the stack.
- `inspectScout.js` -- one-shot script, dumps a real Scout summary response
  to console + `data/sample-scout-summary.json` so the team can agree on
  field names before building a schema around guesses.
- `feedSync.js` / `syncFeeds.js` -- reusable JPL feed sync layer for periodic
  update checks and local feed snapshots.

## Not built yet (next steps)

- `schema.js` -- parse raw Scout fields into the clean internal schema the
  team agrees on after looking at `data/sample-scout-summary.json`.
- `scorer.js` -- the three-component priority score (impact relevance /
  urgency / observability) with per-term breakdown.

## A known rough edge, worth knowing about

`snapshotPoller.js` and `server.js` are separate Node processes and each
has its own `jplClient.js` request queue. That means if both happen to
fire at the exact same moment, JPL could see 2 concurrent requests instead
of strictly 1. For a hackathon this is a fine risk to accept. If you want
it stricter, point the poller at your own `/api/scout/summary` endpoint
instead of calling JPL directly -- see the comment at the top of
`snapshotPoller.js`.

The same caveat applies if you run `npm run sync:daily` as a separate process
while `server.js` is also live. If you want strict one-at-a-time behavior
across API traffic and scheduled syncs, prefer the embedded scheduler via
`ENABLE_JPL_SYNC_SCHEDULER=1 npm run dev`.
