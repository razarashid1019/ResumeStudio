#!/usr/bin/env python3
"""ResumeStudio local server.

Stdlib-only Python HTTP server that reads/writes the existing markdown-based
job-search data in the ResumeSkills repo (resume/applications/*.md,
resume/tailored/*.tex, resume/build/*.pdf) plus the app's own job-board.json,
and serves the ResumeStudio frontend. Binds to 127.0.0.1 only.
"""
import difflib
import json
import mimetypes
import os
import re
import shlex
import shutil
import subprocess
import threading
import time
import urllib.request
import uuid
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

APP_HOME = Path(__file__).resolve().parent.parent
WEB_DIR = APP_HOME / "web-dist"  # Vite build output (frontend/, 2026-09-15 rewrite); see frontend/vite.config.ts's outDir
DATA_DIR = APP_HOME / "data"
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

SETTINGS = json.loads((DATA_DIR / "settings.json").read_text())
REPO_PATH = Path(SETTINGS["repo_path"])
PORT = int(SETTINGS.get("port", 8765))

RESUME_DIR = REPO_PATH / "resume"
APPLICATIONS_DIR = RESUME_DIR / "applications"
README_PATH = APPLICATIONS_DIR / "README.md"
TAILORED_DIR = RESUME_DIR / "tailored"
BUILD_DIR = RESUME_DIR / "build"
MASTER_TEX = RESUME_DIR / "master-resume.tex"
JOB_BOARD_PATH = RESUME_DIR / "data" / "job-board.json"
JOB_PHOTOS_PATH = DATA_DIR / "job-photos.json"
PHOTOS_LOCK = threading.Lock()

SECRETS_PATH = DATA_DIR / "secrets.json"
STREETVIEW_CACHE_DIR = DATA_DIR / "streetview_cache"
STREETVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
STREETVIEW_STATUS_PATH = DATA_DIR / "streetview_status.json"  # job_id -> bool (has real imagery)
STREETVIEW_LOCK = threading.Lock()


def get_maps_api_key():
    if not SECRETS_PATH.exists():
        return ""
    try:
        return json.loads(SECRETS_PATH.read_text()).get("google_maps_api_key", "")
    except Exception:
        return ""

PREPARE_LOCK = threading.Lock()
PREPARE_JOBS = {}  # job_id -> {"status": "running"|"done"|"error", "output": str, "started": float}

# The two cloud routines created 2026-09-15 (see resumestudio-app memory /
# the /schedule conversation) -- hardcoded since there are only ever these
# two and creating new ones isn't a dashboard action.
ROUTINE_IDS = {
    "digest": "trig_01NvD59Y3gTqpQP8tPNZtn5M",
    "approval": "trig_01J8HbayG8GP4f6WfEhaH62c",
}
ROUTINES_CACHE_PATH = DATA_DIR / "routines_cache.json"
ROUTINES_CACHE_TTL = 300  # seconds -- refresh in the background past this age
ROUTINES_LOCK = threading.Lock()
ROUTINES_REFRESHING = False
ROUTINE_JOBS = {}  # run_id -> {"status": "running"|"done"|"error", "output": str}

# ---------------------------------------------------------------- apply loop --
# Actually filling out and submitting a form needs a live, interactive
# Claude Code session with the claude-in-chrome browser tools -- confirmed
# 2026-09-15 that headless `claude -p` has neither those NOR PushNotification
# access locally (it does have RemoteTrigger, which is why the routines
# section above works but this one can't follow the same shell-out pattern).
# So /request opens a real Terminal.app window running `claude` *interactively*
# (not -p) via osascript -- that session has full tool access, including the
# browser, same as any Terminal-launched Claude Code. It reads/writes the rest
# of these fields as live progress. See README.md's "Running the apply loop".
APPLY_LOOP_STATE_PATH = DATA_DIR / "apply_loop_state.json"
APPLY_LOOP_LOCK = threading.Lock()
APPLY_LOOP_DEFAULT = {
    "status": "idle",  # idle | requested | running | done | error
    "requested_at": None,
    "started_at": None,
    "finished_at": None,
    "current": None,  # {"company", "role"} being worked on right now
    "completed": [],  # [{"company", "role"}]
    "failed": [],  # [{"company", "role", "reason"}]
    "summary": None,
}


def load_apply_loop_state():
    if not APPLY_LOOP_STATE_PATH.exists():
        return dict(APPLY_LOOP_DEFAULT)
    try:
        return {**APPLY_LOOP_DEFAULT, **json.loads(APPLY_LOOP_STATE_PATH.read_text())}
    except Exception:
        return dict(APPLY_LOOP_DEFAULT)


def save_apply_loop_state(state):
    APPLY_LOOP_STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")


def launch_apply_loop_session():
    """Open Terminal.app running an interactive `claude` session primed to
    run the apply loop -- browser-driving work headless `claude -p` can't
    do (no browser-tool access at all). Still confirms each real submission
    with Raza live (see README's "Running the apply loop" -- that gate isn't
    optional, Claude Code's own permission system enforces it regardless of
    what this session's prompt says); this just launches it automatically
    instead of Raza having to notice `status: "requested"` and ask for it
    himself. Reports progress back via the /api/apply-loop/* endpoints."""
    prompt = (
        f'Read "Running the apply loop" in {APP_HOME}/README.md and follow it '
        "exactly against http://127.0.0.1:8765/api/apply-loop."
    )
    allowed_tools = "Bash(curl*) Read mcp__claude-in-chrome"
    shell_cmd = (
        f"cd {shlex.quote(str(APP_HOME))} && "
        f"claude {shlex.quote(prompt)} --allowed-tools {shlex.quote(allowed_tools)}"
    )
    applescript = (
        'tell application "Terminal"\n'
        "  activate\n"
        f"  do script {json.dumps(shell_cmd)}\n"
        "end tell"
    )
    subprocess.Popen(["osascript", "-e", applescript])

STATUS_LEGEND = [
    "Staged — not submitted",
    "Applied",
    "OA / Screen",
    "Interview",
    "Offer",
    "Rejected",
    "Withdrawn",
]

# --------------------------------------------------------------- git sync --

def git_sync(paths, message):
    """Best-effort commit + push of the given paths (relative to RESUME_DIR)
    in the resume repo, so local edits don't sit uncommitted indefinitely —
    the cloud digest routine reads this repo's remote and needs it current
    to dedupe correctly. Never raises: a failed sync (offline, no remote,
    conflict) shouldn't break the request that triggered it; the next
    successful sync catches up."""
    try:
        subprocess.run(["git", "add", *paths], cwd=str(RESUME_DIR), check=True, capture_output=True)
        result = subprocess.run(
            ["git", "commit", "-m", message], cwd=str(RESUME_DIR), capture_output=True, text=True,
        )
        if result.returncode != 0 and "nothing to commit" not in result.stdout:
            print(f"[git_sync] commit failed: {result.stdout}\n{result.stderr}")
            return
        subprocess.run(["git", "push"], cwd=str(RESUME_DIR), check=True, capture_output=True, timeout=30)
    except Exception as exc:  # noqa: BLE001
        print(f"[git_sync] failed for {paths}: {exc}")


# ---------------------------------------------------------------- parsing --

def parse_readme_table():
    """Parse resume/applications/README.md's pipe-table into structured rows."""
    if not README_PATH.exists():
        return []
    text = README_PATH.read_text()
    lines = text.splitlines()
    rows = []
    in_table = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("| Company"):
            in_table = True
            continue
        if in_table and re.match(r"^\|[\s:|-]+\|$", stripped):
            continue  # header separator row
        if in_table:
            if not stripped.startswith("|"):
                break
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if len(cells) < 7:
                continue
            company, role, location, status, date_applied, resume_used, detail = cells[:7]
            m = re.search(r"\[([^\]]+)\]\(\./([^)]+)\)", detail)
            detail_file = m.group(2) if m else None
            resume_m = re.search(r"`([^`]+)`", resume_used)
            resume_used_clean = resume_m.group(1) if resume_m else resume_used
            rows.append({
                "company": company,
                "role": role,
                "location": location,
                "status": status,
                "date_applied": date_applied,
                "resume_used": resume_used_clean,
                "detail_file": detail_file,
            })
    return rows


def parse_detail_file(filename):
    """Parse resume/applications/<file>.md into a header field block + sections."""
    path = APPLICATIONS_DIR / filename
    if not path.exists():
        return None
    text = path.read_text()
    lines = text.splitlines()
    title = lines[0].lstrip("#").strip() if lines else filename

    # split into header-field block (before first "## ") and sections
    first_section_idx = len(lines)
    for i, line in enumerate(lines):
        if line.startswith("## "):
            first_section_idx = i
            break

    header_lines = lines[1:first_section_idx]
    fields = {}
    intro_lines = []
    for line in header_lines:
        m = re.match(r"^\*\*(.+?):\*\*\s*(.*)$", line.strip())
        if m:
            key = m.group(1).strip().lower().replace(" ", "_")
            fields[key] = m.group(2).strip()
        elif line.strip():
            intro_lines.append(line)

    sections = []
    current_heading = None
    current_body = []
    for line in lines[first_section_idx:]:
        m = re.match(r"^## (.+)$", line)
        if m:
            if current_heading is not None:
                sections.append({"heading": current_heading, "body": "\n".join(current_body).strip()})
            current_heading = m.group(1).strip()
            current_body = []
        else:
            current_body.append(line)
    if current_heading is not None:
        sections.append({"heading": current_heading, "body": "\n".join(current_body).strip()})

    return {
        "title": title,
        "fields": fields,
        "intro": "\n".join(intro_lines).strip(),
        "sections": sections,
        "raw": text,
    }


def update_readme_status(company, new_status, date_applied=None):
    """Line-targeted edit: change only the Status (and optionally Date Applied)
    cell of the one row matching `company`. Never rewrites the rest of the file."""
    if new_status not in STATUS_LEGEND:
        raise ValueError(f"Unknown status: {new_status}")
    if not README_PATH.exists():
        raise FileNotFoundError(README_PATH)

    shutil.copy(README_PATH, README_PATH.with_suffix(".md.bak"))

    lines = README_PATH.read_text().splitlines(keepends=False)
    changed = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("|") or stripped.startswith("| Company") or re.match(r"^\|[\s:|-]+\|$", stripped):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) < 7:
            continue
        if cells[0].lower() == company.lower():
            cells[3] = new_status
            if date_applied:
                cells[4] = date_applied
            lines[i] = "| " + " | ".join(cells) + " |"
            changed = True
            break

    if not changed:
        raise ValueError(f"No application row found for company: {company}")

    README_PATH.write_text("\n".join(lines) + "\n")
    git_sync(["applications/README.md"], f"Update status: {company} -> {new_status}")
    return True


def list_resumes():
    results = []
    if not TAILORED_DIR.exists():
        return results
    for tex_path in sorted(TAILORED_DIR.glob("*.tex")):
        slug = tex_path.stem
        pdf_path = BUILD_DIR / f"{slug}.pdf"
        results.append({
            "slug": slug,
            "has_pdf": pdf_path.exists(),
            "pdf_size": pdf_path.stat().st_size if pdf_path.exists() else None,
            "mtime": tex_path.stat().st_mtime,
        })
    return results


def diff_resume(slug):
    tailored_path = TAILORED_DIR / f"{slug}.tex"
    if not tailored_path.exists() or not MASTER_TEX.exists():
        return None
    master_lines = MASTER_TEX.read_text().splitlines(keepends=True)
    tailored_lines = tailored_path.read_text().splitlines(keepends=True)
    diff = difflib.unified_diff(
        master_lines, tailored_lines,
        fromfile="master-resume.tex", tofile=f"{slug}.tex",
    )
    return "".join(diff)


# ------------------------------------------------------------- job board --

def load_job_board():
    if not JOB_BOARD_PATH.exists():
        return []
    return json.loads(JOB_BOARD_PATH.read_text())


def save_job_board(jobs):
    JOB_BOARD_PATH.write_text(json.dumps(jobs, indent=2) + "\n")
    git_sync(["data/job-board.json"], "Update job board")


def load_job_photos():
    if not JOB_PHOTOS_PATH.exists():
        return {}
    return json.loads(JOB_PHOTOS_PATH.read_text())


def save_job_photos(cache):
    JOB_PHOTOS_PATH.write_text(json.dumps(cache, indent=2) + "\n")


def fetch_og_image(url, timeout=6):
    """Fetch a job posting's page and pull its og:image (or twitter:image)
    meta tag — a real, company/posting-specific share image where the site
    provides one. Returns None on any failure (dead link, timeout, no tag)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            html = resp.read(300000).decode("utf-8", errors="ignore")
    except Exception:
        return None
    for prop in ("og:image", "twitter:image"):
        m = re.search(
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.I,
        )
        if not m:
            m = re.search(
                rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
                html, re.I,
            )
        if m and m.group(1):
            resolved = urljoin(url, m.group(1))  # some sites give a relative path
            if urlparse(resolved).scheme in ("http", "https") and "missing.png" not in resolved:
                return resolved
    return None


# Confirmed-generic images (verified by hand: same asset served for every
# listing on that platform, not specific to any one company) — skip these
# from the first occurrence rather than waiting for the repeat-detector below
# to catch them after they've already shown up on 2-3 unrelated cards.
KNOWN_GENERIC_IMAGES = {
    "https://jobright.ai/newimages/seo_logo.png",
}


def is_generic_image(cache, image_url, company):
    """An image that shows up for several *different* companies is site
    branding (an ATS aggregator's own share image), not a real per-company
    photo — showing it would misrepresent it as job-specific when it isn't."""
    if image_url in KNOWN_GENERIC_IMAGES:
        return True
    other_companies = {
        entry.get("company") for entry in cache.values()
        if entry.get("image") == image_url and entry.get("company") != company
    }
    return len(other_companies) >= 2


def get_or_fetch_job_photo(job):
    with PHOTOS_LOCK:
        cache = load_job_photos()
        existing = cache.get(job["id"])
        if existing is not None:
            return existing.get("image")

    image = fetch_og_image(job["link"]) if job.get("link") else None

    with PHOTOS_LOCK:
        cache = load_job_photos()
        if image and is_generic_image(cache, image, job["company"]):
            image = None
        cache[job["id"]] = {"image": image, "company": job["company"]}
        save_job_photos(cache)
    return image


def load_streetview_status():
    if not STREETVIEW_STATUS_PATH.exists():
        return {}
    return json.loads(STREETVIEW_STATUS_PATH.read_text())


def save_streetview_status(status):
    STREETVIEW_STATUS_PATH.write_text(json.dumps(status, indent=2) + "\n")


def get_or_fetch_streetview(job):
    """Real photo of the actual workplace, via Google Street View — the
    literal answer to "a picture of where I'd be working," as opposed to a
    logo or generic share-image. Checks the (free) metadata endpoint first
    to confirm real imagery exists before spending a billed image request,
    and caches the resulting JPEG to disk so each address is ever queried
    once, not on every page load."""
    api_key = get_maps_api_key()
    if not api_key:
        return None

    with STREETVIEW_LOCK:
        status = load_streetview_status()
        cached = status.get(job["id"])
    cache_file = STREETVIEW_CACHE_DIR / f"{job['id']}.jpg"
    if cached is True and cache_file.exists():
        return True
    if cached is False:
        return False

    query = quote(f"{job['company']}, {job.get('location') or ''}".strip(", "))
    meta_url = f"https://maps.googleapis.com/maps/api/streetview/metadata?location={query}&key={api_key}"
    try:
        with urllib.request.urlopen(meta_url, timeout=6) as resp:
            meta = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None  # transient failure — don't cache, worth retrying later

    found = meta.get("status") == "OK"
    with STREETVIEW_LOCK:
        status = load_streetview_status()
        status[job["id"]] = found
        save_streetview_status(status)

    if not found:
        return False

    image_url = f"https://maps.googleapis.com/maps/api/streetview?size=640x400&fov=90&location={query}&key={api_key}"
    try:
        with urllib.request.urlopen(image_url, timeout=8) as resp:
            cache_file.write_bytes(resp.read())
        return True
    except Exception:
        with STREETVIEW_LOCK:
            status = load_streetview_status()
            status[job["id"]] = False
            save_streetview_status(status)
        return False


# ---------------------------------------------------- Wikipedia fallback --
# No API key, no billing, no signup — Wikipedia/Wikimedia's API is fully
# open. Keyed by company (not job id), since many postings share a company
# and there's no reason to look it up more than once. Usually surfaces the
# company's logo (that's what most company-article infoboxes use), not a
# building photo — a real, honest, per-company image, just not literally
# "the workplace" the way Street View would have been.
WIKI_CACHE_PATH = DATA_DIR / "wiki-image-cache.json"
WIKI_LOCK = threading.Lock()
_WIKI_HEADERS = {"User-Agent": "ResumeStudio/1.0 (personal local app; contact: n/a)"}
_wiki_last_request = 0.0
_WIKI_MIN_INTERVAL = 0.3  # be a polite API citizen — avoid tripping rate limits on a burst


def load_wiki_cache():
    if not WIKI_CACHE_PATH.exists():
        return {}
    return json.loads(WIKI_CACHE_PATH.read_text())


def save_wiki_cache(cache):
    WIKI_CACHE_PATH.write_text(json.dumps(cache, indent=2) + "\n")


def _wiki_get(url):
    global _wiki_last_request
    with WIKI_LOCK:
        wait = _WIKI_MIN_INTERVAL - (time.time() - _wiki_last_request)
        if wait > 0:
            time.sleep(wait)
        _wiki_last_request = time.time()
    req = urllib.request.Request(url, headers=_WIKI_HEADERS)
    with urllib.request.urlopen(req, timeout=6) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_wikipedia_image(company):
    """Returns an image URL, or None for a genuine no-match (no search
    result, disambiguation guard rejected it, or no infobox image). Network/
    HTTP errors (rate limits, timeouts) propagate as exceptions instead of
    silently becoming None — those are transient and must NOT be cached as
    a permanent "no photo," or a single 429 poisons that company forever."""
    # Appending "company" biases the search away from an unrelated article
    # that happens to share the name (e.g. plain "Adobe" resolves to the
    # building-material article, not Adobe Inc.) — cheap, standard technique,
    # not foolproof but meaningfully better than a bare name search.
    search = _wiki_get(
        f"https://en.wikipedia.org/w/api.php?action=query&list=search"
        f"&srsearch={quote(company + ' company')}&format=json&srlimit=1"
    )
    results = search.get("query", {}).get("search", [])
    if not results:
        return None
    title = results[0]["title"]

    # Guard against a wildly wrong disambiguation match (e.g. "Apex" the
    # startup resolving to some unrelated "Apex" article) — require the
    # company's first significant word to actually appear in the title.
    first_word = re.sub(r"[^a-z0-9]", "", company.lower().split()[0]) if company.split() else ""
    if first_word and first_word not in re.sub(r"[^a-z0-9]", "", title.lower()):
        return None

    images = _wiki_get(
        f"https://en.wikipedia.org/w/api.php?action=query&titles={quote(title)}"
        f"&prop=pageimages&format=json&pithumbsize=640"
    )
    for page in images.get("query", {}).get("pages", {}).values():
        thumb = page.get("thumbnail", {}).get("source")
        if thumb:
            return thumb
    return None


def get_or_fetch_company_photo(company):
    with WIKI_LOCK:
        cache = load_wiki_cache()
        if company in cache:
            return cache[company]
    try:
        image = fetch_wikipedia_image(company)
    except Exception:
        return None  # transient failure (rate limit, timeout) — not cached, safe to retry later
    with WIKI_LOCK:
        cache = load_wiki_cache()
        cache[company] = image
        save_wiki_cache(cache)
    return image


def update_job_status(job_id, new_status):
    jobs = load_job_board()
    found = False
    for job in jobs:
        if job["id"] == job_id:
            job["status"] = new_status
            found = True
            break
    if not found:
        raise ValueError(f"No job found with id: {job_id}")
    save_job_board(jobs)
    return True


# -------------------------------------------------------- prepare (agent) --

def build_prepare_prompt(job):
    why = job.get("why") or "(no prior research notes — use the job posting itself)"
    red_flags = job.get("red_flags") or []
    red_flag_text = ("\nKnown red flags to account for: " + "; ".join(red_flags)) if red_flags else ""
    return f"""Follow the exact conventions already established in this repo for preparing a job
application package. Read resume/README.md and resume/applications/README.md first to confirm
the conventions, and use resume/applications/notion.md and resume/applications/stripe.md as
structural reference examples for the detail file.

Company: {job.get('company')}
Role: {job.get('role')}
Location: {job.get('location') or 'unknown — check the posting'}
Job URL: {job.get('link') or 'none on file — do not guess one'}
Why this role (prior research): {why}{red_flag_text}

Do the following, in order:
1. Read resume/master-resume.tex and the relevant files in resume/experience/ for source material.
2. Create a new tailored resume at resume/tailored/<slug>.tex as a PURE REORDER of
   master-resume.tex content only — same rule as every other tailored resume in this repo:
   no invented scope, no new metrics, no reworded bullets, reordering only. Pick a slug
   consistent with the existing naming pattern (e.g. company-role.tex).
3. Compile it with latexmk to resume/build/<slug>.pdf and confirm it is exactly 1 page.
4. Write resume/applications/<company-slug>.md following the exact section structure used in
   notion.md and stripe.md (Status / Location / Job URL / Resume used / Compensation header
   block, then "## Why this role (match rationale)", "## Application form answers submitted"
   with draft best-guess answers clearly flagged for Raza's review before submission, "## Other
   form answers", and "## Interview prep notes" with STAR-ready stories).
5. Add exactly one new row to resume/applications/README.md's tracker table with
   Status = "Staged — not submitted" and today's date, matching the table's existing column
   format precisely. Do not alter any other row or any other part of the file.
6. Do not open a browser, fill out any external form, or submit anything anywhere — this task
   only produces local files for Raza to review before he applies himself.
7. Commit and push your work so it doesn't sit uncommitted: `cd resume && git add tailored/<slug>.tex
   applications/<company-slug>.md applications/README.md && git commit -m "Stage application: <Company>
   — <Role>" && git push`. Only stage those specific files — nothing else in the tree. If the push
   fails (offline, conflict), say so in your summary but don't treat it as a fatal error.

When done, print a short summary of exactly what you created."""


def run_prepare_job(job_id, job):
    log_path = LOG_DIR / f"{job_id}.log"
    prompt = build_prepare_prompt(job)
    allowed_tools = "Read Write Edit Glob Grep Bash(latexmk*) Bash(pdflatex*) Bash(git*) Bash(cd*)"
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--allowed-tools", allowed_tools],
            cwd=str(REPO_PATH),
            capture_output=True,
            text=True,
            timeout=1200,
        )
        output = proc.stdout + ("\n[stderr]\n" + proc.stderr if proc.stderr else "")
        with PREPARE_LOCK:
            PREPARE_JOBS[job_id]["status"] = "done" if proc.returncode == 0 else "error"
            PREPARE_JOBS[job_id]["output"] = output
        log_path.write_text(output)
        if proc.returncode == 0:
            update_job_status(job["id"], "ready_to_apply")
    except Exception as exc:  # noqa: BLE001
        with PREPARE_LOCK:
            PREPARE_JOBS[job_id]["status"] = "error"
            PREPARE_JOBS[job_id]["output"] = f"Failed to run: {exc}"
        log_path.write_text(f"Failed to run: {exc}")


# ------------------------------------------------------ routine control --
# Same trick as "Prepare Application" above: shell out to `claude -p`.
# Confirmed 2026-09-15 that a headless `claude -p` process DOES have the
# RemoteTrigger tool available (unlike Gmail/browser tools, which it does
# not) -- see resumestudio-app memory. Status is cached to disk and
# refreshed in the background rather than on every page load, since each
# `claude -p` round-trip takes 10-30+ seconds.

def _extract_json(text):
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    return json.loads(text)


def load_routines_cache():
    if not ROUTINES_CACHE_PATH.exists():
        return {"routines": [], "updated_at": None}
    return json.loads(ROUTINES_CACHE_PATH.read_text())


def _refresh_routines_worker():
    global ROUTINES_REFRESHING
    ids = ", ".join(ROUTINE_IDS.values())
    prompt = (
        f"Use the RemoteTrigger tool to fetch the current status of these two routine ids: {ids}. "
        "For each, call action \"get\" (for its config/enabled state) and action \"list_runs\" "
        "(for its most recent run session, if any). Then respond with ONLY a JSON array, no prose, "
        "no markdown code fence, one object per routine shaped exactly like: "
        '{"id": "<trigger id>", "name": "<name>", "enabled": true, "cron_expression": "<cron>", '
        '"next_run_at": "<iso timestamp or null>", "last_fired_at": "<iso timestamp or null>", '
        '"last_run": {"status": "<active|complete|error|...>", "title": "<run title>", '
        '"last_event_at": "<iso timestamp>", "url": "<claude.ai session url>"} or null if it has never run}. '
        "Nothing else in your response — it is parsed as JSON directly, so a stray sentence breaks it."
    )
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--allowed-tools", "RemoteTrigger"],
            capture_output=True, text=True, timeout=90,
        )
        routines = _extract_json(proc.stdout)
        ROUTINES_CACHE_PATH.write_text(json.dumps({"routines": routines, "updated_at": time.time()}, indent=2))
    except Exception as exc:  # noqa: BLE001
        print(f"[routines] refresh failed: {exc}")
    finally:
        with ROUTINES_LOCK:
            ROUTINES_REFRESHING = False


def maybe_refresh_routines_cache():
    """Stale-while-revalidate: GET /api/routines always returns instantly
    from cache, but kicks off a background refresh if the cache is missing
    or older than ROUTINES_CACHE_TTL, so the *next* load has fresh data."""
    global ROUTINES_REFRESHING
    cache = load_routines_cache()
    age = time.time() - cache["updated_at"] if cache.get("updated_at") else None
    if age is not None and age < ROUTINES_CACHE_TTL:
        return
    with ROUTINES_LOCK:
        if ROUTINES_REFRESHING:
            return
        ROUTINES_REFRESHING = True
    threading.Thread(target=_refresh_routines_worker, daemon=True).start()


def run_routine_action(run_id, prompt):
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--allowed-tools", "RemoteTrigger"],
            capture_output=True, text=True, timeout=60,
        )
        output = proc.stdout + ("\n[stderr]\n" + proc.stderr if proc.stderr else "")
        with PREPARE_LOCK:
            ROUTINE_JOBS[run_id] = {"status": "done" if proc.returncode == 0 else "error", "output": output}
    except Exception as exc:  # noqa: BLE001
        with PREPARE_LOCK:
            ROUTINE_JOBS[run_id] = {"status": "error", "output": f"Failed to run: {exc}"}
    finally:
        # whatever just happened almost certainly changed status -- force
        # a fresh fetch on the next GET instead of waiting out the TTL.
        with ROUTINES_LOCK:
            if ROUTINES_CACHE_PATH.exists():
                ROUTINES_CACHE_PATH.unlink()


# -------------------------------------------------------------- HTTP glue --

class Handler(BaseHTTPRequestHandler):
    server_version = "ResumeStudio/1.0"

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; errors still surface via 5xx responses

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _try_serve_static(self, path):
        """Serve the Vite-built React app in web-dist/ (see frontend/,
        2026-09-15 rewrite) -- unlike the old hand-written web/ this has
        hashed asset filenames under assets/, so it's a real directory
        walk instead of 3 hardcoded paths. Falls back to index.html for
        any unresolved non-file path so client-side view state survives a
        manual reload; returns None (not a 404) so callers can still fall
        through to /api/* routes, which this is intentionally never
        called for (see do_GET)."""
        rel = path.lstrip("/") or "index.html"
        candidate = (WEB_DIR / rel).resolve()
        if WEB_DIR.resolve() not in candidate.parents and candidate != WEB_DIR.resolve():
            return self._send_json({"error": "forbidden"}, 403)  # path traversal guard
        if not candidate.is_file():
            candidate = WEB_DIR / "index.html"
        if not candidate.exists():
            return None
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        return self._send_file(candidate, content_type)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if not path.startswith("/api/"):
                static_response = self._try_serve_static(path)
                if static_response is not None:
                    return static_response

            if path == "/api/applications":
                return self._send_json({"rows": parse_readme_table(), "legend": STATUS_LEGEND})

            m = re.match(r"^/api/applications/([^/]+)$", path)
            if m:
                filename = m.group(1)
                if not filename.endswith(".md"):
                    filename += ".md"
                detail = parse_detail_file(filename)
                if detail is None:
                    return self._send_json({"error": "not found"}, 404)
                return self._send_json(detail)

            if path == "/api/jobs":
                return self._send_json({"jobs": load_job_board()})

            if path == "/api/jobs/photos":
                cache = load_job_photos()
                return self._send_json({jid: v.get("image") for jid, v in cache.items()})

            if path == "/api/jobs/streetview-status":
                return self._send_json({
                    "maps_key_configured": bool(get_maps_api_key()),
                    "status": load_streetview_status(),
                })

            if path == "/api/company-photos":
                return self._send_json(load_wiki_cache())

            m = re.match(r"^/api/jobs/streetview/([^/]+)\.jpg$", path)
            if m:
                job_id = m.group(1)
                img_path = STREETVIEW_CACHE_DIR / f"{job_id}.jpg"
                if not img_path.exists():
                    return self._send_json({"error": "not found"}, 404)
                return self._send_file(img_path, "image/jpeg")

            if path == "/api/resume":
                return self._send_json({"resumes": list_resumes()})

            m = re.match(r"^/api/resume/pdf/([^/]+)$", path)
            if m:
                slug = m.group(1).replace(".pdf", "")
                pdf_path = BUILD_DIR / f"{slug}.pdf"
                if not pdf_path.exists():
                    return self._send_json({"error": "not found"}, 404)
                return self._send_file(pdf_path, "application/pdf")

            m = re.match(r"^/api/resume/diff/([^/]+)$", path)
            if m:
                slug = m.group(1).replace(".tex", "")
                diff = diff_resume(slug)
                if diff is None:
                    return self._send_json({"error": "not found"}, 404)
                return self._send_json({"diff": diff})

            m = re.match(r"^/api/prepare/([^/]+)/log$", path)
            if m:
                job_id = m.group(1)
                with PREPARE_LOCK:
                    info = PREPARE_JOBS.get(job_id)
                if info is None:
                    return self._send_json({"error": "not found"}, 404)
                return self._send_json(info)

            if path == "/api/routines":
                maybe_refresh_routines_cache()
                cache = load_routines_cache()
                return self._send_json({
                    "routines": cache["routines"],
                    "updated_at": cache["updated_at"],
                    "refreshing": ROUTINES_REFRESHING,
                })

            m = re.match(r"^/api/routines/run/([^/]+)/log$", path)
            if m:
                run_id = m.group(1)
                with PREPARE_LOCK:
                    info = ROUTINE_JOBS.get(run_id)
                if info is None:
                    return self._send_json({"error": "not found"}, 404)
                return self._send_json(info)

            if path == "/api/apply-loop":
                with APPLY_LOOP_LOCK:
                    state = load_apply_loop_state()
                jobs = load_job_board()
                queued = [
                    {"id": j["id"], "company": j["company"], "role": j["role"]}
                    for j in jobs if j.get("status") == "approved_for_submission"
                ]
                return self._send_json({**state, "queued": queued})

            return self._send_json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            return self._send_json({"error": str(exc)}, 500)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            body = self._read_json_body()

            m = re.match(r"^/api/applications/([^/]+)/status$", path)
            if m:
                company = m.group(1)
                update_readme_status(company, body["status"], body.get("date_applied"))
                return self._send_json({"ok": True})

            m = re.match(r"^/api/jobs/([^/]+)/status$", path)
            if m:
                job_id = m.group(1)
                update_job_status(job_id, body["status"])
                return self._send_json({"ok": True})

            m = re.match(r"^/api/jobs/([^/]+)/photo$", path)
            if m:
                job_id = m.group(1)
                jobs = load_job_board()
                job = next((j for j in jobs if j["id"] == job_id), None)
                if job is None:
                    return self._send_json({"error": "job not found"}, 404)
                image = get_or_fetch_job_photo(job)
                return self._send_json({"image": image})

            m = re.match(r"^/api/jobs/([^/]+)/streetview$", path)
            if m:
                job_id = m.group(1)
                jobs = load_job_board()
                job = next((j for j in jobs if j["id"] == job_id), None)
                if job is None:
                    return self._send_json({"error": "job not found"}, 404)
                available = get_or_fetch_streetview(job)
                return self._send_json({"available": bool(available)})

            if path == "/api/company-photos/lookup":
                company = body.get("company")
                if not company:
                    return self._send_json({"error": "company required"}, 400)
                image = get_or_fetch_company_photo(company)
                return self._send_json({"image": image})

            if path == "/api/prepare":
                job_id_in = body.get("job_id")
                jobs = load_job_board()
                job = next((j for j in jobs if j["id"] == job_id_in), None)
                if job is None:
                    return self._send_json({"error": "job not found"}, 404)
                run_id = uuid.uuid4().hex[:12]
                with PREPARE_LOCK:
                    PREPARE_JOBS[run_id] = {"status": "running", "output": "", "started": time.time()}
                update_job_status(job_id_in, "preparing")
                thread = threading.Thread(target=run_prepare_job, args=(run_id, job), daemon=True)
                thread.start()
                return self._send_json({"run_id": run_id})

            m = re.match(r"^/api/routines/([^/]+)/run$", path)
            if m:
                key = m.group(1)
                trigger_id = ROUTINE_IDS.get(key)
                if trigger_id is None:
                    return self._send_json({"error": f"unknown routine: {key}"}, 404)
                run_id = uuid.uuid4().hex[:12]
                with PREPARE_LOCK:
                    ROUTINE_JOBS[run_id] = {"status": "running", "output": ""}
                prompt = (
                    f'Use the RemoteTrigger tool, action "run", trigger_id "{trigger_id}". '
                    "Report in one line whether it started successfully."
                )
                thread = threading.Thread(target=run_routine_action, args=(run_id, prompt), daemon=True)
                thread.start()
                return self._send_json({"run_id": run_id})

            m = re.match(r"^/api/routines/([^/]+)/enabled$", path)
            if m:
                key = m.group(1)
                trigger_id = ROUTINE_IDS.get(key)
                if trigger_id is None:
                    return self._send_json({"error": f"unknown routine: {key}"}, 404)
                enabled = bool(body.get("enabled"))
                run_id = uuid.uuid4().hex[:12]
                with PREPARE_LOCK:
                    ROUTINE_JOBS[run_id] = {"status": "running", "output": ""}
                prompt = (
                    f'Use the RemoteTrigger tool, action "update", trigger_id "{trigger_id}", '
                    f'body {{"enabled": {"true" if enabled else "false"}}}. '
                    "Report in one line whether it succeeded."
                )
                thread = threading.Thread(target=run_routine_action, args=(run_id, prompt), daemon=True)
                thread.start()
                return self._send_json({"run_id": run_id})

            if path == "/api/apply-loop/request":
                with APPLY_LOOP_LOCK:
                    state = load_apply_loop_state()
                    if state["status"] == "running":
                        return self._send_json({"error": "already running"}, 409)
                    state.update({
                        "status": "requested", "requested_at": time.time(),
                        "started_at": None, "finished_at": None,
                        "current": None, "completed": [], "failed": [], "summary": None,
                    })
                    save_apply_loop_state(state)
                launch_apply_loop_session()
                return self._send_json(state)

            if path == "/api/apply-loop/progress":
                with APPLY_LOOP_LOCK:
                    state = load_apply_loop_state()
                    for key in ("status", "current", "completed", "failed"):
                        if key in body:
                            state[key] = body[key]
                    if state["status"] == "running" and not state["started_at"]:
                        state["started_at"] = time.time()
                    save_apply_loop_state(state)
                return self._send_json(state)

            if path == "/api/apply-loop/complete":
                with APPLY_LOOP_LOCK:
                    state = load_apply_loop_state()
                    state["status"] = body.get("status", "done")
                    state["summary"] = body.get("summary")
                    state["current"] = None
                    state["finished_at"] = time.time()
                    save_apply_loop_state(state)
                return self._send_json(state)

            if path == "/api/apply-loop/reset":
                with APPLY_LOOP_LOCK:
                    save_apply_loop_state(dict(APPLY_LOOP_DEFAULT))
                return self._send_json(dict(APPLY_LOOP_DEFAULT))

            return self._send_json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            return self._send_json({"error": str(exc)}, 500)


def pull_resume_repo():
    """Best-effort fast-forward pull on startup, so anything the daily cloud
    digest routine committed overnight is visible before the dashboard loads.
    Never blocks startup: offline, diverged history, or no remote all just
    mean the server serves whatever's on disk already."""
    try:
        result = subprocess.run(
            ["git", "pull", "--ff-only"], cwd=str(RESUME_DIR),
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0:
            print(f"[startup] git pull: {result.stdout.strip()}")
        else:
            print(f"[startup] git pull skipped: {result.stderr.strip()}")
    except Exception as exc:  # noqa: BLE001
        print(f"[startup] git pull failed: {exc}")


def compile_missing_pdfs():
    """The cloud digest routine's sandbox likely has no LaTeX toolchain, so it
    only ever commits .tex + .md, never a PDF. Catch up here, locally, where
    latexmk actually exists. Best-effort per file — one bad .tex shouldn't
    block the rest, and this must never block server startup."""
    if not TAILORED_DIR.exists() or not shutil.which("latexmk"):
        return
    for tex_path in TAILORED_DIR.glob("*.tex"):
        pdf_path = BUILD_DIR / f"{tex_path.stem}.pdf"
        if pdf_path.exists():
            continue
        try:
            subprocess.run(
                ["latexmk", "-pdf", "-interaction=nonstopmode", f"-outdir={BUILD_DIR}", str(tex_path)],
                cwd=str(RESUME_DIR), capture_output=True, timeout=60,
            )
            print(f"[startup] compiled {tex_path.name}" + (" ok" if pdf_path.exists() else " — still no PDF, check the .log"))
        except Exception as exc:  # noqa: BLE001
            print(f"[startup] compile failed for {tex_path.name}: {exc}")


def main():
    pull_resume_repo()
    compile_missing_pdfs()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    pid_path = DATA_DIR / "server.pid"
    pid_path.write_text(str(os.getpid()))
    print(f"ResumeStudio server running on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    finally:
        if pid_path.exists():
            pid_path.unlink()


if __name__ == "__main__":
    main()
