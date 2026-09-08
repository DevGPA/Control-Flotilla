import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * Portal del proveedor de taller. Sirve la página que ve el taller y recibe sus
 * escrituras (partidas, precios, km, estado, fecha). No hay cuentas: la
 * autenticación es la firma HMAC del token de la liga.
 *
 * Fail-closed: sin TALLER_PORTAL_SECRET configurado, todo request responde 401.
 *   sandbox: npx ampx sandbox secret set TALLER_PORTAL_SECRET
 *   branch:  Amplify console → Secrets (mismo nombre)
 */
export const tallerPortal = defineFunction({
  name: "taller-portal",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  environment: {
    TALLER_PORTAL_SECRET: secret("TALLER_PORTAL_SECRET"),
    TALLER_TENANT_ID: "gpa",
  },
});
