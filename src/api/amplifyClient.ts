// Amplify Gen 2 bootstrap. Configura el SDK con los endpoints del backend
// (Cognito + AppSync + S3) y expone un client tipado para queries GraphQL.
//
// amplify_outputs.json es generado por `npx ampx pipeline-deploy` en CI y
// vive en raíz del repo (gitignored). En local, se descarga manual de
// Amplify Console — Deployment artifacts.
//
// `configureAmplify()` debe llamarse UNA vez antes de cualquier llamada al
// SDK (auth, data, storage). main.ts lo invoca al boot.

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "../../amplify_outputs.json";
import type { Schema } from "../../amplify/data/resource";

let configured = false;
let client: ReturnType<typeof generateClient<Schema>> | null = null;

/** Configura Amplify SDK. Idempotente — segunda llamada no-op. */
export function configureAmplify(): void {
  if (configured) return;
  Amplify.configure(outputs);
  configured = true;
}

/**
 * Obtiene el cliente tipado de Data. Lazy-init: usa singleton para evitar
 * recrear el cliente en cada llamada (mantiene cache + subscriptions vivas).
 *
 * `userPool` = auth mode default (lee JWT del Cognito session current).
 * Todas las llamadas tipo `client.models.Unit.create()` autentican via JWT.
 */
export function getClient(): ReturnType<typeof generateClient<Schema>> {
  if (!configured) {
    throw new Error("Amplify no configurado. Llama configureAmplify() primero.");
  }
  if (!client) {
    client = generateClient<Schema>({ authMode: "userPool" });
  }
  return client;
}

/** Re-export del tipo Schema para que consumers tipen Inputs/Outputs. */
export type { Schema };

/**
 * URL pública del portal del taller (`custom.tallerPortalUrl`), publicada por
 * `amplify/backend.ts` (`backend.addOutput`) — mismo patrón que
 * `custom.moreappWebhookUrl`/`custom.opsgpaReceptorUrl`. Lectura DEFENSIVA a
 * propósito (Task 11, R66): el `amplify_outputs.json` local de esta rama
 * refleja el backend YA desplegado en PROD, que todavía no incluye el Lambda
 * del portal — así que la clave está AUSENTE hasta el primer deploy de esta
 * rama. Ningún consumer debe asumir que existe; este es el ÚNICO lugar que
 * lee `outputs.custom` para este fin (nada de una segunda lectura suelta).
 */
export function tallerPortalUrl(): string | null {
  const custom = (outputs as { custom?: Record<string, unknown> }).custom;
  const url = custom?.tallerPortalUrl;
  return typeof url === "string" && url ? url : null;
}
