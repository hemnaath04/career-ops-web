// TheirStack — paid, but cheap. 200 credits/mo on the free tier.
// API: POST https://api.theirstack.com/v1/jobs/search (Bearer token)

const ENDPOINT = "https://api.theirstack.com/v1/jobs/search";
const TIMEOUT_MS = 25_000;
const PER_QUERY_LIMIT = 25;

function key() { return (process.env.THEIRSTACK_API_KEY || "").trim(); }

function countries() {
  const raw = process.env.THEIRSTACK_COUNTRIES || "US";
  return raw.split(",").map((c) => c.trim()).filter(Boolean);
}

function clean(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim().slice(0, 6000);
}

export async function searchTheirStack({ query }) {
  if (!key()) return { provider: "theirstack", error: "THEIRSTACK_API_KEY not set", jobs: [] };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Authorization": `Bearer ${key()}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        page:                     0,
        limit:                    PER_QUERY_LIMIT,
        job_title_or:             [query],
        posted_at_max_age_days:   14,
        job_country_code_or:      countries(),
        include_total_results:    false,
      }),
    });
    if (!r.ok) throw new Error(`theirstack: HTTP ${r.status}`);
    const data = await r.json();
    const items = data?.data || [];
    return {
      provider: "theirstack",
      jobs: items.map((j) => ({
        provider:    "theirstack",
        id:          String(j.id ?? j.source_job_id),
        title:       clean(j.job_title || j.title || ""),
        company:     clean(j.company || j.company_object?.name || ""),
        location:    clean(
          j.location ||
          j.short_location ||
          [j.city, j.country].filter(Boolean).join(", ")
        ),
        url:         j.url || j.final_url || j.source_url || "",
        posted_at:   j.date_posted || j.discovered_at || "",
      })).filter((j) => j.title),
    };
  } finally {
    clearTimeout(t);
  }
}
