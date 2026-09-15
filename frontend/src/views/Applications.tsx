import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { marked } from "marked";
import { getApplications, getApplicationDetail, type ApplicationRow, type ApplicationDetail } from "@/lib/api";
import { applicationPillStyle } from "@/lib/status";
import { Card } from "@/components/ui/card";

export default function Applications() {
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);

  useEffect(() => {
    getApplications().then((r) => setRows(r.rows));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows ? `${rows.length} tracked` : "Loading…"}
        </p>
      </div>

      <div className="space-y-2">
        {rows?.map((r) => (
          <Card
            key={r.company + r.role}
            onClick={() => setSelected(r)}
            className="cursor-pointer px-4 py-3 transition-colors hover:bg-secondary/30"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{r.company}</div>
                <div className="text-xs text-muted-foreground">{r.role}</div>
              </div>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={applicationPillStyle(r.status)}>
                {r.status}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <AnimatePresence>
        {selected && <DetailPanel row={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

function DetailPanel({ row, onClose }: { row: ApplicationRow; onClose: () => void }) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);

  useEffect(() => {
    if (row.detail_file) getApplicationDetail(row.detail_file).then(setDetail);
  }, [row.detail_file]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="h-full w-[480px] overflow-y-auto border-l border-border bg-background p-6"
        initial={{ x: 40 }}
        animate={{ x: 0 }}
        exit={{ x: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={applicationPillStyle(row.status)}>
            {row.status}
          </span>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <h2 className="mt-3 text-lg font-semibold">{row.company}</h2>
        <p className="text-sm text-muted-foreground">{row.role}</p>

        {!detail && row.detail_file && (
          <div className="mt-6 h-32 animate-pulse rounded-lg bg-secondary/40" />
        )}

        {detail && (
          <div className="mt-5 space-y-4 text-sm">
            {Object.entries(detail.fields).map(([k, v]) => (
              <div key={k}>
                <div className="text-xs font-medium text-muted-foreground">{k.replace(/_/g, " ")}</div>
                <div className="mt-0.5">{v}</div>
              </div>
            ))}
            {detail.sections.map((s) => (
              <div key={s.heading}>
                <div className="text-xs font-medium text-muted-foreground">{s.heading}</div>
                <div
                  className="md-body mt-1"
                  // These files are our own generated markdown, not
                  // third-party content -- rendering trusted local
                  // content, not sanitizing untrusted HTML.
                  dangerouslySetInnerHTML={{ __html: marked.parse(s.body, { async: false }) }}
                />
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
