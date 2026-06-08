// Portal scanner endpoints.
//
//   GET  /api/scan/portals      → list of curated companies + their provider
//   POST /api/scan              → run a scan against a chosen subset
//
// POST body: { slugs: ["anthropic", "openai", ...] }
//   Empty / missing slugs means "scan all enabled companies".
//
// Response: {
//   ok: true,
//   scanned_at: ISO,
//   total_jobs: N,
//   results: [
//     { slug, provider, jobs: [...] }      // on success
//     { slug, provider, error: "..." }     // on failure (per-company)
//   ]
// }

import express from "express";
import { loadPortals } from "../lib/portals.js";
import { fetchByProvider, SUPPORTED_PROVIDERS } from "../lib/ats/index.js";

const router = express.Router();


router.get("/portals", (_req, res) => {
  const { companies, path } = loadPortals();
  res.json({
    ok:        true,
    source:    path,
    providers: SUPPORTED_PROVIDERS,
    companies: companies.map(({ name, slug, provider, careers_url, enabled }) => ({
      name, slug, provider, careers_url, enabled,
    })),
  });
});


router.post("/", async (req, res) => {
  const { slugs } = req.body || {};
  const { companies } = loadPortals();

  // Resolve the subset to scan.
  const selectedSet = Array.isArray(slugs) && slugs.length
    ? new Set(slugs.map(String))
    : null;

  const toScan = companies.filter((c) => {
    if (!c.enabled) return false;
    return selectedSet ? selectedSet.has(c.slug) : true;
  });

  if (toScan.length === 0) {
    return res.json({
      ok: true,
      scanned_at: new Date().toISOString(),
      total_jobs: 0,
      results: [],
      note: "no companies matched — try selecting at least one",
    });
  }

  // Fan out. allSettled so one bad board doesn't kill the run.
  const settled = await Promise.allSettled(
    toScan.map((c) => fetchByProvider(c).then((jobs) => ({ company: c, jobs }))),
  );

  const results = settled.map((s, i) => {
    const c = toScan[i];
    if (s.status === "fulfilled") {
      return {
        slug:     c.slug,
        company:  c.name,
        provider: c.provider,
        jobs:     s.value.jobs,
        count:    s.value.jobs.length,
      };
    }
    return {
      slug:     c.slug,
      company:  c.name,
      provider: c.provider,
      error:    String(s.reason?.message || s.reason || "fetch failed"),
      jobs:     [],
      count:    0,
    };
  });

  const total = results.reduce((n, r) => n + r.count, 0);

  res.json({
    ok:         true,
    scanned_at: new Date().toISOString(),
    total_jobs: total,
    results,
  });
});


export default router;
