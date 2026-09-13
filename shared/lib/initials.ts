// Iniciales de un nombre, para avatares.
//
// Una sola regla: primera palabra + ULTIMA palabra. Un nombre de una sola
// palabra da sus dos primeras letras; vacio da "??".
//
// ALCANCE: esto unifica las 3 variantes PROBADAMENTE equivalentes de las 9 que
// hay en el repo. Las otras 6 no se tocan porque su regla es distinta de
// verdad, no parecida:
//
//   TenantTeamTab      cae al email cuando no hay nombre
//   CampaignCallsTab   lee primary_first_name / primary_last_name, no un string
//   InboxView          primeras DOS palabras, no primera+ultima; devuelve "?"
//   LeadChatThread     idem InboxView
//   PortfolioView      primeras dos palabras, sin filtrar vacios; devuelve "?"
//   TopHeader          valida typeof string y parte por " " literal, no /\s+/
//
// Fusionarlas cambiaria lo que se ve en pantalla. Cuando cada dominio migre,
// su superficie decide si adopta esta regla o se queda con la suya.

export function initials(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
