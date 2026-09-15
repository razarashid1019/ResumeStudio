import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Play, ExternalLink, RefreshCw } from "lucide-react";
import { getRoutines, runRoutineNow, setRoutineEnabled, type RoutineStatus } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { CardSpotlightFallback } from "@/components/CardSpotlightFallback";

// Backed by run_routine_agent() in server/app.py, which shells out to
// `claude -p` with the RemoteTrigger tool -- confirmed working headless
// 2026-09-15 (see resumestudio-app memory). Status is cached server-side
// (stale-while-revalidate, ~5min TTL) since each round-trip is slow.

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "any moment now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Automation() {
  const [data, setData] = useState<{ routines: RoutineStatus[]; updated_at: number | null; refreshing: boolean } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = () => getRoutines().then(setData);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  async function handleRun(id: string) {
    setPending((p) => ({ ...p, [id]: true }));
    await runRoutineNow(id === "trig_01NvD59Y3gTqpQP8tPNZtn5M" ? "digest" : "approval");
    setTimeout(() => {
      setPending((p) => ({ ...p, [id]: false }));
      load();
    }, 8000);
  }

  async function handleToggle(id: string, enabled: boolean) {
    setPending((p) => ({ ...p, [id]: true }));
    await setRoutineEnabled(id === "trig_01NvD59Y3gTqpQP8tPNZtn5M" ? "digest" : "approval", enabled);
    setTimeout(() => {
      setPending((p) => ({ ...p, [id]: false }));
      load();
    }, 5000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The two cloud routines behind the pipeline — controlled from here, not just claude.ai.
        </p>
      </div>

      {!data && (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl bg-secondary/50" />
          <div className="h-32 animate-pulse rounded-xl bg-secondary/50" />
        </div>
      )}

      {data && data.routines.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          {data.refreshing ? "Fetching live status from claude.ai…" : "No routine status cached yet."}
        </Card>
      )}

      {data?.routines.map((r, i) => (
        <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
          <CardSpotlightFallback className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${r.enabled ? "bg-emerald-400" : "bg-muted-foreground"}`}
                  />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  cron <code className="rounded bg-secondary px-1 py-0.5">{r.cron_expression}</code> · next run{" "}
                  {timeUntil(r.next_run_at)}
                </div>
              </div>
              <Switch
                checked={r.enabled}
                disabled={pending[r.id]}
                onCheckedChange={(v) => handleToggle(r.id, v)}
              />
            </div>

            {r.last_run && (
              <div className="mt-4 flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-xs">
                <span>
                  Last run <span className="font-medium">{r.last_run.status}</span> · {timeAgo(r.last_run.last_event_at)}
                </span>
                <a
                  href={r.last_run.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  view log <ExternalLink size={11} />
                </a>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => handleRun(r.id)}
                disabled={pending[r.id]}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary/70 disabled:opacity-50"
              >
                {pending[r.id] ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" /> Running…
                  </>
                ) : (
                  <>
                    <Play size={12} /> Run now
                  </>
                )}
              </button>
            </div>
          </CardSpotlightFallback>
        </motion.div>
      ))}

      {data?.updated_at && (
        <p className="text-center text-[11px] text-muted-foreground">
          Status as of {timeAgo(new Date(data.updated_at * 1000).toISOString())}
          {data.refreshing && " · refreshing…"}
        </p>
      )}
    </div>
  );
}
