// career-ops-web frontend — vanilla JS, no framework.
//
// Single page right now: posts to /api/eval and renders the markdown
// response. v0.2+ will add separate pages for PDF / scan / tracker.

const $ = (id) => document.getElementById(id);

// File upload → parse to text → drop into the CV textarea.
async function handleResumeUpload(e) {
  const file = e.target.files[0];
  const status = $("cv_file_status");
  if (!file) return;

  status.textContent = `parsing ${file.name}…`;
  status.style.color = "";

  const fd = new FormData();
  fd.append("file", file);

  try {
    const r = await fetch("/api/resume/parse", { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      status.textContent = data?.error || `failed (${r.status})`;
      status.style.color = "var(--marker)";
      return;
    }
    $("cv").value = data.text;
    status.textContent = `parsed ${file.name} → ${data.chars.toLocaleString()} characters`;
    status.style.color = "";
  } catch (err) {
    status.textContent = `network error: ${err?.message || err}`;
    status.style.color = "var(--marker)";
  }
}

async function runEval() {
  const btn = $("run");
  const errorEl = $("error");
  const reportEl = $("report");

  errorEl.style.display = "none";
  reportEl.textContent = "";

  const payload = {
    jd:      $("jd").value.trim(),
    jd_url:  $("jd_url").value.trim(),
    cv:      $("cv").value.trim(),
    profile: $("profile").value.trim(),
  };

  if (!payload.jd && !payload.jd_url) {
    errorEl.textContent = "paste a JD or a URL first.";
    errorEl.style.display = "block";
    return;
  }
  if (!payload.cv) {
    errorEl.textContent = "paste your CV (markdown). Career-ops needs " +
      "your resume to evaluate the match.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "thinking…";
  const t0 = performance.now();

  try {
    const r = await fetch("/api/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data.ok) {
      errorEl.textContent = data?.error || `request failed (${r.status})`;
      errorEl.style.display = "block";
      return;
    }
    const dt = Math.round((performance.now() - t0) / 100) / 10;
    reportEl.textContent = data.report || "(no content)";
    // Crude scroll-into-view since this can be long.
    reportEl.scrollIntoView({ behavior: "smooth", block: "start" });
    console.log(`eval finished in ${dt}s`);
  } catch (e) {
    errorEl.textContent = `network error: ${e?.message || e}`;
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "evaluate →";
  }
}

$("run").addEventListener("click", runEval);
$("cv_file").addEventListener("change", handleResumeUpload);
