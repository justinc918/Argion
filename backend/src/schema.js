// schema.js
//
// Normalizes raw JPL Scout fields into a stable internal asteroid shape.
// Parses string numerics, derives diameter from H magnitude, and fills
// nulls consistently so downstream code never has to guess field types.

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// Estimated diameter in meters from absolute magnitude H (albedo = 0.14).
// D[km] = 1329 / sqrt(pv) * 10^(-H/5)
function diameterM(H) {
  const h = num(H);
  if (h === null) return null;
  return (1329 / Math.sqrt(0.14)) * Math.pow(10, -h / 5) * 1000;
}

export function normalize(raw) {
  const H = num(raw.H);
  const moid = num(raw.moid);
  const caDist = num(raw.caDist);
  const vInf = num(raw.vInf);
  const arc = num(raw.arc);
  const Vmag = num(raw.Vmag);
  const elong = num(raw.elong);
  const rate = num(raw.rate);
  const unc = num(raw.unc);
  const nObs = num(raw.nObs);
  const phaScore = num(raw.phaScore) || 0;
  const neoScore = num(raw.neoScore) || 0;
  const neo1kmScore = num(raw.neo1kmScore) || 0;
  const tisserandScore = num(raw.tisserandScore) || 0;
  const geocentricScore = num(raw.geocentricScore) || 0;
  const ieoScore = num(raw.ieoScore) || 0;
  const D = diameterM(H);

  return {
    designation: raw.objectName || raw.tdes || "UNKNOWN",
    H,
    diameterM: D !== null ? Math.round(D) : null,
    moid,
    caDist,
    vInf,
    arc,
    Vmag,
    elong,
    rate,
    unc,
    nObs,
    ra: raw.ra || null,
    dec: raw.dec || null,
    lastRun: raw.lastRun || null,
    rating: num(raw.rating),
    scores: {
      pha: phaScore,
      neo: neoScore,
      neo1km: neo1kmScore,
      tisserand: tisserandScore,
      geocentric: geocentricScore,
      ieo: ieoScore,
    },
  };
}
