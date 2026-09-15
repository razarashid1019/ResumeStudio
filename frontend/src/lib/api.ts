// Typed client for server/app.py's existing /api/* endpoints, plus the new
// /api/routines endpoints added alongside this rewrite. Shapes here mirror
// the Python server exactly (see parse_readme_table, parse_detail_file,
// load_job_board in server/app.py) -- this file has no logic of its own,
// it's just fetch + JSON typing.

export type ApplicationRow = {
  company: string;
  role: string;
  location: string;
  status: string;
  date_applied: string;
  resume_used: string;
  detail_file: string | null;
};

export type ApplicationDetail = {
  title: string;
  fields: Record<string, string>;
  sections: { heading: string; body: string }[];
  intro?: string;
};

// Status vocabulary has grown past the original 6 as the daily digest
// cloud routine (see resumestudio-app memory) introduced "manual_only" and
// the approval-checker routine introduced "approved_for_submission".
export type JobStatus =
  | "new"
  | "shortlisted"
  | "ruled_out"
  | "preparing"
  | "ready_to_apply"
  | "manual_only"
  | "approved_for_submission"
  | "applied";

export type Job = {
  id: string;
  company: string;
  role: string;
  location: string | null;
  link: string;
  comp: string | null;
  why: string | null;
  notes: string | null;
  red_flags: string[];
  rank: number | null;
  source: string;
  status: JobStatus;
  date_added: string;
};

export type Resume = {
  slug: string;
  has_pdf: boolean;
  pdf_size: number | null;
  mtime: number;
};

export type RoutineStatus = {
  id: string;
  name: string;
  enabled: boolean;
  cron_expression: string;
  next_run_at: string | null;
  last_fired_at: string | null;
  last_run?: {
    status: string;
    title: string;
    last_event_at: string;
    url: string;
  } | null;
};

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const getApplications = () =>
  api<{ rows: ApplicationRow[]; legend: string[] }>("/api/applications");

export const getApplicationDetail = (file: string) =>
  api<ApplicationDetail>(`/api/applications/${file}`);

export const getJobs = () => api<{ jobs: Job[] }>("/api/jobs");

export const setJobStatus = (jobId: string, status: string) =>
  api<{ ok: boolean }>(`/api/jobs/${jobId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

export const getResumes = () => api<{ resumes: Resume[] }>("/api/resume");

export const getResumeDiff = (slug: string) =>
  api<{ diff: string }>(`/api/resume/diff/${slug}`);

export const prepareJob = (jobId: string) =>
  api<{ run_id: string }>("/api/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId }),
  });

export const getPrepareLog = (runId: string) =>
  api<{ status: string; output: string }>(`/api/prepare/${runId}/log`);

// -------------------------------------------------------- routine control --
// Backed by run_routine_agent() in app.py, which shells out to `claude -p`
// with the RemoteTrigger tool the same way run_prepare_job already shells
// out for resume tailoring -- confirmed working headless (unlike Gmail /
// browser tools, which are not) before this was built.

export const getRoutines = () =>
  api<{ routines: RoutineStatus[]; updated_at: number | null; refreshing: boolean }>("/api/routines");

export const runRoutineNow = (id: string) =>
  api<{ started: boolean }>(`/api/routines/${id}/run`, { method: "POST" });

export const setRoutineEnabled = (id: string, enabled: boolean) =>
  api<{ ok: boolean }>(`/api/routines/${id}/enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
