// POST /api/find — the unified pipeline.
//
// Body (multipart/form-data):
//   query        — what role you want, free text
//   location     — optional, "United States" / "Boston, MA" / "Remote"
//   resume       — file upload (PDF/HTML/MD/TXT, ≤5MB), OR
//   resume_text  — plain-text resume (if user pasted markdown instead)
//
// Returns JSON: { ok, intent, stats, jobs: [...top N], elapsed_ms }
//
// Long-running (30s-2min depending on how many providers respond),
// so the frontend shows a loading state with the rough phase the
// pipeline is in.

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

  if (!query) {
    return res.status(400).json({ ok: false, error: "what role are you looking for?" });
  }

  // If a file came in, parse it. Otherwise we need resume_text.
  if (req.file) {
    const ext = extensionFromFilename(req.file.originalname || "");
    if (!isAllowedExt(ext)) {
      return res.status(400).json({
        ok: false,
        error: `unsupported resume type ${ext} — must be one of ${ALLOWED_EXT_LIST.join(", ")}`,
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

  try {
    const result = await runPipeline({
      query,
      location,
      resumeText,
      topN: parseInt(req.body.top_n || "20", 10),
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("pipeline failed:", e);
    res.status(500).json({ ok: false, error: `pipeline error: ${e?.message || e}` });
  }
});


export default router;
