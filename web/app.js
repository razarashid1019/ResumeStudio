// ResumeStudio frontend — vanilla JS, no build step.

const STATUS_SLUG = (s) => (s || "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
const JOB_STATUSES = ["new", "shortlisted", "ruled_out", "preparing", "ready_to_apply", "applied"];

// ---------------------------------------------------------------- utils --

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------- company logos --
// Progressive enhancement: show a colored initials avatar immediately (works
// fully offline), swap in the site's real favicon if/when it loads. No logo
// data is stored — everything here is derived from job.company / job.link.

const AVATAR_COLORS = ["#0071e3", "#34c9eb", "#8b3fd6", "#ff9500", "#1f9254", "#ff3b30", "#ff2d92", "#5e5ce6"];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function companyInitials(name) {
  const words = (name || "?").replace(/[,.]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Third-party ATS/job-board platforms — their favicon would misleadingly
// represent every company that happens to post through them, so skip and
// fall back to the initials avatar instead of showing (say) Greenhouse's
// logo on a card for a company that merely uses Greenhouse to host its form.
const ATS_HOST_PATTERNS = [
  "ashbyhq.com", "greenhouse.io", "lever.co", "myworkdayjobs.com", "myworkdaysite.com",
  "icims.com", "workable.com", "oraclecloud.com", "smartrecruiters.com", "jobvite.com",
  "paylocity.com", "taleo.net", "eightfold.ai", "applytojob.com", "jobright.ai",
  "interninsider.me", "recsolu.com", "yello.co", "workatastartup.com",
];

function faviconUrl(link) {
  try {
    const host = new URL(link).hostname;
    if (ATS_HOST_PATTERNS.some((p) => host.includes(p))) return null;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return null;
  }
}

function companyLogoNode(job, size = 44) {
  const wrap = el("div", { class: "company-logo", style: `width:${size}px;height:${size}px;` });
  const avatar = el(
    "div",
    {
      class: "company-avatar",
      style: `background:${AVATAR_COLORS[hashStr(job.company || "?") % AVATAR_COLORS.length]};font-size:${Math.round(size * 0.4)}px;`,
    },
    companyInitials(job.company)
  );
  wrap.appendChild(avatar);
  const url = job.link ? faviconUrl(job.link) : null;
  if (url) {
    const img = new Image();
    img.className = "company-favicon";
    img.width = size;
    img.height = size;
    img.onload = () => {
      wrap.innerHTML = "";
      wrap.appendChild(img);
    };
    img.src = url; // onerror: leave the avatar fallback already showing
  }
  return wrap;
}

// -------------------------------------------------------------- locations --
// OpenClaw's multi-location postings arrive concatenated with no separator
// ("Irvine, CASanta Clara, CA...") — split them back into a clean list.

function splitLocations(loc) {
  if (!loc) return [];
  const fixed = loc.replace(/([A-Z]{2})(?=[A-Z][a-z])/g, "$1|").replace(/\//g, "|");
  return fixed.split("|").map((s) => s.trim()).filter(Boolean);
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Minimal markdown -> HTML. Covers what's actually used in these files:
// headers, bold, links, inline code, lists, blockquotes, paragraphs.
function renderMarkdown(src) {
  if (!src) return "";
  const lines = src.split("\n");
  let html = "";
  let inList = null; // 'ul' | 'ol'
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html += `<p>${inline(para.join(" "))}</p>`;
      para = [];
    }
  };
  const closeList = () => {
    if (inList) { html += `</${inList}>`; inList = null; }
  };
  function inline(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeList(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara(); closeList();
      const level = Math.min(m[1].length + 2, 6);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); closeList();
      html += `<blockquote>${inline(m[1])}</blockquote>`;
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (inList !== "ul") { closeList(); html += "<ul>"; inList = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      flushPara();
      if (inList !== "ol") { closeList(); html += "<ol>"; inList = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList();
  return html || `<p>${inline(src)}</p>`;
}

function pillClass(status) {
  const s = (status || "").toLowerCase();
  if (s.startsWith("staged")) return "pill pill-staged";
  if (s.startsWith("applied")) return "pill pill-applied";
  if (s.startsWith("oa") || s.includes("screen")) return "pill pill-screen";
  if (s.startsWith("interview")) return "pill pill-interview";
  if (s.startsWith("offer")) return "pill pill-offer";
  if (s.startsWith("rejected")) return "pill pill-rejected";
  if (s.startsWith("withdrawn")) return "pill pill-withdrawn";
  return `pill pill-${STATUS_SLUG(status)}`; // job-board statuses (new/shortlisted/etc.)
}

function openPanel(node) {
  document.getElementById("panel-body").innerHTML = "";
  document.getElementById("panel-body").appendChild(node);
  document.getElementById("overlay").classList.remove("hidden");
}
function closePanel() {
  document.getElementById("overlay").classList.add("hidden");
}
document.getElementById("panel-close").addEventListener("click", closePanel);
document.getElementById("overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closePanel();
});

// ------------------------------------------------------------- nav/views --

const views = {};
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function switchView(name) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.body.dataset.view = name;
  views[name] && views[name]();
}

// ------------------------------------------------------------- dashboard --

views.dashboard = async function renderDashboard() {
  const root = document.getElementById("view-dashboard");
  root.innerHTML = `<h1 class="page-title">Dashboard</h1><p class="page-subtitle">Loading…</p>`;
  const [{ rows }, { jobs }] = await Promise.all([api("/api/applications"), api("/api/jobs")]);

  const counts = { applied: 0, inProgress: 0, interview: 0, offer: 0 };
  rows.forEach((r) => {
    const s = r.status.toLowerCase();
    if (s.includes("applied")) counts.applied++;
    if (s.includes("oa") || s.includes("screen")) counts.inProgress++;
    if (s.includes("interview")) counts.interview++;
    if (s.includes("offer")) counts.offer++;
  });

  root.innerHTML = "";
  root.appendChild(el("h1", { class: "page-title" }, "Dashboard"));
  root.appendChild(el("p", { class: "page-subtitle" }, `${rows.length} applications tracked · ${jobs.length} jobs on the board`));

  const stats = el("div", { class: "stat-grid" }, [
    statTile(counts.applied, "Applied"),
    statTile(counts.inProgress, "OA / Screen"),
    statTile(counts.interview, "Interviewing"),
    statTile(counts.offer, "Offers"),
  ]);
  root.appendChild(stats);

  root.appendChild(el("div", { class: "section-title" }, "Recent activity"));
  const recent = [...rows].sort((a, b) => (b.date_applied || "").localeCompare(a.date_applied || "")).slice(0, 6);
  recent.forEach((r) => root.appendChild(applicationCard(r)));

  const newJobs = jobs.filter((j) => j.status === "new" || j.status === "shortlisted").slice(0, 4);
  if (newJobs.length) {
    root.appendChild(el("div", { class: "section-title" }, "Fresh on the job board"));
    const list = el("div", { class: "job-row-list" });
    newJobs.forEach((j) => list.appendChild(jobListRow(j, { onClick: () => openJobDetail(j) })));
    root.appendChild(list);
  }
};

function statTile(value, label) {
  return el("div", { class: "stat-tile" }, [
    el("div", { class: "stat-value" }, String(value)),
    el("div", { class: "stat-label" }, label),
  ]);
}

// ------------------------------------------------------------- job board --

let jobFilter = "all";
const PAGE_SIZE = 20; // cards per infinite-scroll batch
let streetviewCache = {}; // job_id -> true|false|undefined(not checked yet)
let mapsKeyConfigured = false;
let jobsScrollHandler = null; // torn down and re-attached each render

views.jobs = async function renderJobs() {
  const root = document.getElementById("view-jobs");
  root.innerHTML = `<h1 class="page-title">Job Board</h1><p class="page-subtitle">Loading…</p>`;
  const [{ jobs }, svStatus] = await Promise.all([api("/api/jobs"), api("/api/jobs/streetview-status")]);
  streetviewCache = svStatus.status;
  mapsKeyConfigured = svStatus.maps_key_configured;

  root.innerHTML = "";
  root.appendChild(el("h1", { class: "page-title" }, "Job Board"));
  if (!mapsKeyConfigured) {
    root.appendChild(el("div", { class: "job-flags", style: "margin-bottom:16px;" },
      "No Google Maps API key configured yet — cards show placeholders until one's added to data/secrets.json."));
  }
  root.appendChild(el("p", { class: "page-subtitle" }, `${jobs.length} postings — scroll for more.`));

  const filters = ["all", ...JOB_STATUSES];
  const filterRow = el("div", { class: "filter-row" });
  filters.forEach((f) => {
    const chip = el("button", { class: "chip" + (jobFilter === f ? " active" : "") }, f.replace(/_/g, " "));
    chip.addEventListener("click", () => { jobFilter = f; views.jobs(); });
    filterRow.appendChild(chip);
  });
  root.appendChild(filterRow);

  const shown = jobFilter === "all" ? jobs : jobs.filter((j) => j.status === jobFilter);

  if (!shown.length) {
    root.appendChild(el("div", { class: "empty-state" }, "No jobs in this category."));
    return;
  }

  const grid = el("div", { class: "photo-grid" });
  root.appendChild(grid);

  const contentEl = document.querySelector(".content");
  if (jobsScrollHandler) contentEl.removeEventListener("scroll", jobsScrollHandler);

  let loaded = 0;
  function loadMore() {
    if (loaded >= shown.length) return;
    const next = shown.slice(loaded, loaded + PAGE_SIZE);
    next.forEach((j) => grid.appendChild(photoCard(j)));
    loaded += next.length;
    if (loaded >= shown.length) contentEl.removeEventListener("scroll", jobsScrollHandler);
  }

  jobsScrollHandler = () => {
    if (document.body.dataset.view !== "jobs") {
      contentEl.removeEventListener("scroll", jobsScrollHandler);
      return;
    }
    if (contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 900) loadMore();
  };

  loadMore();
  if (loaded < shown.length) contentEl.addEventListener("scroll", jobsScrollHandler);
};

function photoCard(job) {
  const card = el("div", { class: "photo-card" });

  const image = el("div", { class: "photo-card-image" });
  applyCardImage(image, job);
  image.appendChild(el("span", { class: pillClass(job.status) }, job.status.replace(/_/g, " ")));
  card.appendChild(image);

  const body = el("div", { class: "photo-card-body" });
  body.appendChild(el("div", { class: "photo-card-role" }, job.role || job.company));
  body.appendChild(el("div", { class: "photo-card-company" }, job.company));

  const metaBits = [splitLocations(job.location).join(" · "), job.comp, daysAgo(job.date_added)].filter(Boolean);
  if (metaBits.length) body.appendChild(el("div", { class: "job-row-meta" }, metaBits.join(" · ")));

  const snippet = job.why || job.notes;
  if (snippet) body.appendChild(el("div", { class: "job-row-snippet" }, snippet));
  if (job.red_flags && job.red_flags.length) {
    body.appendChild(el("div", { class: "job-row-flag" }, "⚠ " + job.red_flags[0]));
  }
  card.appendChild(body);

  card.addEventListener("click", () => openJobDetail(job));
  return card;
}

// Sets the card's photo area to a real Street View image of the company's
// actual workplace when one's known to exist, otherwise a colored-initials
// placeholder — upgraded in place if a background check finds real imagery.
// (Deliberately not falling back to a scraped og:image/logo here — showing
// a logo as if it were "a picture of where you'd be working" would be the
// same kind of misleading substitution already ruled out for ATS icons.)
function applyCardImage(imageEl, job) {
  const known = streetviewCache[job.id];
  if (known === true) {
    imageEl.style.backgroundImage = `url(/api/jobs/streetview/${job.id}.jpg)`;
    return;
  }
  const initials = el("div", { class: "photo-card-initials" }, companyInitials(job.company));
  imageEl.classList.add("photo-card-image-fallback");
  imageEl.style.background = AVATAR_COLORS[hashStr(job.company || "?") % AVATAR_COLORS.length];
  imageEl.appendChild(initials);

  if (known === undefined && mapsKeyConfigured) {
    streetviewCache[job.id] = false; // mark checked so we don't fetch twice
    api(`/api/jobs/${job.id}/streetview`, { method: "POST" })
      .then(({ available }) => {
        streetviewCache[job.id] = available;
        if (available) {
          initials.remove();
          imageEl.classList.remove("photo-card-image-fallback");
          imageEl.style.background = "";
          imageEl.style.backgroundImage = `url(/api/jobs/streetview/${job.id}.jpg)`;
        }
      })
      .catch(() => {});
  }
}

function jobListRow(job, { selected, onClick } = {}) {
  const row = el("div", { class: "job-row" + (selected ? " selected" : "") });
  row.appendChild(companyLogoNode(job, 36));

  const body = el("div", { class: "job-row-body" });
  body.appendChild(el("div", { class: "job-row-top" }, [
    el("span", { class: "job-row-role" }, job.role || job.company),
    el("span", { class: pillClass(job.status) }, job.status.replace(/_/g, " ")),
  ]));
  body.appendChild(el("div", { class: "job-row-company" }, job.company));

  const metaBits = [splitLocations(job.location).join(" · "), job.comp, daysAgo(job.date_added)].filter(Boolean);
  if (metaBits.length) body.appendChild(el("div", { class: "job-row-meta" }, metaBits.join(" · ")));

  const snippet = job.why || job.notes;
  if (snippet) body.appendChild(el("div", { class: "job-row-snippet" }, snippet));
  if (job.red_flags && job.red_flags.length) {
    body.appendChild(el("div", { class: "job-row-flag" }, "⚠ " + job.red_flags[0]));
  }

  row.appendChild(body);
  row.addEventListener("click", () => onClick && onClick());
  return row;
}

function buildJobDetailNode(job, { onChanged } = {}) {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "detail-header-row" }, [
    companyLogoNode(job, 64),
    el("div", {}, [
      el("h2", { style: "margin-bottom:2px;" }, job.company),
      el("div", { class: "card-sub" }, job.role || ""),
    ]),
  ]));

  const chips = [];
  splitLocations(job.location).forEach((loc) => chips.push(el("span", { class: "meta-chip" }, loc)));
  if (job.comp) chips.push(el("span", { class: "meta-chip meta-chip-comp" }, job.comp));
  const ago = daysAgo(job.date_added);
  if (ago) chips.push(el("span", { class: "meta-chip meta-chip-muted" }, ago));
  if (chips.length) wrap.appendChild(el("div", { class: "meta-chip-row", style: "margin:14px 0;" }, chips));

  const statusPicker = el("select", { class: "status-select" });
  JOB_STATUSES.forEach((s) => {
    const opt = el("option", { value: s }, s.replace(/_/g, " "));
    if (s === job.status) opt.selected = true;
    statusPicker.appendChild(opt);
  });
  statusPicker.addEventListener("change", async () => {
    await api(`/api/jobs/${job.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: statusPicker.value }),
    });
    views.dashboard();
    onChanged && onChanged();
  });

  const actions = el("div", { class: "job-actions", style: "margin:14px 0;" });
  if (job.link) actions.appendChild(el("a", { class: "btn btn-primary", href: job.link, target: "_blank", rel: "noopener" }, "Open posting"));
  if (job.status !== "ruled_out" && job.status !== "ready_to_apply" && job.status !== "applied") {
    const prepBtn = el("button", { class: "btn" }, job.status === "preparing" ? "Preparing…" : "Prepare Application");
    prepBtn.disabled = job.status === "preparing";
    prepBtn.addEventListener("click", () => startPrepare(job, prepBtn));
    actions.appendChild(prepBtn);
  }
  wrap.appendChild(actions);

  wrap.appendChild(el("div", { class: "detail-section" }, [
    el("div", { class: "detail-field-label" }, "Status"),
    statusPicker,
  ]));

  if (job.why) wrap.appendChild(el("div", { class: "detail-section" }, [
    el("h3", {}, "Why this role"),
    el("div", { class: "md-body" }, job.why),
  ]));
  if (job.notes) wrap.appendChild(el("div", { class: "detail-section" }, [
    el("h3", {}, "Notes"),
    el("div", { class: "md-body" }, job.notes),
  ]));
  if (job.red_flags && job.red_flags.length) {
    wrap.appendChild(el("div", { class: "detail-section" }, [
      el("h3", {}, "Red flags"),
      el("div", { class: "job-flags" }, job.red_flags.join(" ")),
    ]));
  }
  if (job.source) wrap.appendChild(el("div", { class: "detail-section" }, [
    el("div", { class: "detail-field-label" }, "Source"),
    el("div", { class: "detail-field-value" }, job.source),
  ]));

  return wrap;
}

function openJobDetail(job) {
  openPanel(buildJobDetailNode(job, { onChanged: () => { views.dashboard(); } }));
}

async function startPrepare(job, btn) {
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const { run_id } = await api("/api/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: job.id }),
    });
    pollPrepare(run_id, job);
  } catch (e) {
    btn.textContent = "Failed — retry";
    btn.disabled = false;
  }
}

function pollPrepare(runId, job) {
  const timer = setInterval(async () => {
    try {
      const info = await api(`/api/prepare/${runId}/log`);
      if (info.status === "done" || info.status === "error") {
        clearInterval(timer);
        views.jobs();
        if (document.querySelector(".nav-item.active").dataset.view === "jobs") views.jobs();
      }
    } catch (e) {
      clearInterval(timer);
    }
  }, 4000);
}

// ------------------------------------------------------------ applications --

views.applications = async function renderApplications() {
  const root = document.getElementById("view-applications");
  root.innerHTML = `<h1 class="page-title">Applications</h1><p class="page-subtitle">Loading…</p>`;
  const { rows, legend } = await api("/api/applications");

  root.innerHTML = "";
  root.appendChild(el("h1", { class: "page-title" }, "Applications"));
  root.appendChild(el("p", { class: "page-subtitle" }, `${rows.length} tracked, grouped by stage`));

  const kanban = el("div", { class: "kanban" });
  legend.forEach((stage) => {
    const stageRows = rows.filter((r) => r.status === stage);
    const col = el("div", { class: "kanban-col" }, [
      el("div", { class: "kanban-col-header" }, [
        el("span", {}, stage),
        el("span", { class: "kanban-count" }, String(stageRows.length)),
      ]),
    ]);
    stageRows.forEach((r) => col.appendChild(applicationCard(r)));
    kanban.appendChild(col);
  });
  root.appendChild(kanban);
};

function applicationCard(row) {
  const card = el("div", { class: "card" }, [
    el("div", { class: "card-row" }, [
      el("div", {}, [
        el("div", { class: "card-title" }, row.company),
        el("div", { class: "card-sub" }, row.role),
      ]),
      el("span", { class: pillClass(row.status) }, row.status),
    ]),
  ]);
  card.addEventListener("click", () => openApplicationDetail(row));
  return card;
}

async function openApplicationDetail(row) {
  const body = el("div", {}, [el("div", { class: "loading" }, "Loading…")]);
  openPanel(body);
  const detail = row.detail_file ? await api(`/api/applications/${row.detail_file}`) : null;

  const wrap = el("div");
  wrap.appendChild(el("h2", {}, `${row.company} — ${row.role}`));

  const statusRow = el("div", { class: "detail-fields" }, [
    field("Location", row.location),
    field("Resume used", row.resume_used),
  ]);
  wrap.appendChild(statusRow);

  const statusPicker = el("select", { class: "status-select" });
  ["Staged — not submitted", "Applied", "OA / Screen", "Interview", "Offer", "Rejected", "Withdrawn"].forEach((s) => {
    const opt = el("option", { value: s }, s);
    if (s === row.status) opt.selected = true;
    statusPicker.appendChild(opt);
  });
  statusPicker.addEventListener("change", async () => {
    await api(`/api/applications/${encodeURIComponent(row.company)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: statusPicker.value }),
    });
    views.dashboard(); views.applications();
  });
  wrap.appendChild(el("div", { class: "detail-section" }, [
    el("div", { class: "detail-field-label" }, "Status"),
    statusPicker,
  ]));

  if (detail) {
    if (detail.fields.job_url) {
      wrap.appendChild(el("div", { style: "margin-bottom:20px;" }, [
        el("a", { class: "btn", href: detail.fields.job_url, target: "_blank", rel: "noopener" }, "Open job posting"),
      ]));
    }
    detail.sections.forEach((sec) => {
      wrap.appendChild(el("div", { class: "detail-section" }, [
        el("h3", {}, sec.heading),
        el("div", { class: "md-body", html: renderMarkdown(sec.body) }),
      ]));
    });
  } else {
    wrap.appendChild(el("p", { class: "empty-state" }, "No detail file on record yet."));
  }

  openPanel(wrap);
}

function field(label, value) {
  return el("div", {}, [
    el("div", { class: "detail-field-label" }, label),
    el("div", { class: "detail-field-value" }, value || "—"),
  ]);
}

// -------------------------------------------------------------- interview --

views.interview = async function renderInterview() {
  const root = document.getElementById("view-interview");
  root.innerHTML = `<h1 class="page-title">Interview Prep</h1><p class="page-subtitle">Loading…</p>`;
  const { rows } = await api("/api/applications");

  root.innerHTML = "";
  root.appendChild(el("h1", { class: "page-title" }, "Interview Prep"));
  root.appendChild(el("p", { class: "page-subtitle" }, "Pulled from each application's notes — study sheet per company."));

  const withDetail = rows.filter((r) => r.detail_file);
  for (const row of withDetail) {
    const detail = await api(`/api/applications/${row.detail_file}`);
    const prepSection = detail.sections.find((s) => /interview prep/i.test(s.heading));
    if (!prepSection) continue;
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-row" }, [
        el("div", { class: "card-title" }, `${row.company} — ${row.role}`),
        el("span", { class: pillClass(row.status) }, row.status),
      ]),
      el("div", { class: "md-body", html: renderMarkdown(prepSection.body), style: "margin-top:10px;cursor:default;" }),
    ]));
  }
  if (!root.querySelectorAll(".card").length) {
    root.appendChild(el("div", { class: "empty-state" }, "No interview prep notes yet."));
  }
};

// ---------------------------------------------------------------- resumes --

views.resumes = async function renderResumes() {
  const root = document.getElementById("view-resumes");
  root.innerHTML = `<h1 class="page-title">Resumes</h1><p class="page-subtitle">Loading…</p>`;
  const { resumes } = await api("/api/resume");

  root.innerHTML = "";
  root.appendChild(el("h1", { class: "page-title" }, "Resumes"));
  root.appendChild(el("p", { class: "page-subtitle" }, `${resumes.length} tailored versions, each a pure reorder of the master resume.`));

  resumes.forEach((r) => {
    const card = el("div", { class: "card" }, [
      el("div", { class: "card-row" }, [
        el("div", { class: "card-title" }, r.slug),
        el("span", { class: "job-meta" }, r.has_pdf ? `${Math.round(r.pdf_size / 1024)} KB` : "no PDF"),
      ]),
    ]);
    card.addEventListener("click", () => openResumeDetail(r));
    root.appendChild(card);
  });
};

async function openResumeDetail(resume) {
  const wrap = el("div");
  wrap.appendChild(el("h2", {}, resume.slug));
  const actions = el("div", { class: "job-actions" }, [
    el("a", { class: "btn btn-primary", href: `/api/resume/pdf/${resume.slug}`, target: "_blank" }, "Open PDF"),
  ]);
  wrap.appendChild(actions);

  const diffWrap = el("div", { class: "detail-section" }, [
    el("h3", {}, "Compare to master"),
    el("div", { class: "loading" }, "Loading diff…"),
  ]);
  wrap.appendChild(diffWrap);
  openPanel(wrap);

  const { diff } = await api(`/api/resume/diff/${resume.slug}`);
  diffWrap.innerHTML = "";
  diffWrap.appendChild(el("h3", {}, "Compare to master"));
  const pre = el("div", { class: "diff-block" });
  (diff || "(no differences)").split("\n").forEach((line) => {
    const span = document.createElement("div");
    if (line.startsWith("+") && !line.startsWith("+++")) span.className = "diff-add";
    else if (line.startsWith("-") && !line.startsWith("---")) span.className = "diff-del";
    else if (line.startsWith("@@")) span.className = "diff-hunk";
    span.textContent = line;
    pre.appendChild(span);
  });
  diffWrap.appendChild(pre);
}

// ------------------------------------------------------------------- init --
switchView("dashboard");
