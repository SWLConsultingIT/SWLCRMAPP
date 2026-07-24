// POST /api/leads/[id]/send-to-odoo — Fase 3. Pushes a positive result into the
// SWL Odoo CRM (PROSPECT column) with the full GROWTH ENGINE payload mapped onto
// Odoo's custom (x_studio_*) fields, then flags the lead transferred so the
// Results kanban moves the card to "Sent to Odoo".
//
// SWL-tenant only. Ports the company/contact/seller/crm.lead logic from the n8n
// "SWL - CRM - Create Odoo Lead" workflow (kept as the reference source) and adds
// the custom-field mapping introspected from the live crm.lead schema.
// Odoo creds read from env (ODOO_*) with the current SWL values as fallback so it
// works before the env vars are set. TODO: move the key fully to env + rotate,
// and add per-tenant Odoo config when we onboard a 2nd tenant.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

export const runtime = "nodejs";
export const maxDuration = 60;

const SWL_BIO = "7c02e222-be59-416d-9434-acf4685f8590";
const ODOO = {
  url: process.env.ODOO_URL ?? "https://swlconsulting-swlodoosh.odoo.com/jsonrpc",
  db: process.env.ODOO_DB ?? "juandevera92-swlodoo-main-29112709",
  uid: Number(process.env.ODOO_UID ?? 13),
  key: process.env.ODOO_API_KEY ?? "7eb365ac9dbc92a3b8c575dd7d489fb3fa7d9490",
  stageProspect: Number(process.env.ODOO_STAGE_PROSPECT ?? 9),
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const htmlPara = (s: unknown) => { const t = String(s ?? "").trim(); return t ? `<p>${esc(t).replace(/\n/g, "<br/>")}</p>` : false; };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const drafts = (body?.drafts ?? {}) as Record<string, string>;

  const svc = getSupabaseService();
  const sb = await getSupabaseServer();

  // Read the lead (user-scoped for the read) — select * to avoid column drift.
  const { data: lead } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  const L = lead as any;
  if (L.company_bio_id !== SWL_BIO) return NextResponse.json({ error: "demo-only (SWL Consulting)" }, { status: 403 });
  // NOTE: an existing odoo_lead_id no longer short-circuits — we UPSERT below
  // (update the same opportunity) so a re-push enriches instead of skipping.

  // Seller name (for Odoo salesperson match) from the lead's latest campaign.
  const { data: camp } = await sb.from("campaigns").select("seller_id, name, sellers(name)").eq("lead_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const sellerName = ((camp as any)?.sellers?.name as string) ?? null;

  // Conversation (sent + inbound), grouped per channel → one HTML thread per
  // Growth Engine tab field (fields verified against the live crm.lead schema).
  const [{ data: sent }, { data: replies }] = await Promise.all([
    sb.from("campaign_messages").select("channel, content, sent_at, metadata").eq("lead_id", id).eq("status", "sent").order("sent_at", { ascending: true }),
    sb.from("lead_replies").select("channel, reply_text, received_at").eq("lead_id", id).order("received_at", { ascending: true }),
  ]);
  const sellerLabel = sellerName || "Seller";
  type Ev = { from: string; text: string; at: string };
  const byChannel: Record<string, Ev[]> = {};
  for (const m of sent ?? []) { const ch = String((m as any).channel ?? "").toLowerCase(); const t = ((m as any).metadata?.rendered_content as string) || (m as any).content || ""; if (t) (byChannel[ch] ??= []).push({ from: `→ ${sellerLabel}`, text: t, at: (m as any).sent_at ?? "" }); }
  for (const r of replies ?? []) { const ch = String((r as any).channel ?? "").toLowerCase(); if ((r as any).reply_text) (byChannel[ch] ??= []).push({ from: "← Lead", text: (r as any).reply_text, at: (r as any).received_at ?? "" }); }
  // One rendered thread per channel: a Sent/Replies/Last header + the messages.
  function renderThread(ch: string): string | false {
    const ev = (byChannel[ch] || []).slice().sort((a, b) => a.at.localeCompare(b.at));
    if (!ev.length) return false;
    const sentN = ev.filter(e => e.from.startsWith("→")).length;
    const repN = ev.filter(e => e.from.startsWith("←")).length;
    const header = `<p><b>Sent:</b> ${sentN} · <b>Replies:</b> ${repN} · <b>Last:</b> ${esc(ev[ev.length - 1].at.slice(0, 10))}</p><hr/>`;
    const rows = ev.map(e => `<p><b>${esc(e.from)}</b> <small>${esc(e.at.slice(0, 16))}</small><br/>${esc(e.text)}</p>`).join("");
    return header + rows;
  }
  const callThread = renderThread("call"); // no dedicated Calls field on the Growth tab → folded into comm notes
  const lastAt = replies && replies.length ? (replies as any[])[replies.length - 1].received_at : (sent && sent.length ? (sent as any[])[sent.length - 1].sent_at : null);
  const lastDate = lastAt ? String(lastAt).slice(0, 10) : false;

  async function odoo(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    const r = await fetch(ODOO.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service: "object", method: "execute_kw", args: [ODOO.db, ODOO.uid, ODOO.key, model, method, args, kwargs] } }) });
    const j = await r.json();
    if (j.error) throw new Error(typeof j.error === "object" ? (j.error.data?.message || j.error.message || JSON.stringify(j.error)).slice(0, 400) : String(j.error));
    return j.result;
  }

  const fullName = `${L.primary_first_name ?? ""} ${L.primary_last_name ?? ""}`.trim() || "Unknown";
  const email = L.primary_work_email || L.primary_personal_email || "";
  const phone = L.primary_phone || "";
  const companyName = L.company_name || "";
  const website = L.company_website || "";
  const domain = website ? website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : "";

  try {
    // 1) company partner (find-or-create)
    let companyId: number | null = null;
    if (companyName) {
      const found = await odoo("res.partner", "search_read", [["&", ["is_company", "=", true], "|", ["name", "ilike", companyName], domain ? ["website", "ilike", domain] : ["id", "=", 0]]], { fields: ["id"], limit: 1 });
      if (found?.[0]?.id) companyId = found[0].id;
      else companyId = await odoo("res.partner", "create", [{ name: companyName, is_company: true, website: website || false, comment: (L.organization_description || false) }]);
    }
    // 2) contact partner (find-or-create by email)
    let contactId: number | null = null;
    if (email) {
      const found = await odoo("res.partner", "search_read", [[["email", "=ilike", email]]], { fields: ["id", "parent_id"], limit: 1 });
      if (found?.[0]?.id) { contactId = found[0].id; if (companyId) await odoo("res.partner", "write", [[contactId], { parent_id: companyId }]); }
    }
    if (!contactId) {
      contactId = await odoo("res.partner", "create", [{ name: fullName, is_company: false, parent_id: companyId || false, email: email || false, phone: phone || false, function: L.primary_title_role || false, website: L.primary_linkedin_url || false }]);
    }
    // 3) seller user
    let userId = ODOO.uid;
    if (sellerName) { const u = await odoo("res.users", "search_read", [[["name", "ilike", sellerName]]], { fields: ["id"], limit: 1 }); if (u?.[0]?.id) userId = u[0].id; }

    // 4) crm.lead with GROWTH ENGINE payload → custom fields
    const descParts = [
      `<h3>Positive lead — via ${esc(L.current_channel ?? "outreach")}</h3>`,
      drafts.conversationSummary ? `<p><b>Resumen de la conversación:</b><br/>${esc(drafts.conversationSummary).replace(/\n/g, "<br/>")}</p>` : "",
      drafts.sellerComments ? `<p><b>Comentarios del vendedor:</b><br/>${esc(drafts.sellerComments).replace(/\n/g, "<br/>")}</p>` : "",
    ].filter(Boolean).join("");

    const empl = Number(L.employees); const rev = Number(L.annual_revenue);
    const leadPayload: Record<string, unknown> = {
      name: `${fullName} - ${companyName || "Lead"}`,
      partner_id: contactId || false,
      partner_name: companyName || false,
      contact_name: fullName,
      email_from: email || false,
      phone: phone || false,
      website: website || false,
      type: "opportunity", // land in the Pipeline kanban (type='lead' only shows under the Leads menu)
      stage_id: ODOO.stageProspect,
      user_id: userId,
      description: descParts || false,
      // Contact tab
      x_studio_headline: htmlPara(L.primary_headline),
      x_studio_seniority: htmlPara(L.primary_seniority),
      x_studio_career: htmlPara(L.primary_career),
      x_studio_linkedin_url: htmlPara(L.primary_linkedin_url),
      // Enrichment tab
      x_studio_company_overview: htmlPara(drafts.companySummary || L.organization_description),
      x_studio_description: htmlPara(L.organization_description),
      x_studio_short_description: htmlPara(L.organization_short_desc),
      x_studio_seo_description: htmlPara(L.organization_seo_desc),
      x_studio_tagline: htmlPara(L.organization_tagline),
      x_studio_keywords: htmlPara(L.keywords),
      x_studio_technologies: htmlPara(Array.isArray(L.organization_technologies) ? L.organization_technologies.join(", ") : L.organization_technologies),
      x_studio_industry_trends: htmlPara(L.industry_trends),
      x_studio_similar_organizations_1: htmlPara(L.similar_organization),
      ...(Number.isFinite(empl) && empl > 0 ? { x_studio_employees: empl } : {}),
      ...(Number.isFinite(rev) && rev > 0 ? { x_studio_monetary_field_5nb_1jl2cuqj2: rev } : {}),
      // Personalized Info
      x_studio_personalized_info_1: htmlPara(drafts.profileSummary || L.primary_headline),
      x_studio_personalized_info_2: htmlPara(drafts.highlights),
      x_studio_personalized_info_3: htmlPara(drafts.conversationSummary),
      // Discovery + Notes
      x_studio_lead_discovery: htmlPara(drafts.highlights),
      x_studio_related_field_4bc_1jplfb7lt: htmlPara(drafts.sellerComments),
      // Growth Engine tab — one thread per channel (LinkedIn/SMS/Wpp use the _1
      // fields that are actually placed on the tab; the non-_1 twins are orphaned).
      x_studio_emails: renderThread("email"),
      x_studio_linkedin_1: renderThread("linkedin"),
      x_studio_sms_1: renderThread("sms"),
      x_studio_wpp_1: renderThread("whatsapp"),
      // Comm notes = seller summary + calls thread (no Calls field exists on the tab).
      x_email_comm_notes: (() => {
        const parts = [htmlPara(drafts.conversationSummary) || "", callThread ? `<p><b>☎ Calls</b></p>${callThread}` : ""].filter(Boolean);
        return parts.length ? parts.join("") : false;
      })(),
      // Last contact
      ...(lastDate ? { x_studio_last: lastDate } : {}),
      // Source
      x_studio_source: htmlPara(L.source_campaign_name || L.source_tool),
    };
    // Drop false/empty fields so we never blank a value with junk.
    for (const k of Object.keys(leadPayload)) if (leadPayload[k] === false || leadPayload[k] === undefined) delete leadPayload[k];

    // UPSERT: reuse an existing crm.lead (known odoo_lead_id, else match by email)
    // so a re-push enriches the same opportunity instead of creating a duplicate.
    let existingId: number | null = L.odoo_lead_id ? Number(L.odoo_lead_id) : null;
    if (existingId) {
      const chk = await odoo("crm.lead", "search_read", [[["id", "=", existingId]]], { fields: ["id"], context: { active_test: false } });
      if (!chk?.[0]) existingId = null; // deleted in Odoo → recreate
    }
    if (!existingId && email) {
      const found = await odoo("crm.lead", "search_read", [[["email_from", "=ilike", email]]], { fields: ["id"], limit: 1, context: { active_test: false } });
      if (found?.[0]?.id) existingId = found[0].id;
    }

    let odooLeadId: number;
    if (existingId) {
      // Enrich the existing opportunity: push ONLY the custom fields + contact link.
      // Never touch stage/type/owner/name — the seller may have advanced the deal.
      const updatePayload: Record<string, unknown> = {};
      for (const k of Object.keys(leadPayload)) if (k.startsWith("x_")) updatePayload[k] = leadPayload[k];
      if (contactId) updatePayload.partner_id = contactId;
      await odoo("crm.lead", "write", [[existingId], updatePayload]);
      odooLeadId = existingId;
    } else {
      // Create a fresh opportunity in PROSPECT with all standard + custom fields.
      leadPayload.type = "opportunity";
      leadPayload.stage_id = ODOO.stageProspect;
      leadPayload.name = `${fullName} - ${companyName || "Lead"}`;
      leadPayload.contact_name = fullName;
      if (contactId) leadPayload.partner_id = contactId;
      leadPayload.user_id = userId;
      odooLeadId = await odoo("crm.lead", "create", [leadPayload]);
      if (!odooLeadId) throw new Error("crm.lead create returned no id");
    }

    // Flag transferred → Results kanban moves the card to "Sent to Odoo".
    await svc.from("leads").update({ odoo_lead_id: odooLeadId, transferred_to_odoo_at: new Date().toISOString() }).eq("id", id);

    return NextResponse.json({ ok: true, odooLeadId, companyId, contactId, updated: !!existingId });
  } catch (e: any) {
    return NextResponse.json({ error: `Odoo push failed: ${e?.message ?? "unknown"}` }, { status: 502 });
  }
}
