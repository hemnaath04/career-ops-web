// Client for the jobspy-service Python sidecar (port 8002, localhost-only).
// Gated by ENABLE_JOBSPY=1 in .env so the pipeline doesn't try to call
// localhost:8002 on droplets that haven't run deploy/setup-jobspy.sh.

const ENDPOINT         = process.env.JOBSPY_URL || "http://127.0.0.1:8002";
const SITES            = (process.env.JOBSPY_SITES || "linkedin,indeed,glassdoor,google")
                            .split(",").map((s) => s.trim()).filter(Boolean);
const RESULTS_PER_SITE = parseInt(process.env.JOBSPY_RESULTS_PER_SITE || "20", 10);
const HOURS_OLD        = parseInt(process.env.JOBSPY_HOURS_OLD || "72", 10);
const COUNTRY_INDEED   = process.env.JOBSPY_COUNTRY_INDEED || "USA";
const TIMEOUT_MS       = parseInt(process.env.JOBSPY_TIMEOUT_MS || "180000", 10);


export async function searchJobSpy({ query, location }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  console.warn(`[jobspy] query=${JSON.stringify(query)} sites=${SITES.join(",")} location=${JSON.stringify(location || "")}`);

  try {
    const r = await fetch(`${ENDPOINT}/search`, {
      method:  "POST",
      signal:  ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_name:      SITES,
        search_term:    query,
        location:       location || "",
        results_wanted: RESULTS_PER_SITE,
        hours_old:      HOURS_OLD,
        country_indeed: COUNTRY_INDEED,
      }),
    });
    if (!r.ok) {
      let body = "";
      try { body = (await r.text()).slice(0, 400); } catch {}
      return { provider: "jobspy", error: `jobspy: HTTP ${r.status} ${body.replace(/\s+/g, " ")}`, jobs: [] };
    }
    const data = await r.json();
    const items = data.jobs || [];
    console.warn(`[jobspy] returned ${items.length} jobs across ${SITES.length} sites`);

    return {
      provider: "jobspy",
      jobs: items
        .map((j) => ({
          // Per-site source so each site gets its own chip in the UI.
          source:      j.site || "jobspy",
          provider:    j.site || "jobspy",
          id:          j.id,
          title:       j.title,
          company:     j.company,
          location:    j.location,
          url:         j.url,
          description: j.description,
          posted_at:   j.posted_at,
        }))
        .filter((j) => j.title && j.url),
    };
  } catch (e) {
    if (e?.name === "AbortError") {
      return { provider: "jobspy", error: `jobspy timeout after ${TIMEOUT_MS}ms`, jobs: [] };
    }
    return { provider: "jobspy", error: `jobspy: ${e?.message || e}`, jobs: [] };
  } finally {
    clearTimeout(t);
  }
}
