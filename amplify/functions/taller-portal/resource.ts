import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * Portal del proveedor de taller. Sirve la página que ve el taller y recibe sus
 * escrituras (partidas, precios, km, estado, fecha). No hay cuentas: la
 * autenticación es la firma HMAC del token de la liga.
 *
 * Fail-closed: sin TALLER_PORTAL_SECRET configurado — o con uno de menos de 32
 * caracteres, que se trata como ausente (ver `secretoUtilizable` en
 * validacion.ts) —, todo request responde 401.
 *   sandbox: npx ampx sandbox secret set TALLER_PORTAL_SECRET
 *   branch:  Amplify console → Secrets (mismo nombre)
 *
 * El tenant NO viene de una env var: sale del `identity`/`claims` que AppSync ya
 * validó (`identidadDeResolver`, handler.ts) o del token de la liga. La env var
 * `TALLER_TENANT_ID` existió declarada y nadie la leyó nunca — se retira para
 * que no sugiera una fuente de verdad que no existe.
 */
export const tallerPortal = defineFunction({
  name: "taller-portal",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  environment: {
    TALLER_PORTAL_SECRET: secret("TALLER_PORTAL_SECRET"),
  },
});
