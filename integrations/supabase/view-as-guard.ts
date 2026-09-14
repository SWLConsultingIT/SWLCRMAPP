// Admin "View as Seller" = READ-ONLY — client-side write guard.
//
// proxy.ts blocks every mutating /api/* call during a seller preview (the
// server-side boundary). This guard is the client-side companion for the few
// surfaces that talk to Supabase DIRECTLY from the browser (bypassing /api):
// the icp / voice / company-bios / campaigns-new table writes AND the two
// storage uploads (company-assets, campaign-files). Applied once to each
// browser client singleton, it makes every table mutation and every storage
// write reject while previewing. Reads, auth and realtime are untouched.
//
// It reads the server-validated flag (view-as-flag), never a forgeable cookie.
// It is a UX / accidental-write guard for the admin's own session: the real
// user stays Admin, so a bypass mutates nothing the admin couldn't mutate by
// simply leaving preview — never a privilege escalation, and attribution is
// always the real admin (writes that run, run as them).

import { isViewAsActive } from "@/shared/auth/view-as-flag";

const BLOCKED_TABLE_OPS = ["insert", "update", "upsert", "delete"] as const;
const BLOCKED_STORAGE_OPS = ["upload", "update", "remove", "move", "copy", "createSignedUploadUrl", "uploadToSignedUrl"] as const;

const MSG = "read_only_seller_preview: writes are disabled while viewing as a seller. Return to Admin view to act.";

function tableError() {
  return { data: null, error: { message: MSG, code: "read_only_seller_preview", details: "", hint: "" } };
}
function storageError() {
  return { data: null, error: { message: MSG, name: "ReadOnlySellerPreview" } };
}

type AnyRec = Record<string, unknown>;

/** Wrap a supabase-js / ssr browser client so direct writes reject during a
 *  seller preview. Idempotent-safe to call once per client singleton. */
export function guardClientWrites<T>(client: T): T {
  const c = client as unknown as {
    from: (t: string) => AnyRec;
    storage?: { from: (b: string) => AnyRec };
  };

  // ── table mutations ──
  const originalFrom = c.from.bind(c);
  c.from = (table: string) => {
    const builder = originalFrom(table);
    for (const op of BLOCKED_TABLE_OPS) {
      const original = builder[op];
      if (typeof original !== "function") continue;
      builder[op] = (...args: unknown[]) => {
        if (isViewAsActive()) return Promise.resolve(tableError());
        return (original as (...a: unknown[]) => unknown).apply(builder, args);
      };
    }
    return builder;
  };

  // ── storage writes ──
  if (c.storage && typeof c.storage.from === "function") {
    const originalStorageFrom = c.storage.from.bind(c.storage);
    c.storage.from = (bucket: string) => {
      const api = originalStorageFrom(bucket);
      for (const op of BLOCKED_STORAGE_OPS) {
        const original = api[op];
        if (typeof original !== "function") continue;
        api[op] = (...args: unknown[]) => {
          if (isViewAsActive()) return Promise.resolve(storageError());
          return (original as (...a: unknown[]) => unknown).apply(api, args);
        };
      }
      return api;
    };
  }

  return client;
}
