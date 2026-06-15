import { defineFunction } from "@aws-amplify/backend";

// Lambda del módulo de Administración de Usuarios (2026-06-12). Respalda las
// custom mutations/queries adminUsers* del schema (ver amplify/data/resource.ts).
// IAM Cognito Admin acotado al User Pool + env USER_POOL_ID: se conceden en
// amplify/backend.ts (allí está el handle del pool). Sin Function URL: se invoca
// vía AppSync, que valida el grupo 'admin' antes de ejecutar.
export const adminUsers = defineFunction({
  name: "admin-users",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  environment: {
    ALLOWED_EMAIL_DOMAIN: "gpa.com.mx",
    // USER_POOL_ID se inyecta en backend.ts (depende del recurso auth).
  },
});
