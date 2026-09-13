// Formateo generico compartido.
//
// ALCANCE — leer antes de agregar nada aca.
//
// El repo tiene 24 sitios que formatean "hace cuanto", y al compararlos uno
// por uno resultaron ser 23 IMPLEMENTACIONES DISTINTAS. No difieren en estilo:
// difieren en lo que muestran.
//
//   nulo        "never" · "Never" · "—" · "" · null · sin guarda
//   sub-minuto  "just now" · "Just now" · "now" · t("...justNow") · sin rama
//   sufijo      "5m ago" · "5m" · "5min" · "hace 5 minutos"
//   idioma      8 pasan por t(), el resto hardcodean ingles
//   NaN         unos pocos chequean isNaN, la mayoria no
//
// Por eso aca hay UNA sola funcion, la unica que aparecia identica en dos
// dominios distintos. El resto no se fusiona: unificarlas cambiaria el texto
// en pantalla y, en las 8 traducidas, romperia i18n.

/** "hace cuanto", en ingles, con "never" para nulo. Precision: minuto. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
