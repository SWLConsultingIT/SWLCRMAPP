// Fetch the SWL-CRM workflows from n8n + summarize their status. Used
// by the WorkflowsSection on the Reliability page.
//
// 2026-06-16 refactor: this used to hit n8n's REST API directly with an
// `X-N8N-API-KEY` Vercel env var, which (a) failed silently in any
// deploy where the env wasn't set and (b) tied this feature to Vercel
// hosting. Now we call an n8n webhook (`SWL - CRM - Reliability Status
// Proxy`, workflow id W1XeJTAOS8DRxuyt) — that workflow lives inside
// n8n with its own credential to query its own API. If we ever migrate
// off Vercel, the URL still points to n8n and everything keeps working.

const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");
const RELIABILITY_STATUS_WEBHOOK = `${N8N_BASE}/webhook/swl-crm-reliability-status`;

export type N8nWorkflowStatus = {
  id: string;
  name: string;
  active: boolean;
  lastExecutionAt: string | null;
  lastExecutionStatus: "success" | "error" | "running" | "unknown" | null;
};

export async function getSwlWorkflowStatuses(): Promise<N8nWorkflowStatus[] | null> {
  try {
    const res = await fetch(RELIABILITY_STATUS_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
      // Workflow status changes rarely. Cache 60s so we don't hammer n8n
      // every time the page refreshes.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const body = await res.json() as { workflows?: N8nWorkflowStatus[] } | null;
    return body?.workflows ?? null;
  } catch {
    return null;
  }
}
