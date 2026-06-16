// Fetch the SWL-CRM workflows from n8n + summarize their status. Used
// by the WorkflowsSection on the Reliability page so the operator can
// see at a glance which workflows are active, which last ran, and which
// failed on their last run.
//
// Auth: n8n's REST API expects an `X-N8N-API-KEY` header. The env var
// `N8N_API_KEY` must be set in Vercel for this to return data; without
// it the helper returns null and the section renders a friendly message
// instead of crashing.

const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY ?? "";
// Only surface OUR workflows. Other clients live in the same n8n
// instance — never display theirs (CLAUDE.md hard rule).
const NAME_PREFIX = "SWL - CRM";

export type N8nWorkflowStatus = {
  id: string;
  name: string;
  active: boolean;
  lastExecutionAt: string | null;
  lastExecutionStatus: "success" | "error" | "running" | "unknown" | null;
};

async function fetchJson<T>(path: string): Promise<T | null> {
  if (!N8N_API_KEY) return null;
  try {
    const res = await fetch(`${N8N_BASE}${path}`, {
      headers: { "X-N8N-API-KEY": N8N_API_KEY, accept: "application/json" },
      // Workflow status changes rarely. Cache 60s so we don't hammer n8n
      // every time the page refreshes.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getSwlWorkflowStatuses(): Promise<N8nWorkflowStatus[] | null> {
  type ListResp = { data?: Array<{ id: string; name: string; active: boolean }> };
  const list = await fetchJson<ListResp>("/api/v1/workflows?limit=200");
  if (!list?.data) return null;

  const ours = list.data.filter(w => w.name.startsWith(NAME_PREFIX));
  // Fetch the most recent execution per workflow (in parallel).
  type ExecsResp = { data?: Array<{ id: string; startedAt: string | null; stoppedAt: string | null; status: string | null; finished: boolean | null }> };
  const statuses = await Promise.all(ours.map(async w => {
    const ex = await fetchJson<ExecsResp>(`/api/v1/executions?workflowId=${w.id}&limit=1`);
    const last = ex?.data?.[0];
    let lastStatus: N8nWorkflowStatus["lastExecutionStatus"] = null;
    if (last) {
      const s = (last.status ?? "").toLowerCase();
      if (s === "success" || s === "error" || s === "running") lastStatus = s;
      else if (last.finished === true) lastStatus = "success";
      else if (last.finished === false) lastStatus = "running";
      else lastStatus = "unknown";
    }
    return {
      id: w.id,
      name: w.name,
      active: w.active,
      lastExecutionAt: last?.stoppedAt ?? last?.startedAt ?? null,
      lastExecutionStatus: lastStatus,
    } satisfies N8nWorkflowStatus;
  }));
  // Sort: failed first, then inactive, then by name.
  statuses.sort((a, b) => {
    const ord = (s: N8nWorkflowStatus) => s.lastExecutionStatus === "error" ? 0 : !s.active ? 1 : 2;
    if (ord(a) !== ord(b)) return ord(a) - ord(b);
    return a.name.localeCompare(b.name);
  });
  return statuses;
}
