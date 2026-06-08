// Apify search — two actors share the same query/location input:
//   LinkedIn Jobs   (default: bebity/linkedin-jobs-scraper)
//   Google Jobs     (default: dan.foreman/google-jobs-scraper)
//
// Each actor charges Apify credits per scrape. Set APIFY_PER_QUERY_LIMIT
// in .env to control how many items each run pulls.

const BASE = "https://api.apify.com/v2";
const TIMEOUT_MS = 300_000;          // actor sync runs can take a couple of minutes

const LINKEDIN_ACTOR = process.env.APIFY_LINKEDIN_ACTOR || "bebity~linkedin-jobs-scraper";
const GOOGLE_ACTOR   = process.env.APIFY_GOOGLE_ACTOR   || "dan.foreman~google-jobs-scraper";
const PER_QUERY_LIMIT = parseInt(process.env.APIFY_PER_QUERY_LIMIT || "25", 10);

function token() { return (process.env.APIFY_TOKEN || "").trim(); }

async function runActorSync(actorId, input) {
  const url = `${BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token())}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error(`apify ${actorId}: HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(t);
  }
}

function clean(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim().slice(0, 6000);
}

export async function searchLinkedIn({ query, location }) {
  if (!token()) return { provider: "linkedin", error: "APIFY_TOKEN not set", jobs: [] };
  const items = await runActorSync(LINKEDIN_ACTOR, {
    keywords:     query,
    location:     location || "United States",
    rows:         PER_QUERY_LIMIT,
    publishedAt:  "r604800",         // last 7 days
  });
  return {
    provider: "linkedin",
    jobs: items.map((j) => ({
      provider:    "linkedin",
      id:          String(j.id ?? j.jobId ?? j.jobUrl ?? j.link),
      title:       clean(j.title || j.jobTitle || ""),
      company:     clean(j.companyName || j.company || ""),
      location:    clean(j.location || j.locationName || ""),
      url:         j.link || j.jobUrl || j.url || "",
      posted_at:   j.postedAt || j.publishedAt || "",
    })).filter((j) => j.title),
  };
}

export async function searchGoogleJobs({ query, location }) {
  if (!token()) return { provider: "google_jobs", error: "APIFY_TOKEN not set", jobs: [] };
  const q = location ? `${query} in ${location}` : query;
  const items = await runActorSync(GOOGLE_ACTOR, {
    queries:           [q],
    maxItems:          PER_QUERY_LIMIT,
    csvFriendlyOutput: false,
  });
  return {
    provider: "google_jobs",
    jobs: items.map((j) => ({
      provider:    "google_jobs",
      id:          String(j.jobId ?? j.id ?? j.applyLink ?? j.link),
      title:       clean(j.title || j.jobTitle || ""),
      company:     clean(j.companyName || j.company || ""),
      location:    clean(j.location || ""),
      url:         j.applyLink || j.link || j.url || "",
      posted_at:   j.postedAt || j.datePosted || "",
    })).filter((j) => j.title),
  };
}
