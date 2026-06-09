// Generate a tailored CV for one specific job.
//
// LLM emits RxResume-compatible JSON. We render that JSON via a server-
// side HTML template + Playwright to produce a one-page ATS-friendly PDF.
//
// Rules baked into the prompt:
//   - Never invent facts. Skills / dates / roles must appear in the raw
//     resume. If unclear in the source, leave blank.
//   - Tailor by EMPHASIS — reorder bullets, surface relevant skills,
//     inject JD keywords ONLY where they describe the candidate's real
//     work. No fabrication.
//   - Keep every employer + education entry (de-emphasize, don't drop).

import { complete } from "./llm.js";

const SYSTEM_PROMPT = `You are a resume tailor. Take a raw resume + a target job and produce
a tailored, ATS-friendly resume as a JSON object.

CRITICAL RULES (do not violate):
  1. Do NOT invent facts. Skills, jobs, projects, dates, schools, metrics
     in the output must appear in the raw resume. If unclear, leave blank.
  2. Tailor by emphasis and ordering, not by fabrication:
       - Reorder experience.items so the most JD-relevant role is first.
       - Promote bullets that match JD hits to the top of highlights.
       - Inject JD keywords ONLY where they truthfully describe work.
  3. Keep EVERY employer and EVERY education entry. You may de-emphasize
     by trimming highlights, but do not drop them.
  4. Skills section contains the candidate's real skills, ordered so JD-
     matched ones come first.
  5. Summary is 2-3 lines positioned for THIS specific role, grounded
     in the resume.

OUTPUT — respond with ONLY a JSON object (no prose, no markdown fence):

{
  "basics": {
    "name":     "<from resume>",
    "headline": "<2-6 word professional headline tailored for this role>",
    "email":    "<from resume or empty>",
    "phone":    "<from resume or empty>",
    "location": "<from resume or empty>",
    "url":      "<from resume or empty>",
    "profiles": [
      {"network": "GitHub|LinkedIn|...", "username": "<handle>", "url": "<url>"}
    ]
  },
  "summary":  "<2-3 lines, positioned for this role>",
  "sections": {
    "experience": {
      "items": [
        {
          "company":  "<from resume>",
          "position": "<from resume>",
          "location": "<from resume or empty>",
          "date":     "<from resume verbatim>",
          "summary":  "<optional one-line role summary>",
          "highlights": ["<bullet>", "<bullet>", ...]
        }
      ]
    },
    "projects": {
      "items": [
        {"name": "...", "description": "...", "keywords": ["..."], "url": "<or empty>", "date": "<or empty>"}
      ]
    },
    "education": {
      "items": [
        {"institution": "...", "area": "...", "studyType": "Bachelor|Master|...",
         "date": "<from resume>", "score": "<GPA if present>"}
      ]
    },
    "skills": {
      "items": [
        {"name": "Programming Languages", "keywords": ["Python", "Go", "..."]},
        {"name": "Frameworks", "keywords": ["React", "FastAPI", "..."]}
      ]
    },
    "certifications": {"items": [{"name": "...", "issuer": "...", "date": "..."}]},
    "awards":         {"items": [{"title": "...", "awarder": "...", "date": "..."}]}
  }
}

Omit any section the resume doesn't support (use empty arrays). Be concise —
no padded fluff. The target audience is an ATS scanner first, then a human.`;


function extractJson(text) {
  const s = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try { return JSON.parse(s); }
  catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in response");
    return JSON.parse(m[0]);
  }
}

function clip(s, n) { return String(s ?? "").slice(0, n); }
function asList(v) { return Array.isArray(v) ? v : []; }


function normalize(data) {
  if (!data || typeof data !== "object") {
    return { basics: {}, summary: "", sections: {} };
  }
  const basics = data.basics || {};
  const profiles = asList(basics.profiles);
  const sections = data.sections || {};

  const items = (name, max = 20) => asList(sections[name]?.items).slice(0, max);

  return {
    basics: {
      name:     clip(basics.name, 120),
      headline: clip(basics.headline, 160),
      email:    clip(basics.email, 160),
      phone:    clip(basics.phone, 60),
      location: clip(basics.location, 160),
      url:      clip(basics.url, 300),
      profiles: profiles
        .filter((p) => p && typeof p === "object")
        .slice(0, 6)
        .map((p) => ({
          network:  clip(p.network, 32),
          username: clip(p.username, 60),
          url:      clip(p.url, 300),
        })),
    },
    summary: clip(data.summary, 1500),
    sections: {
      experience: {
        items: items("experience").map((it) => ({
          company:    clip(it.company, 120),
          position:   clip(it.position, 120),
          location:   clip(it.location, 120),
          date:       clip(it.date, 60),
          summary:    clip(it.summary, 300),
          highlights: asList(it.highlights).slice(0, 8).map((h) => clip(h, 300)),
        })),
      },
      education: {
        items: items("education").map((it) => ({
          institution: clip(it.institution, 160),
          area:        clip(it.area, 120),
          studyType:   clip(it.studyType, 60),
          date:        clip(it.date, 60),
          score:       clip(it.score, 30),
        })),
      },
      projects: {
        items: items("projects").map((it) => ({
          name:        clip(it.name, 120),
          description: clip(it.description, 600),
          keywords:    asList(it.keywords).slice(0, 12).map((k) => clip(k, 32)),
          url:         clip(it.url, 300),
          date:        clip(it.date, 60),
        })),
      },
      skills: {
        items: items("skills", 10).map((it) => ({
          name:     clip(it.name, 60),
          keywords: asList(it.keywords).slice(0, 24).map((k) => clip(k, 32)),
        })),
      },
      certifications: {
        items: items("certifications", 10).map((it) => ({
          name:   clip(it.name, 120),
          issuer: clip(it.issuer, 120),
          date:   clip(it.date, 60),
        })),
      },
      awards: {
        items: items("awards", 10).map((it) => ({
          title:   clip(it.title, 120),
          awarder: clip(it.awarder, 120),
          date:    clip(it.date, 60),
        })),
      },
    },
  };
}


function buildUserMessage({ resumeText, job }) {
  const hits = asList(job.hits).slice(0, 5).join("; ");
  const gaps = asList(job.gaps).slice(0, 5).join("; ");
  const desc = clip(job.description || "", 5000);
  return [
    "=== RAW RESUME (verbatim) ===",
    clip(resumeText, 12000),
    "",
    "=== TARGET JOB ===",
    `Company:  ${job.company || ""}`,
    `Title:    ${job.title || ""}`,
    `Location: ${job.location || ""}`,
    "",
    "Description:",
    desc,
    "",
    hits ? `Hits the scorer flagged: ${hits}` : "",
    gaps ? `Gaps the scorer flagged: ${gaps}` : "",
  ].filter(Boolean).join("\n");
}


export async function generateCvJson({ resumeText, job }) {
  if (!resumeText) return null;
  const user = buildUserMessage({ resumeText, job });
  try {
    const out = await complete({
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 2400,
    });
    return normalize(extractJson(out));
  } catch (e) {
    console.warn("generateCvJson failed:", e?.message || e);
    return null;
  }
}
