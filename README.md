# ResumeStudio

A local, double-clickable Mac app for tracking your job search — reads and writes
directly against `~/resume-workspace/ResumeSkills/resume/`, no separate database.

## Architecture

- **`server/app.py`** — Python 3 stdlib HTTP server (no pip deps), binds to
  `127.0.0.1:8765` only. Parses `resume/applications/README.md` and
  `resume/applications/<company>.md` on every request (no caching), and reads/writes
  `resume/data/job-board.json` for sourced-but-not-yet-applied listings.
- **`frontend/`** — React + Vite + TypeScript + Tailwind + shadcn/ui, with a
  few components pulled from Aceternity UI and Skiper UI for the animated
  bits (Pipeline view's tracing-beam, background-beams, hand-rolled sparkles;
  Automation view's spotlight-hover cards). Builds to `web-dist/` (gitignored
  build artifact, not committed), which is what the server actually serves.
  Replaced the original hand-written `web/` (2026-09-15 rewrite; that vanilla
  JS/no-build-step version is kept at `web-legacy/` for reference, not served
  by anything). Standing preference for future UI work across projects:
  this same stack, see the `ui-stack-preference` memory.
- **`ResumeStudio.app/`** — hand-built `.app` bundle (no Xcode). Its launcher
  (`Contents/MacOS/ResumeStudio`) starts the Python server if it isn't already
  running, then opens `http://127.0.0.1:8765` in a Chrome app-mode window.
  Symlinked into `~/Applications/ResumeStudio.app` for Spotlight/Launchpad.
- **`data/settings.json`** — points at the ResumeSkills repo path + server port.
- **`resume/data/job-board.json`** — the only real "database" this app owns. Lives
  *inside* the private `resume` git repo (not in this app's own `data/`, and not
  gitignored there) specifically so the daily cloud digest routine (see
  `resume-workspace/ResumeSkills` conversation history — no in-repo doc for it yet)
  can read/write it by cloning that repo, and so this app's own writes to it
  (`save_job_board`, `update_readme_status`) auto-commit+push via `git_sync()` in
  `app.py`. The server also does a best-effort `git pull --ff-only` on startup
  (`pull_resume_repo()`) to pick up whatever the cloud routine committed overnight.
  Everything else (applications, resumes, interview prep) is read live from the
  markdown/LaTeX already in ResumeSkills — this app is a viewer/controller on top
  of it, not a replacement store.

## Dev workflow — READ BEFORE EDITING

- **Frontend changes** (`frontend/src/**`): the `.app` launcher rebuilds `web-dist/`
  automatically on next launch if anything under `frontend/src` or `vite.config.ts`
  is newer than the last build — so `open ResumeStudio.app` after an edit is
  usually enough. For rapid iteration instead, `cd frontend && npm run dev`
  runs Vite's dev server (hot reload, proxies `/api/*` to the already-running
  Python server on 8765) — open that URL instead of 8765 directly while
  actively editing, then switch back to the `.app` launcher when done so the
  real build gets picked up.
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
git afterward to confirm only the intended row changed — it's a real tracked file
in the `resume` repo now, so `git diff` there is the actual source of truth, not a
manual `.bak` (the app still writes a scratch `.bak` before editing, but it's
gitignored and just a local undo net, not what to diff against).

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

- No login/auth on the local server (single user, localhost-only).
- No live Gmail sync button in the app itself — the server still has no Gmail
  credentials of its own. As of 2026-09, a **cloud routine** (created via
  Claude Code's `/schedule`, not part of this repo's code, but controllable
  from the Automation view below) handles that instead:
  - `ResumeStudio Daily Digest` (`trig_01NvD59Y3gTqpQP8tPNZtn5M`) — fires
    2:30pm daily. Runs on Anthropic's cloud with a Gmail MCP connector,
    reads the OpenClaw digest via `scripts/ingest_openclaw.py` (in the
    `resume` repo, not here), filters/dedupes, researches and ranks every
    new/shortlisted listing itself (no manual shortlisting step anymore —
    Raza turned that off 2026-09-21), tailors + stages anything worth
    pursuing straight to `approved_for_submission`, rules out the rest,
    commits straight into the private `resume` repo, and emails a report.
  This app just needs to be open (it pulls on startup) to see whatever the
  routine committed. Manually pulling new listings from a pasted digest via
  Claude in chat still works the same way as before, into the same file.
  - `ResumeStudio Approval Checker` (`trig_01J8HbayG8GP4f6WfEhaH62c`) used to
    watch for an email reply approving staged applications by number/name.
    **Disabled 2026-09-21** — there's no separate approval step to check for
    anymore now that the digest auto-approves directly.
  Actually submitting an application **is now automated**, fully unattended
  — see "Running the apply loop" below. The digest routine still can't do
  it itself (a **cloud** routine session has Gmail access but no browser
  tools), so form-fill/submit happens in a separate **local**, Terminal-launched
  interactive `claude` session with claude-in-chrome, kicked off by clicking
  "Start Apply Loop" in the Pipeline view (or asking in chat). It runs to
  completion without anyone watching each submission — the one thing it still
  won't do is submit through a job with an unresolved red flag the digest
  routine already flagged (see "Running the apply loop" below), or create an
  account/enter credentials to get past a login wall.
- **Automation view** (`frontend/src/views/Automation.tsx`) shows both
  routines' live status and lets you run-now / enable / disable them —
  backed by `run_routine_action()` in `app.py`, which shells out to
  `claude -p --allowed-tools RemoteTrigger` the same way "Prepare
  Application" shells out for tailoring. Status is cached
  (`data/routines_cache.json`, gitignored) with a 5-minute
  stale-while-revalidate TTL since each round-trip is slow (10-30s+).

## Running the apply loop

The Pipeline view's "Apply Loop" card (`frontend/src/components/ApplyLoopPanel.tsx`)
lets Raza click "Start Apply Loop". That sets `data/apply_loop_state.json`'s
status to `"requested"` *and* `launch_apply_loop_session()` in `app.py` opens
a new Terminal.app window running `claude` interactively (via `osascript`,
not `claude -p`, which has no browser-tool access at all), pre-loaded with
the prompt "read this section and follow it." So the loop now starts
itself and runs unattended end to end — this section is what that session
(or you, if Raza asks in chat instead — same procedure either way) actually
does:

1. `curl -s http://127.0.0.1:8765/api/apply-loop` — if `queued` is empty,
   there's nothing to do; tell Raza and stop. Otherwise mark it started:
   `curl -X POST http://127.0.0.1:8765/api/apply-loop/progress -H 'Content-Type: application/json' -d '{"status":"running"}'`
2. For each job in `queued` (one at a time, in order):
   - Post which one you're on:
     `-d '{"status":"running","current":{"company":"...","role":"..."}}'`
     to `.../apply-loop/progress`.
   - Read its tailored resume (`tailored/<slug>.tex`, or the compiled
     PDF in `build/`) and its detail file (`applications/<company>.md`)
     for the answers it already drafted.
   - **Check the detail file for an unresolved `## ⚠️ Open items / red
     flags before submitting` section first.** If it has one, don't
     submit — this isn't a style judgment call, it's the digest routine
     telling you it couldn't confirm something material (eligibility,
     whether the link even works, a possible duplicate). Treat it like
     `manual_only` below instead: skip it, `reason` = that section's
     text, move on.
   - Otherwise, use claude-in-chrome to open the job's `link`, fill the
     form from that detail file, and submit it — no pause for
     confirmation, Raza has approved autonomous submission for anything
     that reaches this point clean. Never create an account or enter
     credentials to get past a login wall; if a posting turns out to
     need one, treat it like `manual_only` (see below) instead.
   - On success: `update_job_status(job_id, "applied")` equivalent via
     `POST /api/jobs/<id>/status {"status":"applied"}`, add a row/update
     `applications/README.md` the same way "Prepare Application" does,
     and post progress with that job appended to `completed`.
   - On failure (dead posting, turned out to need an account, unresolved
     red flag, etc.): append to `failed` with a short `reason` instead,
     and move on — one bad job shouldn't stop the rest of the queue.
3. When the queue is empty, post a short summary:
   `curl -X POST .../apply-loop/complete -d '{"status":"done","summary":"..."}'`.

Never skip straight to `/complete` without actually doing the above.
This runs fully unattended now (Raza isn't watching each submission
live) — which makes the red-flag check above the only thing standing
between "the agent's judgment" and "the agent guessing on a fact it
already told you it didn't know." Don't skip that check.
