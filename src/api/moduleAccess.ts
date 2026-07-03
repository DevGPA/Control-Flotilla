/**
 * Acceso por módulo por usuario — lógica PURA (sin DOM), testeable y compartida.
 *
 * Gating de UI: el admin asigna a cada usuario qué módulos ve (atributo Cognito
 * `custom:modulos`, CSV). Sin asignación = todos (backward-compatible). El admin
 * siempre ve todo. NO es frontera de seguridad dura: el dato sigue protegido por
 * tenant + rol + sucursal en AppSync.
 */

// ⚠️ FUENTE DE VERDAD de los módulos limitables por usuario. Al agregar un módulo
// nuevo, añádelo AQUÍ (a las tres estructuras) y quedará automáticamente: (1) gateado
// en el nav por gatingPlan y (2) como checkbox en el modal de Usuarios (que se genera
// dinámicamente desde esta lista, ver openUsuarioModal en el HTML). No hardcodear
// módulos en el HTML ni en otros lados.
export const ASSIGNABLE_MODULES = [
  "inspecciones",
  "taller",
  "semanales",
  "analytics",
  "combustible",
  "cumplimiento",
] as const;
export type ModuleKey = (typeof ASSIGNABLE_MODULES)[number];

/** módulo → id del botón de nav (`.mnav`) en el HTML. */
export const MODULE_NAV: Record<ModuleKey, string> = {
  inspecciones: "mn-insp",
  taller: "mn-taller",
  semanales: "mn-semanales",
  analytics: "mn-analytics",
  combustible: "mn-combustible",
  cumplimiento: "mn-cumplimiento",
};

/** módulo → etiqueta visible en el modal de Usuarios (checkbox). */
export const MODULE_LABEL: Record<ModuleKey, string> = {
  inspecciones: "Inspecciones",
  taller: "Taller",
  semanales: "Semanales",
  analytics: "Análisis",
  combustible: "Combustible",
  cumplimiento: "Cumplimiento",
};

function isModuleKey(s: string): s is ModuleKey {
  return (ASSIGNABLE_MODULES as readonly string[]).includes(s);
}

/**
 * CSV de `custom:modulos` → lista de módulos. Devuelve `null` cuando no hay
 * asignación (vacío/undefined) o cuando ningún token es válido → significa
 * "todos los módulos" (no bloquear por dato ausente o corrupto).
 */
export function parseModulos(csv: string | undefined | null): ModuleKey[] | null {
  if (!csv) return null;
  const valid = csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter(isModuleKey);
  return valid.length ? [...new Set(valid)] : null;
}

export type GatingPlan = {
  /** ids de botones de nav a ocultar */
  hidden: string[];
  /** vista a la que redirigir si la actual no está permitida (null = quedarse) */
  redirectTo: ModuleKey | null;
};

/**
 * Decide el gating de UI. `isAdmin` o `modulos==null` → sin gating (todo visible).
 * Si la `currentView` no está permitida, redirige al primer módulo permitido.
 */
export function gatingPlan(
  modulos: ModuleKey[] | null,
  isAdmin: boolean,
  currentView: string,
): GatingPlan {
  if (isAdmin || modulos == null) return { hidden: [], redirectTo: null };
  const allowed = new Set<string>(modulos);
  const hidden = ASSIGNABLE_MODULES.filter((m) => !allowed.has(m)).map((m) => MODULE_NAV[m]);
  const redirectTo = allowed.has(currentView) ? null : (modulos[0] ?? null);
  return { hidden, redirectTo };
}
