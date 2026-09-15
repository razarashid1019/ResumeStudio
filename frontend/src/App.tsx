import { useState } from "react";
import {
  Workflow,
  Briefcase,
  FileText,
  Mic,
  FileStack,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Dashboard from "@/views/Dashboard";
import JobBoard from "@/views/JobBoard";
import Applications from "@/views/Applications";
import InterviewPrep from "@/views/InterviewPrep";
import Resumes from "@/views/Resumes";
import Automation from "@/views/Automation";

// "Dashboard" and "Pipeline" used to be two separate views -- merged into
// one (2026-09-15) since the automation pipeline visualization is meant
// to be the actual heart of the app, not a secondary page next to a more
// conventional stat-tile dashboard.
const VIEWS = [
  { id: "dashboard", label: "Pipeline", icon: Workflow, accent: "#a78bfa" },
  { id: "jobs", label: "Job Board", icon: Briefcase, accent: "var(--view-jobs)" },
  { id: "applications", label: "Applications", icon: FileText, accent: "var(--view-applications)" },
  { id: "interview", label: "Interview Prep", icon: Mic, accent: "var(--view-interview)" },
  { id: "resumes", label: "Resumes", icon: FileStack, accent: "var(--view-resumes)" },
  { id: "automation", label: "Automation", icon: Bot, accent: "#34d399" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export default function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const active = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Desktop sidebar -- hidden below md, replaced by the bottom tab
          bar. This was a fixed-width flex-row shell with no mobile
          fallback at all until this was checked on an actual phone. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar/60 backdrop-blur-xl md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-sm font-semibold text-primary-foreground">
            RS
          </div>
          <span className="text-[15px] font-semibold tracking-tight">ResumeStudio</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {VIEWS.map((v) => {
            const isActive = v.id === view;
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <v.icon
                  size={16}
                  strokeWidth={2}
                  style={{ color: isActive ? v.accent : undefined }}
                  className="shrink-0"
                />
                {v.label}
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4 text-[11px] text-muted-foreground">
          Local · 127.0.0.1
        </div>
      </aside>

      {/* Mobile top bar -- just the wordmark, nav lives at the bottom
          within thumb reach instead. */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3 md:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-xs font-semibold text-primary-foreground">
          RS
        </div>
        <span className="text-sm font-semibold tracking-tight">ResumeStudio</span>
      </div>

      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div
          key={active.id}
          className="mx-auto max-w-5xl animate-in fade-in px-4 py-6 duration-300 sm:px-6 md:px-10 md:py-10"
        >
          {view === "dashboard" && <Dashboard />}
          {view === "jobs" && <JobBoard />}
          {view === "applications" && <Applications />}
          {view === "interview" && <InterviewPrep />}
          {view === "resumes" && <Resumes />}
          {view === "automation" && <Automation />}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-between border-t border-border bg-sidebar/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {VIEWS.map((v) => {
          const isActive = v.id === view;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium"
            >
              <v.icon
                size={19}
                strokeWidth={2}
                style={{ color: isActive ? v.accent : "var(--muted-foreground)" }}
              />
              <span style={{ color: isActive ? undefined : "var(--muted-foreground)" }} className="leading-none">
                {v.label.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
