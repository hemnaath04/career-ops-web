// ATS provider dispatch.
// Routes a normalized company {slug, provider} to the right fetcher and
// returns a flat list of jobs. Each fetcher exits via throw on failure;
// the caller wraps in Promise.allSettled so a single broken board never
// kills the whole scan.

import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever }      from "./lever.js";
import { fetchAshby }      from "./ashby.js";

const REGISTRY = {
  greenhouse: fetchGreenhouse,
  lever:      fetchLever,
  ashby:      fetchAshby,
};

export const SUPPORTED_PROVIDERS = Object.keys(REGISTRY);

export function fetchByProvider(company) {
  const fn = REGISTRY[company.provider];
  if (!fn) {
    return Promise.reject(new Error(`provider not supported: ${company.provider}`));
  }
  return fn(company);
}
