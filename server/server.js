// Express server for career-ops-web.
//
// nginx terminates TLS at https://careerops.hemnaath.tech and proxies
// every request here (default port 8001). Auth happens at the nginx
// layer via HTTP Basic Auth — this app trusts whoever nginx lets through.
//
// v1.0 collapses the v0.x scatter of pages into one unified flow at /
// driven by POST /api/find (query + resume → ranked top N). Tracker
// stays as a side-pane for persistent state. PDF tailoring still TODO.

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import findRouter    from "./routes/find.js";       // v1.0 — unified pipeline
import resumeRouter  from "./routes/resume.js";     // file-upload helper (used by /api/find too)
import trackerRouter from "./routes/tracker.js";
import storiesRouter from "./routes/stories.js";
import pdfRouter     from "./routes/pdf.js";        // v1.1 — tailored CV PDF

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const app = express();
app.use(express.json({ limit: "2mb" }));

// HTML must never be cached — otherwise users keep loading old <script>
// tags pointing at stale versions of app.js/style.css. JS/CSS get a
// short cache TTL but their ?v= query strings act as the real bust.
app.use(express.static(join(REPO_ROOT, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith("/")) {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
    } else if (filePath.match(/\.(js|css|svg|png|jpg|webp)$/)) {
      res.set("Cache-Control", "public, max-age=300");  // 5 min
    }
  },
}));

app.get("/healthz", (_req, res) => res.json({ ok: true, version: "1.0.0" }));

app.use("/api/find",    findRouter);
app.use("/api/resume",  resumeRouter);
app.use("/api/tracker", trackerRouter);
app.use("/api/stories", storiesRouter);
app.use("/api/pdf",     pdfRouter);

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  res.status(404).sendFile(join(REPO_ROOT, "public", "404.html"), (err) => {
    if (err) res.status(404).end("not found");
  });
});

const PORT = parseInt(process.env.PORT || "8001", 10);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`career-ops-web v1.0 listening on 127.0.0.1:${PORT}`);
});
