// Score one job against the candidate's resume + intent.
//
// Uses a compact rubric (smaller than career-ops's full oferta.md) because
// we run this 30-100 times per submission and need each call snappy.
// For the deep A-F write-up the user can still hit the /eval flow on a
// specific job after the ranked list comes back.
//
// Returns:
//   { score: int 1-10, rationale: str, hits: [str], gaps: [str] }

import { complete } from "./llm.js";

const SYSTEM_PROMPT = `You are screening one job posting for one candidate.

Score holistically 1-10:
   10 = bullseye on what they asked for + clearly qualified
    8 = strong match on role/level, small skill gaps
    6 = relevant role family, solid partial overlap
    4 = adjacent role, weak overlap
    1 = unrelated OR a hard constraint is violated

Consider role fit + qualifications + level + location + timing
TOGETHER. Unknown signals (JD doesn't state location etc.) should NOT
drag the score down on their own — only EXPLICIT mismatches should.

Hard cap at 3 if the JD explicitly contradicts a stated hard constraint
(wrong work-auth, on-site at impossible city, wrong level by 2+ rungs).
"Location not specified" is NOT a hard cap.

Respond with ONLY a JSON object (no prose, no markdown fence):

{
  "score": <int 1-10>,
  "rationale": "<one sentence, the WHY>",
  "hits": ["<concrete skill/experience from resume that matches>", ...3 max],
  "gaps": ["<JD requirement not in resume>", ...3 max]
}`;


function extractJson(text) {
  const s = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try { return JSON.parse(s); }
  catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in response");
    return JSON.parse(m[0]);
  }
}

function clipInt(v, lo = 1, hi = 10) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}


function buildSystem(resumeText, raw_query) {
  // Long static prefix gets cache_control'd in lib/llm.js for huge
  // token savings on every job after the first in a submission.
  return `${SYSTEM_PROMPT}

=== CANDIDATE QUERY (what they typed) ===
${raw_query}

=== CANDIDATE RESUME ===
${resumeText.slice(0, 12000)}`;
}


function buildUser(job) {
  return [
    `Company: ${job.company || ""}`,
    `Title: ${job.title || ""}`,
    `Location: ${job.location || ""}`,
    `URL: ${job.url || ""}`,
    "",
    `Description / details:`,
    (job.description || "").slice(0, 4000),
  ].join("\n");
}


export async function scoreJob({ job, resumeText, intent }) {
  const system = buildSystem(resumeText, intent.raw_query || "");
  const user = buildUser(job);
  try {
    const out = await complete({ system, user, maxTokens: 400 });
    const parsed = extractJson(out);
    return {
      score:     clipInt(parsed.score),
      rationale: String(parsed.rationale || "").slice(0, 500),
      hits:      Array.isArray(parsed.hits) ? parsed.hits.slice(0, 5).map(String) : [],
      gaps:      Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 5).map(String) : [],
    };
  } catch (e) {
    return {
      score:     0,
      rationale: `scoring_error: ${e?.message || e}`,
      hits:      [],
      gaps:      [],
    };
  }
}


// Concurrent scoring. Caps in-flight requests so we don't drown the
// proxy. The cache_control on the system message means jobs 2-N
// essentially pay for output only.
//
// `onResult(scoredJob, index)` fires every time a worker finishes one,
// useful for streaming the score back to the frontend as it lands.
export async function scoreMany(jobs, ctx, { concurrency = 8, onResult } = {}) {
  const out = new Array(jobs.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= jobs.length) return;
      const result = await scoreJob({ ...ctx, job: jobs[i] });
      out[i] = result;
      if (onResult) {
        try { onResult({ ...jobs[i], ...result }, i); }
        catch (e) { console.warn("onResult callback threw:", e?.message || e); }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}
