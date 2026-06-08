// Load and normalize career-ops's portals config.
//
// career-ops keeps a curated list of 45+ companies in
// templates/portals.example.yml — name, careers_url, optional api endpoint,
// optional api_provider. We read that file from disk on every call
// (cheap, lets the user edit the YAML and see changes without a restart)
// and emit a flat list of {slug, name, provider, careers_url} that the
// scan endpoint can fan out across.
//
// Slug inference: prefers an explicit `slug` field, falls back to the
// recognizable slug-segment of careers_url for the supported providers,
// finally derives from name. Anything we can't infer a provider for
// gets filtered out so the UI doesn't list un-fetchable rows.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const REPO_DIR = process.env.CAREER_OPS_DIR || "../career-ops";

// Order matters: the most specific URL shapes must come first because
// the looser patterns happily match a prefix of the URL and grab the
// wrong path segment as the slug.
//
//   boards-api.greenhouse.io/v1/boards/anthropic/jobs   <- slug is `anthropic`
//   boards.greenhouse.io/anthropic                       <- slug is `anthropic`
//
// Without the explicit /v1/boards/ pattern the second-line regex matches
// the first one and captures `v1` instead of the company slug.
const PROVIDER_PATTERNS = [
  // Greenhouse boards-api: full API URL with /v{N}/boards/<slug>/jobs
  { re: /boards-api\.greenhouse\.io\/v\d+\/boards\/([^/?#]+)/i, provider: "greenhouse" },
  // Greenhouse hosted boards: (boards|job-boards|job-boards.eu).greenhouse.io/<slug>
  { re: /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i, provider: "greenhouse" },
  // Ashby
  { re: /jobs\.ashbyhq\.com\/([^/?#]+)/i, provider: "ashby" },
  // Lever API
  { re: /api\.lever\.co\/v\d+\/postings\/([^/?#]+)/i, provider: "lever" },
  // Lever hosted board
  { re: /jobs\.lever\.co\/([^/?#]+)/i, provider: "lever" },
];


function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}


function inferFromUrl(url) {
  if (!url) return { provider: null, slug: null };
  for (const { re, provider } of PROVIDER_PATTERNS) {
    const m = url.match(re);
    if (m) return { provider, slug: m[1] };
  }
  return { provider: null, slug: null };
}


function normalizeCompany(raw) {
  // Try api URL first (most authoritative for slug), then careers_url.
  const fromApi      = inferFromUrl(raw.api);
  const fromCareers  = inferFromUrl(raw.careers_url);
  const provider     = raw.api_provider || fromApi.provider || fromCareers.provider;
  const slug         = raw.slug || fromApi.slug || fromCareers.slug || slugify(raw.name);

  return {
    name:        String(raw.name || slug),
    slug,
    provider,
    careers_url: raw.careers_url || "",
    api:         raw.api || "",
    enabled:     raw.enabled !== false,
  };
}


export function loadPortals() {
  const path = join(REPO_DIR, "templates", "portals.example.yml");
  if (!existsSync(path)) {
    console.warn(`portals: ${path} not found; returning empty list`);
    return { companies: [], path };
  }
  const raw = yaml.load(readFileSync(path, "utf8")) || {};
  const tracked = Array.isArray(raw.tracked_companies) ? raw.tracked_companies : [];

  // Normalize + drop entries we can't actually fetch (no recognized provider).
  const companies = tracked
    .map(normalizeCompany)
    .filter((c) => c.provider && c.slug);

  // Stable sort by name for a predictable UI.
  companies.sort((a, b) => a.name.localeCompare(b.name));

  return { companies, path };
}
