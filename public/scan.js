// Portal scanner frontend.
// Two phases:
//   1. On load, GET /api/scan/portals to render the company grid.
//   2. On "scan selected", POST /api/scan with the chosen slugs and
//      render the aggregated results below.

const $ = (id) => document.getElementById(id);

let companies = [];       // {slug, name, provider, careers_url, enabled}
const selected = new Set(); // slugs

async function loadCompanies() {
  const grid = $("companies");
  grid.innerHTML = '<p class="muted">loading…</p>';
  try {
    const r = await fetch("/api/scan/portals");
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    companies = data.companies || [];
    // Select all enabled by default.
    for (const c of companies) if (c.enabled) selected.add(c.slug);
    render();
  } catch (e) {
    grid.innerHTML = `<p class="error-inline">couldn't load portals: ${e.message}</p>`;
  }
}

function render() {
  const grid = $("companies");
  grid.innerHTML = companies.map((c) => `
    <label class="company-card" data-slug="${c.slug}">
      <input type="checkbox" data-slug="${c.slug}" ${selected.has(c.slug) ? "checked" : ""}>
      <div class="company-meta">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="mono provider-${c.provider}">${c.provider}</span>
        ${c.careers_url ? `<a href="${escapeAttr(c.careers_url)}" target="_blank" rel="noopener">↗</a>` : ""}
      </div>
    </label>
  `).join("");
  $("company_count").textContent = `${selected.size} of ${companies.length} selected`;
  // Wire checkboxes.
  grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const slug = e.target.dataset.slug;
      if (e.target.checked) selected.add(slug); else selected.delete(slug);
      $("company_count").textContent = `${selected.size} of ${companies.length} selected`;
    });
  });
}

function setAll(on) {
  selected.clear();
  if (on) for (const c of companies) selected.add(c.slug);
  render();
}

async function runScan() {
  const btn = $("run");
  const errorEl = $("error");
  const resultsEl = $("results");

  errorEl.style.display = "none";
  resultsEl.innerHTML = "";

  if (selected.size === 0) {
    errorEl.textContent = "pick at least one company.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = `scanning ${selected.size}…`;
  const t0 = performance.now();

  try {
    const r = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ slugs: [...selected] }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      errorEl.textContent = data.error || `HTTP ${r.status}`;
      errorEl.style.display = "block";
      return;
    }
    renderResults(data);
    const dt = Math.round((performance.now() - t0) / 100) / 10;
    console.log(`scan finished in ${dt}s — ${data.total_jobs} jobs`);
  } catch (e) {
    errorEl.textContent = `network error: ${e?.message || e}`;
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "scan selected →";
  }
}

function renderResults(data) {
  const okWithJobs   = data.results.filter((r) => !r.error && r.count > 0);
  const okNoJobs     = data.results.filter((r) => !r.error && r.count === 0);
  const failed       = data.results.filter((r) => r.error);

  // Group failures by error class (404 / network / etc.) so the user sees
  // one chip per failure mode instead of a wall of text.
  const failGroups = {};
  for (const f of failed) {
    const cls = classifyError(f.error);
    (failGroups[cls] ||= []).push(f);
  }

  // Sort visible companies by job count desc — most-hiring first.
  okWithJobs.sort((a, b) => b.count - a.count);

  const html = [];

  // Headline + tiny stat row.
  html.push(`
    <h2 style="margin-top:2rem">
      ${data.total_jobs} job${data.total_jobs === 1 ? "" : "s"}
      across ${okWithJobs.length} compan${okWithJobs.length === 1 ? "y" : "ies"}
    </h2>
    <p class="muted scan-stats">
      ${okWithJobs.length} with jobs ·
      ${okNoJobs.length} empty ·
      ${failed.length} skipped
    </p>
  `);

  // Failures section — collapsed by default. Grouped by error class.
  if (failed.length) {
    html.push(`
      <details class="failures">
        <summary><span class="muted">show ${failed.length} skipped compan${failed.length === 1 ? "y" : "ies"}</span></summary>
        ${Object.entries(failGroups).map(([cls, list]) => `
          <div class="fail-group">
            <p class="mono fail-group-head">${escapeHtml(cls)} <span class="muted">(${list.length})</span></p>
            <p class="fail-list">${list.map(f => escapeHtml(f.company)).join(", ")}</p>
          </div>
        `).join("")}
        <p class="muted" style="font-size:0.78rem; margin-top:0.4rem">
          These usually mean the company's ATS slug in career-ops's portals.yml
          is stale (board renamed, company switched providers) — not a bug in
          this scanner.
        </p>
      </details>
    `);
  }

  // Successful companies with jobs.
  for (const r of okWithJobs) {
    html.push(`
      <details class="company-results" open>
        <summary>
          <strong>${escapeHtml(r.company)}</strong>
          <span class="mono provider-${r.provider}">${r.provider}</span>
          <span class="muted">${r.count} role${r.count === 1 ? "" : "s"}</span>
        </summary>
        <ul class="job-list">
          ${r.jobs.map(j => `
            <li>
              <a href="${escapeAttr(j.url)}" target="_blank" rel="noopener">${escapeHtml(j.title)}</a>
              ${j.location ? `<span class="muted">· ${escapeHtml(j.location)}</span>` : ""}
              ${j.team ? `<span class="muted">· ${escapeHtml(j.team)}</span>` : ""}
              ${j.comp ? `<span class="muted">· ${escapeHtml(j.comp)}</span>` : ""}
            </li>
          `).join("")}
        </ul>
      </details>
    `);
  }

  $("results").innerHTML = html.join("");
}

function classifyError(msg) {
  const s = String(msg || "");
  if (s.includes("404")) return "404 (board not found — slug likely stale)";
  if (s.includes("403")) return "403 (board access denied)";
  if (s.includes("429")) return "429 (rate limited)";
  if (s.includes("aborted") || s.includes("timeout")) return "timeout";
  if (s.includes("HTTP")) return s.replace(/^.*?(HTTP \d+).*$/, "$1");
  return "other";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

$("run").addEventListener("click", runScan);
$("select_all").addEventListener("click", () => setAll(true));
$("select_none").addEventListener("click", () => setAll(false));

loadCompanies();
