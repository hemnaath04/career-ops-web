// POST /api/eval
//
// Body: { jd?, jd_url?, cv?, proof_points?, profile?, mode? }
//   - At least one of jd / jd_url must be present.
//   - mode defaults to "oferta" (career-ops's single-job A-F evaluation).
//
// Returns: { ok: true, report: "<markdown A-F report>" }
//
// We always use career-ops's mode file VERBATIM as the system prompt, so
// the output structure matches what a Claude Code user would see. The
// only addition is a non-agentic execution note (see lib/prompts.js).

import express from "express";
import { complete } from "../lib/llm.js";
import { loadMode, buildUserMessage } from "../lib/prompts.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { jd, jd_url, cv, proof_points, profile, mode = "oferta" } =
    req.body || {};

  if (!jd?.trim() && !jd_url?.trim()) {
    return res.status(400).json({
      ok: false,
      error: "provide either `jd` (pasted text) or `jd_url`",
    });
  }

  let system;
  try {
    system = loadMode(mode);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const user = buildUserMessage({
    jd, jdUrl: jd_url, cv, proofPoints: proof_points, profile,
  });

  try {
    const report = await complete({ system, user, maxTokens: 4000 });
    res.json({ ok: true, mode, report });
  } catch (e) {
    console.error("eval failed:", e?.message || e);
    res.status(502).json({
      ok: false,
      error: `LLM call failed: ${e?.message || e}`,
    });
  }
});

export default router;
