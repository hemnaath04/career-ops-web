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
import { searchJobSpy }     from "./search/jobspy.js";

import { scoreMany } from "./scorer.js";


// Score everything (within reason) by default — slow is fine, the
// frontend now streams results as they land. Set MAX_JOBS_TO_SCORE
// in .env to cap if your proxy starts throttling.
const MAX_JOBS_TO_SCORE = parseInt(process.env.MAX_JOBS_TO_SCORE || "500", 10);
const DEFAULT_TOP_N     = parseInt(process.env.TOP_N || "50", 10);
// Concurrency 4 by default — most Claude proxies throttle anything
// north of ~5-8 simultaneous requests. Bump to 8 or 12 only if your
// proxy explicitly supports it; the SDK's 6-retry backoff covers
// short bursts but can't paper over a low rate ceiling.
const SCORE_CONCURRENCY = parseInt(process.env.SCORE_CONCURRENCY || "4", 10);


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

  // Search-API fan-out.
  //   - bluedoor + free APIs: fire all queries (cheap or free)
  //   - Apify + TheirStack: fire ONLY the first query (each request burns
  //     paid quota; 4× queries × 2 actors = quota-killer on free tiers).
  //     If you upgrade the paid tier, change `apifyQueries` below to `queries`.
  const tokSet = !!process.env.APIFY_TOKEN;
  const tsSet  = !!process.env.THEIRSTACK_API_KEY;
  console.warn(`[pipeline] Apify token set: ${tokSet}, TheirStack key set: ${tsSet}, search queries: ${queries.length}`);

  const apifyQueries      = queries.slice(0, 1);
  const theirstackQueries = queries.slice(0, 1);

  // Apify (paid quota — one call per actor per submission)
  for (const q of apifyQueries) {
    if (!tokSet) {
      console.warn("[pipeline] skipping LinkedIn + Google Jobs — APIFY_TOKEN not in env");
      break;
    }
    tasks.push(searchLinkedIn   ({ query: q, location })
      .then((r) => { if (r.error) console.warn(`[pipeline] linkedin error: ${r.error}`);    return { source: "linkedin",    jobs: r.jobs || [], error: r.error }; })
      .catch((e) => { console.warn(`[pipeline] linkedin threw: ${e.message}`);             return { source: "linkedin",    error: e.message,   jobs: [] }; }));
    tasks.push(searchGoogleJobs ({ query: q, location })
      .then((r) => { if (r.error) console.warn(`[pipeline] google_jobs error: ${r.error}`); return { source: "google_jobs", jobs: r.jobs || [], error: r.error }; })
      .catch((e) => { console.warn(`[pipeline] google_jobs threw: ${e.message}`);          return { source: "google_jobs", error: e.message,  jobs: [] }; }));
  }

  // TheirStack (paid credits — one call per submission on free tier)
  for (const q of theirstackQueries) {
    if (!tsSet) break;
    tasks.push(searchTheirStack({ query: q })
      .then((r) => { if (r.error) console.warn(`[pipeline] theirstack error: ${r.error}`); return { source: "theirstack",  jobs: r.jobs || [], error: r.error }; })
      .catch((e) => { console.warn(`[pipeline] theirstack threw: ${e.message}`);          return { source: "theirstack", error: e.message,   jobs: [] }; }));
  }

  // bluedoor — anonymous tier is free, fire all queries
  for (const q of queries) {
    tasks.push(searchBluedoor    ({ query: q, location })
      .then((r) => { if (r.error) console.warn(`[pipeline] bluedoor error: ${r.error}`); return { source: "bluedoor",     jobs: r.jobs || [], error: r.error }; })
      .catch((e) => { console.warn(`[pipeline] bluedoor threw: ${e.message}`);          return { source: "bluedoor",    error: e.message,    jobs: [] }; }));
  }

  // JobSpy (Python sidecar on localhost:8002). Off by default — set
  // ENABLE_JOBSPY=1 in .env after running deploy/setup-jobspy.sh.
  // JobSpy hits LinkedIn/Indeed/Glassdoor/Google internally, so we
  // only need ONE call per submission (uses the first search query).
  if (/^(1|true|yes)$/i.test(process.env.ENABLE_JOBSPY || "")) {
    const q = queries[0];
    if (q) {
      tasks.push(searchJobSpy({ query: q, location })
        .then((r) => { if (r.error) console.warn(`[pipeline] jobspy error: ${r.error}`); return { source: "jobspy", jobs: r.jobs || [], error: r.error }; })
        .catch((e) => { console.warn(`[pipeline] jobspy threw: ${e.message}`);          return { source: "jobspy", error: e.message,   jobs: [] }; }));
    }
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
    const taskKey = r.source;
    stats[taskKey] = stats[taskKey] || { fetched: 0, errors: 0 };
    if (r.error) stats[taskKey].errors++;
    for (const j of (r.jobs || [])) {
      // Per-job source overrides the task-level source. JobSpy returns
      // jobs from multiple sites (linkedin/indeed/glassdoor/...) under
      // one task; tagging each job with its actual site gives the UI
      // accurate source chips.
      const jobSource = j.source || taskKey;
      stats[jobSource] = stats[jobSource] || { fetched: 0, errors: 0 };
      stats[jobSource].fetched++;
      allJobs.push({ ...j, source: jobSource });
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
