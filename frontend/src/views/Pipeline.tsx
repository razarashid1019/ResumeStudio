import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { getJobs, type Job } from "@/lib/api";
import { TracingBeam } from "@/components/ui/tracing-beam";
import { Sparkles } from "@/components/Sparkles";

// The pipeline stages are real job-board.json status values (see
// resumestudio-app memory), not decorative labels -- this visualizes the
// actual daily-digest / approval-checker automation state, live.
const STAGES = [
  { status: "new", label: "Sourced", detail: "Pulled from today's OpenClaw digest, kept after filtering", color: "#60a5fa" },
  { status: "shortlisted", label: "Shortlisted", detail: "You flagged it worth a closer look on the dashboard", color: "#fbbf24" },
  { status: "preparing", label: "Tailoring", detail: "Resume + application file being drafted right now", color: "#a78bfa" },
  { status: "ready_to_apply", label: "Staged", detail: "Numbered in the daily digest email, waiting on your reply", color: "#38bdf8" },
  { status: "approved_for_submission", label: "Approved", detail: "You replied approving it — phone notified, queued to submit", color: "#34d399" },
  { status: "applied", label: "Submitted", detail: "Actually sent, live-triggered from a real Claude Code session", color: "#4ade80" },
] as const;

const SIDE_BRANCHES = [
  { status: "ruled_out", label: "Ruled out", color: "#9ca3af" },
  { status: "manual_only", label: "Manual only", detail: "Needs an account/login — never automated", color: "#f87171" },
] as const;

export default function Pipeline() {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    getJobs().then((r) => setJobs(r.jobs));
  }, []);

  const countFor = (status: string) => jobs?.filter((j) => j.status === status).length ?? 0;

  return (
    <div className="space-y-2">
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card/40 py-10">
        <Sparkles count={50} />
        <div className="relative z-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Automation Pipeline</h1>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Every listing on the board right now, live, moving through the same
            stages the daily digest and approval-checker routines actually use.
          </p>
        </div>
      </div>

      <TracingBeam className="px-6">
        <div className="space-y-6 pb-10">
          {STAGES.map((stage, i) => (
            <motion.div
              key={stage.status}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="relative rounded-xl border border-border bg-card p-5"
              style={{ boxShadow: jobs ? `0 0 0 1px ${stage.color}22` : undefined }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.span
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                    style={{ background: `${stage.color}22`, color: stage.color }}
                    animate={jobs && countFor(stage.status) > 0 ? { scale: [1, 1.08, 1] } : undefined}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  >
                    {jobs ? countFor(stage.status) : "–"}
                  </motion.span>
                  <div>
                    <div className="text-sm font-medium">{stage.label}</div>
                    <div className="text-xs text-muted-foreground">{stage.detail}</div>
                  </div>
                </div>
                {i < STAGES.length - 1 && (
                  <motion.div
                    className="h-8 w-px"
                    style={{ background: `linear-gradient(to bottom, ${stage.color}, transparent)` }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: i * 0.08 + 0.2, duration: 0.3 }}
                  />
                )}
              </div>
            </motion.div>
          ))}

          <div className="flex gap-4 pt-2">
            {SIDE_BRANCHES.map((b) => (
              <div
                key={b.status}
                className="flex-1 rounded-xl border border-dashed border-border/60 p-4 text-center"
              >
                <div className="text-lg font-semibold" style={{ color: b.color }}>
                  {jobs ? countFor(b.status) : "–"}
                </div>
                <div className="text-xs font-medium">{b.label}</div>
                {"detail" in b && <div className="mt-1 text-[11px] text-muted-foreground">{b.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      </TracingBeam>
    </div>
  );
}
