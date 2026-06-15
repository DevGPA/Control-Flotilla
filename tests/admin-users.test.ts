// Tests de la lógica pura del módulo de Administración de Usuarios (2026-06-12).
// Cubre validación de alta (dominio @gpa.com.mx, rol, campos), construcción del
// evento de auditoría, diff de perfil y mapeo de errores de Cognito. El handler
// que toca Cognito/DynamoDB se valida en sandbox (igual que el webhook).

import { describe, expect, it } from "vitest";
import {
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
