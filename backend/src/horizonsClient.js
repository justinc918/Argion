import fetch from "node-fetch";

const PLANET_IDS = {
  Mercury: "199",
  Venus: "299",
  Earth: "399",
  Mars: "499",
  Jupiter: "599",
  Saturn: "699",
  Uranus: "799",
  Neptune: "899",
};

const HORIZONS_API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowUtcDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseCsvLine(line) {
  return line.split(",").map((part) => part.trim());
}

function extractHorizonsRows(resultText) {
  const start = resultText.indexOf("$$SOE");
  const end = resultText.indexOf("$$EOE");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Horizons response missing $$SOE/$$EOE block");
  }

  const headerBlock = resultText.slice(0, start).split("\n");
  let fields = null;
  for (let i = headerBlock.length - 1; i >= 0; i -= 1) {
    const line = headerBlock[i].trim();
    if (line.startsWith("JDTDB") || line.startsWith("JDTDB,")) {
      fields = parseCsvLine(line);
      break;
    }
  }

  if (!fields) {
    throw new Error("Horizons response missing CSV header");
  }

  const rows = resultText
    .slice(start + 5, end)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseCsvLine(line))
    .map((values) => {
      const row = {};
      fields.forEach((field, idx) => {
        row[field] = values[idx] ?? null;
      });
      return row;
    });

  return { fields, rows };
}

function num(value) {
  if (value === null || value === undefined || value === "" || value === "NULL") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizePlanetElements(name, row, color) {
  const a = num(row.A);
  const e = num(row.EC);
  const i = num(row.IN);
  const Om = num(row.OM);
  const w = num(row.W);
  const M0 = num(row.MA);
  const periodDays = num(row.PR);

  return {
    name,
    tint: color,
    epochJdTdb: num(row.JDTDB),
    epoch: row["Calendar Date (TDB)"] || null,
    a,
    e,
    i,
    Om,
    w,
    M0,
    periodDays,
    periodYears: periodDays !== null ? periodDays / 365.25 : null,
    q: num(row.QR),
    ad: num(row.AD),
    n: num(row.N),
    ta: num(row.TA),
    tp: num(row.Tp),
  };
}

export async function getPlanetElements(name, {
  startDate = todayUtcDate(),
  stopDate = tomorrowUtcDate(),
} = {}) {
  const command = PLANET_IDS[name];
  if (!command) {
    throw new Error(`Unknown planet "${name}"`);
  }

  const url = new URL(HORIZONS_API_URL);
  const params = {
    format: "json",
    COMMAND: `'${command}'`,
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'ELEMENTS'",
    CENTER: "'500@10'",
    START_TIME: `'${startDate}'`,
    STOP_TIME: `'${stopDate}'`,
    STEP_SIZE: "'1 d'",
    REF_PLANE: "'ECLIPTIC'",
    REF_SYSTEM: "'ICRF'",
    OUT_UNITS: "'AU-D'",
    CSV_FORMAT: "'YES'",
  };

  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "planetary-defense-triage-hackathon/0.1" },
  });
  const response = await res.json();

  if (!res.ok) {
    throw new Error(`Horizons API failed: HTTP ${res.status}`);
  }

  if (!response?.result) {
    throw new Error("Horizons response missing result text");
  }

  const { rows } = extractHorizonsRows(response.result);
  if (rows.length === 0) {
    throw new Error(`No Horizons rows returned for ${name}`);
  }

  return normalizePlanetElements(name, rows[0], null);
}

export async function getAllPlanetElements() {
  const names = Object.keys(PLANET_IDS);
  const colors = {
    Mercury: "#b4a48c",
    Venus: "#e6c98a",
    Earth: "#46c9e0",
    Mars: "#e06a4b",
    Jupiter: "#d8a878",
    Saturn: "#e8d6a0",
    Uranus: "#9fe0e0",
    Neptune: "#6f8ee8",
  };

  const results = await Promise.all(
    names.map(async (name) => {
      const planet = await getPlanetElements(name);
      return { ...planet, tint: colors[name] };
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    data: results,
  };
}
