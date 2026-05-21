import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";

/**
 * Amplify Gen 2 backend entrypoint.
 *
 * Recursos:
 * - auth: Cognito user pool + group 'admin' + custom attr 'tenantId'.
 * - data: AppSync GraphQL API con 6 modelos (Unit/Taller/Nota/Checklist/Periodo/Semanal).
 *   Cada modelo respaldado por una tabla DynamoDB con GSIs por tenant + sort key.
 * - storage: S3 bucket 'gpa-fleet-photos' particionado por tenantId.
 *
 * Deploy: TI debe habilitar backend builds en el Amplify app antes de que
 * `amplify.yml` con sección `backend:` corra en CI.
 *
 * Dev local: `npm run amplify:sandbox` crea backend temporal en cuenta AWS
 * (requiere AWS CLI + credentials configurados).
 */
defineBackend({
  auth,
  data,
  storage,
});
