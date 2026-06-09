"""Tiny FastAPI sidecar wrapping python-jobspy.

career-ops-web (Node, port 8001) POSTs here (port 8002, localhost-only)
when a user kicks off a search. JobSpy fans out to LinkedIn / Indeed /
Glassdoor / Google Jobs / ZipRecruiter using public job pages — no API
keys, no quotas, just rate-limit risk (mainly on LinkedIn).

Endpoints:
    GET  /healthz   liveness ping
    POST /search    { site_name, search_term, location, results_wanted, ... }

JobSpy returns a pandas DataFrame; we normalize each row to a flat dict
that matches the shape career-ops-web's pipeline.js expects.
"""
from __future__ import annotations

import logging
import math
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jobspy")

# python-jobspy may take a couple seconds to import (it spins up its
# parser tables). Import once at module load so the first request isn't
# slowed by the import cost.
from jobspy import scrape_jobs   # noqa: E402

app = FastAPI(title="career-ops-web jobspy sidecar", version="0.1.0")


class SearchReq(BaseModel):
    site_name:      List[str] = Field(default_factory=lambda: ["linkedin", "indeed", "google"])
    search_term:    str
    location:       Optional[str] = ""
    results_wanted: int  = 20
    hours_old:      int  = 72
    country_indeed: str  = "USA"
    is_remote:      Optional[bool] = None


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "version": "0.1.0"}


def _clean_cell(v):
    """pandas/jobspy returns NaN/NaT for missing — coerce to empty string."""
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return v


@app.post("/search")
def search(req: SearchReq) -> dict:
    log.info("scrape_jobs sites=%s term=%r location=%r want=%d hours=%d",
             req.site_name, req.search_term, req.location, req.results_wanted, req.hours_old)
    try:
        kwargs = dict(
            site_name=req.site_name,
            search_term=req.search_term,
            location=req.location or None,
            results_wanted=req.results_wanted,
            hours_old=req.hours_old,
            country_indeed=req.country_indeed,
        )
        if req.is_remote is not None:
            kwargs["is_remote"] = req.is_remote
        df = scrape_jobs(**kwargs)
    except Exception as e:
        log.exception("jobspy failed")
        raise HTTPException(status_code=502, detail=f"jobspy failed: {type(e).__name__}: {e}")

    if df is None or len(df) == 0:
        return {"jobs": [], "count": 0}

    jobs = []
    for _, row in df.iterrows():
        site = str(_clean_cell(row.get("site"))) or "jobspy"
        url  = str(_clean_cell(row.get("job_url"))) or str(_clean_cell(row.get("job_url_direct")))
        jid  = str(_clean_cell(row.get("id"))) or url
        if not jid:
            continue
        jobs.append({
            "site":        site,
            "id":          jid,
            "title":       str(_clean_cell(row.get("title"))).strip(),
            "company":     str(_clean_cell(row.get("company"))).strip(),
            "location":    str(_clean_cell(row.get("location"))).strip(),
            "url":         url,
            "description": str(_clean_cell(row.get("description")))[:6000].strip(),
            "posted_at":   str(_clean_cell(row.get("date_posted"))),
            "is_remote":   bool(_clean_cell(row.get("is_remote")) or False),
            "min_amount":  _clean_cell(row.get("min_amount")) or None,
            "max_amount":  _clean_cell(row.get("max_amount")) or None,
            "currency":    str(_clean_cell(row.get("currency")) or ""),
        })

    log.info("returning %d normalized jobs", len(jobs))
    return {"jobs": jobs, "count": len(jobs)}
