import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Rocket, Check, X, Loader2 } from "lucide-react";
import { getApplyLoop, requestApplyLoop, resetApplyLoop, type ApplyLoopState } from "@/lib/api";

/**
 * Starting and watching the apply loop, right where "Approved" sits in the
 * flow. Submitting a real application always needs a live, interactive
 * Claude Code + Chrome session (see the comment in lib/api.ts) -- this
 * panel can request one and show its live progress, but the actual run
 * happens because you told an interactive session "run the apply loop",
 * not because this button reached out and started one on its own.
 */
export function ApplyLoopPanel() {
  const [state, setState] = useState<ApplyLoopState | null>(null);

  const refresh = () => getApplyLoop().then(setState);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  if (!state) return null;

  const queuedCount = state.queued.length;

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket size={15} className="text-emerald-400" />
          <span className="text-sm font-medium">Apply Loop</span>
        </div>
        <StatusBadge status={state.status} />
      </div>

      <AnimatePresence mode="wait">
        {state.status === "idle" && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <p className="text-xs text-muted-foreground">
              {queuedCount > 0
                ? `${queuedCount} auto-approved and ready to submit.`
                : "Nothing queued yet — the daily digest auto-approves anything worth pursuing."}
            </p>
            {queuedCount > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {state.queued.map((j) => (
                  <li key={j.id}>
                    {j.company} — {j.role}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => requestApplyLoop().then(refresh)}
              disabled={queuedCount === 0}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Rocket size={12} /> Start Apply Loop
            </button>
          </motion.div>
        )}

        {state.status === "requested" && (
          <motion.div key="requested" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <p className="text-xs text-muted-foreground">
              Waiting for you to pick it up — open Claude Code and say{" "}
              <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">run the apply loop</code>. It'll drive
              your real browser live, on {queuedCount} approved application{queuedCount === 1 ? "" : "s"}.
            </p>
            <button
              onClick={() => resetApplyLoop().then(refresh)}
              className="mt-3 w-full rounded-lg bg-secondary px-3 py-2 text-xs font-medium hover:bg-secondary/70"
            >
              Cancel request
            </button>
          </motion.div>
        )}

        {state.status === "running" && (
          <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 space-y-2">
            {state.current && (
              <div className="flex items-center gap-2 text-xs">
                <Loader2 size={12} className="animate-spin text-emerald-400" />
                <span>
                  Submitting <span className="font-medium">{state.current.company}</span> — {state.current.role}
                </span>
              </div>
            )}
            {[...state.completed, ...state.failed].length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {state.completed.map((j) => (
                  <li key={`c-${j.company}${j.role}`} className="flex items-center gap-1.5">
                    <Check size={11} className="text-emerald-400" /> {j.company} — {j.role}
                  </li>
                ))}
                {state.failed.map((j) => (
                  <li key={`f-${j.company}${j.role}`} className="flex items-center gap-1.5">
                    <X size={11} className="text-red-400" /> {j.company} — {j.role}
                    {j.reason && <span className="text-red-400/70">({j.reason})</span>}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}

        {(state.status === "done" || state.status === "error") && (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
            <p className="text-xs">{state.summary || "Finished."}</p>
            {[...state.completed, ...state.failed].length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {state.completed.map((j) => (
                  <li key={`c-${j.company}${j.role}`} className="flex items-center gap-1.5">
                    <Check size={11} className="text-emerald-400" /> {j.company} — {j.role}
                  </li>
                ))}
                {state.failed.map((j) => (
                  <li key={`f-${j.company}${j.role}`} className="flex items-center gap-1.5">
                    <X size={11} className="text-red-400" /> {j.company} — {j.role}
                    {j.reason && <span className="text-red-400/70">({j.reason})</span>}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => resetApplyLoop().then(refresh)}
              className="mt-3 w-full rounded-lg bg-secondary px-3 py-2 text-xs font-medium hover:bg-secondary/70"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status }: { status: ApplyLoopState["status"] }) {
  const map: Record<ApplyLoopState["status"], { label: string; color: string }> = {
    idle: { label: "Idle", color: "#9ca3af" },
    requested: { label: "Waiting on you", color: "#fbbf24" },
    running: { label: "Running", color: "#34d399" },
    done: { label: "Done", color: "#38bdf8" },
    error: { label: "Error", color: "#f87171" },
  };
  const m = map[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: `${m.color}1f`, color: m.color }}
    >
      {m.label}
    </span>
  );
}
