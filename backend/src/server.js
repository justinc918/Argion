// server.js
//
// The frontend talks ONLY to this server -- never to ssd-api.jpl.nasa.gov
// directly (that's both a CORS reality and one of the runbook's hard rules).
//
//   npm run dev
//
// Routes are intentionally thin: cache + pass-through. All real parsing/
// scoring logic should live in separate modules (schema.js, scorer.js, not
// written yet) so this file stays easy to read at 2am.

import express from "express";
import cors from "cors";
import {
  getScoutSummary,
  getScoutObject,
  getScoutEphemeris,
  getSentry,
  getCloseApproaches,
} from "./jplClient.js";
import { cached } from "./cache.js";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8080;

// Scout summary: the core live feed. Cached ~60s per the fair-use rule --
// poll Scout summary once every ~60s, don't hit it per-request.
app.get("/api/scout/summary", async (req, res) => {
  try {
    const data = await cached("scout-summary", 60_000, getScoutSummary);
    res.json(data);
  } catch (err) {
    console.error("[/api/scout/summary]", err.message);
    res.status(502).json({ error: "Failed to fetch Scout summary", detail: err.message });
  }
});

// Per-object detail: lazy, only hit when a card is expanded on the frontend.
// Cached longer (5 min) since a single object's orbit detail won't churn
// minute to minute the way the summary list does.
app.get("/api/scout/object/:tdes", async (req, res) => {
  const { tdes } = req.params;
  const orbits = req.query.orbits === "1" || req.query.orbits === "true";
  try {
    const data = await cached(`scout-object:${tdes}:${orbits}`, 5 * 60_000, () =>
      getScoutObject(tdes, { orbits })
    );
    res.json(data);
  } catch (err) {
    console.error(`[/api/scout/object/${tdes}]`, err.message);
    res.status(502).json({ error: "Failed to fetch object detail", detail: err.message });
  }
});

// Ephemeris: also lazy, also cached -- this is the per-site observability call.
app.get("/api/scout/ephemeris/:tdes", async (req, res) => {
  const { tdes } = req.params;
  const { obscode, ephStart, ephStop, ephStep } = req.query;
  try {
    const data = await cached(
      `scout-eph:${tdes}:${obscode}:${ephStart}:${ephStop}:${ephStep}`,
      5 * 60_000,
      () => getScoutEphemeris(tdes, { obscode, ephStart, ephStop, ephStep })
    );
    res.json(data);
  } catch (err) {
    console.error(`[/api/scout/ephemeris/${tdes}]`, err.message);
    res.status(502).json({ error: "Failed to fetch ephemeris", detail: err.message });
  }
});

// Sentry: secondary signal, confirmed-object impact risk. Changes slowly --
// cache for 10 minutes.
app.get("/api/sentry", async (req, res) => {
  try {
    const data = await cached("sentry", 10 * 60_000, getSentry);
    res.json(data);
  } catch (err) {
    console.error("[/api/sentry]", err.message);
    res.status(502).json({ error: "Failed to fetch Sentry data", detail: err.message });
  }
});

// Close approaches: context data, also slow-changing.
app.get("/api/close-approaches", async (req, res) => {
  try {
    const data = await cached("close-approaches", 10 * 60_000, getCloseApproaches);
    res.json(data);
  } catch (err) {
    console.error("[/api/close-approaches]", err.message);
    res.status(502).json({ error: "Failed to fetch close approach data", detail: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Try: curl http://localhost:${PORT}/api/scout/summary | head -c 1000`);
});
