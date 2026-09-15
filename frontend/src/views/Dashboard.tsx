import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { getApplications, getJobs, type ApplicationRow, type Job } from "@/lib/api";
import { applicationPillStyle } from "@/lib/status";
import { Sparkles } from "@/components/Sparkles";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { FlowNode } from "@/components/FlowNode";
import { FlowConnector } from "@/components/FlowConnector";

// This IS the app now, not a page next to it -- the automation pipeline
// (job-board.json's actual status values) as a continuous live flow,
// extended past "Submitted" into the applications tracker's real-world
// outcome funnel (Screen/Interview/Offer), so it reads as one story from
// first sourced to offer, not two separate datasets bolted together.

const MAIN_STAGES = [
  { status: "new", label: "Sourced", color: "#60a5fa" },
  { status: "shortlisted", label: "Shortlisted", color: "#fbbf24" },
  { status: "preparing", label: "Tailoring", color: "#a78bfa" },
  { status: "ready_to_apply", label: "Staged", color: "#38bdf8" },
  { status: "approved_for_submission", label: "Approved", color: "#34d399" },
  { status: "applied", label: "Submitted", color: "#4ade80" },
] as const;

const BRANCHES = [
  { after: "shortlisted", status: "ruled_out", label: "Ruled out", color: "#9ca3af" },
  { after: "ready_to_apply", status: "manual_only", label: "Manual only", color: "#f87171" },
] as const;

const OUTCOME_STAGES = [
  { key: "screen", label: "Screening", color: "#c398f5", match: (s: string) => s.includes("oa") || s.includes("screen") },
  { key: "interview", label: "Interviewing", color: "#ffb454", match: (s: string) => s.includes("interview") },
  { key: "offer", label: "Offer", color: "#57d98a", match: (s: string) => s.includes("offer") },
] as const;

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);

  useEffect(() => {
    Promise.all([getJobs(), getApplications()]).then(([j, a]) => {
      setJobs(j.jobs);
      setRows(a.rows);
    });
  }, []);

  const jobCount = (status: string) => jobs?.filter((j) => j.status === status).length ?? 0;
  const outcomeCount = (match: (s: string) => boolean) =>
    rows?.filter((r) => match(r.status.toLowerCase())).length ?? 0;

  const recent = rows
    ? [...rows].sort((a, b) => (b.date_applied || "").localeCompare(a.date_applied || "")).slice(0, 5)
    : [];

  return (
    <div className="space-y-14">
      {/* ------------------------------------------------------------ hero */}
      <div className="relative -mx-10 -mt-10 overflow-hidden border-b border-border/60 px-10 pb-12 pt-14">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(139,92,246,0.14),transparent)]" />
        <BackgroundBeams className="opacity-40" />
        <Sparkles count={60} />

        <div className="relative text-center">
          <h1 className="text-3xl font-semibold tracking-tight">The Pipeline</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Every listing, live, moving through the exact stages the daily digest
            and approval-checker routines actually use — sourced to offer.
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span>{jobs ? jobs.length : "…"} on the board</span>
            <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
            <span>{rows ? rows.length : "…"} applications tracked</span>
          </div>
        </div>

        {/* main flow */}
        <div className="relative mt-12 flex flex-wrap items-center justify-center gap-1">
          {MAIN_STAGES.map((stage, i) => (
            <div key={stage.status} className="flex items-center">
              <FlowNode
                label={stage.label}
                count={jobs ? jobCount(stage.status) : 0}
                color={stage.color}
                delay={i * 0.08}
              />
              {i < MAIN_STAGES.length - 1 && (
                <div className="w-8 sm:w-14">
                  <FlowConnector color={stage.color} active={!!jobs} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* branches peeling off */}
        <div className="mt-8 flex justify-center gap-16">
          {BRANCHES.map((b, i) => (
            <motion.div
              key={b.status}
              className="flex flex-col items-center gap-1.5"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.1 }}
            >
              <div className="h-4 w-px" style={{ background: `${b.color}55` }} />
              <FlowNode label={b.label} count={jobs ? jobCount(b.status) : 0} color={b.color} size="sm" delay={0.55 + i * 0.1} />
            </motion.div>
          ))}
        </div>

        {/* continuation into real-world outcomes */}
        <div className="relative mt-10 flex flex-wrap items-center justify-center gap-1 border-t border-dashed border-border/60 pt-8">
          <span className="mr-4 text-[11px] uppercase tracking-wide text-muted-foreground">Beyond automation</span>
          {OUTCOME_STAGES.map((stage, i) => (
            <div key={stage.key} className="flex items-center">
              {i === 0 && (
                <div className="w-8 sm:w-14">
                  <FlowConnector color={MAIN_STAGES[MAIN_STAGES.length - 1].color} active={!!jobs} />
                </div>
              )}
              <FlowNode
                label={stage.label}
                count={rows ? outcomeCount(stage.match) : 0}
                color={stage.color}
                size="sm"
                delay={0.7 + i * 0.08}
              />
              {i < OUTCOME_STAGES.length - 1 && (
                <div className="w-8 sm:w-14">
                  <FlowConnector color={stage.color} active={!!rows} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* --------------------------------------------------------- recent */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
        <div className="space-y-2">
          {recent.map((r) => (
            <div
              key={r.company + r.role}
              className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{r.company}</div>
                <div className="text-xs text-muted-foreground">{r.role}</div>
              </div>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={applicationPillStyle(r.status)}>
                {r.status}
              </span>
            </div>
          ))}
          {rows && recent.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
