// Story bank — STAR+R stories accumulated across evals.
// One row per story, tagged by behavioral theme. Manual entry for v0.4;
// auto-extraction from eval reports queued for v0.4.1.

import express from "express";
import { loadCollection, upsert, remove } from "../lib/store.js";

const COLL = "stories";

function clean(record) {
  return {
    id:        record.id || undefined,
    theme:     String(record.theme  || "general").toLowerCase().slice(0, 64),
    story:     String(record.story  || "").slice(0, 4000),
    source_company: String(record.source_company || "").slice(0, 200),
    source_title:   String(record.source_title   || "").slice(0, 240),
  };
}

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, items: loadCollection(COLL) });
});

router.post("/", express.json({ limit: "256kb" }), (req, res) => {
  const payload = clean(req.body || {});
  if (!payload.story.trim()) {
    return res.status(400).json({ ok: false, error: "story text is required" });
  }
  const saved = upsert(COLL, payload);
  res.json({ ok: true, item: saved });
});

router.delete("/:id", (req, res) => {
  const n = remove(COLL, req.params.id);
  res.json({ ok: true, deleted: n });
});

export default router;
