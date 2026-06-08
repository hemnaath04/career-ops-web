// Premium-API search.
// POST /api/search { query, location?, providers? }
//
// providers defaults to ["linkedin","google_jobs","theirstack","bluedoor"]
// — any unconfigured provider (missing API key) returns an empty result
// with an `error` note instead of failing the whole request.

import express from "express";
import { searchLinkedIn, searchGoogleJobs } from "../lib/search/apify.js";
import { searchTheirStack }                from "../lib/search/theirstack.js";
import { searchBluedoor }                  from "../lib/search/bluedoor.js";

const router = express.Router();

const ALL = {
  linkedin:    (opts) => searchLinkedIn(opts),
  google_jobs: (opts) => searchGoogleJobs(opts),
  theirstack:  (opts) => searchTheirStack(opts),
  bluedoor:    (opts) => searchBluedoor(opts),
};

export const SUPPORTED = Object.keys(ALL);

router.get("/providers", (_req, res) => {
  // Tell the frontend which providers are CONFIGURED (have keys),
  // so the UI can disable the others by default.
  res.json({
    ok: true,
    providers: [
      { id: "linkedin",    label: "LinkedIn (Apify)",     configured: !!process.env.APIFY_TOKEN },
      { id: "google_jobs", label: "Google Jobs (Apify)",  configured: !!process.env.APIFY_TOKEN },
      { id: "theirstack",  label: "TheirStack",           configured: !!process.env.THEIRSTACK_API_KEY },
      { id: "bluedoor",    label: "bluedoor",             configured: true /* anonymous works */ },
    ],
  });
});

router.post("/", express.json({ limit: "32kb" }), async (req, res) => {
  const { query, location, providers } = req.body || {};
  const q = String(query || "").trim();
  if (!q) {
    return res.status(400).json({ ok: false, error: "query is required" });
  }
  const picked = Array.isArray(providers) && providers.length
    ? providers.filter((p) => p in ALL)
    : SUPPORTED;

  const settled = await Promise.allSettled(
    picked.map((p) => ALL[p]({ query: q, location: location || "" })
      .then((r) => ({ provider: p, ...r }))),
  );

  const results = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return { provider: picked[i], error: String(s.reason?.message || s.reason), jobs: [] };
  });

  const total = results.reduce((n, r) => n + (r.jobs?.length || 0), 0);

  res.json({
    ok:         true,
    searched_at: new Date().toISOString(),
    query: q,
    total_jobs: total,
    results,
  });
});

export default router;
