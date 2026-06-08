// Loads career-ops's mode markdown files as system prompts.
//
// Each mode under career-ops/modes/*.md is a self-contained agent
// instruction set. We treat the markdown as the system prompt verbatim,
// then pass the user's job description as the user message. This is
// what career-ops itself does when an agent CLI reads the file.
//
// We append a short instruction asking the model to emit one final
// MARKDOWN report (not interactive output), since the original modes
// were written for an interactive Claude Code session.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_DIR = process.env.CAREER_OPS_DIR || "../career-ops";

// Make the prompt-as-API-call request explicit. The original mode files
// expect to be running inside an agent loop with tools and iterative
// thinking; here we get one shot, so be clear about what we want.
const NON_AGENTIC_SUFFIX = `

---

EXECUTION NOTE (overrides any "use the Agent tool" / "use Playwright" /
"call this script" instructions in the mode above):

You are running as a one-shot LLM call, not inside an interactive agent
loop. You do NOT have tools available. Produce the FINAL output that
the mode describes — a complete markdown report — based solely on the
candidate profile and job description provided in the user message.

If the mode references files that would normally be read at runtime
(cv.md, article-digest.md, etc.), use the inline equivalents in the
user message. If the mode references writing files (reports/*.md,
pipeline.md), simply produce the markdown content the user can save.

Output ONLY the markdown report. No preamble, no "I'll now..." narration.
`;


export function loadMode(name) {
  const path = join(REPO_DIR, "modes", `${name}.md`);
  if (!existsSync(path)) {
    throw new Error(`Mode not found: ${name} (looked in ${path}). ` +
      `Set CAREER_OPS_DIR to the career-ops repo root.`);
  }
  const raw = readFileSync(path, "utf8");
  return raw + NON_AGENTIC_SUFFIX;
}

// Compose the user-message payload from the candidate-side inputs.
export function buildUserMessage({ jd, jdUrl, cv, proofPoints, profile }) {
  const parts = [];
  if (profile)     parts.push(`=== CANDIDATE PROFILE ===\n${profile}`);
  if (cv)          parts.push(`=== CV (markdown) ===\n${cv}`);
  if (proofPoints) parts.push(`=== PROOF POINTS ===\n${proofPoints}`);
  if (jdUrl)       parts.push(`=== JOB URL ===\n${jdUrl}`);
  if (jd)          parts.push(`=== JOB DESCRIPTION ===\n${jd}`);
  return parts.join("\n\n");
}
