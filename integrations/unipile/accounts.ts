// Cuentas conectadas y hosted auth de Unipile.
//
// Transporte puro: listar cuentas del workspace y pedir un link de conexion
// hosted. Que hacer con el resultado —que seller queda linkeado, que se
// persiste, que se le muestra al usuario— es del feature.

import { unipileFetch } from "./client";

/** GET /accounts — todas las cuentas conectadas del workspace. */
export function listAccountsRaw(init?: RequestInit): Promise<Response> {
  return unipileFetch("/api/v1/accounts", init);
}

/** POST /hosted/accounts/link — pide un link de conexion hosted. */
export function createHostedAuthLink(body: Record<string, unknown>): Promise<Response> {
  return unipileFetch("/api/v1/hosted/accounts/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
