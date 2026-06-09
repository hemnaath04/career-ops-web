// career-ops-web v1.2 — streaming.
//
// /api/find now streams NDJSON. We render each scored job as it lands
// (even score=0 ones), then on `done` we rank top-N and dim the rest.

const $ = (id) => document.getElementById(id);

let _lastResumeText = "";

// In-memory state of jobs we've seen, keyed by dedupe key.
const _seen = new Map();   // key → { domNode, job }
let _scoredCount = 0;
let _totalToScore = 0;
let _scoringStart = 0;


// === resume picker preview ============================================
$("resume_file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const kb = (f.size / 1024).toFixed(1);
  $("resume_status").textContent = `${f.name} (${kb} KB) — parsed at submit`;
});


// === main submit ======================================================
$("find").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query    = $("query").value.trim();
  const location = $("location").value.trim();
  const file     = $("resume_file").files[0];
  const pasted   = $("resume_text").value.trim();

  if (!query)             return showError("type the role you want first.");
  if (!file && !pasted)   return showError("upload your resume (or paste markdown).");

  resetState();
  setRunning(true);

  const fd = new FormData();
  fd.append("query", query);
  if (location) fd.append("location", location);
  if (file)     fd.append("resume",      file);
  else          fd.append("resume_text", pasted);

  try {
    const r = await fetch("/api/find", { method: "POST", body: fd });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showError(data?.error || `request failed (${r.status})`);
      return;
    }
    await streamEvents(r);
  } catch (err) {
    showError(`network error: ${err?.message || err}`);
  } finally {
    setRunning(false);
  }
});


async function streamEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();    // last (possibly partial) line stays in buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch (e) {
        console.warn("bad event line", line.slice(0, 200), e);
      }
    }
  }
}


function handleEvent(e) {
  switch (e.type) {
    case "phase":
      setPhase(e.stage);
      break;
    case "intent":
      // Note the extracted search queries in the phase row.
      setPhase("fetching", `intent: ${e.intent.search_queries?.join(" · ") || "(none)"}`);
      break;
    case "stats":
      setPhase("filtering", `fetched ${e.fetched} jobs from ${Object.keys(e.stats).length} sources`);
      renderSourceChips(e.stats);
      break;
    case "scoring_start":
      _totalToScore = e.total;
      _scoringStart = Date.now();
      setPhase("scoring", `0 / ${e.total} scored…`);
      ensureResultsHeader();
      break;
    case "scored":
      _scoredCount++;
      addOrUpdateJob(e.job);
      updateScoringProgress();
      break;
    case "resume":
      _lastResumeText = e.resume_text || "";
      break;
    case "heartbeat":
      // proxy keep-alive only, ignore in UI
      break;
    case "error":
      showError(e.error);
      break;
    case "done":
      finalize(e);
      break;
    default:
      // unknown event types: log + ignore
      console.log("event", e);
  }
}


// === phase indicator =================================================
function setPhase(stage, detail) {
  const labels = {
    intent:     "reading what you want…",
    fetching:   "fanning out across job boards…",
    filtering:  "filtering candidates…",
    scoring:    "scoring against your resume…",
  };
  const el = $("phase");
  el.style.display = "block";
  el.textContent = (labels[stage] || stage) + (detail ? ` — ${detail}` : "");
}

function updateScoringProgress() {
  const el = $("phase");
  const dt = Math.round((Date.now() - _scoringStart) / 1000);
  el.textContent = `scoring against your resume… ${_scoredCount} / ${_totalToScore}  ·  ${dt}s elapsed`;
}


// === source chips above results =======================================
function renderSourceChips(stats) {
  ensureResultsHeader();
  const meta = document.querySelector(".chip-row");
  if (!meta) return;
  const chips = Object.entries(stats)
    .filter(([, v]) => v.fetched > 0)
    .sort((a, b) => b[1].fetched - a[1].fetched)
    .map(([k, v]) => `<span class="chip" data-source="${k}">${k} · ${v.fetched}</span>`)
    .join("");
  meta.innerHTML = chips;
}


function ensureResultsHeader() {
  if (document.querySelector(".results-meta")) return;
  $("results").insertAdjacentHTML("beforeend", `
    <div class="results-meta">
      <p class="caveat big" id="meta_title">live ranking…</p>
      <p class="muted small" id="meta_sub">streaming jobs as they're scored</p>
      <div class="chip-row"></div>
    </div>
    <div class="job-grid" id="job_grid"></div>
  `);
}


// === per-job render + live re-sort ===================================
function jobKey(j) {
  if (j.url) return j.url.split("?")[0];
  return `${(j.company || "").toLowerCase()}|${(j.title || "").toLowerCase()}`;
}

function addOrUpdateJob(j) {
  ensureResultsHeader();
  const grid = $("job_grid");
  const k = jobKey(j);

  let entry = _seen.get(k);
  if (entry) {
    // already in DOM — refresh the card
    entry.job = j;
    const next = renderJobCard(j, null);
    entry.domNode.outerHTML = next;
    // re-grab the new node
    const all = grid.querySelectorAll(".job-card");
    for (const n of all) {
      if (n.dataset.key === k) { entry.domNode = n; break; }
    }
  } else {
    const html = renderJobCard(j, null);
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const node = tmp.firstElementChild;
    node.dataset.key = k;
    grid.appendChild(node);
    _seen.set(k, { job: j, domNode: node });
  }

  // Re-sort by score, descending. CSS order trick: just reorder DOM.
  resortByScore();
  wireCardButtons();
}


function resortByScore() {
  const grid = $("job_grid");
  if (!grid) return;
  const cards = [..._seen.values()]
    .sort((a, b) => (b.job.score || 0) - (a.job.score || 0));
  // Re-rank labels
  cards.forEach((entry, i) => {
    const rankEl = entry.domNode.querySelector(".rank");
    if (rankEl) rankEl.textContent = `#${i + 1}`;
  });
  // Append in new order — appendChild moves existing nodes.
  for (const { domNode } of cards) grid.appendChild(domNode);
}


function renderJobCard(j, rank) {
  const scoreCls = j.score >= 8 ? "score-great" : j.score >= 6 ? "score-good" : j.score >= 1 ? "score-meh" : "score-zero";
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
  const tailorPayload = JSON.stringify({
    title:       j.title || "",
    company:     j.company || "",
    location:    j.location || "",
    url:         j.url || "",
    source:      j.source || "",
    description: j.description || "",
    hits:        j.hits || [],
    gaps:        j.gaps || [],
  });

  return `
    <article class="job-card">
      <header>
        <span class="rank">${rank != null ? `#${rank}` : ""}</span>
        <span class="score ${scoreCls}">${j.score ?? 0}<small>/10</small></span>
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
        <button class="action ghost" data-tailor='${escapeAttr(tailorPayload)}'>✦ tailor cv</button>
        <span class="cv-result"></span>
      </footer>
    </article>
  `;
}


function wireCardButtons() {
  // Idempotent — re-runs on every re-sort.
  document.querySelectorAll("[data-track]").forEach((b) => {
    if (b._wired) return;
    b._wired = true;
    b.addEventListener("click", () => saveToTracker(JSON.parse(b.dataset.track)));
  });
  document.querySelectorAll("[data-tailor]").forEach((b) => {
    if (b._wired) return;
    b._wired = true;
    b.addEventListener("click", () => tailorCv(JSON.parse(b.dataset.tailor), b));
  });
}


// === final done event =================================================
function finalize(e) {
  $("phase").style.display = "none";

  const total = _seen.size;
  const kept  = e.kept ?? 0;
  const elapsed = Math.round((e.elapsed_ms || 0) / 1000);

  // Cards below the top_n cutoff get dimmed but stay visible (user
  // explicitly asked to see 0/10 too).
  const cutoffIdx = e.top_n || 50;
  let idx = 0;
  for (const card of document.querySelectorAll(".job-card")) {
    if (idx >= cutoffIdx) card.classList.add("below-cutoff");
    idx++;
  }

  document.getElementById("meta_title").textContent =
    `${kept} ranked match${kept === 1 ? "" : "es"} · ${total - kept} below the cut`;
  document.getElementById("meta_sub").textContent =
    `${total} jobs scored in ${elapsed}s · sources fanned out in parallel`;
}


// === tailored CV =====================================================
async function tailorCv(job, btn) {
  if (!_lastResumeText) {
    alert("can't tailor — resume text wasn't cached. re-submit the form once.");
    return;
  }
  const slot = btn.parentElement.querySelector(".cv-result");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "tailoring…";
  slot.textContent = "";

  try {
    const r = await fetch("/api/pdf/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_text: _lastResumeText, job }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      slot.innerHTML = `<span style="color:var(--marker)">failed: ${escapeHtml(data?.error || r.status)}</span>`;
      return;
    }
    btn.style.display = "none";
    slot.innerHTML = `
      <a class="action" href="${escapeAttr(data.view_url)}" target="_blank" rel="noopener">view tailored cv ↗</a>
      <a class="action" href="${escapeAttr(data.download_url)}" target="_blank" rel="noopener">⬇ pdf</a>
    `;
  } catch (e) {
    slot.innerHTML = `<span style="color:var(--marker)">network: ${escapeHtml(String(e?.message || e))}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}


// === tracker save =====================================================
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


// === helpers =========================================================
function resetState() {
  $("results").innerHTML = "";
  $("error").style.display = "none";
  _seen.clear();
  _scoredCount = 0;
  _totalToScore = 0;
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
