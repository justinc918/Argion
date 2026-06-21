// jplClient.js
//
// The ONLY module allowed to talk to ssd-api.jpl.nasa.gov.
// Per the runbook's fair-use hard rules:
//   1. No direct browser calls (CORS) -> only this backend calls JPL.
//   2. One request at a time -> we serialize all outbound calls with a
//      simple mutex queue, regardless of which route triggered them.
//   3. Data format can change -> every response is logged with its raw
//      `signature`/`version` field (if present) so schema drift is visible
//      immediately instead of silently breaking the scorer downstream.

import fetch from "node-fetch";

const BASE = "https://ssd-api.jpl.nasa.gov/";

// --- serialize all JPL calls to respect "one request at a time" ---
let chain = Promise.resolve();
function serialize(fn) {
  const run = chain.then(fn, fn); // run even if previous failed
  chain = run.catch(() => {}); // don't let one failure poison the chain
  return run;
}

async function rawGet(path, params = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  return serialize(async () => {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "planetary-defense-triage-hackathon/0.1" },
    });
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error(`[jplClient] non-JSON response from ${url}`, text.slice(0, 300));
      throw new Error(`JPL ${path} returned non-JSON (status ${res.status})`);
    }

    // Schema drift canary: log version/signature so we notice if JPL changes shape.
    if (json && json.signature) {
      console.log(`[jplClient] ${path} signature:`, JSON.stringify(json.signature));
    }

    if (!res.ok) {
      console.error(`[jplClient] ${path} HTTP ${res.status}`, json);
      throw new Error(`JPL ${path} failed: HTTP ${res.status}`);
    }

    return json;
  });
}

export { rawGet };

export function getScoutSummary() {
  return rawGet("scout.api");
}

export function getScoutObject(tdes, { orbits = false } = {}) {
  const params = { tdes };
  if (orbits) params.orbits = 1;
  return rawGet("scout.api", params);
}

export function getScoutEphemeris(tdes, { obscode, ephStart = "now", ephStop, ephStep = "2h" } = {}) {
  const params = {
    tdes,
    "eph-start": ephStart,
    "eph-stop": ephStop,
    "eph-step": ephStep,
    obscode,
  };
  return rawGet("scout.api", params);
}

export function getSentry() {
  return rawGet("sentry.api");
}

export function getCloseApproaches({ distMax = "10LD", dateMin = "now", sort = "dist" } = {}) {
  return rawGet("cad.api", { "dist-max": distMax, "date-min": dateMin, sort });
}

export function getSbdb(des, { physPar = true } = {}) {
  return rawGet("sbdb.api", { des, "phys-par": physPar ? "true" : undefined });
}
