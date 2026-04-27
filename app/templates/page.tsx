import { redirect } from "next/navigation";

// /templates was unified into /voice with a "Templates Library" tab.
export default function TemplatesRedirect() {
  redirect("/voice?tab=templates");
}
