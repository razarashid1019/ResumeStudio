#!/usr/bin/env python3
"""One-off ingestion: parse data/openclaw_raw.txt (raw OpenClaw digest emails)
into structured job-board entries, filter for relevance to a SWE/AI-focused
candidate, dedupe against each other + already-tracked applications, and
merge new entries into data/job-board.json with status 'new'."""
import json
import re
from pathlib import Path

APP_HOME = Path(__file__).resolve().parent.parent
RAW_PATH = APP_HOME / "data" / "openclaw_raw.txt"
JOB_BOARD_PATH = APP_HOME / "data" / "job-board.json"

ALREADY_TRACKED = {
    "notion", "hypercubic", "kastle", "deepgram", "melius", "google", "stripe",
    "microsoft", "paypal", "enfos", "primer", "scale ai", "scaleai", "wipfli",
}

POSITIVE_PATTERNS = re.compile(
    r"software|\bswe\b|full[\s-]?stack|front[\s-]?end|back[\s-]?end|"
    r"web developer|application development|app development|"
    r"data scien|data engineer|machine learning|\bml\b|"
    r"artificial intelligence|\bai\b|quantitative|devops|"
    r"site reliability|\bsre\b|cybersecurity|security engineer|"
    r"computer science|programmer|mobile application|\bios\b|\bandroid\b|"
    r"salesforce developer|cloud (software|engineer|operations|application)",
    re.IGNORECASE,
)


def canonical_url(url):
    url = url.split("?")[0].rstrip("/")
    url = re.sub(r"/(apply|application)$", "", url, flags=re.IGNORECASE)
    return url.lower()


def normalize_company(name):
    name = name.lower()
    name = re.sub(r"[,.]?\s*(inc|llc|corp|corporation|co)\.?$", "", name.strip())
    return name.strip()


def is_already_tracked(company):
    norm = normalize_company(company)
    return any(t in norm or norm in t for t in ALREADY_TRACKED)


def parse_raw(text):
    entries = []
    blocks = text.split("===EMAIL===")[1:]
    for block in blocks:
        header_line, _, body = block.strip().partition("\n")
        m = re.search(r"date=(\S+)", header_line)
        email_date = m.group(1) if m else None

        lines = body.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line and not line.startswith("http") and i + 1 < len(lines) and lines[i + 1].strip().startswith("http"):
                title = line
                url = lines[i + 1].strip()
                parts = [p.strip() for p in title.split(" - ")]
                if len(parts) >= 3:
                    company = parts[0]
                    location = parts[-1]
                    role = " - ".join(parts[1:-1])
                elif len(parts) == 2:
                    company, role = parts
                    location = None
                else:
                    company, role, location = title, "", None
                entries.append({
                    "company": company,
                    "role": role,
                    "location": location,
                    "link": url,
                    "date_added": email_date,
                })
                i += 2
            else:
                i += 1
    return entries


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main():
    raw_text = RAW_PATH.read_text()
    entries = parse_raw(raw_text)
    print(f"Parsed {len(entries)} raw listings from OpenClaw emails")

    existing_jobs = json.loads(JOB_BOARD_PATH.read_text())
    existing_urls = {canonical_url(j["link"]) for j in existing_jobs if j.get("link")}
    existing_ids = {j["id"] for j in existing_jobs}

    seen_urls = set()
    seen_company_role = set()
    kept = []
    dropped_irrelevant = 0
    dropped_tracked = 0
    dropped_dupe = 0

    for e in entries:
        curl = canonical_url(e["link"])
        key = (normalize_company(e["company"]), e["role"].lower())

        if is_already_tracked(e["company"]):
            dropped_tracked += 1
            continue
        if curl in existing_urls or curl in seen_urls or key in seen_company_role:
            dropped_dupe += 1
            continue
        if not POSITIVE_PATTERNS.search(e["role"]):
            dropped_irrelevant += 1
            continue

        seen_urls.add(curl)
        seen_company_role.add(key)

        base_id = f"{slugify(e['company'])}-{slugify(e['role'])[:40]}"
        job_id = base_id
        n = 2
        while job_id in existing_ids:
            job_id = f"{base_id}-{n}"
            n += 1
        existing_ids.add(job_id)

        kept.append({
            "id": job_id,
            "company": e["company"],
            "role": e["role"],
            "location": e["location"],
            "link": e["link"],
            "comp": None,
            "why": None,
            "notes": "Sourced from Samir's OpenClaw internship-watch digest.",
            "red_flags": [],
            "rank": None,
            "source": f"OpenClaw email ({e['date_added']})",
            "status": "new",
            "date_added": e["date_added"],
        })

    print(f"Kept {len(kept)} relevant new listings")
    print(f"Dropped: {dropped_tracked} already-tracked, {dropped_dupe} duplicates, {dropped_irrelevant} not relevant")

    merged = existing_jobs + kept
    JOB_BOARD_PATH.write_text(json.dumps(merged, indent=2) + "\n")
    print(f"job-board.json now has {len(merged)} total entries")


if __name__ == "__main__":
    main()
