import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { getCloseApproaches, getScoutSummary, getSentry } from "./jplClient.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

const DATA_DIR = new URL("../data/", import.meta.url);
const FEEDS_DIR = new URL("../data/feeds/", import.meta.url);
const MANIFEST_FILE = new URL("../data/feed-sync-manifest.json", import.meta.url);
const LOG_FILE = new URL("../data/feed-sync-log.jsonl", import.meta.url);

const FEED_DEFS = {
  scout: {
    description: "JPL Scout NEOCP summary",
    fetch: () => getScoutSummary(),
    query: () => ({}),
  },
  sentry: {
    description: "JPL Sentry impact risk feed",
    fetch: () => getSentry(),
    query: () => ({}),
  },
  closeApproaches: {
    description: "JPL close-approach feed",
    fetch: () =>
      getCloseApproaches({
        distMax: process.env.JPL_CLOSE_APPROACH_DIST_MAX || "10LD",
        dateMin: process.env.JPL_CLOSE_APPROACH_DATE_MIN || "now",
        sort: process.env.JPL_CLOSE_APPROACH_SORT || "dist",
      }),
    query: () => ({
      distMax: process.env.JPL_CLOSE_APPROACH_DIST_MAX || "10LD",
      dateMin: process.env.JPL_CLOSE_APPROACH_DATE_MIN || "now",
      sort: process.env.JPL_CLOSE_APPROACH_SORT || "dist",
    }),
  },
};

function ensureStorage() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(FEEDS_DIR, { recursive: true });
}

function feedDir(feedName) {
  return new URL(`./${feedName}/`, FEEDS_DIR);
}

function jsonOr(defaultValue, fileUrl) {
  if (!existsSync(fileUrl)) return defaultValue;

  try {
    return JSON.parse(readFileSync(fileUrl, "utf8"));
  } catch (err) {
    console.warn(`[feedSync] failed to parse ${fileUrl.pathname}: ${err.message}`);
    return defaultValue;
  }
}

function writeJson(fileUrl, value) {
  writeFileSync(fileUrl, JSON.stringify(value, null, 2) + "\n");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item) ?? "null").join(",")}]`;
  }

  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();

  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function payloadHash(data) {
  return createHash("sha256").update(stableStringify(data)).digest("hex");
}

function extractRecordCount(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.data)) return data.data.length;
  if (typeof data.count === "number") return data.count;
  if (typeof data.count === "string" && !Number.isNaN(Number(data.count))) return Number(data.count);

  const firstArrayKey = Object.keys(data).find((key) => Array.isArray(data[key]));
  return firstArrayKey ? data[firstArrayKey].length : null;
}

function buildEmptyManifest() {
  return {
    version: 1,
    updatedAt: null,
    feeds: {},
  };
}

function appendLogEntry(entry) {
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

function snapshotFileName(timestamp) {
  return `snapshot-${timestamp.replace(/[:.]/g, "-")}.json`;
}

function relativeFeedPath(feedName, fileName) {
  return `feeds/${feedName}/${fileName}`;
}

function summarizeFeedResult(result) {
  if (!result.ok) return `${result.feed}: ERROR (${result.error})`;
  return `${result.feed}: ${result.changed ? "updated" : "unchanged"} (${result.recordCount ?? "?"} records)`;
}

export function listFeeds() {
  return Object.keys(FEED_DEFS);
}

export function readFeedSyncStatus() {
  return jsonOr(buildEmptyManifest(), MANIFEST_FILE);
}

async function syncOneFeed(feedName, manifest, { forceSnapshot = false } = {}) {
  const definition = FEED_DEFS[feedName];
  if (!definition) throw new Error(`Unknown feed "${feedName}"`);

  const checkedAt = new Date().toISOString();
  const previous = manifest.feeds[feedName] || {};
  const query = definition.query();
  const data = await definition.fetch();
  const hash = payloadHash(data);
  const changed = previous.hash !== hash;
  const snapshotWritten = forceSnapshot || changed;
  const recordCount = extractRecordCount(data);
  const signature = data && typeof data === "object" ? data.signature || null : null;
  const dir = feedDir(feedName);
  const latestFile = "latest.json";
  const latestFileUrl = new URL(latestFile, dir);
  let latestSnapshotFile = previous.latestSnapshotFile || null;

  mkdirSync(dir, { recursive: true });

  if (snapshotWritten) {
    const snapshot = snapshotFileName(checkedAt);
    writeJson(new URL(snapshot, dir), data);
    latestSnapshotFile = relativeFeedPath(feedName, snapshot);
  }

  if (snapshotWritten || !existsSync(latestFileUrl)) {
    writeJson(latestFileUrl, data);
  }

  const entry = {
    feed: feedName,
    ok: true,
    description: definition.description,
    query,
    lastCheckedAt: checkedAt,
    lastChangedAt: changed ? checkedAt : previous.lastChangedAt || null,
    lastFailedAt: null,
    lastError: null,
    changed,
    snapshotWritten,
    hash,
    recordCount,
    signature,
    latestFile: relativeFeedPath(feedName, latestFile),
    latestSnapshotFile,
  };

  manifest.feeds[feedName] = entry;
  appendLogEntry({
    timestamp: checkedAt,
    feed: feedName,
    ok: true,
    changed,
    snapshotWritten,
    recordCount,
    signature,
    hash,
    latestSnapshotFile,
    query,
  });

  return entry;
}

export async function syncFeeds({
  feeds = listFeeds(),
  forceSnapshot = false,
} = {}) {
  ensureStorage();

  const manifest = readFeedSyncStatus();
  const startedAt = new Date().toISOString();
  const results = [];

  for (const feedName of feeds) {
    try {
      results.push(await syncOneFeed(feedName, manifest, { forceSnapshot }));
    } catch (err) {
      const checkedAt = new Date().toISOString();
      const definition = FEED_DEFS[feedName];
      const previous = manifest.feeds[feedName] || {};
      const query = definition?.query?.() || {};
      const failure = {
        feed: feedName,
        ok: false,
        description: definition?.description || "Unknown feed",
        query,
        changed: false,
        snapshotWritten: false,
        lastCheckedAt: checkedAt,
        lastChangedAt: previous.lastChangedAt || null,
        lastFailedAt: checkedAt,
        lastError: err.message,
        hash: previous.hash || null,
        recordCount: previous.recordCount || null,
        signature: previous.signature || null,
        latestFile: previous.latestFile || null,
        latestSnapshotFile: previous.latestSnapshotFile || null,
      };

      manifest.feeds[feedName] = failure;
      appendLogEntry({
        timestamp: checkedAt,
        feed: feedName,
        ok: false,
        error: err.message,
        query,
      });
      results.push(failure);
    }
  }

  const finishedAt = new Date().toISOString();
  manifest.updatedAt = finishedAt;
  writeJson(MANIFEST_FILE, manifest);

  return {
    ok: results.every((result) => result.ok),
    startedAt,
    finishedAt,
    results,
  };
}

export function formatSyncSummary(result) {
  return `[feedSync] ${result.results.map(summarizeFeedResult).join(" | ")}`;
}

export function startScheduledFeedSync({
  feeds = listFeeds(),
  intervalMs = DAY_MS,
  runOnStart = true,
  forceSnapshot = false,
  unrefTimer = false,
  logger = console,
} = {}) {
  let running = false;

  async function run(reason = "manual") {
    if (running) {
      logger.warn(`[feedSync] skipped ${reason} run; previous sync still active`);
      return { ok: false, skipped: true, reason };
    }

    running = true;
    try {
      const result = await syncFeeds({ feeds, forceSnapshot });
      logger.log(`${formatSyncSummary(result)} [${reason}]`);
      return result;
    } catch (err) {
      logger.error(`[feedSync] ${reason} run failed: ${err.message}`);
      return { ok: false, error: err.message };
    } finally {
      running = false;
    }
  }

  if (runOnStart) {
    void run("startup");
  }

  const timer = setInterval(() => {
    void run("interval");
  }, intervalMs);

  if (unrefTimer) {
    timer.unref?.();
  }
  logger.log(
    `[feedSync] scheduler active for ${feeds.join(", ")} every ${Math.round(intervalMs / 60000)} minutes`
  );

  return {
    run,
    stop() {
      clearInterval(timer);
    },
  };
}
