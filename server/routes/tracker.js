// Tracker — pipeline of jobs you're working on.
// Statuses: to-apply | applied | interviewing | decision
//
//   GET    /api/tracker        list everything
//   PUT    /api/tracker        body { id?, title, company, url, status?, ... } → upsert
//   DELETE /api/tracker/:id    remove one

import express from "express";
import { loadCollection, upsert, remove } from "../lib/store.js";

const COLL = "tracker";

const STATUSES = new Set(["to-apply", "applied", "interviewing", "decision"]);

function clean(record) {
  const status = STATUSES.has(record.status) ? record.status : "to-apply";
  return {
    id:       record.id || undefined,
    title:    String(record.title || "").slice(0, 240),
    company:  String(record.company || "").slice(0, 200),
    location: String(record.location || "").slice(0, 200),
    url:      String(record.url || "").slice(0, 500),
    status,
    notes:    String(record.notes || "").slice(0, 4000),
    source:   String(record.source || "").slice(0, 64),  // "scan" | "eval" | "manual"
  };
}

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, items: loadCollection(COLL) });
});

router.put("/", express.json({ limit: "256kb" }), (req, res) => {
  const payload = clean(req.body || {});
  if (!payload.title || !payload.company) {
    return res.status(400).json({ ok: false, error: "title and company are required" });
  }
  const saved = upsert(COLL, payload);
  res.json({ ok: true, item: saved });
});

router.delete("/:id", (req, res) => {
  const n = remove(COLL, req.params.id);
  res.json({ ok: true, deleted: n });
});

export default router;
