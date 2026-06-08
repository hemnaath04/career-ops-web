// Greenhouse board fetcher.
// docs:    https://developers.greenhouse.io/job-board.html
// endpoint: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs

const API_BASE = "https://boards-api.greenhouse.io/v1/boards";
const TIMEOUT_MS = 15_000;


export async function fetchGreenhouse(company) {
  const url = `${API_BASE}/${encodeURIComponent(company.slug)}/jobs`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      throw new Error(`greenhouse ${company.slug}: HTTP ${r.status}`);
    }
    const data = await r.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return jobs.map((j) => ({
      provider:   "greenhouse",
      company:    company.name,
      company_slug: company.slug,
      id:         String(j.id ?? j.requisition_id ?? j.absolute_url),
      title:      String(j.title || ""),
      location:   j.location?.name || j.offices?.[0]?.name || "",
      url:        j.absolute_url || "",
      posted_at:  j.updated_at || j.first_published || "",
    }));
  } finally {
    clearTimeout(t);
  }
}
