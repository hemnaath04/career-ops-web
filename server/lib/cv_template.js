// Render an RxResume-shape JSON object into ATS-friendly HTML.
//
// Plain text-flow layout (no grid/flex for primary content) so ATS
// parsers extract correctly. @page Letter rules size the PDF when
// Playwright prints it.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function rowFlex(left, right) {
  return `<div class="row"><div>${left}</div><div class="right">${right}</div></div>`;
}

function joinAlive(parts, sep = ' &nbsp;·&nbsp; ') {
  return parts.filter(Boolean).join(sep);
}


export function renderCvHtml({ cv, job }) {
  const b = cv.basics || {};
  const s = cv.sections || {};

  // Contact line
  const contact = joinAlive([
    b.location ? esc(b.location) : "",
    b.email    ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "",
    b.phone    ? esc(b.phone) : "",
    b.url      ? `<a href="${esc(b.url)}">${esc(b.url)}</a>` : "",
    ...(b.profiles || [])
      .filter((p) => p.url)
      .map((p) => `<a href="${esc(p.url)}">${esc(p.network)}/${esc(p.username)}</a>`),
  ]);

  const experience = (s.experience?.items || []).map((it) => `
    <div class="entry">
      ${rowFlex(
        `<h3>${esc(it.position)}${it.company ? ` — <span class="org">${esc(it.company)}</span>` : ""}</h3>`,
        `<span class="meta">${esc(it.date)}${it.location ? ` · ${esc(it.location)}` : ""}</span>`
      )}
      ${it.summary ? `<p class="meta sub">${esc(it.summary)}</p>` : ""}
      ${it.highlights?.length ? `<ul>${it.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
    </div>
  `).join("");

  const projects = (s.projects?.items || []).map((it) => `
    <div class="entry">
      ${rowFlex(
        `<h3>${esc(it.name)}${it.url ? ` — <a href="${esc(it.url)}" class="proj-link">${esc(it.url)}</a>` : ""}</h3>`,
        it.date ? `<span class="meta">${esc(it.date)}</span>` : ""
      )}
      ${it.description ? `<p>${esc(it.description)}</p>` : ""}
      ${it.keywords?.length ? `<p class="kw">${it.keywords.map(esc).join(" · ")}</p>` : ""}
    </div>
  `).join("");

  const education = (s.education?.items || []).map((it) => `
    ${rowFlex(
      `<h3>${esc(it.institution)}${(it.area || it.studyType)
        ? ` — <span class="org">${esc(it.studyType)}${it.studyType && it.area ? ", " : ""}${esc(it.area)}</span>` : ""}</h3>`,
      `<span class="meta">${esc(it.date)}${it.score ? ` · ${esc(it.score)}` : ""}</span>`
    )}
  `).join("");

  const skills = (s.skills?.items || []).map((it) => `
    <p class="skills-row"><strong>${esc(it.name)}.</strong> ${it.keywords.map(esc).join(", ")}</p>
  `).join("");

  const certs = (s.certifications?.items || []).map((it) => `
    ${rowFlex(
      `<span><strong>${esc(it.name)}</strong>${it.issuer ? ` — ${esc(it.issuer)}` : ""}</span>`,
      `<span class="meta">${esc(it.date)}</span>`
    )}
  `).join("");

  const awards = (s.awards?.items || []).map((it) => `
    ${rowFlex(
      `<span><strong>${esc(it.title)}</strong>${it.awarder ? ` — ${esc(it.awarder)}` : ""}</span>`,
      `<span class="meta">${esc(it.date)}</span>`
    )}
  `).join("");

  const jobLabel = job?.company && job?.title ? `${esc(job.title)} @ ${esc(job.company)}` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(b.name || "Resume")}${jobLabel ? ` — ${jobLabel}` : ""}</title>
<style>
  @page { size: Letter; margin: 0.55in 0.6in; }
  :root {
    --ink:    #1a1a1a;
    --muted:  #555;
    --rule:   #999;
    --accent: #7a4b00;
  }
  * { box-sizing: border-box; }
  body {
    color: var(--ink);
    font-family: "Charter", "Iowan Old Style", "Source Serif Pro", Cambria, Georgia, serif;
    font-size: 10.5pt;
    line-height: 1.42;
    max-width: 7.4in;
    margin: 0 auto;
    padding: 0.4in 0.55in;
    background: #fff;
  }
  h1, h2, h3 { margin: 0; font-weight: 700; }
  h1 { font-size: 22pt; letter-spacing: -0.01em; line-height: 1.05; margin-bottom: 0.18em; }
  h2 {
    font-size: 11.5pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    border-bottom: 1.5px solid var(--rule);
    padding-bottom: 0.18em;
    margin-top: 1.0em;
    margin-bottom: 0.45em;
  }
  h3 { font-size: 11.5pt; line-height: 1.2; }
  p, ul { margin: 0.18em 0; }
  ul { padding-left: 1.05em; }
  ul li { margin: 0.08em 0; }
  .headline {
    font-size: 11pt;
    color: var(--muted);
    margin-top: 0;
    margin-bottom: 0.4em;
  }
  .contact { font-size: 9.5pt; margin: 0.1em 0 0.4em; }
  .contact a { color: var(--ink); text-decoration: none; border-bottom: 1px dotted var(--rule); }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.8em; }
  .right { text-align: right; color: var(--muted); }
  .meta { color: var(--muted); font-size: 9.5pt; }
  .meta.sub { margin-top: 0.05em; }
  .org { font-weight: 600; }
  .summary { margin-bottom: 0.5em; }
  .skills-row { margin: 0.18em 0; }
  .kw { font-size: 9.5pt; color: var(--muted); margin-top: 0.1em; }
  .entry { margin-bottom: 0.55em; }
  .proj-link { font-weight: 500; font-size: 10.5pt; }
  .footer-tag {
    margin-top: 1.4em;
    font-size: 7.5pt;
    color: #aaa;
    text-align: right;
    letter-spacing: 0.04em;
  }
  @media print { body { padding: 0; max-width: none; } .footer-tag { display: none; } }
</style>
</head>
<body>
  <header>
    <h1>${esc(b.name)}</h1>
    ${b.headline ? `<p class="headline">${esc(b.headline)}</p>` : ""}
    <p class="contact">${contact}</p>
  </header>

  ${cv.summary ? `<section><h2>Summary</h2><p class="summary">${esc(cv.summary)}</p></section>` : ""}
  ${experience ? `<section><h2>Experience</h2>${experience}</section>` : ""}
  ${projects   ? `<section><h2>Projects</h2>${projects}</section>` : ""}
  ${skills     ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${education  ? `<section><h2>Education</h2>${education}</section>` : ""}
  ${certs      ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
  ${awards     ? `<section><h2>Awards</h2>${awards}</section>` : ""}

  ${jobLabel ? `<p class="footer-tag">tailored for ${jobLabel}</p>` : ""}
</body>
</html>`;
}
