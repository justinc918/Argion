// snapshotPoller.js
//
// Standalone process, separate from server.js. Run this in its own
// terminal/tab starting at hour 0 so snapshots accrue all day, regardless
// of whether the rest of the stack is built yet:
//
//   npm run poll
//
// Per the runbook (section 3): real historical NEOCP outcomes are the
// ideal labels for the "will this be lost" classifier, but assembling them
// takes longer than 24h. The pragmatic path is to poll the Scout summary
// every few minutes and snapshot it to disk, so that by hour 13-16 you have
// a small real longitudinal dataset of which objects persisted vs dropped
// off the list. This script does ONLY that -- no scoring, no parsing,
// just timestamped raw dumps. Keep it that way so it can't break and lose
// data partway through the day.
//
// NOTE: this process calls JPL directly via jplClient.js, which serializes
// requests internally. If server.js is ALSO running and polling on its own
// cache, that's still fine -- jplClient's queue serializes across both
// processes' calls only if they share a process. They don't here (two
// separate node processes), so in practice you get up to 2 concurrent JPL
// calls if both happen to fire at once. For a hackathon this is an
// acceptable risk, but if you want to be strict about "one request at a
// time" across the whole system, have server.js read snapshots from disk
// instead of calling JPL itself, OR have the poller hit your own
// /api/scout/summary endpoint instead of JPL directly. The latter is a
// 2-line change (see ALTERNATE MODE below) and is the safer choice once
// server.js exists.

import { writeFileSync, mkdirSync, appendFileSync, existsSync } from "fs";
import { getScoutSummary } from "./jplClient.js";

const POLL_INTERVAL_MS = 3 * 60_000; // every 3 minutes; adjust if you want denser data
const DATA_DIR = new URL("../data/snapshots/", import.meta.url);
const INDEX_FILE = new URL("../data/snapshot-index.jsonl", import.meta.url);

mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(INDEX_FILE)) writeFileSync(INDEX_FILE, "");

function findObjectList(data) {
  const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
  return arrayKey ? data[arrayKey] : [];
}

// Best-effort designation extractor -- field name TBD until someone runs
// inspectScout.js and confirms it (likely "objectName" or "tdes" or similar).
// Update this once the real field is confirmed; until then we fall back
// through a few likely candidates so the poller doesn't crash on day one.
function extractId(obj) {
  return obj.tdes || obj.objectName || obj.des || obj.name || JSON.stringify(obj).slice(0, 40);
}

async function pollOnce() {
  const timestamp = new Date().toISOString();
  try {
    const data = await getScoutSummary();
    const list = findObjectList(data);
    const ids = list.map(extractId);

    const filename = `snapshot-${timestamp.replace(/[:.]/g, "-")}.json`;
    writeFileSync(new URL(filename, DATA_DIR), JSON.stringify(data, null, 2));

    appendFileSync(
      INDEX_FILE,
      JSON.stringify({ timestamp, count: list.length, ids, file: filename }) + "\n"
    );

    console.log(`[${timestamp}] snapshot saved: ${list.length} objects -> ${filename}`);
  } catch (err) {
    // Log and continue -- one failed poll shouldn't kill the whole day's
    // data collection.
    appendFileSync(INDEX_FILE, JSON.stringify({ timestamp, error: err.message }) + "\n");
    console.error(`[${timestamp}] poll failed:`, err.message);
  }
}

console.log(`Starting snapshot poller -- every ${POLL_INTERVAL_MS / 1000}s.`);
console.log(`Snapshots -> ${DATA_DIR.pathname}`);
console.log(`Index (one line per poll, for quick scanning) -> ${INDEX_FILE.pathname}`);

pollOnce();
setInterval(pollOnce, POLL_INTERVAL_MS);
