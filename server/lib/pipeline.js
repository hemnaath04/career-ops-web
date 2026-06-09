// End-to-end pipeline: query + resume → top N ranked jobs.
//
//   1. Parse intent (role keywords, location filter, search queries)
//   2. Fan out to every source IN PARALLEL:
//        - career-ops's curated companies (Greenhouse / Lever / Ashby)
//        - LinkedIn + Google Jobs via Apify (if APIFY_TOKEN set)
//        - TheirStack (if THEIRSTACK_API_KEY set)
//        - bluedoor (anonymous tier works)
//   3. Filter by title keywords + negative keywords + location
//   4. Dedupe across providers by URL + (company, title)
//   5. Cap candidate pool at MAX_JOBS_TO_SCORE (default 30)
//   6. Score each candidate with the LLM (concurrent)
//   7. Sort by score, return top N (default 20)

import { parseIntent } from "./intent.js";
import { loadPortals }  from "./portals.js";
import { fetchByProvider } from "./ats/index.js";

import { searchLinkedIn, searchGoogleJobs } from "./search/apify.js";
import { searchTheirStack } from "./search/theirstack.js";
import { searchBluedoor }   from "./search/bluedoor.js";

import { scoreMany } from "./scorer.js";


// Score everything (within reason) by default — slow is fine, the
// frontend now streams results as they land. Set MAX_JOBS_TO_SCORE
// in .env to cap if your proxy starts throttling.
const MAX_JOBS_TO_SCORE = parseInt(process.env.MAX_JOBS_TO_SCORE || "500", 10);
const DEFAULT_TOP_N     = parseInt(process.env.TOP_N || "50", 10);
const SCORE_CONCURRENCY = parseInt(process.env.SCORE_CONCURRENCY || "16", 10);


// ---------- fan-out ----------

async function fetchAllSources(intent, location) {
  const { companies } = loadPortals();
  const queries = intent.search_queries.length
    ? intent.search_queries
    : [intent.raw_query || ""].filter(Boolean);

  // Each task returns { source, jobs?, error? }
  const tasks = [];

  // Per-company ATS scans (career-ops's portals.yml)
  for (const c of companies) {
    if (!c.enabled) continue;
    tasks.push(
      fetchByProvider(c)
        .then((jobs) => ({ source: c.provider, company: c.name, jobs }))
        .catch((e)  => ({ source: c.provider, company: c.name, error: e.message, jobs: [] }))
    );
  }

  // Search-API fan-out (one task per query × per provider)
  for (const q of queries) {
    if (process.env.APIFY_TOKEN) {
      tasks.push(searchLinkedIn   ({ query: q, location })
        .then((r) => ({ source: "linkedin",    jobs: r.jobs || [], error: r.error }))
        .catch((e) => ({ source: "linkedin",   error: e.message,   jobs: [] })));
      tasks.push(searchGoogleJobs ({ query: q, location })
        .then((r) => ({ source: "google_jobs", jobs: r.jobs || [], error: r.error }))
        .catch((e) => ({ source: "google_jobs", error: e.message,  jobs: [] })));
    }
    if (process.env.THEIRSTACK_API_KEY) {
      tasks.push(searchTheirStack({ query: q })
        .then((r) => ({ source: "theirstack",  jobs: r.jobs || [], error: r.error }))
        .catch((e) => ({ source: "theirstack", error: e.message,   jobs: [] })));
    }
    tasks.push(searchBluedoor    ({ query: q, location })
      .then((r) => ({ source: "bluedoor",     jobs: r.jobs || [], error: r.error }))
      .catch((e) => ({ source: "bluedoor",    error: e.message,    jobs: [] })));
  }

  return Promise.all(tasks);
}


// ---------- filters ----------

function passesKeyword(title, role, negatives) {
  const t = String(title || "").toLowerCase();
  if (!t) return false;
  if (negatives && negatives.length && negatives.some((n) => t.includes(n))) return false;
  if (!role || !role.length) return true;
  return role.some((kw) => t.includes(kw));
}

function passesLocation(loc, allow) {
  if (!allow || !allow.length) return true;
  const l = String(loc || "").toLowerCase();
  if (!l) return true; // unknown location → don't reject
  return allow.some((tok) => l.includes(tok));
}


// ---------- dedupe ----------

function dedupeKey(job) {
  // Prefer URL (exact). Fall back to company+title fuzzy key.
  if (job.url) return job.url.split("?")[0];
  return `${String(job.company || "").toLowerCase().trim()}|${String(job.title || "").toLowerCase().trim()}`;
}

function dedupe(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    const k = dedupeKey(j);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}


// ---------- rank cap by keyword match count ----------

function rankByKeywordHits(jobs, role) {
  if (!role || !role.length) return jobs;
  const score = (j) => {
    const t = (j.title || "").toLowerCase();
    return role.reduce((n, kw) => n + (t.includes(kw) ? 1 : 0), 0);
  };
  return jobs.slice().sort((a, b) => score(b) - score(a));
}


// ---------- main entry point ----------

// onEvent is the streaming hook. Events emitted (in order):
//   { type: "phase", stage }
//   { type: "intent", intent }
//   { type: "stats", stats, fetched }
//   { type: "scoring_start", total: <#candidates> }
//   { type: "scored", job }                 (one per scored job, including 0/10)
//   { type: "done", elapsed_ms, kept: <topN> }
// runPipeline ALSO returns the final ranked top-N at the end so non-
// streaming callers still work.
export async function runPipeline({
  query, location, resumeText,
  topN = DEFAULT_TOP_N,
  onEvent,
}) {
  const t0 = Date.now();
  const emit = (e) => { try { onEvent?.(e); } catch (err) { console.warn("onEvent threw:", err); } };

  emit({ type: "phase", stage: "intent" });
  const intent = await parseIntent(query);
  emit({ type: "intent", intent });

  emit({ type: "phase", stage: "fetching" });
  const sourceResults = await fetchAllSources(intent, location);

  const allJobs = [];
  const stats   = {};
  for (const r of sourceResults) {
    const key = r.source;
    stats[key] = stats[key] || { fetched: 0, errors: 0 };
    if (r.error) stats[key].errors++;
    for (const j of (r.jobs || [])) {
      stats[key].fetched++;
      allJobs.push({ ...j, source: key });
    }
  }
  const fetched = allJobs.length;
  emit({ type: "stats", stats, fetched });

  emit({ type: "phase", stage: "filtering" });
  let candidates = allJobs.filter((j) =>
    passesKeyword(j.title, intent.role_keywords, intent.negative_keywords) &&
    passesLocation(j.location, intent.location_keywords)
  );
  candidates = dedupe(candidates);
  // Most-relevant first so the cap (if any) keeps the strongest matches.
  candidates = rankByKeywordHits(candidates, intent.role_keywords).slice(0, MAX_JOBS_TO_SCORE);

  emit({ type: "scoring_start", total: candidates.length });

  const scored = candidates.length === 0 ? [] : await scoreMany(
    candidates,
    { resumeText, intent },
    {
      concurrency: SCORE_CONCURRENCY,
      onResult: (scoredJob) => emit({ type: "scored", job: scoredJob }),
    },
  );

  const ranked = candidates
    .map((j, i) => ({ ...j, ...scored[i] }))
    .filter((j) => j.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const elapsed = Date.now() - t0;
  // No "done" event from here — the route layer emits a single final
  // "done" with the ranked list attached, so streaming consumers don't
  // get two done events.

  return {
    elapsed_ms: elapsed,
    intent,
    stats,
    fetched,
    candidates: candidates.length,
    scored:     scored.length,
    jobs:       ranked,
  };
}
