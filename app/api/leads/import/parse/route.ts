// Step 1 of the import wizard: parse the uploaded file and return headers +
// a sample. The browser keeps the parsed data and re-sends it to /map and
// /commit; we never store anything server-side at this step.

import { NextRequest, NextResponse } from "next/server";
import { getUserScope, canEditTenantSettings } from "@/lib/scope";
import { parseUploadedSheet } from "@/lib/csv-xlsx-parser";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Only owners/admins can import. Sellers and viewers don't have tenant-level
  // write authority over the leads pool.
  if (!canEditTenantSettings(scope.tier) && scope.tier !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 10MB.` }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const parsed = parseUploadedSheet(buffer, file.name);
    return NextResponse.json({
      fileName: file.name,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 3),
      totalRows: parsed.totalRows,
      // Round-trip the rows to the browser. For a 50k-row sheet this is ~5MB
      // JSON which is acceptable for the wizard flow. We avoid persisting
      // the file to disk to keep client-uploaded leads off SWL infrastructure
      // until the cipher step.
      rows: parsed.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "parse failed" },
      { status: 422 },
    );
  }
}
