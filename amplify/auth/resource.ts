import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito user pool.
 * - Login con email + password.
 * - Groups dinámicos por tenant (gpa, clienteX, ...) creados via Cognito console
 *   o admin API. Cada usuario pertenece al group de su organización.
 * - Group 'admin' = super-usuario (acceso cross-tenant para soporte/auditoría).
 * - Atributo custom 'tenantId' replica el group activo del usuario para facilitar
 *   queries — el authorization real lo decide la membership al group.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ["admin"],
  userAttributes: {
    "custom:tenantId": {
      dataType: "String",
      mutable: true,
    },
  },
});
