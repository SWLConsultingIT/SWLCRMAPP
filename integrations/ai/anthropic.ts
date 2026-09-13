// Fabrica del cliente Anthropic.
//
// Catorce archivos hacian `new Anthropic()` o `new Anthropic({ apiKey })` por
// su cuenta. Lo unico que se mueve aca es ESO: la creacion del SDK y de donde
// sale la key.
//
// LO QUE NO ESTA ACA, a proposito: los prompts, los modelos, los max_tokens,
// la temperatura, los reintentos por feature y como se parsea la salida. Todo
// eso es decision del feature y sigue en su route.
//
// En particular NO se unifican los tres callHaiku() de los endpoints de
// tailoring: tienen retries y manejo de error distintos, y fusionarlos cambia
// comportamiento. Queda anotado como dedupe posterior.
//
// LEY DEL PROYECTO: la generacion de contenido de outreach pasa por n8n, no por
// llamadas directas desde Next. Este modulo es para los usos que YA existen
// (resumenes, coaching, analisis), no una invitacion a agregar mas.

import Anthropic from "@anthropic-ai/sdk";

/** Cliente Anthropic. Sin `apiKey` usa la env que lee el SDK (ANTHROPIC_API_KEY),
 *  que es lo que ya hacian los call sites que llamaban `new Anthropic()` pelado. */
export function getAnthropic(apiKey?: string): Anthropic {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

export type { Anthropic };
