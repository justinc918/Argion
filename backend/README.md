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
