// Lever board fetcher.
// docs:    https://github.com/lever/postings-api
// endpoint: GET https://api.lever.co/v0/postings/{slug}?mode=json

const API_BASE = "https://api.lever.co/v0/postings";
const TIMEOUT_MS = 15_000;


export async function fetchLever(company) {
  const url = `${API_BASE}/${encodeURIComponent(company.slug)}?mode=json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      throw new Error(`lever ${company.slug}: HTTP ${r.status}`);
    }
    const items = await r.json();
    const jobs = Array.isArray(items) ? items : [];
    return jobs.map((j) => ({
      provider:     "lever",
      company:      company.name,
      company_slug: company.slug,
      id:           String(j.id || j.hostedUrl || j.applyUrl),
      title:        String(j.text || j.title || ""),
      location:     (j.categories?.location || j.categories?.allLocations?.join(", ") || "").trim(),
      url:          j.hostedUrl || j.applyUrl || "",
      posted_at:    j.createdAt ? new Date(j.createdAt).toISOString() : "",
    }));
  } finally {
    clearTimeout(t);
  }
}
