# ResumeStudio

A local, double-clickable Mac app for tracking your job search — reads and writes
directly against `~/resume-workspace/ResumeSkills/resume/`, no separate database.

## Architecture

- **`server/app.py`** — Python 3 stdlib HTTP server (no pip deps), binds to
  `127.0.0.1:8765` only. Parses `resume/applications/README.md` and
  `resume/applications/<company>.md` on every request (no caching), and reads/writes
  `data/job-board.json` for sourced-but-not-yet-applied listings.
- **`web/`** — vanilla HTML/CSS/JS frontend, no build step. `app.js` does all
  rendering client-side (including a small hand-rolled markdown-to-HTML renderer).
- **`ResumeStudio.app/`** — hand-built `.app` bundle (no Xcode). Its launcher
  (`Contents/MacOS/ResumeStudio`) starts the Python server if it isn't already
  running, then opens `http://127.0.0.1:8765` in a Chrome app-mode window.
  Symlinked into `~/Applications/ResumeStudio.app` for Spotlight/Launchpad.
- **`data/settings.json`** — points at the ResumeSkills repo path + server port.
- **`data/job-board.json`** — the only real "database" this app owns. Everything else
  (applications, resumes, interview prep) is read live from the markdown/LaTeX
  already in ResumeSkills — this app is a viewer/controller on top of it, not a
  replacement store.

## Dev workflow — READ BEFORE EDITING

- **Frontend changes** (`web/*.html`, `*.css`, `*.js`): just reload the browser tab —
  the server reads these files fresh on every request.
- **Backend changes** (`server/app.py`): the running Python process has the old code
  loaded in memory. Kill it and relaunch:
  ```
  bin/resumestudio stop
  open ResumeStudio.app
  ```
  (or just `pkill -f server/app.py` then reopen the app). The launcher only starts a
  new server if none is already answering on port 8765 — it will NOT auto-restart a
  stale one for you.
- **Data-integrity rule**: any write path that touches `resume/applications/README.md`
  must edit only the one row it's changing (see `update_readme_status` in `app.py`) —
  never rewrite the whole file. That table is hand-maintained prose-adjacent data;
  a full rewrite risks silently dropping notes.

## Verifying nothing broke after a change

```
python3 server/app.py &                                   # start
curl -s http://127.0.0.1:8765/api/applications | python3 -m json.tool | head -20
curl -s http://127.0.0.1:8765/api/jobs | python3 -m json.tool | head -20
```
If you touched `update_readme_status`, diff `resume/applications/README.md` against
git (the main ResumeSkills repo has it excluded from git, so keep a manual `.bak`
mental note, or `cp` it before testing) to confirm only the intended row changed.

## Regenerating the icon

```
python3 bin/make_icon.py AppIcon.png
mkdir AppIcon.iconset && for s in 16 32 64 128 256 512 1024; do sips -z $s $s AppIcon.png --out AppIcon.iconset/icon_${s}x${s}_tmp.png; done
# then remap _tmp files to icon_NxN.png / icon_NxN@2x.png pairs and:
iconutil -c icns AppIcon.iconset -o ResumeStudio.app/Contents/Resources/AppIcon.icns
```

## `shell/` — native window shell (blocked on this machine, not wired up)

`shell/ResumeStudioShell.swift` is a small AppKit + WKWebView program that would replace
the Chrome-app-mode launcher with a real native window (own Dock icon, no Chrome
dependency) — the same technique used by
[Christian-Katzmann/app-it](https://github.com/Christian-Katzmann/app-it) (verified via
the `trending-skill-finder` skill, 217 stars). It's currently **not compilable on this
machine**: `swiftc` fails with `redefinition of module 'SwiftBridging'`, a known Xcode
Command Line Tools corruption/version-mismatch issue, unrelated to this code. Fix
requires reinstalling Command Line Tools (`sudo rm -rf /Library/Developer/CommandLineTools
&& xcode-select --install`) — a system-level, sudo-gated change, so it's left for you to
run if/when you want this. Once `swiftc shell/ResumeStudioShell.swift -o
ResumeStudio.app/Contents/Resources/ResumeStudioShell` succeeds, swap the launcher's
`open -na "Google Chrome" ...` line for exec-ing that binary instead.

## Design system note: per-section accent color

Each nav item / page title takes on a distinct accent color per view (`--view-dashboard`,
`--view-jobs`, etc. in `styles.css`, applied via `body[data-view]`) instead of one repeated
blue everywhere. This was a deliberate fix against "uniform SaaS card kit" sameness — the
colors are pulled from the existing status-pill palette so it still reads as one coherent
system, not an arbitrary rainbow.

## What's deliberately NOT built

- No auto-submission of applications anywhere — "Prepare Application" tailors a
  resume + drafts the detail file, then stops for manual review/submit.
- No login/auth on the local server (single user, localhost-only).
- No live Gmail sync button — the server has no Gmail credentials of its own;
  pulling new OpenClaw listings happens through Claude in chat, which then writes
  into `data/job-board.json` directly.
