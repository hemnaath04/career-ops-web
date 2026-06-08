// Tiny file-backed JSON store.
//
// One file per collection, atomic writes via tmpfile-then-rename. No
// indexes, no schema validation — this is a personal-use app with
// <1000 records expected. Each record needs an `id`; the collection
// is a flat array.
//
// Race-free for our single-process workload (read-modify-write inside
// a single Node event loop tick).

import {
  existsSync, mkdirSync,
  readFileSync, renameSync, writeFileSync, unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";

function pathFor(name) {
  return join(DATA_DIR, `${name}.json`);
}

function ensureDir(file) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadCollection(name) {
  const f = pathFor(name);
  if (!existsSync(f)) return [];
  try {
    const raw = readFileSync(f, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`store: ${f} unreadable (${e.message}); treating as empty`);
    return [];
  }
}

function atomicWrite(file, content) {
  ensureDir(file);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

export function saveCollection(name, items) {
  const f = pathFor(name);
  atomicWrite(f, JSON.stringify(items, null, 2) + "\n");
}

export function genId() {
  // 64 bits of entropy, hex — collision-resistant for any personal scale.
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// CRUD helpers — operate on an in-memory copy + persist.

export function upsert(name, record) {
  const items = loadCollection(name);
  const now = new Date().toISOString();
  record.updated_at = now;
  if (!record.id) {
    record.id = genId();
    record.created_at = now;
    items.unshift(record);
  } else {
    const i = items.findIndex((r) => r.id === record.id);
    if (i >= 0) items[i] = { ...items[i], ...record };
    else { record.created_at = now; items.unshift(record); }
  }
  saveCollection(name, items);
  return record;
}

export function remove(name, id) {
  const items = loadCollection(name);
  const next = items.filter((r) => r.id !== id);
  const removed = items.length - next.length;
  if (removed) saveCollection(name, next);
  return removed;
}

export function findById(name, id) {
  return loadCollection(name).find((r) => r.id === id) || null;
}
