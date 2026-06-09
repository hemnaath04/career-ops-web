// Tailored CV pipeline.
//
//   POST   /api/pdf/generate    body { resume_text, job }
//                               → kicks off LLM + saves the JSON
//                               → returns { share_id, view_url, download_url }
//
//   GET    /api/pdf/:id/view    renders the HTML
//   GET    /api/pdf/:id.pdf     streams the rendered PDF
//
// CVs persist in data/cvs.json (file-store). 30-day expiry isn't enforced
// at the moment — for a personal app, just nuke the file if it gets big.

import express from "express";
import crypto  from "node:crypto";

import { upsert, findById, loadCollection } from "../lib/store.js";
import { generateCvJson } from "../lib/cv_generator.js";
import { renderCvHtml }   from "../lib/cv_template.js";
import { htmlToPdf }      from "../lib/pdf.js";

const COLL = "cvs";

const router = express.Router();

function newShareId() {
  return crypto.randomBytes(8).toString("hex");
}


router.post("/generate", express.json({ limit: "256kb" }), async (req, res) => {
  const { resume_text, job } = req.body || {};
  if (!resume_text || !resume_text.trim()) {
    return res.status(400).json({ ok: false, error: "resume_text required" });
  }
  if (!job?.title || !job?.company) {
    return res.status(400).json({ ok: false, error: "job.title and job.company required" });
  }

  const cv_json = await generateCvJson({ resumeText: resume_text, job });
  if (!cv_json) {
    return res.status(502).json({ ok: false, error: "CV generation failed" });
  }

  const share_id = newShareId();
  const saved = upsert(COLL, {
    share_id,
    cv_json,
    job: {
      title:    job.title,
      company:  job.company,
      location: job.location || "",
      url:      job.url || "",
      source:   job.source || "",
    },
  });

  res.json({
    ok: true,
    share_id,
    view_url:     `/api/pdf/${share_id}/view`,
    download_url: `/api/pdf/${share_id}.pdf`,
    id:           saved.id,
  });
});


function lookup(share_id) {
  return loadCollection(COLL).find((r) => r.share_id === share_id) || null;
}


router.get("/:share_id/view", (req, res) => {
  const doc = lookup(req.params.share_id);
  if (!doc) return res.status(404).send("Not found");
  res.type("html").send(renderCvHtml({ cv: doc.cv_json, job: doc.job }));
});


router.get("/:share_id.pdf", async (req, res) => {
  const doc = lookup(req.params.share_id);
  if (!doc) return res.status(404).send("Not found");
  try {
    const html = renderCvHtml({ cv: doc.cv_json, job: doc.job });
    const pdf  = await htmlToPdf(html);
    const slug = `${(doc.job.title || "cv").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${doc.job.company?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}`;
    res
      .type("application/pdf")
      .header("Content-Disposition", `inline; filename="${slug}.pdf"`)
      .send(pdf);
  } catch (e) {
    console.error("pdf render failed:", e);
    res.status(500).send(`PDF render failed: ${e?.message || e}`);
  }
});


export default router;
