// Overlay de hallazgos AUTO-RESUELTOS por inspección posterior — capa pura.
//
// Spec: docs/superpowers/specs/2026-07-23-hallazgos-autoresueltos-design.md
// (rama feat/opsgpa-mensual, commits 1105f85/5b27970/09d6156; revisada
// adversarialmente). Regla: un hallazgo pendiente de una inspección pasada se
// muestra resuelto cuando la inspección más reciente de la misma placa que
// EVALUÓ ese punto ya no lo reporta. Decisión de Navares 2026-07-23 (no
// re-preguntar): derivado en memoria, JAMÁS persistido ni subido a la nube.
//
// Las entradas inyectadas {done:true, ts:<fecha de E>, by:"auto", auto:true}
// componen con la maquinaria existente sin tocar los ~14 call sites: el corte
// temporal de isFindingDone cubre las filas ≤ E y deja pendiente cualquier
// re-reporte posterior; el LWW por ts resuelve contra marcas humanas.
//
// NOTA evaluatedKeys (spec §4): la persistencia hacia adelante (analyzeRow +
// puente OpsGPA + webhook Lambda) queda DIFERIDA — tocar los Lambdas exige el
// handoff de seguridad. El régimen retro de evaluoKey cubre todas las filas
// actuales; cuando el pipeline escriba evaluatedKeys, este módulo ya lo honra.
//
// Sin acceso a window/IndexedDB (mismo patrón que mergeCheckDones).

import { findingKey, isoDayOf, resolveDoneEntry, type DoneEntry, type DoneMap } from "./findingKey";

/** Fila mínima de inspección que el overlay necesita (subset de Unit). */
export type AutoRow = {
  uid: string;
  plate?: string;
  fecha?: string;
  F: Array<{ key?: string; text: string }>;
  T?: Record<string, unknown>;
  evaluatedKeys?: string[];
  km?: number | string;
  kmNextSvc?: number | string;
  nextSvc?: string;
  validationErrors?: string[];
};

/** Elimina in-situ toda entrada auto:true. Devuelve los uids modificados.
 *  DEBE correr antes de mergeCheckDones en cada hidratación: un auto viejo
 *  bloquearía por LWW el re-merge de marcas humanas y sobreviviría a la
 *  anulación de su evidencia. */
export function purgeAutoEntries(cdb: Record<string, DoneMap>): string[] {
  const modified: string[] = [];
  for (const uid of Object.keys(cdb)) {
    const m = cdb[uid];
    if (!m) continue;
    let touched = false;
    for (const k of Object.keys(m)) {
      if (m[k]?.auto === true) {
        delete m[k];
        touched = true;
      }
    }
    if (touched) modified.push(uid);
  }
  return modified;
}

/** ¿La fila evaluó la key k? Filas con evaluatedKeys → lista literal. Filas
 *  legacy → régimen retro pragmático (decisión 2026-07-23): Llanta vía tires,
 *  Chk:Refaccion nunca (carve-out d0e7499), Mant:Servicio vía km/fecha,
 *  Bin:/Fluido: confiados (formulario obligatorio). Keys sin prefijo conocido
 *  (findings pre-C1 con texto display como identidad) → nunca. */
export function evaluoKey(row: AutoRow, k: string): boolean {
  if (Array.isArray(row.evaluatedKeys)) return row.evaluatedKeys.includes(k);
  if (k.startsWith("Llanta:")) {
    return Number.isFinite(row.T?.[k.slice("Llanta:".length)]);
  }
  if (k === "Chk:Refaccion") return false;
  if (k === "Mant:Servicio") {
    const km = parseFloat(String(row.km ?? "0"));
    const kmSig = parseFloat(String(row.kmNextSvc ?? "0"));
    if (km > 0 && kmSig > 0) return true;
    return isoDayOf(row.nextSvc) !== "";
  }
  return k.startsWith("Bin:") || k.startsWith("Fluido:");
}

/** Inyecta entradas auto en cdb (muta). Devuelve los uids modificados.
 *  Reglas de inyección (spec §2): nunca sobre done:true (atribución humana),
 *  nunca sobre entrada con ts >= fecha de la evidencia (tombstone posterior
 *  gana), respetando el dual-read key/alias de resolveDoneEntry. */
export function injectAutoResolve(opts: {
  rows: AutoRow[];
  cdb: Record<string, DoneMap>;
}): string[] {
  const { rows, cdb } = opts;

  const byPlate = new Map<string, AutoRow[]>();
  for (const r of rows) {
    const p = String(r.plate ?? "").trim();
    if (!p || p === "SIN_ID") continue;
    if (!isoDayOf(r.fecha)) continue;
    const arr = byPlate.get(p) ?? [];
    arr.push(r);
    byPlate.set(p, arr);
  }

  const modified = new Set<string>();
  for (const list of byPlate.values()) {
    if (list.length < 2) continue;
    // Desc por fecha: find() da la evidencia más reciente que evaluó la key.
    list.sort((a, b) => isoDayOf(b.fecha).localeCompare(isoDayOf(a.fecha)));
    const evidencia = list.filter((r) => !r.validationErrors?.length);

    for (const R of list) {
      const fechaR = isoDayOf(R.fecha);
      for (const f of R.F) {
        const k = findingKey(f);
        const E = evidencia.find((e) => isoDayOf(e.fecha) > fechaR && evaluoKey(e, k));
        if (!E) continue;
        if (E.F.some((g) => findingKey(g) === k)) continue; // sigue reportado
        const tsE = isoDayOf(E.fecha);
        const dm = (cdb[R.uid] ??= {});
        const eff = resolveDoneEntry(dm, f);
        if (eff?.done === true) continue; // atendido por humano — preservar
        if (eff && (eff.ts ?? "") >= tsE) continue; // tombstone posterior gana
        const entry: DoneEntry = { done: true, ts: tsE, by: "auto", auto: true };
        dm[k] = entry;
        modified.add(R.uid);
      }
    }
  }
  return [...modified];
}
