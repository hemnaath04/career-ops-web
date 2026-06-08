# career-ops-web

A minimal web GUI on top of [santifer/career-ops](https://github.com/santifer/career-ops)
by Santiago Fernández de Valderrama ([santifer.io](https://santifer.io)).
All the heavy lifting — the A-F evaluation rubric, the curated company
list, the mode prompts — lives in his repo. This is just the browser
shell. See [ATTRIBUTION.md](./ATTRIBUTION.md).

The original career-ops is a Node CLI + a folder of agent prompts (`modes/*.md`)
designed to run inside Claude Code / Gemini CLI. This wraps those same prompts
in an Express server + a static HTML frontend so you can use career-ops from a
browser, hosted on your own droplet, gated by HTTP Basic Auth.

## Status — v0.1

| Feature | Status |
|---|---|
| Single-job evaluation (`POST /api/eval`, `modes/oferta.md`) | ✅ working |
| PDF tailored CV | 🚧 v0.2 |
| Portal scanner (45+ companies via ATS APIs) | 🚧 v0.3 |
| Tracker + story bank | 🚧 v0.4 |

## Credits

- **[santifer/career-ops](https://github.com/santifer/career-ops)** —
  Santiago Fernández de Valderrama. MIT-licensed. This project would
  not exist without his evaluation framework, mode prompts, and
  curated portals list.
- See [ATTRIBUTION.md](./ATTRIBUTION.md) for the full attribution.

## Architecture

```
browser
  ↓ https://careerops.<your-domain>
nginx  (TLS + HTTP Basic Auth gate)
  ↓ 127.0.0.1:8001
Express server (server/server.js)
  ↓ reads modes/oferta.md as system prompt
  ↓ calls Claude via OpenAI-compatible proxy (OPENAI_BASE_URL)
  ↓ returns the markdown report
browser renders it
```

## Local development

```bash
git clone <this repo> career-ops-web
cd career-ops-web

# Clone the career-ops engine alongside
git clone https://github.com/santifer/career-ops.git ../career-ops

npm install
cp .env.example .env
# Edit .env with your OPENAI_API_KEY + OPENAI_BASE_URL

npm run dev
# Open http://localhost:8001
```

## Production deploy on Ubuntu droplet

One-shot bootstrap:

```bash
# on the droplet, as root
cd /opt
git clone <this repo> career-ops-web
cd career-ops-web
sudo bash deploy/setup.sh careerops.<your-domain> <basic-auth-username>
```

Then follow the printed instructions:

1. Add DNS A/CNAME for `careerops.<your-domain>` pointing at the droplet
2. Edit `/opt/career-ops-web/.env` with your real Claude proxy credentials
3. `sudo systemctl enable --now careerops`
4. `sudo certbot --nginx -d careerops.<your-domain>`

## Updating

```bash
ssh root@<droplet> 'cd /opt/career-ops-web && git pull && npm install --omit=dev && sudo systemctl restart careerops'
```

If you want auto-deploy on push, mirror the workflow used in the sibling
`job-searcher` repo (`.github/workflows/deploy.yml`).

## Why this exists

Career-ops's evaluation framework (A-F rubric, hits/gaps/mitigation, STAR
prep) is excellent, but it requires an agent CLI to drive it. This project
extracts the prompts and runs them via a single LLM call, so you can use
career-ops without installing Claude Code on the droplet.

The original career-ops repo is required at runtime — we clone it during
setup and the server reads its `modes/*.md` files at request time. Updating
career-ops (`git pull`) gets you any prompt improvements without changing
this code.
