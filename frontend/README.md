# Argion — Planetary Defense Workbench

Single-file, build-free demo UI for the planetary-defense NEO triage stack.
Palantir / Gotham-style instrument panel. Open `index.html` directly in a
browser (double-click) or serve it from anything. It auto-detects the backend
at `http://localhost:8080`; if that's unreachable it falls back to an embedded
51-object Scout sample so the demo always renders.

**Branding.** The Argion mark — an aperture "eye" over a wireframe globe with
tracked NEO sparkles — is embedded directly in `index.html` as an inline SVG
(topbar + favicon), so the app stays a single self-contained file. The original
high-res raster lives at `argion_primary_4096.png` as the canonical asset for
decks, READMEs, and app icons.

## Tabs

**Triage** — the watch floor. Watch-floor stats + all-sky RA/Dec plot (left),
sortable/filterable triage queue (center), and a per-object inspector (right)
with the full score decomposition, backend-fed AI risk assessment sections,
**and a heliocentric mini-orbit** showing the object's orbit and current
position relative to Earth.

**Tracking** — a pannable / rotatable 3D heliocentric view (Three.js): the Sun,
a stylized Earth globe on its orbit, and the orbital paths of the **top 50
objects by priority**, colored by tier and labeled, plus the major planets from
backend-fed JPL Horizons elements. Drag to rotate, scroll to
zoom, shift-drag to pan, click an object to select (selection is shared with
Triage). Pause / labels / reset-view controls in the overlay.

**Hunting** — an explainable recommendation engine. For each high-priority,
observable object it picks a **science goal** (astrometry to secure a short
arc · radar for a close pass · spectroscopy for large bodies) and matches it to
a **facility** from a curated list (Pan-STARRS, Catalina, ATLAS, LCO, Goldstone
radar, Gemini, VLT, Spacewatch) by limiting magnitude, sky reachability and
purpose — with an indicative tonight window and a plain-language *why*. A
**Classification Agent** panel answers "classify this", "why this telescope",
"is radar feasible", and what-if questions. It's a deterministic local stub —
wire it to your agent layer / the Anthropic API for free-form reasoning.

**Insight** — the physics, at two levels. A **Plain language ↔ The physics**
toggle switches every section between government-friendly explanation and the
underlying equations. Interactive widgets: H → diameter (with albedo), and an
impact-energy estimator (size · speed · composition → megatons, with
Chelyabinsk / Tunguska / Chicxulub comparisons). Plus short-arc orbit
uncertainty, observability physics, and how the triage score relates to the
Torino / Palermo scales.

## Scoring model

Three components → weighted total → tier. Weights `impact 0.45 · urgency 0.35 ·
observability 0.20`; tiers `CRITICAL ≥70 · ELEVATED ≥50 · ROUTINE ≥30 ·
NOMINAL`. In live mode, the queue now consumes backend-scored rows from
`/api/scout/summary/scored`. The mirrored logic at the top of `index.html`
exists only so the embedded offline sample can still rank objects with no
backend running.

In live mode, the inspector also uses backend analysis endpoints:

- `/api/scout/object/:tdes/analysis`
- `/api/scout/object/:tdes/analysis/summary/stream`
- `/api/scout/object/:tdes/orbit`
- `/api/planets/elements`

## Derived orbits (important caveat)

The Scout **summary** feed carries no Keplerian elements, so selected-object
orbit views now upgrade lazily from the backend route
`/api/scout/object/:tdes/orbit`, which derives a representative solution from
the object's real Scout orbit ensemble (`orbits=1`). If the backend is
unreachable, the frontend still falls back to an illustrative local orbit so
the demo remains usable offline.

## Offline note

Triage, Hunting and Insight need **no network**. The Tracking tab loads
Three.js (r128) from a CDN; offline it shows a graceful fallback. To make
Tracking fully offline, vendor `three.min.js` locally and point the `<script>`
tag at it.

## Next steps (Claude Code)

- Remove the duplicated offline scoring logic if you no longer need the fully
  offline sample mode.
- Wire `/api/scout/object?orbits=1` to feed real elements into `elements()`.
- Diff `data/snapshots/` to flag newly-risen objects on the watch floor.
- Replace the Hunting agent stub with a real agent / Anthropic API call.
