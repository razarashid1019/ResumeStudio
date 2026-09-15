import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getResumes, getResumeDiff, type Resume } from "@/lib/api";
import { Card } from "@/components/ui/card";

export default function Resumes() {
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [selected, setSelected] = useState<Resume | null>(null);

  useEffect(() => {
    getResumes().then((r) => setResumes(r.resumes));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resumes ? `${resumes.length} tailored versions, each a pure reorder of the master resume.` : "Loading…"}
        </p>
      </div>

      <div className="space-y-2">
        {resumes?.map((r) => (
          <Card
            key={r.slug}
            onClick={() => setSelected(r)}
            className="flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/30"
          >
            <span className="text-sm font-medium">{r.slug}</span>
            <span className="text-xs text-muted-foreground">
              {r.has_pdf ? `${Math.round((r.pdf_size ?? 0) / 1024)} KB` : "no PDF yet"}
            </span>
          </Card>
        ))}
      </div>

      <AnimatePresence>
        {selected && <ResumeDetail resume={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

function ResumeDetail({ resume, onClose }: { resume: Resume; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    getResumeDiff(resume.slug).then((r) => setDiff(r.diff));
  }, [resume.slug]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="h-full w-[520px] overflow-y-auto border-l border-border bg-background p-6"
        initial={{ x: 40 }}
        animate={{ x: 0 }}
        exit={{ x: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{resume.slug}</h2>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {resume.has_pdf && (
          <a
            href={`/api/resume/pdf/${resume.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Open PDF
          </a>
        )}

        <h3 className="mt-6 text-xs font-medium text-muted-foreground">Compare to master</h3>
        {diff === null ? (
          <div className="mt-2 h-40 animate-pulse rounded-lg bg-secondary/40" />
        ) : (
          <pre className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg bg-secondary/30 p-3 text-[11px] leading-relaxed">
            {(diff || "(no differences)").split("\n").map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? "text-emerald-400"
                    : line.startsWith("-") && !line.startsWith("---")
                      ? "text-red-400"
                      : line.startsWith("@@")
                        ? "text-violet-400"
                        : "text-muted-foreground"
                }
              >
                {line}
              </div>
            ))}
          </pre>
        )}
      </motion.div>
    </motion.div>
  );
}
