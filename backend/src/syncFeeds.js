import { DAY_MS, formatSyncSummary, listFeeds, startScheduledFeedSync, syncFeeds } from "./feedSync.js";

function parseArgs(argv) {
  const options = {
    watch: false,
    runOnStart: true,
    forceSnapshot: false,
    feeds: listFeeds(),
    intervalMs: DAY_MS,
  };

  for (const arg of argv) {
    if (arg === "--watch") {
      options.watch = true;
      continue;
    }

    if (arg === "--no-startup-sync") {
      options.runOnStart = false;
      continue;
    }

    if (arg === "--force-snapshot") {
      options.forceSnapshot = true;
      continue;
    }

    if (arg.startsWith("--feeds=")) {
      options.feeds = arg
        .slice("--feeds=".length)
        .split(",")
        .map((feed) => feed.trim())
        .filter(Boolean);
      continue;
    }

    if (arg.startsWith("--interval-hours=")) {
      const hours = Number(arg.slice("--interval-hours=".length));
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error(`Invalid --interval-hours value: ${arg}`);
      }
      options.intervalMs = hours * 60 * 60 * 1000;
      continue;
    }
  }

  return options;
}

function installSignalHandlers(stop) {
  const shutdown = (signal) => {
    console.log(`[feedSync] received ${signal}; stopping scheduler`);
    stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.watch) {
    const scheduler = startScheduledFeedSync({
      feeds: options.feeds,
      intervalMs: options.intervalMs,
      runOnStart: options.runOnStart,
      forceSnapshot: options.forceSnapshot,
    });

    installSignalHandlers(() => scheduler.stop());
    return;
  }

  const result = await syncFeeds({
    feeds: options.feeds,
    forceSnapshot: options.forceSnapshot,
  });

  console.log(formatSyncSummary(result));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[feedSync]", err.message);
  process.exit(1);
});
