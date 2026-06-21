// riskAnalyzer.js
//
// Assembles JPL data + deterministic scores into a structured prompt,
// calls Sonnet, and returns a validated analysis payload for the frontend.

import { callSonnet, callSonnetStream } from "./anthropicClient.js";
import { normalize } from "./schema.js";
import { score } from "./scorer.js";

const SYSTEM_PROMPT = `You are an asteroid risk assessment specialist working within NASA's planetary defense framework. Your role is to analyze Near-Earth Object (NEO) data from JPL's Scout system and produce structured risk assessments for a general audience.

You MUST follow these rules:
1. Only use the data provided in the user message — never invent observations or measurements.
2. Reference and explicitly discuss BOTH the Torino Scale (0–10 integer, categorizes impact hazard for public communication) and the Palermo Scale (logarithmic, compares impact probability to background risk; negative values mean below average risk, 0 means equal to background, positive means elevated).
3. When data is sparse (short arc, few observations, high uncertainty), clearly state that the assessment is preliminary and may change significantly with additional observations.
4. Write for a non-specialist reader: avoid jargon without explanation, use everyday analogies for scale, and be precise about what is known vs. uncertain.
5. Be scientifically cautious — most newly discovered objects are removed from risk lists after follow-up observations refine their orbits.

Reference standards for asteroid classification:
- Torino Scale: 0 = no hazard, 1 = merits careful monitoring, 2–4 = merits concern, 5–7 = threatening, 8–10 = certain collision
- Palermo Scale: < -2 = negligible, -2 to 0 = merits careful monitoring, 0 to +2 = elevated concern, > +2 = very high concern
- PHA criteria: absolute magnitude H ≤ 22 AND MOID ≤ 0.05 AU
- Size thresholds: ~140m = city-scale damage potential, ~1km = global consequences, ~10km = extinction-level

You MUST respond with ONLY valid JSON matching the exact schema specified in the user message. No markdown fences, no commentary outside the JSON.`;

function buildUserMessage(asteroid, scoreResult, rawData) {
  return `Analyze this asteroid and return a JSON object with the schema below.

## Asteroid Data (from JPL Scout)
${JSON.stringify({ designation: asteroid.designation, raw: rawData, normalized: asteroid, deterministicScore: scoreResult }, null, 2)}

## Required JSON Response Schema
{
  "overallSeverity": "CRITICAL | ELEVATED | ROUTINE | NOMINAL",
  "riskClass": "Short phrase classifying the risk (e.g. 'Newly discovered, needs follow-up', 'Virtual impactor candidate', 'Likely safe passage')",
  "torinoScale": {
    "value": <integer 0-10>,
    "rationale": "1-2 sentence explanation of the Torino rating and what it means for the public"
  },
  "palermoScale": {
    "value": "<estimated numeric value or 'Indeterminate' if data insufficient>",
    "rationale": "1-2 sentence explanation of the Palermo rating relative to background risk"
  },
  "impactRelevance": {
    "score": <0-100 matching deterministic score>,
    "summary": "1-2 sentences explaining size, approach geometry, and potential consequences"
  },
  "urgency": {
    "score": <0-100 matching deterministic score>,
    "summary": "1-2 sentences explaining observation window, arc quality, and time pressure"
  },
  "observability": {
    "score": <0-100 matching deterministic score>,
    "summary": "1-2 sentences on current brightness, sky position, and feasibility of follow-up"
  },
  "keyStats": [
    { "label": "string", "value": "string", "context": "short plain-language note" }
  ],
  "assessmentSummary": "3-5 sentence plain-language summary for a non-scientist. Explain what this object is, whether it poses a threat, and what happens next.",
  "technicalRationale": "2-3 sentences with more technical detail for the curious reader.",
  "uncertaintyNotes": "1-2 sentences about what is NOT known and how additional data would change the picture."
}

Important: The overallSeverity should align with the deterministic tier (${scoreResult.tier}) unless you have strong scientific justification to differ. The impactRelevance/urgency/observability scores should be very close to the deterministic values provided.`;
}

const REQUIRED_FIELDS = [
  "overallSeverity",
  "torinoScale",
  "palermoScale",
  "assessmentSummary",
];

function validateAnalysis(parsed) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  if (!["CRITICAL", "ELEVATED", "ROUTINE", "NOMINAL"].includes(parsed.overallSeverity)) {
    parsed.overallSeverity = "NOMINAL";
  }
  // Fill optional fields with safe defaults so frontend never has to guard
  parsed.riskClass = parsed.riskClass || "";
  parsed.impactRelevance = parsed.impactRelevance || null;
  parsed.urgency = parsed.urgency || null;
  parsed.observability = parsed.observability || null;
  parsed.keyStats = parsed.keyStats || [];
  parsed.technicalRationale = parsed.technicalRationale || "";
  parsed.uncertaintyNotes = parsed.uncertaintyNotes || "";
  return parsed;
}

const SUMMARY_SYSTEM_PROMPT = `You are an asteroid risk assessment specialist. Write a brief, plain-language assessment summary for a general audience. Reference both the Torino Scale and Palermo Scale in your explanation. Be scientifically cautious — most newly discovered objects are removed from risk lists after follow-up observations. Write 3-5 sentences only. Do not use markdown or special formatting.`;

const CHAT_SYSTEM_PROMPT = `You are the Classification Agent inside ARGION, a planetary defense triage console.

Answer operator questions about one selected asteroid using ONLY the context provided in the user message.

You MUST follow these rules:
1. Treat the backend JPL Scout data and deterministic score as the source of truth.
2. Use the frontend triage context when explaining telescope choice, observability, and follow-up strategy.
3. Never invent measurements, facilities, orbital parameters, impact claims, or observing constraints.
4. If the answer is not supported by the provided context, say so plainly and explain what is missing.
5. Be concise but useful. Short paragraphs or bullets are fine.
6. When relevant, call out uncertainty from short arcs, sparse observations, faint magnitudes, or preliminary solutions.
7. Output plain text only. No JSON, no markdown tables, and no code fences.`;

function buildSummaryUserMessage(asteroid, scoreResult) {
  return `Write a plain-language assessment summary for this asteroid:

Designation: ${asteroid.designation}
Estimated Diameter: ${asteroid.diameterM !== null ? asteroid.diameterM + " m" : "unknown"}
MOID: ${asteroid.moid !== null ? asteroid.moid + " AU" : "unknown"}
Close Approach Distance: ${asteroid.caDist !== null ? asteroid.caDist + " lunar distances" : "unknown"}
Arc Length: ${asteroid.arc !== null ? asteroid.arc + " days" : "unknown"}
Observations: ${asteroid.nObs || "unknown"}
Velocity (V∞): ${asteroid.vInf !== null ? asteroid.vInf + " km/s" : "unknown"}
Brightness (Vmag): ${asteroid.Vmag !== null ? asteroid.Vmag : "unknown"}

Priority Score: ${scoreResult.total}/100 (Tier: ${scoreResult.tier})
Impact Relevance: ${scoreResult.impact}/100
Urgency: ${scoreResult.urgency}/100
Observability: ${scoreResult.observability}/100

Explain what this object is, whether it poses a threat (referencing Torino and Palermo scales), and what happens next. Write for someone who is NOT an earth scientist.`;
}

function buildClassificationAgentUserMessage({ asteroid, scoreResult, rawData, question, frontendContext }) {
  return `Answer the operator's question about the selected asteroid.

## Operator Question
${question}

## Backend Context (JPL Scout + normalized score inputs)
${JSON.stringify({
    designation: asteroid.designation,
    raw: rawData,
    normalized: asteroid,
    deterministicScore: scoreResult,
  }, null, 2)}

## Frontend Triage Context
${JSON.stringify(frontendContext || {}, null, 2)}

Important:
- If the operator asks "why this telescope" or similar, use the provided tasking and facility ranking context.
- If the operator asks for classification, explain the current triage state using the supplied scores and descriptors.
- If the operator asks a hypothetical, ground the answer in the supplied data and be explicit about uncertainty.`;
}

export async function streamAssessmentSummary(rawData, onChunk) {
  const asteroid = normalize(rawData);
  const scoreResult = score(asteroid);
  const userMessage = buildSummaryUserMessage(asteroid, scoreResult);
  return callSonnetStream({ system: SUMMARY_SYSTEM_PROMPT, userMessage, onChunk });
}

export async function answerClassificationQuestion({ rawData, question, frontendContext = null }) {
  const asteroid = normalize(rawData);
  const scoreResult = score(asteroid);
  const userMessage = buildClassificationAgentUserMessage({
    asteroid,
    scoreResult,
    rawData,
    question,
    frontendContext,
  });
  const answer = await callSonnet({
    system: CHAT_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1024,
  });

  return {
    asteroid,
    score: scoreResult,
    answer: answer.trim(),
    source: {
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      answeredAt: new Date().toISOString(),
    },
  };
}

export async function analyzeAsteroid(rawData) {
  const asteroid = normalize(rawData);
  const scoreResult = score(asteroid);

  let analysis = null;
  let analysisError = null;

  try {
    const userMessage = buildUserMessage(asteroid, scoreResult, rawData);
    const responseText = await callSonnet({ system: SYSTEM_PROMPT, userMessage });

    const cleaned = responseText.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    analysis = validateAnalysis(parsed);
  } catch (err) {
    console.error(`[riskAnalyzer] LLM analysis failed for ${asteroid.designation}:`, err.message);
    analysisError = err.message;
  }

  return {
    asteroid,
    score: scoreResult,
    analysis,
    analysisError,
    source: {
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      analyzedAt: new Date().toISOString(),
      llmSuccess: analysis !== null,
    },
  };
}
