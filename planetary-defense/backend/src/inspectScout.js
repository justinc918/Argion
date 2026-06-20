// inspectScout.js
//
// Run this FIRST, before writing any parsing/scoring code:
//
//   npm run inspect
//
// It dumps the raw Scout summary response to stdout AND to
// backend/data/sample-scout-summary.json, so the whole team can look at
// real field names instead of trusting the runbook's guesses. The runbook
// explicitly warns the JPL data format can change -- this is how we find
// out what it actually looks like today.

import { writeFileSync, mkdirSync } from "fs";
import { getScoutSummary } from "./jplClient.js";

const OUT_DIR = new URL("../data/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log("Fetching live Scout summary from JPL...");
  const data = await getScoutSummary();

  console.log("\n=== Top-level keys ===");
  console.log(Object.keys(data));

  // Scout summary's per-object list key has varied historically
  // (e.g. "data" / "objects" / "scoutObj" depending on version) -- print
  // whatever array-shaped field we find so we don't hardcode a guess.
  const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
  if (arrayKey) {
    const list = data[arrayKey];
    console.log(`\n=== Found object list under key "${arrayKey}" (length ${list.length}) ===`);
    if (list.length > 0) {
      console.log("First object's fields:");
      console.log(Object.keys(list[0]));
      console.log("\nFirst object, full:");
      console.log(JSON.stringify(list[0], null, 2));
    }
  } else {
    console.log("\nNo array field found at top level -- inspect the full dump below.");
  }

  const outPath = new URL("sample-scout-summary.json", OUT_DIR);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nFull response written to ${outPath.pathname}`);
  console.log("Look at this file as a team before agreeing on the parsed schema.");
}

main().catch((err) => {
  console.error("Inspection failed:", err.message);
  process.exit(1);
});
