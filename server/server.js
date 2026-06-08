// Express server for career-ops-web.
//
// nginx terminates TLS at https://careerops.hemnaath.tech and proxies
// every request here (default port 8001). Auth happens at the nginx
// layer via HTTP Basic Auth — this app trusts whoever nginx lets through.
//
// v0.1 ships /api/eval only; /api/pdf, /api/scan, /api/tracker are
// stubbed and return 501 with a "coming soon" message.

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import evalRouter   from "./routes/eval.js";
import resumeRouter from "./routes/resume.js";
import scanRouter   from "./routes/scan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Static frontend
app.use(express.static(join(REPO_ROOT, "public")));

// Cheap liveness probe — nginx + deploy scripts hit this to verify the
// service came up cleanly.
app.get("/healthz", (_req, res) => res.json({ ok: true, version: "0.1.0" }));

// Active features
app.use("/api/eval",   evalRouter);
app.use("/api/resume", resumeRouter);
app.use("/api/scan",   scanRouter);     // v0.3

// v0.2+ stubs. Returning 501 (Not Implemented) is more honest than a 404
// because the route IS defined; the feature just isn't there yet.
const comingSoon = (feature) => (_req, res) =>
  res.status(501).json({
    ok: false,
    feature,
    error: `${feature} not implemented in v0.1 — shipping in a follow-up`,
  });

app.post("/api/pdf",     comingSoon("PDF tailored CV"));
app.get ("/api/tracker", comingSoon("tracker view"));
app.get ("/api/stories", comingSoon("story bank"));

// Catch-all that returns JSON for /api/* and HTML 404 for everything else,
// so the SPA-ish frontend stays predictable.
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
  console.log(`career-ops-web listening on 127.0.0.1:${PORT}`);
});
