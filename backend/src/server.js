// server.js
//
// The frontend talks ONLY to this server -- never to ssd-api.jpl.nasa.gov
// directly (that's both a CORS reality and one of the runbook's hard rules).
//
//   npm run dev
//
// Routes are intentionally thin: cache + pass-through. Parsing and scoring
// live in dedicated modules so this file stays easy to read at 2am.

import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  getScoutSummary,
  getScoutObject,
  getScoutEphemeris,
  getSentry,
  getCloseApproaches,
} from "./jplClient.js";
import { cached, getCached, setCached } from "./cache.js";
import {
  analyzeAsteroid,
  answerClassificationQuestion,
  streamAssessmentSummary,
} from "./riskAnalyzer.js";
import { DAY_MS, readFeedSyncStatus, startScheduledFeedSync } from "./feedSync.js";
import { normalize } from "./schema.js";
import { score } from "./scorer.js";
import { getAllPlanetElements } from "./horizonsClient.js";
import { representativeScoutOrbit } from "./orbitAdapter.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

const PORT = process.env.PORT || 8080;
let schedulerStarted = false;

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function syncIntervalMs() {
  const rawHours = process.env.JPL_SYNC_INTERVAL_HOURS;
  if (!rawHours) return DAY_MS;

  const hours = Number(rawHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.warn(`[feedSync] invalid JPL_SYNC_INTERVAL_HOURS=${rawHours}; falling back to 24h`);
    return DAY_MS;
  }

  return hours * 60 * 60 * 1000;
}

function scoredScoutSummary(summary) {
  const rows = summary?.data || [];
  return {
    ...summary,
    data: rows.map((raw) => {
      const asteroid = normalize(raw);
      return {
        raw,
        asteroid,
        score: score(asteroid),
        orbit: null,
      };
    }),
  };
}

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

// Scout summary + backend-owned normalization/scoring for the triage queue.
app.get("/api/scout/summary/scored", async (req, res) => {
  try {
    const data = await cached("scout-summary-scored", 60_000, async () => {
      const summary = await cached("scout-summary", 60_000, getScoutSummary);
      return scoredScoutSummary(summary);
    });
    res.json(data);
  } catch (err) {
    console.error("[/api/scout/summary/scored]", err.message);
    res.status(502).json({ error: "Failed to fetch scored Scout summary", detail: err.message });
  }
});

app.get("/api/planets/elements", async (req, res) => {
  try {
    const data = await cached("planet-elements", 6 * 60 * 60_000, getAllPlanetElements);
    res.json(data);
  } catch (err) {
    console.error("[/api/planets/elements]", err.message);
    res.status(502).json({ error: "Failed to fetch planet elements", detail: err.message });
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

app.get("/api/scout/object/:tdes/orbit", async (req, res) => {
  const { tdes } = req.params;
  try {
    const data = await cached(`scout-orbit:${tdes}`, 5 * 60_000, async () => {
      const raw = await getScoutObject(tdes, { orbits: true });
      const orbit = representativeScoutOrbit(raw);
      if (!orbit) {
        throw new Error(`No orbit solutions returned for ${tdes}`);
      }
      return {
        designation: raw.objectName || tdes,
        orbit,
        rawSummary: {
          H: raw.H ?? null,
          vInf: raw.vInf ?? null,
          moid: raw.moid ?? null,
          caDist: raw.caDist ?? null,
          arc: raw.arc ?? null,
        },
        source: raw.signature || null,
      };
    });
    res.json(data);
  } catch (err) {
    console.error(`[/api/scout/object/${tdes}/orbit]`, err.message);
    res.status(502).json({ error: "Failed to fetch Scout orbit", detail: err.message });
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

// LLM risk analysis: lazy per-object, cached 15 minutes.
// Fetches the object's raw data from the Scout summary cache, then runs
// through schema → scorer → Sonnet for a structured assessment.
app.get("/api/scout/object/:tdes/analysis", async (req, res) => {
  const { tdes } = req.params;
  const cacheKey = `analysis:${tdes}`;
  try {
    const hit = getCached(cacheKey);
    if (hit !== undefined) { res.json(hit); return; }

    const summary = await cached("scout-summary", 60_000, getScoutSummary);
    const rows = summary?.data || [];
    const raw = rows.find((r) => r.objectName === tdes);
    if (!raw) {
      res.status(404).json({ error: "Not found", detail: `Object ${tdes} not in current Scout summary` });
      return;
    }

    const result = await analyzeAsteroid(raw);
    const ttl = result.analysisError ? 60_000 : 15 * 60_000;
    setCached(cacheKey, result, ttl);
    res.json(result);
  } catch (err) {
    console.error(`[/api/scout/object/${tdes}/analysis]`, err.message);
    res.status(502).json({ error: "Analysis failed", detail: err.message });
  }
});

// Streamed assessment summary: text-only, progressive delivery via SSE.
// If a cached full analysis exists, short-circuits with the stored summary.
app.get("/api/scout/object/:tdes/analysis/summary/stream", async (req, res) => {
  const { tdes } = req.params;
  try {
    const cached_analysis = getCached(`analysis:${tdes}`);
    if (cached_analysis?.analysis?.assessmentSummary) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ text: cached_analysis.analysis.assessmentSummary, done: true })}\n\n`);
      res.end();
      return;
    }

    const summary = await cached("scout-summary", 60_000, getScoutSummary);
    const rows = summary?.data || [];
    const raw = rows.find((r) => r.objectName === tdes);
    if (!raw) {
      res.status(404).json({ error: "Not found", detail: `Object ${tdes} not in current Scout summary` });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let aborted = false;
    req.on("close", () => { aborted = true; });

    await streamAssessmentSummary(raw, (chunk) => {
      if (aborted) return;
      res.write(`data: ${JSON.stringify({ text: chunk, done: false })}\n\n`);
    });

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ text: "", done: true })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error(`[/api/scout/object/${tdes}/analysis/summary/stream]`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "Stream failed", detail: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
      res.end();
    }
  }
});

// Free-form Classification Agent answer: same selected-object context as the
// hunting panel, plus backend Scout/scoring data, sent through Anthropic.
app.post("/api/scout/object/:tdes/agent", async (req, res) => {
  const { tdes } = req.params;
  const question = String(req.body?.question || "").trim();
  const frontendContext = req.body?.context || null;

  if (!question) {
    res.status(400).json({ error: "Question required", detail: "Provide a non-empty question in the request body." });
    return;
  }

  try {
    const summary = await cached("scout-summary", 60_000, getScoutSummary);
    const rows = summary?.data || [];
    const raw = rows.find((r) => r.objectName === tdes);
    if (!raw) {
      res.status(404).json({ error: "Not found", detail: `Object ${tdes} not in current Scout summary` });
      return;
    }

    const result = await answerClassificationQuestion({
      rawData: raw,
      question,
      frontendContext,
    });
    res.json(result);
  } catch (err) {
    console.error(`[/api/scout/object/${tdes}/agent]`, err.message);
    res.status(502).json({ error: "Agent request failed", detail: err.message });
  }
});

app.get("/api/feed-sync/status", (req, res) => {
  res.json(readFeedSyncStatus());
});

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Try: curl http://localhost:${PORT}/api/scout/summary | head -c 1000`);

  if (!schedulerStarted && envFlag("ENABLE_JPL_SYNC_SCHEDULER")) {
    startScheduledFeedSync({
      intervalMs: syncIntervalMs(),
      runOnStart: envFlag("JPL_SYNC_RUN_ON_START", true),
      unrefTimer: true,
    });
    schedulerStarted = true;
  }
});
