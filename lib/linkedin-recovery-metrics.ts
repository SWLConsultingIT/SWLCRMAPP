// LinkedIn Recovery metrics — pure aggregation over recovery rows, so it's
// unit-tested and reusable by any surface (admin endpoint ?metrics=1, a script).
// Metrics come ONLY from linkedin_recovery — the original campaign stats are
// never inflated by the second attempt.

export type RecoveryMetricRow = {
  state: string;
  withdrawn_at: string | null;
  second_invite_sent_at: string | null;
  second_message_sent_at: string | null;
  company_bio_id?: string | null;
  seller_id?: string | null;
};

export type RecoveryKpis = {
  total: number;
  byState: Record<string, number>;
  withdrawn: number;
  secondInvitesSent: number;
  secondAccepted: number;      // reached DONE (accepted + DM sent)
  secondDmSent: number;
  stoppedUnaccepted: number;
  // recovery conversion = second DMs sent / second invites sent
  secondAcceptanceRate: number | null;
};

export function computeRecoveryKpis(rows: RecoveryMetricRow[]): RecoveryKpis {
  const byState: Record<string, number> = {};
  let withdrawn = 0, secondInvitesSent = 0, secondDmSent = 0, done = 0, stopped = 0;
  for (const r of rows) {
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.withdrawn_at) withdrawn += 1;
    if (r.second_invite_sent_at) secondInvitesSent += 1;
    if (r.second_message_sent_at) secondDmSent += 1;
    if (r.state === "DONE") done += 1;
    if (r.state === "STOPPED_UNACCEPTED") stopped += 1;
  }
  return {
    total: rows.length,
    byState,
    withdrawn,
    secondInvitesSent,
    secondAccepted: done,
    secondDmSent,
    stoppedUnaccepted: stopped,
    secondAcceptanceRate: secondInvitesSent > 0 ? Math.round((done / secondInvitesSent) * 100) / 100 : null,
  };
}

// Group KPIs by a dimension (tenant or seller).
export function kpisByDimension(rows: RecoveryMetricRow[], dim: "company_bio_id" | "seller_id"): Record<string, RecoveryKpis> {
  const groups = new Map<string, RecoveryMetricRow[]>();
  for (const r of rows) {
    const k = (r[dim] as string | null) ?? "(none)";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Record<string, RecoveryKpis> = {};
  for (const [k, rs] of groups) out[k] = computeRecoveryKpis(rs);
  return out;
}
