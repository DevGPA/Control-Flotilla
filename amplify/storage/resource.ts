import { defineStorage } from "@aws-amplify/backend";

/**
 * S3 bucket para fotos del flotilla.
 * Path convention: photos/{tenantId}/{filename}
 *
 * Auth: usuarios autenticados leen/escriben/borran path photos/*.
 * NOTA: Amplify Gen 2 solo soporta {entity_id} como placeholder de path; otros
 * tokens como {tenantId} se tratan literal (la IAM policy generada no los
 * expande). Por eso usamos wildcard simple `photos/*` y aplicamos isolation
 * multi-tenant a nivel de app code (cada cliente solo lista/sube a su carpeta
 * `photos/${tenantId}/`). Para strict isolation, futuro: Lambda authorizer.
 */
export const storage = defineStorage({
  name: "gpa-fleet-photos",
  access: (allow) => ({
    "photos/*": [
      allow.authenticated.to(["read", "write", "delete"]),
      // CRÍTICO (incidente fotos 2026-06-17): los usuarios que pertenecen a un grupo
      // (admin/operativo/viewer) NO asumen el rol `authenticated` por defecto — el
      // Identity Pool tiene un role-mapping tipo Token que les asigna el ROL DE GRUPO
      // (cognito:preferred_role del JWT). Esos roles de grupo se crean SIN políticas,
      // así que sin esta línea quedan sin `s3:GetObject` → las fotos firmadas dan 403
      // ("No disponible") para todo usuario con grupo, mientras un usuario sin grupo-rol
      // (cae al rol default) sí las ve. admin/operativo gestionan; viewer solo lee.
      allow.groups(["admin", "operativo"]).to(["read", "write", "delete"]),
      allow.groups(["viewer"]).to(["read"]),
    ],
  }),
});
