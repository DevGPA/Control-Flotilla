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
  // Modulo de Administracion de Usuarios (2026-06-12): roles como Cognito groups.
  // 'admin' = super-usuario (gestiona usuarios, acceso cross-tenant). 'operativo'
  // y 'viewer' = roles operativos. El grupo de TENANT ('gpa') es aparte: un
  // usuario pertenece a su tenant + su rol.
  groups: ["admin", "operativo", "viewer"],
  userAttributes: {
    "custom:tenantId": {
      dataType: "String",
      mutable: true,
    },
    // Sucursal asignada (GDL/MTY/CDMX/Cancun/Vallarta/Cabos). La usa el filtro de
    // UI del rol viewer (restriccion a nivel de interfaz, no de fila — MVP).
    "custom:sucursal": {
      dataType: "String",
      mutable: true,
    },
  },
});
