// POST /api/resume/parse
//
// multipart/form-data with field `file` containing the resume.
// Returns: { ok: true, text: "<plain text>", chars: N }
//
// Frontend uses this to convert PDF/HTML uploads into the text that
// gets dumped into the CV textarea before submission to /api/eval.

import express from "express";
import multer from "multer";

import {
  ALLOWED_EXT_LIST,
  MAX_RESUME_BYTES,
  extensionFromFilename,
  isAllowedExt,
  looksLegit,
  parseResume,
} from "../lib/resume.js";

const router = express.Router();

// In-memory upload; never hits disk. Adequate for 5MB resumes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_RESUME_BYTES, files: 1 },
});

router.post("/parse", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      ok: false,
      error: "no file uploaded — POST multipart/form-data with field 'file'",
    });
  }

  const ext = extensionFromFilename(req.file.originalname || "");
  if (!isAllowedExt(ext)) {
    return res.status(400).json({
      ok: false,
      error: `unsupported file type ${ext || "(none)"} — must be one of: ${ALLOWED_EXT_LIST.join(", ")}`,
    });
  }

  if (!looksLegit(ext, req.file.buffer)) {
    return res.status(400).json({
      ok: false,
      error: `file content doesn't match the ${ext} extension (magic-byte / encoding check failed)`,
    });
  }

  try {
    const text = await parseResume(ext, req.file.buffer);
    res.json({ ok: true, text, chars: text.length });
  } catch (e) {
    console.error("resume parse failed:", e?.message || e);
    res.status(422).json({
      ok: false,
      error: `couldn't parse: ${e?.message || e}`,
    });
  }
});

export default router;
