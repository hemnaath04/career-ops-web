// POST /api/find — streaming NDJSON.
//
// Body (multipart/form-data):
//   query        what role you want, free text
//   location     optional location filter
//   resume       file upload (PDF/HTML/MD/TXT, ≤5MB), OR
//   resume_text  plain-text resume
//   top_n        optional, default 50
//
// Response: Content-Type: application/x-ndjson, one JSON object per line.
//   {type:"intent", intent}
//   {type:"stats",  stats, fetched}
//   {type:"scoring_start", total}
//   {type:"scored", job}                       (one per scored job)
//   {type:"done",   elapsed_ms, kept, top_n, jobs}   ← final ranked top-N

import express from "express";
import multer  from "multer";

import { runPipeline } from "../lib/pipeline.js";
import {
  ALLOWED_EXT_LIST, MAX_RESUME_BYTES,
  extensionFromFilename, isAllowedExt, looksLegit, parseResume,
} from "../lib/resume.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_RESUME_BYTES, files: 1 },
});


router.post("/", upload.single("resume"), async (req, res) => {
  const query    = String(req.body.query    || "").trim();
  const location = String(req.body.location || "").trim();
  let   resumeText = String(req.body.resume_text || "").trim();
  const topN     = parseInt(req.body.top_n || "50", 10);

  if (!query) {
    return res.status(400).json({ ok: false, error: "what role are you looking for?" });
  }

  if (req.file) {
    const ext = extensionFromFilename(req.file.originalname || "");
    if (!isAllowedExt(ext)) {
      return res.status(400).json({
        ok: false,
        error: `unsupported resume type ${ext} — must be ${ALLOWED_EXT_LIST.join(", ")}`,
      });
    }
    if (!looksLegit(ext, req.file.buffer)) {
      return res.status(400).json({ ok: false, error: `${ext} content didn't pass the magic-byte check` });
    }
    try {
      resumeText = await parseResume(ext, req.file.buffer);
    } catch (e) {
      return res.status(422).json({ ok: false, error: `couldn't parse resume: ${e?.message || e}` });
    }
  }

  if (!resumeText) {
    return res.status(400).json({ ok: false, error: "upload your resume or paste it as markdown" });
  }

  // Stream NDJSON. nginx must have proxy_buffering off (or a long-enough
  // timeout) to forward each chunk as it lands.
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");        // tells nginx: don't buffer

  const write = (event) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(event) + "\n");
  };

  // Heartbeat — keeps proxies awake during long scoring loops.
  const heartbeat = setInterval(() => write({ type: "heartbeat", t: Date.now() }), 15_000);

  // Reflect parsed resume text so the frontend can use it later for
  // per-job CV tailoring without re-uploading.
  write({ type: "resume", resume_text: resumeText });

  try {
    const result = await runPipeline({
      query, location, resumeText, topN,
      onEvent: write,
    });
    write({ ...{ type: "done" }, jobs: result.jobs, elapsed_ms: result.elapsed_ms, kept: result.jobs.length, top_n: topN });
  } catch (e) {
    console.error("pipeline failed:", e);
    write({ type: "error", error: `pipeline error: ${e?.message || e}` });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});


export default router;
