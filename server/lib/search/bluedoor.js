// bluedoor — US-focused, free anonymous tier (~50 req per short window),
// optional API key for higher limits.
// API: GET https://api.bluedoor.sh/job-postings/v1/jobs/search

const ENDPOINT = "https://api.bluedoor.sh/job-postings/v1/jobs/search";
const TIMEOUT_MS = 25_000;
const PER_QUERY_LIMIT = 25;

function key() { return (process.env.BLUEDOOR_API_KEY || "").trim(); }

function clean(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim().slice(0, 6000);
}

export async function searchBluedoor({ query, location }) {
  const params = new URLSearchParams({
    q:     query,
    limit: String(PER_QUERY_LIMIT),
  });
  if (location) params.set("location", location);

  const headers = { accept: "application/json" };
  if (key()) headers["x-api-key"] = key();

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal, headers });
    if (!r.ok) throw new Error(`bluedoor: HTTP ${r.status}`);
    const data = await r.json();
    const items = data?.data || data?.jobs || [];
    return {
      provider: "bluedoor",
      jobs: items.map((j) => {
        const employer = j.employer || {};
        const loc = typeof j.location === "object"
          ? [j.location.city, j.location.region, j.location.country].filter(Boolean).join(", ")
          : (j.location_text || j.location || "");
        return {
          provider:  "bluedoor",
          id:        String(j.id || j.job_id || j.uuid),
          title:     clean(j.title),
          company:   clean(employer.name || j.company || j.organization || ""),
          location:  clean(loc),
          url:       j.url || j.apply_url || j.source_url || "",
          posted_at: j.discovered_at || j.posted_at || "",
        };
      }).filter((j) => j.title),
    };
  } finally {
    clearTimeout(t);
  }
}
