import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { Link, useLocation } from "react-router";
import { api, errorText, parseResponse } from "../lib/client";
import type { AiResult } from "../lib/ai/provider";
import { aiCapabilityLabel } from "../lib/ai/capabilities";
import type { AiCapability } from "../lib/schema";
import { Badge } from "./ui";
export interface ClientJob {
  id: string;
  draftId: string;
  capability: AiCapability;
  status: string;
  provider: "hiobuy" | "mock";
  simulated: boolean;
  attempts: number;
  applied: boolean;
  error: string | null;
  errorCode: string | null;
  imageId: string | null;
  billingState: string | null;
  result: AiResult | null;
}
const Context = createContext<{
  jobs: ClientJob[];
  refresh: () => Promise<void>;
}>({ jobs: [], refresh: async () => {} });
export function useJobs() {
  return useContext(Context);
}
export function JobsProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [jobs, setJobs] = useState<ClientJob[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const data = await parseResponse<{ jobs: ClientJob[] }>(
        await fetch("/app/api?resource=jobs"),
      );
      setJobs(data.jobs);
      setError("");
    } catch {
      /* Session/navigation errors are surfaced by app routes. */
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  const active = jobs.filter((j) =>
    ["QUEUED", "RUNNING"].includes(j.status),
  ).length;
  return (
    <Context.Provider value={{ jobs, refresh }}>
      {children}
      {jobs.length > 0 && (
        <aside
          className={`jobs-panel ${location.pathname.startsWith("/app/editor/") ? "editor-jobs" : ""}`}
          aria-label="AI tasks"
        >
          <button className="jobs-toggle" onClick={() => setOpen(!open)}>
            <span>✧ AI tasks</span>
            <Badge>
              {active ? `${active} running` : `${jobs.length} recent`}
            </Badge>
            <span>{open ? "⌄" : "⌃"}</span>
          </button>
          {open && (
            <div className="jobs-list">
              <p className="hint">
                Tasks stay open when you switch tabs or reload. Retry uses the
                same AI task instead of starting another charge.
              </p>
              {error && <p role="alert">{error}</p>}
              {jobs.slice(0, 10).map((job) => (
                <div className="job-row" key={job.id}>
                  <div>
                    <Link to={`/app/editor/${job.draftId}`}>
                      {aiCapabilityLabel[job.capability]}
                    </Link>
                    <span className="hint">
                      {job.simulated ? "Earlier simulation" : "Commerce AI"} ·
                      attempt {job.attempts}
                      {job.billingState === "reconciliation" ||
                      job.billingState === "provider_succeeded"
                        ? " · settling"
                        : ""}
                    </span>
                  </div>
                  <Badge
                    tone={
                      job.status === "FAILED"
                        ? "danger"
                        : job.status === "SUCCEEDED"
                          ? "green"
                          : ""
                    }
                  >
                    {job.status.toLowerCase()}
                  </Badge>
                  {job.status === "FAILED" &&
                    job.errorCode !== "REJECTED" &&
                    job.errorCode !== "REFUNDED" && (
                    <button
                      onClick={async () => {
                        try {
                          await api("retryJob", { jobId: job.id });
                          await refresh();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      )}
    </Context.Provider>
  );
}
