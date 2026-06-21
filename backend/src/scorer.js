// scorer.js
//
// Three-component priority score: impact relevance, urgency, observability.
// Ported from frontend/index.html so the backend is the single source of truth.

const WEIGHTS = { impact: 0.45, urgency: 0.35, observability: 0.20 };

const TIERS = [
  { id: "CRITICAL", min: 70, color: "#F2566B" },
  { id: "ELEVATED", min: 50, color: "#F2A23B" },
  { id: "ROUTINE", min: 30, color: "#4FB3D9" },
  { id: "NOMINAL", min: 0, color: "#6B7686" },
];

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export function score(ast) {
  const { H, diameterM: D, moid, caDist: ca, vInf: vinf, arc, Vmag: vmag, elong, rate, unc } = ast;
  const pha = ast.scores?.pha || 0;

  // Impact Relevance — how much it would matter if real
  const tSize = D !== null ? clamp(Math.log10(D) / 3 * 100) : 30;
  const tMoid = moid !== null ? clamp((0.05 - moid) / 0.05 * 100) : 40;
  const tCaIR = ca !== null ? clamp((20 - ca) / 20 * 100) : 30;
  const impact = clamp(0.40 * tSize + 0.25 * tMoid + 0.20 * tCaIR + 0.15 * pha);

  // Urgency — how fast the decision window is closing
  const tArc = arc !== null ? clamp((3 - arc) / 3 * 100) : 60;
  const tCaUR = ca !== null ? clamp((10 - ca) / 10 * 100) : 30;
  const tUnc = unc !== null ? clamp(Math.log10(unc + 1) / Math.log10(361) * 100) : 40;
  const tVel = vinf !== null ? clamp((vinf - 5) / 35 * 100) : 30;
  const urgency = clamp(0.40 * tArc + 0.25 * tCaUR + 0.20 * tUnc + 0.15 * tVel);

  // Observability — can we collect more data tonight
  const tMag = vmag !== null ? clamp((26 - vmag) / 9 * 100) : 25;
  const tElong = elong !== null ? clamp((elong - 20) / 160 * 100) : 40;
  const tRate = rate !== null ? clamp((20 - rate) / 20 * 100) : 60;
  const observability = clamp(0.55 * tMag + 0.30 * tElong + 0.15 * tRate);

  const total = clamp(
    WEIGHTS.impact * impact + WEIGHTS.urgency * urgency + WEIGHTS.observability * observability
  );
  const tier = TIERS.find((t) => total >= t.min);

  return {
    total: Math.round(total * 10) / 10,
    tier: tier.id,
    tierColor: tier.color,
    impact: Math.round(impact * 10) / 10,
    urgency: Math.round(urgency * 10) / 10,
    observability: Math.round(observability * 10) / 10,
    weights: WEIGHTS,
    terms: {
      impact: [["size", Math.round(tSize)], ["MOID", Math.round(tMoid)], ["approach", Math.round(tCaIR)], ["PHA", pha]],
      urgency: [["short arc", Math.round(tArc)], ["approach", Math.round(tCaUR)], ["pos. unc.", Math.round(tUnc)], ["velocity", Math.round(tVel)]],
      observability: [["brightness", Math.round(tMag)], ["elongation", Math.round(tElong)], ["sky rate", Math.round(tRate)]],
    },
  };
}

export { WEIGHTS, TIERS };
