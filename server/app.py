#!/usr/bin/env python3
"""ResumeStudio local server.

Stdlib-only Python HTTP server that reads/writes the existing markdown-based
job-search data in the ResumeSkills repo (resume/applications/*.md,
resume/tailored/*.tex, resume/build/*.pdf) plus the app's own job-board.json,
and serves the ResumeStudio frontend. Binds to 127.0.0.1 only.
"""
import difflib
import json
import os
import re
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
WEB_DIR = APP_HOME / "web"
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

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/" or path == "/index.html":
                return self._send_file(WEB_DIR / "index.html", "text/html")
            if path == "/app.js":
                return self._send_file(WEB_DIR / "app.js", "application/javascript")
            if path == "/styles.css":
                return self._send_file(WEB_DIR / "styles.css", "text/css")

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


def main():
    pull_resume_repo()
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
