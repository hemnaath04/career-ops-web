// Ashby board fetcher.
//
// Ashby exposes its job board via an unofficial-but-public GraphQL endpoint
// (the same one their hosted job board pages use under the hood). career-ops
// uses this exact query — we mirror it.
//
// endpoint: POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams

const ENDPOINT = "https://jobs.ashbyhq.com/api/non-user-graphql";
const TIMEOUT_MS = 20_000;

// Compact GraphQL payload. Mirrors what career-ops's scan.md describes:
// ApiJobBoardWithTeams + jobPostings { id, title, locationName, employmentType, ... }
const QUERY = `
query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(
    organizationHostedJobsPageName: $organizationHostedJobsPageName
  ) {
    jobPostings {
      id
      title
      locationName
      employmentType
      teamName
      compensationTierSummary
      isListed
    }
  }
}`;


export async function fetchAshby(company) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ENDPOINT}?op=ApiJobBoardWithTeams`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "ApiJobBoardWithTeams",
        query: QUERY,
        variables: { organizationHostedJobsPageName: company.slug },
      }),
    });
    if (!r.ok) {
      throw new Error(`ashby ${company.slug}: HTTP ${r.status}`);
    }
    const data = await r.json();
    const postings = data?.data?.jobBoard?.jobPostings || [];
    return postings
      .filter((p) => p.isListed !== false)
      .map((p) => ({
        provider:     "ashby",
        company:      company.name,
        company_slug: company.slug,
        id:           String(p.id),
        title:        String(p.title || ""),
        location:     p.locationName || "",
        // Ashby doesn't return the public URL directly in the GraphQL
        // response, but the URL pattern is stable: jobs.ashbyhq.com/<slug>/<id>
        url:          `https://jobs.ashbyhq.com/${encodeURIComponent(company.slug)}/${encodeURIComponent(p.id)}`,
        posted_at:    "",  // not in this payload
        // Bonus context — kept on the row for the UI to surface
        team:         p.teamName || "",
        comp:         p.compensationTierSummary || "",
      }));
  } finally {
    clearTimeout(t);
  }
}
