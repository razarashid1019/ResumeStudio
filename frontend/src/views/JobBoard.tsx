import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Sparkles } from "lucide-react";
import { getJobs, setJobStatus, prepareJob, getPrepareLog, type Job } from "@/lib/api";
import { pillStyle, jobStatusLabel } from "@/lib/status";
import { Card } from "@/components/ui/card";

const FILTERS = ["all", "new", "shortlisted", "ready_to_apply", "approved_for_submission", "manual_only"] as const;

export default function JobBoard() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [selected, setSelected] = useState<Job | null>(null);

  const refresh = () => getJobs().then((r) => setJobs(r.jobs));
  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const list = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);
    return [...list].sort((a, b) => (b.date_added || "").localeCompare(a.date_added || ""));
  }, [jobs, filter]);

  async function shortlist(job: Job) {
    await setJobStatus(job.id, "shortlisted");
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Job Board</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {jobs ? `${jobs.length} sourced listings` : "Loading…"}
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            {f === "all" ? "All" : jobStatusLabel(f)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((j) => (
          <Card
            key={j.id}
            onClick={() => setSelected(j)}
            className="cursor-pointer px-4 py-3 transition-colors hover:bg-secondary/30"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium">{j.company}</div>
                <div className="truncate text-xs text-muted-foreground">{j.role}</div>
              </div>
              <span className="ml-3 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium" style={pillStyle(j.status)}>
                {jobStatusLabel(j.status)}
              </span>
            </div>
          </Card>
        ))}
        {jobs && filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">Nothing here.</div>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <JobDetailPanel
            job={selected}
            onClose={() => setSelected(null)}
            onShortlist={() => shortlist(selected)}
            onPrepared={refresh}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function JobDetailPanel({
  job,
  onClose,
  onShortlist,
  onPrepared,
}: {
  job: Job;
  onClose: () => void;
  onShortlist: () => void;
  onPrepared: () => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  async function handlePrepare() {
    setPreparing(true);
    const { run_id } = await prepareJob(job.id);
    const poll = setInterval(async () => {
      const info = await getPrepareLog(run_id);
      if (info.status !== "running") {
        clearInterval(poll);
        setPreparing(false);
        setLog(info.output);
        onPrepared();
      }
    }, 4000);
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="h-full w-[420px] overflow-y-auto border-l border-border bg-background p-6"
        initial={{ x: 40 }}
        animate={{ x: 0 }}
        exit={{ x: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={pillStyle(job.status)}>
            {jobStatusLabel(job.status)}
          </span>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <h2 className="mt-3 text-lg font-semibold">{job.company}</h2>
        <p className="text-sm text-muted-foreground">{job.role}</p>
        {job.location && <p className="mt-1 text-xs text-muted-foreground">{job.location}</p>}

        {job.comp && (
          <div className="mt-4 rounded-lg bg-secondary/40 px-3 py-2 text-sm">{job.comp}</div>
        )}
        {job.why && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground">Why this role</div>
            <p className="mt-1 text-sm">{job.why}</p>
          </div>
        )}
        {job.red_flags?.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-red-400">Red flags</div>
            <ul className="mt-1 list-disc pl-4 text-sm text-muted-foreground">
              {job.red_flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <a
            href={job.link}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary/40"
          >
            Posting <ExternalLink size={13} />
          </a>
          {job.status === "new" && (
            <button
              onClick={onShortlist}
              className="flex-1 rounded-lg bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/70"
            >
              Shortlist
            </button>
          )}
          {job.status === "shortlisted" && (
            <button
              onClick={handlePrepare}
              disabled={preparing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              <Sparkles size={13} /> {preparing ? "Tailoring…" : "Prepare Application"}
            </button>
          )}
        </div>

        {log && (
          <pre className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-[11px] text-muted-foreground">
            {log}
          </pre>
        )}
      </motion.div>
    </motion.div>
  );
}
