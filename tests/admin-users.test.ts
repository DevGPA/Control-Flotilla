// Tests de la lógica pura del módulo de Administración de Usuarios (2026-06-12).
// Cubre validación de alta (dominio @gpa.com.mx, rol, campos), construcción del
// evento de auditoría, diff de perfil y mapeo de errores de Cognito. El handler
// que toca Cognito/DynamoDB se valida en sandbox (igual que el webhook).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ROLES,
  CREDENCIALES,
  esGrupoDeTenant,
  derivarTenantDeGrupos,
  validateCreateInput,
  validateTelefono,
  isAllowedDomain,
  isValidRol,
  normalizeEmail,
  buildAuditEvent,
  diffUserProfile,
  mapCognitoError,
} from "../amplify/functions/admin-users/logic";

describe("validación de alta", () => {
  it("acepta un alta válida @gpa.com.mx", () => {
    const r = validateCreateInput({
      email: "Juan.Perez@GPA.com.mx",
      nombre: "Juan Pérez",
      rol: "operativo",
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rechaza dominio ajeno", () => {
    const r = validateCreateInput({ email: "x@gmail.com", nombre: "X", rol: "viewer" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("@gpa.com.mx"))).toBe(true);
  });

  it("rechaza rol inválido", () => {
    const r = validateCreateInput({ email: "a@gpa.com.mx", nombre: "A", rol: "superadmin" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes("rol"))).toBe(true);
  });

  it("rechaza nombre y correo faltantes", () => {
    const r = validateCreateInput({ email: "", nombre: "  ", rol: "admin" });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rechaza correo con formato inválido", () => {
    const r = validateCreateInput({ email: "no-es-correo", nombre: "A", rol: "admin" });
    expect(r.valid).toBe(false);
  });

  it("normalizeEmail / isAllowedDomain / isValidRol", () => {
    expect(normalizeEmail("  A@GPA.COM.MX ")).toBe("a@gpa.com.mx");
    expect(isAllowedDomain("x@gpa.com.mx")).toBe(true);
    expect(isAllowedDomain("x@gpa.com.mx.evil.com")).toBe(false);
    expect(isValidRol("operativo")).toBe(true);
    expect(isValidRol("root")).toBe(false);
  });

  it("validateTelefono acepta vacío y E.164, rechaza basura", () => {
    expect(validateTelefono("")).toBe(true);
    expect(validateTelefono("+523312345678")).toBe(true);
    expect(validateTelefono("33 1234 5678")).toBe(true);
    expect(validateTelefono("abc")).toBe(false);
  });
});

describe("buildAuditEvent", () => {
  it("arma el evento con id = now#sufijo y diff serializado", () => {
    const e = buildAuditEvent({
      tenantId: "gpa",
      actor: "admin@gpa.com.mx",
      accion: "crear",
      targetUser: "nuevo@gpa.com.mx",
      diff: { rol: { de: null, a: "viewer" } },
      ip: "10.0.0.1",
      now: "2026-06-12T10:00:00.000Z",
      idSuffix: "abc123",
    });
    expect(e.id).toBe("2026-06-12T10:00:00.000Z#abc123");
    expect(e.timestamp).toBe("2026-06-12T10:00:00.000Z");
    expect(e.actor).toBe("admin@gpa.com.mx");
    expect(JSON.parse(e.detalleCambios)).toEqual({ rol: { de: null, a: "viewer" } });
    expect(e.ip).toBe("10.0.0.1");
  });

  it("tolera campos opcionales ausentes", () => {
    const e = buildAuditEvent({
      tenantId: "gpa",
      actor: "a",
      accion: "listar",
      now: "t",
      idSuffix: "s",
    });
    expect(e.targetUser).toBe("");
    expect(e.ip).toBe("");
    expect(e.detalleCambios).toBe("{}");
  });
});

describe("diffUserProfile", () => {
  it("solo reporta campos cambiados", () => {
    const d = diffUserProfile(
      { nombre: "Ana", rol: "viewer", sucursal: "GDL" },
      { nombre: "Ana", rol: "operativo", sucursal: "GDL" },
    );
    expect(d).toEqual({ rol: { de: "viewer", a: "operativo" } });
  });

  it("alta (prev null) reporta los campos nuevos", () => {
    const d = diffUserProfile(null, { nombre: "Ana", rol: "viewer" });
    expect(d.nombre).toEqual({ de: null, a: "Ana" });
    expect(d.rol).toEqual({ de: null, a: "viewer" });
  });

  it("ignora campos no presentes en next", () => {
    const d = diffUserProfile({ nombre: "Ana", telefono: "x" }, { nombre: "Beto" });
    expect(d).toEqual({ nombre: { de: "Ana", a: "Beto" } });
  });
});

describe("mapCognitoError", () => {
  it("mapea los errores conocidos a mensajes limpios", () => {
    expect(mapCognitoError({ name: "UsernameExistsException" })).toContain("Ya existe");
    expect(mapCognitoError({ name: "UserNotFoundException" })).toContain("no existe");
    expect(mapCognitoError({ name: "NotAuthorizedException" })).toContain("no autorizada");
    expect(mapCognitoError({ name: "LimitExceededException" })).toContain("límite");
  });

  it("error desconocido cae a mensaje genérico (sin filtrar detalles técnicos)", () => {
    const m = mapCognitoError(new Error("AccessDenied: arn:aws:... stack trace"));
    expect(m).not.toContain("arn:aws");
    expect(m).toContain("servidor de identidad");
  });
});

// ── Task 14 — la credencial `riesgos` frente al panel de usuarios ───────────
// `riesgos` es una CREDENCIAL ADICIONAL, no un rol: se suma al rol de la persona
// (`operativo`) y habilita solo emitir/revocar la liga del proveedor de Taller.
// De eso salen tres propiedades que estas pruebas fijan.
describe("credencial `riesgos` (Task 14)", () => {
  it("NO es un rol asignable desde el panel (el panel es de un solo rol)", () => {
    expect(isValidRol("riesgos")).toBe(false);
    expect(ROLES as readonly string[]).not.toContain("riesgos");
    // Y el alta la rechaza con el mismo mensaje que cualquier rol inválido.
    const r = validateCreateInput({
      email: "persona@gpa.com.mx",
      nombre: "Persona",
      rol: "riesgos",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("El rol debe ser uno de");
  });

  it("está declarada como credencial, aparte de los roles", () => {
    expect(CREDENCIALES as readonly string[]).toContain("riesgos");
    // Los dos conjuntos son disjuntos: una credencial nunca es un rol.
    for (const c of CREDENCIALES) expect(ROLES as readonly string[]).not.toContain(c);
  });

  // LA TRAMPA de este cambio. El tenant se deriva por descarte cuando el
  // idToken no trae `custom:tenantId`. Sin excluir la credencial, a la persona
  // de Riesgos se le derivaría `tenantId = "riesgos"` — un tenant fantasma.
  it("nunca se confunde con el TENANT en la derivación por descarte", () => {
    expect(esGrupoDeTenant("riesgos")).toBe(false);
    expect(esGrupoDeTenant("admin")).toBe(false);
    expect(esGrupoDeTenant("operativo")).toBe(false);
    expect(esGrupoDeTenant("viewer")).toBe(false);
    expect(esGrupoDeTenant("gpa")).toBe(true);

    // El caso real: Riesgos = operativo + riesgos + su tenant, en el orden en
    // que Cognito los entrega (la credencial ANTES del tenant es lo que rompía).
    expect(derivarTenantDeGrupos(["operativo", "riesgos", "gpa"])).toBe("gpa");
    expect(derivarTenantDeGrupos(["riesgos", "gpa"])).toBe("gpa");
    expect(derivarTenantDeGrupos(["admin", "gpa"])).toBe("gpa");
    // Sin ningún grupo de tenant, "" — nunca un rol ni una credencial.
    expect(derivarTenantDeGrupos(["operativo", "riesgos"])).toBe("");
    expect(derivarTenantDeGrupos([])).toBe("");
  });

  // `setUserRole` quita al usuario de todos los grupos de ROL antes de añadirlo
  // al nuevo. Si esa lista incluyera las credenciales, cambiar el rol de la
  // persona de Riesgos desde el panel le borraría su credencial en silencio.
  it("SOBREVIVE un cambio de rol hecho desde el panel (setUserRole solo recorre ROLES)", () => {
    const handlerSrc = readFileSync("amplify/functions/admin-users/handler.ts", "utf8");
    expect(handlerSrc).toMatch(/const ROLE_GROUPS = ROLES as readonly string\[\]/);
    expect(handlerSrc).not.toMatch(/ROLE_GROUPS\s*=\s*\[[^\]]*CREDENCIALES/);
    const i = handlerSrc.indexOf("async function setUserRole(");
    const cuerpo = handlerSrc.slice(i, handlerSrc.indexOf("\n}", i));
    // Solo se saca de los grupos de ROL; la credencial no se menciona siquiera.
    expect(cuerpo).toContain("for (const g of ROLE_GROUPS)");
    expect(cuerpo).not.toContain("CREDENCIALES");
    expect(cuerpo).not.toContain('"riesgos"');
  });

  it("el handler deriva el tenant con la función pura (no con un Set local que olvide la credencial)", () => {
    const handlerSrc = readFileSync("amplify/functions/admin-users/handler.ts", "utf8");
    expect(handlerSrc).toContain("derivarTenantDeGrupos(groups)");
    expect(handlerSrc).not.toContain("groups.find((g) => !roleSet.has(g))");
  });
});
