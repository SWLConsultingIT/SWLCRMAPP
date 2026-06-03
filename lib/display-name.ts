// Resolve a friendly display name from auth metadata, falling back to a
// prettified email prefix ("lucia.antel" → "Lucia Antel") so rosters/pickers
// never show raw handles next to real names.
export function prettyDisplayName(meta: Record<string, unknown> | null | undefined, email: string | null | undefined): string {
  const m = meta ?? {};
  const direct = (m.full_name as string) || (m.display_name as string) || (m.name as string);
  if (direct && direct.trim()) return direct.trim();
  const prefix = (email ?? "").split("@")[0];
  if (!prefix) return "Teammate";
  const pretty = prefix.split(/[._-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return pretty || "Teammate";
}
