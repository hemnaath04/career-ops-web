// Tracker + story bank frontend.
// Two tabs sharing this file. State lives in two REST collections:
//   /api/tracker  (kanban entries, statuses move with arrow buttons)
//   /api/stories  (flat list, themed)

const $ = (id) => document.getElementById(id);
const STATUSES = ["to-apply", "applied", "interviewing", "decision"];
const STATUS_LABELS = {
  "to-apply":     "to apply",
  applied:        "applied",
  interviewing:   "interviewing",
  decision:       "decision",
};

// --- tabs ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    const which = btn.dataset.tab;
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === `tab-${which}`));
  });
});

// =====================================================================
// Tracker
// =====================================================================

async function loadTracker() {
  const r = await fetch("/api/tracker");
  const data = await r.json().catch(() => ({}));
  renderKanban(data.items || []);
}

function renderKanban(items) {
  const board = $("kanban");
  const cols = STATUSES.map((status) => {
    const filtered = items.filter((i) => i.status === status);
    return `
      <section class="kanban-col">
        <header>${STATUS_LABELS[status]} <span class="muted">${filtered.length}</span></header>
        <div class="kanban-stack">
          ${filtered.map(card).join("") || `<p class="muted" style="font-size:0.8rem">empty</p>`}
        </div>
      </section>
    `;
  }).join("");
  board.innerHTML = cols;

  board.querySelectorAll("[data-move]").forEach((b) => {
    b.addEventListener("click", () => moveCard(b.dataset.id, parseInt(b.dataset.move, 10)));
  });
  board.querySelectorAll("[data-delete]").forEach((b) => {
    b.addEventListener("click", () => deleteCard(b.dataset.delete));
  });
}

function card(it) {
  const i = STATUSES.indexOf(it.status);
  const canLeft  = i > 0;
  const canRight = i < STATUSES.length - 1;
  return `
    <article class="kanban-card">
      <div class="kanban-card-head">
        <strong>${escapeHtml(it.title)}</strong>
        <button class="ghost-x" data-delete="${it.id}" title="delete">×</button>
      </div>
      <p class="muted" style="margin:0.1rem 0 0.4rem">${escapeHtml(it.company)}${it.location ? " · " + escapeHtml(it.location) : ""}</p>
      ${it.url ? `<p><a href="${escapeAttr(it.url)}" target="_blank" rel="noopener" class="mono">↗ open</a></p>` : ""}
      ${it.notes ? `<p class="muted" style="font-size:0.82rem; white-space:pre-wrap">${escapeHtml(it.notes)}</p>` : ""}
      <div class="kanban-move">
        <button class="ghost" data-move="-1" data-id="${it.id}" ${canLeft  ? "" : "disabled"}>←</button>
        <button class="ghost" data-move="+1" data-id="${it.id}" ${canRight ? "" : "disabled"}>→</button>
      </div>
    </article>
  `;
}

async function moveCard(id, delta) {
  const items = await fetch("/api/tracker").then((r) => r.json()).then((d) => d.items || []);
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const i = STATUSES.indexOf(it.status);
  const next = STATUSES[i + delta];
  if (!next) return;
  await fetch("/api/tracker", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...it, status: next }),
  });
  loadTracker();
}

async function deleteCard(id) {
  if (!confirm("delete this entry?")) return;
  await fetch(`/api/tracker/${encodeURIComponent(id)}`, { method: "DELETE" });
  loadTracker();
}

async function saveNewTrackerEntry() {
  const status = $("t_status");
  const payload = {
    title:    $("t_title").value.trim(),
    company:  $("t_company").value.trim(),
    location: $("t_location").value.trim(),
    url:      $("t_url").value.trim(),
    notes:    $("t_notes").value.trim(),
    source:   "manual",
    status:   "to-apply",
  };
  if (!payload.title || !payload.company) {
    status.textContent = "title and company are required";
    status.style.color = "var(--marker)";
    return;
  }
  status.textContent = "saving…";
  status.style.color = "";
  const r = await fetch("/api/tracker", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    status.textContent = data.error || `failed (${r.status})`;
    status.style.color = "var(--marker)";
    return;
  }
  // Clear form
  ["t_title", "t_company", "t_location", "t_url", "t_notes"].forEach((id) => $(id).value = "");
  status.textContent = "added.";
  status.style.color = "";
  loadTracker();
}

// =====================================================================
// Stories
// =====================================================================

async function loadStories() {
  const r = await fetch("/api/stories");
  const data = await r.json().catch(() => ({}));
  renderStories(data.items || []);
}

function renderStories(items) {
  const list = $("stories_list");
  if (items.length === 0) {
    list.innerHTML = `<p class="muted">empty — add your first story above.</p>`;
    return;
  }
  list.innerHTML = items.map((s) => `
    <article class="story-card">
      <header>
        <span class="story-theme">${escapeHtml(s.theme || "general")}</span>
        ${s.source_company ? `<span class="muted">· ${escapeHtml(s.source_company)}</span>` : ""}
        <button class="ghost-x" data-delete="${s.id}" title="delete" style="margin-left:auto">×</button>
      </header>
      <p style="white-space:pre-wrap; margin:0.5rem 0 0">${escapeHtml(s.story)}</p>
    </article>
  `).join("");
  list.querySelectorAll("[data-delete]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("delete this story?")) return;
      await fetch(`/api/stories/${encodeURIComponent(b.dataset.delete)}`, { method: "DELETE" });
      loadStories();
    });
  });
}

async function saveNewStory() {
  const status = $("s_status");
  const payload = {
    theme:          $("s_theme").value.trim(),
    story:          $("s_story").value.trim(),
    source_company: $("s_source").value.trim(),
  };
  if (!payload.story) {
    status.textContent = "story text is required";
    status.style.color = "var(--marker)";
    return;
  }
  status.textContent = "saving…";
  status.style.color = "";
  const r = await fetch("/api/stories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    status.textContent = data.error || `failed (${r.status})`;
    status.style.color = "var(--marker)";
    return;
  }
  ["s_theme", "s_story", "s_source"].forEach((id) => $(id).value = "");
  status.textContent = "added.";
  status.style.color = "";
  loadStories();
}

// --- utils ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// --- bind + boot ----------
$("t_save").addEventListener("click", saveNewTrackerEntry);
$("s_save").addEventListener("click", saveNewStory);
loadTracker();
loadStories();
