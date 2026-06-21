function num(value) {
  if (value === null || value === undefined || value === "" || value === "NULL") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeScoutOrbitRow(row, fields) {
  const record = Object.fromEntries(fields.map((field, idx) => [field, row[idx] ?? null]));
  const a = num(record.qr) !== null && num(record.ec) !== null ? num(record.qr) / (1 - num(record.ec)) : null;

  return {
    idx: num(record.idx),
    epochJdTdb: num(record.epoch),
    e: num(record.ec),
    q: num(record.qr),
    a,
    tp: num(record.tp),
    Om: num(record.om),
    w: num(record.w),
    i: num(record.inc),
    H: num(record.H),
    dca: num(record.dca),
    tca: num(record.tca),
    moid: num(record.moid),
    vinf: num(record.vinf),
    geoEcc: num(record.geoEcc),
    impFlag: num(record.impFlag),
    periodDays: a !== null ? Math.pow(a, 1.5) * 365.25 : null,
  };
}

export function representativeScoutOrbit(raw) {
  const orbitData = raw?.orbits?.data;
  const fields = raw?.orbits?.fields;
  if (!Array.isArray(orbitData) || !Array.isArray(fields) || orbitData.length === 0) {
    return null;
  }

  const exactImpact = orbitData.find((row) => num(row[fields.indexOf("impFlag")]) === 1);
  const best = exactImpact || orbitData[0];
  return normalizeScoutOrbitRow(best, fields);
}
