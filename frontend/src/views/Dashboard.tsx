import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { getApplications, getJobs, type ApplicationRow, type Job } from "@/lib/api";
import { applicationPillStyle } from "@/lib/status";
import { Card } from "@/components/ui/card";

export default function Dashboard({ onNavigate }: { onNavigate: (v: "pipeline") => void }) {
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    Promise.all([getApplications(), getJobs()]).then(([a, j]) => {
      setRows(a.rows);
      setJobs(j.jobs);
    });
  }, []);

  if (!rows || !jobs) return <DashboardSkeleton />;

  const counts = { applied: 0, inProgress: 0, interview: 0, offer: 0 };
  for (const r of rows) {
    const s = r.status.toLowerCase();
    if (s.includes("applied")) counts.applied++;
    if (s.includes("oa") || s.includes("screen")) counts.inProgress++;
    if (s.includes("interview")) counts.interview++;
    if (s.includes("offer")) counts.offer++;
  }

  const recent = [...rows]
    .sort((a, b) => (b.date_applied || "").localeCompare(a.date_applied || ""))
    .slice(0, 6);
  const freshJobs = jobs.filter((j) => j.status === "new" || j.status === "shortlisted").slice(0, 4);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} applications tracked · {jobs.length} jobs on the board
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {(
          [
            ["Applied", counts.applied],
            ["OA / Screen", counts.inProgress],
            ["Interviewing", counts.interview],
            ["Offers", counts.offer],
          ] as const
        ).map(([label, value], i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="p-5">
              <div className="text-3xl font-semibold tabular-nums">{value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      <button
        onClick={() => onNavigate("pipeline")}
        className="group flex w-full items-center justify-between rounded-xl border border-border bg-gradient-to-r from-violet-500/10 via-primary/10 to-transparent px-5 py-4 text-left transition-colors hover:border-violet-400/40"
      >
        <div>
          <div className="text-sm font-medium">See the automation pipeline live</div>
          <div className="text-xs text-muted-foreground">
            Digest → filter → tailor → approve → submit, animated
          </div>
        </div>
        <span className="text-sm text-violet-400 opacity-0 transition-opacity group-hover:opacity-100">
          View →
        </span>
      </button>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
        <div className="space-y-2">
          {recent.map((r) => (
            <Card key={r.company + r.role} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{r.company}</div>
                <div className="text-xs text-muted-foreground">{r.role}</div>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={applicationPillStyle(r.status)}
              >
                {r.status}
              </span>
            </Card>
          ))}
        </div>
      </section>

      {freshJobs.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Fresh on the job board</h2>
          <div className="space-y-2">
            {freshJobs.map((j) => (
              <Card key={j.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{j.company}</div>
                  {j.status === "shortlisted" && (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                      shortlisted
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{j.role}</div>
                {j.why && <div className="mt-1.5 text-xs text-muted-foreground/80">{j.why}</div>}
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div className="h-16 animate-pulse rounded-lg bg-secondary/50" />
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary/50" />
        ))}
      </div>
    </div>
  );
}
