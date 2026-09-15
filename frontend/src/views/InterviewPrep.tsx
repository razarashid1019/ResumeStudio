import { useEffect, useState } from "react";
import { marked } from "marked";
import { getApplications, getApplicationDetail, type ApplicationRow } from "@/lib/api";
import { applicationPillStyle } from "@/lib/status";
import { Card } from "@/components/ui/card";

type PrepEntry = { row: ApplicationRow; body: string };

export default function InterviewPrep() {
  const [entries, setEntries] = useState<PrepEntry[] | null>(null);

  useEffect(() => {
    (async () => {
      const { rows } = await getApplications();
      const withDetail = rows.filter((r) => r.detail_file);
      const results: PrepEntry[] = [];
      for (const row of withDetail) {
        const detail = await getApplicationDetail(row.detail_file!);
        const prep = detail.sections.find((s) => /interview prep/i.test(s.heading));
        if (prep) results.push({ row, body: prep.body });
      }
      setEntries(results);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Interview Prep</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pulled from each application's notes — study sheet per company.
        </p>
      </div>

      {!entries && <div className="h-32 animate-pulse rounded-xl bg-secondary/50" />}
      {entries?.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">No interview prep notes yet.</div>
      )}

      <div className="space-y-3">
        {entries?.map(({ row, body }) => (
          <Card key={row.company} className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                {row.company} — {row.role}
              </div>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={applicationPillStyle(row.status)}>
                {row.status}
              </span>
            </div>
            <div className="md-body mt-3" dangerouslySetInnerHTML={{ __html: marked.parse(body, { async: false }) }} />
          </Card>
        ))}
      </div>
    </div>
  );
}
