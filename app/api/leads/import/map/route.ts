// Step 2 of the import wizard: GPT-4o-mini suggests a column mapping. The UI
// shows it as a suggestion and the user can edit any row before /commit.

import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canEditTenantSettings } from "@/lib/scope";
import { inferLeadMapping } from "@/lib/lead-csv-mapper";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canEditTenantSettings(scope.tier) && scope.tier !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.fileName !== "string" || !Array.isArray(body.sourceHeaders) || !Array.isArray(body.sampleRows)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const result = await inferLeadMapping({
      fileName: body.fileName,
      sourceHeaders: body.sourceHeaders.slice(0, 200),
      sampleRows: body.sampleRows.slice(0, 5),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "mapping failed" },
      { status: 502 },
    );
  }
}
