// Premium-API search frontend.

const $ = (id) => document.getElementById(id);

const providersEl = $("providers");
const selected = new Set();

async function loadProviders() {
  try {
    const r = await fetch("/api/search/providers");
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "providers load failed");
    renderProviders(data.providers || []);
  } catch (e) {
    providersEl.innerHTML = `<p class="error-inline">${e.message}</p>`;
  }
}

function renderProviders(providers) {
  providersEl.innerHTML = providers.map((p) => {
    const checked = p.configured ? "checked" : "";
    if (p.configured) selected.add(p.id);
    return `
      <label class="provider-checkbox" data-id="${p.id}">
        <input type="checkbox" data-id="${p.id}" ${checked} ${p.configured ? "" : "disabled"}>
        <span>${escapeHtml(p.label)}</span>
        ${p.configured ? "" : `<span class="muted mono">no key in .env</span>`}
      </label>
    `;
  }).join("");
  providersEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selected.add(id); else selected.delete(id);
    });
  });
}

async function runSearch() {
  const btn = $("run");
  const errorEl = $("error");
  const resultsEl = $("results");

  errorEl.style.display = "none";
  resultsEl.innerHTML = "";

  const query    = $("q").value.trim();
  const location = $("loc").value.trim();
  if (!query) {
    errorEl.textContent = "type a query first.";
    errorEl.style.display = "block";
    return;
  }
  if (selected.size === 0) {
    errorEl.textContent = "pick at least one provider.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = `searching ${selected.size}…`;
  const t0 = performance.now();

  try {
    const r = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query, location, providers: [...selected] }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      errorEl.textContent = data.error || `HTTP ${r.status}`;
      errorEl.style.display = "block";
      return;
    }
    renderResults(data);
    const dt = Math.round((performance.now() - t0) / 100) / 10;
    console.log(`search finished in ${dt}s — ${data.total_jobs} jobs`);
  } catch (e) {
    errorEl.textContent = `network error: ${e?.message || e}`;
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "search →";
  }
}

function renderResults(data) {
  const okWithJobs = data.results.filter((r) => !r.error && r.jobs.length > 0);
  const okEmpty    = data.results.filter((r) => !r.error && r.jobs.length === 0);
  const failed     = data.results.filter((r) => r.error);

  okWithJobs.sort((a, b) => b.jobs.length - a.jobs.length);

  const html = [];
  html.push(`
    <h2 style="margin-top:2rem">${data.total_jobs} job${data.total_jobs === 1 ? "" : "s"} for "${escapeHtml(data.query)}"</h2>
    <p class="muted scan-stats">
      ${okWithJobs.length} provider${okWithJobs.length === 1 ? "" : "s"} returned jobs ·
      ${okEmpty.length} empty ·
      ${failed.length} failed
    </p>
  `);

  if (failed.length) {
    html.push(`
      <details class="failures">
        <summary><span class="muted">${failed.length} failure${failed.length === 1 ? "" : "s"}</span></summary>
        ${failed.map(f => `
          <p class="mono fail-group-head">${escapeHtml(f.provider)} — ${escapeHtml(f.error)}</p>
        `).join("")}
      </details>
    `);
  }

  for (const r of okWithJobs) {
    html.push(`
      <details class="company-results" open>
        <summary>
          <strong>${escapeHtml(providerLabel(r.provider))}</strong>
          <span class="mono provider-${r.provider}">${r.provider}</span>
          <span class="muted">${r.jobs.length} role${r.jobs.length === 1 ? "" : "s"}</span>
        </summary>
        <ul class="job-list">
          ${r.jobs.map(j => `
            <li>
              <a href="${escapeAttr(j.url)}" target="_blank" rel="noopener">${escapeHtml(j.title)}</a>
              ${j.company ? `<span class="muted">· ${escapeHtml(j.company)}</span>` : ""}
              ${j.location ? `<span class="muted">· ${escapeHtml(j.location)}</span>` : ""}
            </li>
          `).join("")}
        </ul>
      </details>
    `);
  }

  $("results").innerHTML = html.join("");
}

function providerLabel(id) {
  return {
    linkedin:    "LinkedIn (Apify)",
    google_jobs: "Google Jobs (Apify)",
    theirstack:  "TheirStack",
    bluedoor:    "bluedoor",
  }[id] || id;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

$("run").addEventListener("click", runSearch);
loadProviders();
