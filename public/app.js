// career-ops-web v1.0 — single unified flow.
//
//   1. User types role + location, picks/pastes resume, submits.
//   2. We POST multipart to /api/find which kicks off the pipeline
//      (intent → fan-out → filter → score → top N).
//   3. Server returns JSON when done (no streaming yet — 30-90s wait).
//   4. We render ranked cards with score, rationale, hits, gaps.

const $ = (id) => document.getElementById(id);

// === resume preview (optional — show byte count after pick) ============
$("resume_file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const kb = (f.size / 1024).toFixed(1);
  $("resume_status").textContent = `${f.name} (${kb} KB) — will be parsed when you submit`;
});


// === main submit =======================================================
$("find").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query    = $("query").value.trim();
  const location = $("location").value.trim();
  const file     = $("resume_file").files[0];
  const pasted   = $("resume_text").value.trim();

  if (!query)             return showError("type the role you want first.");
  if (!file && !pasted)   return showError("upload your resume (or paste markdown).");

  clearResults();
  setRunning(true);

  // Build multipart form-data. If they uploaded a file, send that;
  // otherwise send the pasted markdown.
  const fd = new FormData();
  fd.append("query", query);
  if (location) fd.append("location", location);
  if (file)     fd.append("resume",      file);
  else          fd.append("resume_text", pasted);

  // Fake progress phases. The endpoint is one synchronous call but the
  // pipeline does intent → fetching → filtering → scoring so we cycle
  // through hints to make it feel responsive.
  cyclePhases();

  try {
    const r = await fetch("/api/find", { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    stopPhases();
    if (!r.ok || !data.ok) {
      showError(data?.error || `request failed (${r.status})`);
      return;
    }
    renderResults(data);
  } catch (err) {
    stopPhases();
    showError(`network error: ${err?.message || err}`);
  } finally {
    setRunning(false);
  }
});


// === phase cycler =====================================================
let phaseTimer = null;
function cyclePhases() {
  const phases = [
    { text: "reading what you want…",              ms: 2500 },
    { text: "fanning out across job boards…",      ms: 6000 },
    { text: "scoring each posting against you…",   ms: 14000 },
    { text: "still ranking — long tail of providers…", ms: 30000 },
  ];
  const el = $("phase");
  el.style.display = "block";
  let i = 0;
  function next() {
    if (i >= phases.length) { i = phases.length - 1; }
    el.textContent = phases[i].text;
    const d = phases[i].ms;
    i++;
    phaseTimer = setTimeout(next, d);
  }
  next();
}
function stopPhases() {
  if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
  $("phase").style.display = "none";
}


// === render results ===================================================
function renderResults(data) {
  const root = $("results");
  if (!data.jobs?.length) {
    root.innerHTML = `
      <div class="paper-card" style="margin-top:1.5rem">
        <p class="caveat" style="font-size:1.5rem">nothing rated highly today.</p>
        <p class="muted">
          ${data.fetched} jobs found across ${Object.keys(data.stats || {}).length}
          sources; ${data.candidates} survived the keyword filter; ${data.scored}
          got scored. None passed the bar. Tweak your role description or
          location and try again.
        </p>
        <details style="margin-top:0.6rem">
          <summary class="muted small">debug — what intent.parse extracted</summary>
          <pre>${escapeHtml(JSON.stringify(data.intent, null, 2))}</pre>
        </details>
      </div>`;
    return;
  }

  const sourceStats = Object.entries(data.stats || {})
    .filter(([, v]) => v.fetched > 0)
    .sort((a, b) => b[1].fetched - a[1].fetched)
    .map(([k, v]) => `<span class="chip" data-source="${k}">${k} · ${v.fetched}</span>`)
    .join("");

  const cards = data.jobs.map((j, idx) => renderJob(j, idx + 1)).join("");

  root.innerHTML = `
    <div class="results-meta">
      <p class="caveat big">${data.jobs.length} matches for you.</p>
      <p class="muted small">
        scanned ${data.fetched} jobs from ${Object.keys(data.stats).length} sources,
        scored top ${data.scored}, kept top ${data.jobs.length} ·
        ${Math.round(data.elapsed_ms / 1000)}s
      </p>
      <div class="chip-row">${sourceStats}</div>
    </div>
    <div class="job-grid">${cards}</div>
  `;

  // wire "save to tracker" buttons
  root.querySelectorAll("[data-track]").forEach((b) =>
    b.addEventListener("click", () => saveToTracker(JSON.parse(b.dataset.track))));
}


function renderJob(j, rank) {
  const scoreCls = j.score >= 8 ? "score-great" : j.score >= 6 ? "score-good" : "score-meh";
  const hits = (j.hits || []).slice(0, 3).map((h) => `<li>${escapeHtml(h)}</li>`).join("");
  const gaps = (j.gaps || []).slice(0, 3).map((g) => `<li>${escapeHtml(g)}</li>`).join("");
  const trackPayload = JSON.stringify({
    title:    j.title || "",
    company:  j.company || "",
    location: j.location || "",
    url:      j.url || "",
    source:   j.source || "",
    notes:    j.rationale || "",
    status:   "to-apply",
  });

  return `
    <article class="job-card">
      <header>
        <span class="rank">#${rank}</span>
        <span class="score ${scoreCls}">${j.score}<small>/10</small></span>
        <div class="job-title-block">
          <strong>${escapeHtml(j.title || "(untitled)")}</strong>
          <p class="muted small">
            ${escapeHtml(j.company || "")}
            ${j.location ? `· ${escapeHtml(j.location)}` : ""}
            ${j.source ? `<span class="chip tiny" data-source="${j.source}">${j.source}</span>` : ""}
          </p>
        </div>
      </header>

      ${j.rationale ? `<p class="rationale">${escapeHtml(j.rationale)}</p>` : ""}

      ${(hits || gaps) ? `
        <div class="hits-gaps">
          ${hits ? `<div class="hits"><p class="lbl">hits</p><ul>${hits}</ul></div>` : ""}
          ${gaps ? `<div class="gaps"><p class="lbl">gaps</p><ul>${gaps}</ul></div>` : ""}
        </div>` : ""}

      <footer class="job-actions">
        ${j.url ? `<a class="action" href="${escapeAttr(j.url)}" target="_blank" rel="noopener">open posting ↗</a>` : ""}
        <button class="action ghost" data-track='${escapeAttr(trackPayload)}'>+ tracker</button>
      </footer>
    </article>
  `;
}


// === tracker save (uses existing /api/tracker) =========================
async function saveToTracker(payload) {
  try {
    const r = await fetch("/api/tracker", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      alert(`tracker save failed: ${data?.error || r.status}`);
      return;
    }
    flashToast(`saved "${payload.title}" to tracker`);
  } catch (e) {
    alert(`network error: ${e?.message || e}`);
  }
}


// === helpers ==========================================================
function clearResults() {
  $("results").innerHTML = "";
  $("error").style.display = "none";
}
function setRunning(on) {
  $("run").disabled = on;
  $("run").innerHTML = on
    ? `<span class="caveat">thinking…</span>`
    : `<span class="caveat">find me jobs</span> →`;
}
function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.style.display = "block";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function flashToast(text) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = text;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
