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
    newJobs.forEach((j) => root.appendChild(jobCard(j)));
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

views.jobs = async function renderJobs() {
  const root = document.getElementById("view-jobs");
  root.innerHTML = `<h1 class="page-title">Job Board</h1><p class="page-subtitle">Loading…</p>`;
  const { jobs } = await api("/api/jobs");

  root.innerHTML = "";
  root.appendChild(el("h1", { class: "page-title" }, "Job Board"));
  root.appendChild(el("p", { class: "page-subtitle" }, "Sourced candidates — prep an application without leaving this view."));

  const filters = ["all", ...JOB_STATUSES];
  const filterRow = el("div", { class: "filter-row" });
  filters.forEach((f) => {
    const chip = el("button", { class: "chip" + (jobFilter === f ? " active" : "") }, f.replace(/_/g, " "));
    chip.addEventListener("click", () => { jobFilter = f; views.jobs(); });
    filterRow.appendChild(chip);
  });
  root.appendChild(filterRow);

  const shown = jobFilter === "all" ? jobs : jobs.filter((j) => j.status === jobFilter);
  const grid = el("div", { class: "job-grid" });
  if (!shown.length) grid.appendChild(el("div", { class: "empty-state" }, "No jobs in this category."));
  shown.forEach((j) => grid.appendChild(jobCard(j)));
  root.appendChild(grid);
};

function jobCard(job) {
  const card = el("div", { class: "job-card" });
  card.appendChild(el("div", { class: "job-card-top" }, [
    el("div", {}, [
      el("div", { class: "job-company" }, job.company),
      el("div", { class: "job-role" }, job.role || ""),
    ]),
    el("span", { class: pillClass(job.status) }, job.status.replace(/_/g, " ")),
  ]));
  if (job.location || job.comp) {
    card.appendChild(el("div", { class: "job-meta" }, [job.location, job.comp].filter(Boolean).join(" · ")));
  }
  if (job.why) card.appendChild(el("div", { class: "job-why" }, job.why));
  if (job.red_flags && job.red_flags.length) {
    card.appendChild(el("div", { class: "job-flags" }, "⚠ " + job.red_flags.join(" ")));
  }
  const actions = el("div", { class: "job-actions" });
  if (job.link) {
    actions.appendChild(el("a", { class: "btn", href: job.link, target: "_blank", rel: "noopener" }, "Open posting"));
  }
  if (job.status !== "ruled_out" && job.status !== "ready_to_apply" && job.status !== "applied") {
    const prepBtn = el("button", { class: "btn btn-primary" }, job.status === "preparing" ? "Preparing…" : "Prepare Application");
    prepBtn.disabled = job.status === "preparing";
    prepBtn.addEventListener("click", () => startPrepare(job, prepBtn));
    actions.appendChild(prepBtn);
  }
  if (job.status === "ready_to_apply") {
    actions.appendChild(el("span", { class: "job-meta" }, "Ready — open the posting and submit yourself"));
  }
  card.appendChild(actions);
  return card;
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
