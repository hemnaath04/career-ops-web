# jobspy-service

Tiny FastAPI sidecar that wraps [python-jobspy](https://github.com/cullenwatson/JobSpy).

career-ops-web's pipeline POSTs here when a user submits a search;
JobSpy fans out to LinkedIn, Indeed, Glassdoor, Google Jobs, and
ZipRecruiter via their public job-search pages.

## What this gives you

- Free LinkedIn coverage (no Apify, no proxies, until your droplet IP
  gets rate-limited)
- Indeed, Glassdoor, Google Jobs, ZipRecruiter in the same request
- Self-hosted — no API keys, no monthly quotas

## Endpoints

- `GET  /healthz` — liveness ping
- `POST /search`  — body `{ site_name, search_term, location, ... }` →
  `{ jobs: [...], count: N }`

Listens on `127.0.0.1:8002` only. career-ops-web (port 8001) calls it
via localhost; nothing else can reach it.

## Install on the droplet

From the career-ops-web repo root:

```bash
sudo bash deploy/setup-jobspy.sh
```

That installs `python3-venv`, creates `/opt/jobspy-service/` owned by
the `careerops` user, builds a Python venv, installs deps, and starts
the systemd service.

To enable in career-ops-web, set in `/opt/career-ops-web/.env`:

```bash
ENABLE_JOBSPY=1
JOBSPY_URL=http://127.0.0.1:8002
JOBSPY_SITES=linkedin,indeed,glassdoor,google
JOBSPY_RESULTS_PER_SITE=20
JOBSPY_HOURS_OLD=72
```

Then `sudo systemctl restart careerops`.

## Watch the logs

```bash
sudo journalctl -u jobspy -f
```

## When LinkedIn starts blocking

JobSpy uses your droplet's IP — LinkedIn typically rate-limits after
100-500 searches/day per IP. When it starts erroring:

- Drop `linkedin` from `JOBSPY_SITES` (the others keep working)
- Or pipe through a residential proxy (cheap proxy services start at
  ~$20/mo; configure via JobSpy's `proxies` parameter — needs a small
  patch to `main.py`)
