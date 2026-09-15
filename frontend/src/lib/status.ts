import type { CSSProperties } from "react";

// Shared status -> label/color mapping. Ported from web/styles.css's
// pill-* custom properties (kept in index.css) plus the two statuses the
// cloud routines introduced on 2026-09-15 that the original vanilla-JS app
// never had a mapping for.

export const JOB_STATUSES = [
  "new",
  "shortlisted",
  "ruled_out",
  "preparing",
  "ready_to_apply",
  "manual_only",
  "approved_for_submission",
  "applied",
] as const;

type PillKey =
  | "staged"
  | "applied"
  | "screen"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

const JOB_STATUS_TO_PILL: Record<string, PillKey> = {
  new: "staged",
  shortlisted: "screen",
  ruled_out: "withdrawn",
  preparing: "screen",
  ready_to_apply: "interview",
  manual_only: "rejected",
  approved_for_submission: "offer",
  applied: "applied",
};

export function jobStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export function pillStyle(status: string): CSSProperties {
  const key = JOB_STATUS_TO_PILL[status] ?? "staged";
  return {
    background: `var(--pill-${key}-bg)`,
    color: `var(--pill-${key}-fg)`,
  };
}

/** Application-tracker statuses are free-text prose ("Staged — not
 * submitted", "OA / Screen", ...), not the job-board's snake_case enum --
 * matched by substring the same way the original app.js did. */
export function applicationPillStyle(status: string): CSSProperties {
  const s = status.toLowerCase();
  let key: PillKey = "staged";
  if (s.includes("applied")) key = "applied";
  else if (s.includes("oa") || s.includes("screen")) key = "screen";
  else if (s.includes("interview")) key = "interview";
  else if (s.includes("offer")) key = "offer";
  else if (s.includes("reject")) key = "rejected";
  else if (s.includes("withdrawn")) key = "withdrawn";
  return {
    background: `var(--pill-${key}-bg)`,
    color: `var(--pill-${key}-fg)`,
  };
}
