import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminPage } from "@/lib/auth-admin";
import { notFound } from "next/navigation";
import VoiceEditorClient from "./VoiceEditorClient";

const supabase = getSupabaseService();

export default async function VoiceEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;

  const { data: bio } = await supabase
    .from("company_bios")
    .select("id, company_name, tone_of_voice, ideal_message_examples")
    .eq("id", id)
    .maybeSingle();

  if (!bio) notFound();

  return <VoiceEditorClient bio={bio} />;
}
