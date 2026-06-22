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
    // Personalización del correo de INVITACIÓN (alta de usuario por el admin).
    // Antes usaba el template por defecto de Cognito (asunto "Your temporary
    // password", sin contexto ni URL) → parecía spam. Ahora lleva asunto claro,
    // contexto y la URL de la app. Los placeholders username()/code() son
    // obligatorios (Cognito exige el de contraseña temporal en el cuerpo).
    email: {
      userInvitation: {
        emailSubject: "Acceso a Control de Flotilla GPA",
        emailBody: (username, code) =>
          `Hola, se creó tu cuenta en Control de Flotilla GPA.\n\n` +
          `Usuario: ${username()}\n` +
          `Contraseña temporal: ${code()}\n\n` +
          `Ingresa aquí: https://main.d3tud8dzuub7bj.amplifyapp.com\n\n` +
          `Se te pedirá cambiar la contraseña en el primer inicio de sesión.\n` +
          `Si no esperabas este correo, ignóralo.`,
      },
    },
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
    // Módulos permitidos por usuario (CSV: "inspecciones,combustible,..."). Gating
    // de UI: el admin asigna qué pestañas ve cada usuario. Vacío = todos. NO es
    // frontera de seguridad dura (el dato sigue por tenant+rol+sucursal en AppSync).
    "custom:modulos": {
      dataType: "String",
      mutable: true,
    },
  },
});
