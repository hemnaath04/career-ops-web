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
  const ok = data.results.filter((r) => !r.error);
  const failed = data.results.filter((r) => r.error);

  const html = [];
  html.push(`<h2 style="margin-top:2rem">${data.total_jobs} job${data.total_jobs === 1 ? "" : "s"} across ${ok.length} compan${ok.length === 1 ? "y" : "ies"}</h2>`);
  if (failed.length) {
    html.push(`<p class="muted">${failed.length} compan${failed.length === 1 ? "y" : "ies"} failed: ${failed.map(f => `${escapeHtml(f.company)} <span class="mono">(${escapeHtml(f.error)})</span>`).join(", ")}</p>`);
  }

  // Sort results: companies with the most jobs first.
  ok.sort((a, b) => b.count - a.count);

  for (const r of ok) {
    html.push(`
      <details class="company-results" open>
        <summary>
          <strong>${escapeHtml(r.company)}</strong>
          <span class="mono">${r.provider}</span>
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

$("run").addEventListener("click", runScan);
$("select_all").addEventListener("click", () => setAll(true));
$("select_none").addEventListener("click", () => setAll(false));

loadCompanies();
