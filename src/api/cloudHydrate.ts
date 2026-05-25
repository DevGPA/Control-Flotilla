// Hydrate frontend state desde DynamoDB.
//
// Tras login, el frontend lee de cloud y reconstruye los objetos Unit del
// legacy (window.units + checklistDB) mergeando Unit catalog + Checklist
// resultados. Esto permite que cualquier usuario del tenant vea los mismos
// datos sin necesidad de re-subir el ZIP.
//
// Mapping cloud → legacy:
// - cloud.Unit (catálogo)     → legacy.{uid, plate, brand, branch}
// - cloud.Checklist.resultados → legacy.{F, T, risk, minT, obs, km, nextSvc, kmNextSvc}
//
// Triggers re-render de la UI legacy llamando window.renderTable / buildKPIs.

import type { Schema } from "./amplifyClient";
import { listUnits, listChecklists, listSemanales } from "./client";
import { batchGetCloudPhotoUrls, indexCloudPhotos } from "./photoFetch";
import type { Unit, Finding, RiskLevel, ChecklistDB, WeeklyEntry } from "../types";
import type { WeeklyPeriodo } from "../weekly/weeklyStore";

interface ChecklistResultados {
  findings?: unknown[];
  tires?: Record<string, number>;
  risk?: string;
  max?: string;
  minT?: number | null;
  obs?: string;
  km?: number | string;
  nextSvc?: string;
  kmNextSvc?: number | string;
  validationErrors?: string[];
  photos?: unknown[];
}

const VALID_RISKS: ReadonlySet<RiskLevel> = new Set<RiskLevel>([
  "Urgente",
  "Revisar",
  "Completar",
  "OK",
]);
function asRisk(v: unknown): RiskLevel | undefined {
  const s = String(v ?? "");
  return VALID_RISKS.has(s as RiskLevel) ? (s as RiskLevel) : undefined;
}

declare global {
  interface Window {
    buildAnalytics?: () => void;
    buildAlertsSummary?: () => void;
    buildKPIs?: () => void;
    showDash?: () => void;
    renderDet?: () => void;
    weeklyPeriodos?: WeeklyPeriodo[];
    activeWeeklyPeriodoId?: string | null;
    updateSwNavBadge?: () => void;
    /** Mapa filename → S3 presigned URL pre-fetched al hydrate. Lo lee legacy imgUrl. */
    __cloudPhotoUrlMap?: Map<string, string>;
  }
}

function periodoLabelFromId(id: string): string {
  // "2026-W21" → "Semana 21, 2026"
  const m = id.match(/^(\d{4})-W(\d{1,2})$/);
  if (m) return `Semana ${parseInt(m[2]!, 10)}, ${m[1]}`;
  return id;
}

function parseResultados(raw: unknown): ChecklistResultados {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ChecklistResultados;
    } catch {
      return {};
    }
  }
  return raw as ChecklistResultados;
}

function mergeUnitWithChecklist(
  unit: Schema["Unit"]["type"],
  checklist: Schema["Checklist"]["type"] | undefined,
): Unit {
  const r = parseResultados(checklist?.resultados);
  const risk = (r.risk ?? r.max ?? "OK") as RiskLevel;
  const findings = (Array.isArray(r.findings) ? r.findings : []) as Finding[];
  // economicoId es el ID interno GPA (numérico tipo "78"). Fallback a placa si
  // el upload no lo guardó (rows viejas) — preserva render legacy `u.eco || u.plate`.
  const ecoId = unit.economicoId || unit.placa;
  return {
    uid: unit.placa,
    eco: ecoId,
    plate: unit.placa,
    brand: unit.marca ?? undefined,
    branch: unit.sucursal ?? undefined,
    insp: checklist?.responsable ?? "",
    fecha: checklist?.fecha ?? "",
    km: r.km ?? "",
    obs: r.obs ?? "",
    obsArr: r.obs ? r.obs.split("\n\n").filter(Boolean) : [],
    nextSvc: r.nextSvc ?? "",
    kmNextSvc: r.kmNextSvc ?? "",
    risk,
    F: findings,
    T: r.tires ?? {},
    minT: r.minT ?? null,
    photos: Array.isArray(r.photos) ? r.photos : [],
    hasRefaccion: true,
  };
}

/**
 * Lee Units + Checklists del cloud, los merge en LegacyUnit[] y los inyecta
 * en window.units. Trigger re-render de la UI.
 *
 * Llamar SOLO si hay sesión activa con tenantId válido.
 * Idempotente: re-correr reemplaza state actual con data fresca del cloud.
 */
export async function hydrateFromCloud(tenantId: string): Promise<{
  units: number;
  source: "cloud" | "empty";
}> {
  const [units, checklists, semanales] = await Promise.all([
    listUnits(tenantId),
    listChecklists(tenantId),
    listSemanales(tenantId),
  ]);

  if (units.length === 0 && semanales.length === 0) {
    console.info("[cloudHydrate] cloud vacío, nada que hidratar");
    return { units: 0, source: "empty" };
  }

  // ── Hydrate semanales → window.weeklyPeriodos ──────────────────
  // Agrupa entries por periodoId. Cada Semanal row es una entry de una unidad
  // en un período (semana ISO). Reconstruimos el shape legacy {id, label, entries}.
  if (semanales.length > 0) {
    const periodoMap = new Map<string, WeeklyEntry[]>();
    for (const s of semanales) {
      const d = (s.datos ?? {}) as Record<string, unknown>;
      const datos = typeof s.datos === "string" ? (JSON.parse(s.datos) as Record<string, unknown>) : d;
      // economicoId desde datos JSON (Excel "# Economico - id"). Fallback a
      // placa si upload viejo no lo guardó.
      const ecoId = String(datos.economicoId ?? "").trim() || s.unitUid;
      const entry: WeeklyEntry = {
        uid: s.unitUid,
        eco: ecoId,
        plate: s.unitUid,
        brand: String(datos.brand ?? ""),
        branch: s.sucursal,
        km: (datos.km as number | string) ?? "",
        fecha: String(datos.fecha ?? ""),
        responsable: String(datos.responsable ?? ""),
        aceite: String(datos.aceite ?? ""),
        aceiteRisk: asRisk(datos.aceiteRisk),
        radiador: String(datos.radiador ?? ""),
        radiadorRisk: asRisk(datos.radiadorRisk),
        carroceria: String(datos.carroceria ?? ""),
        carroceriaRisk: asRisk(datos.carroceriaRisk),
        llanta: String(datos.llanta ?? ""),
        llantaRisk: asRisk(datos.llantaRisk),
        risk: asRisk(datos.risk) ?? "OK",
        photos: Array.isArray(datos.photos) ? (datos.photos as string[]) : [],
      };
      const arr = periodoMap.get(s.periodoId) ?? [];
      arr.push(entry);
      periodoMap.set(s.periodoId, arr);
    }
    const weeklyPeriodos: WeeklyPeriodo[] = [...periodoMap.entries()]
      .map(([id, entries]) => ({
        id,
        label: periodoLabelFromId(id),
        uploadedAt: new Date().toISOString(),
        entries,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    window.weeklyPeriodos = weeklyPeriodos;
    if (weeklyPeriodos.length > 0) {
      window.activeWeeklyPeriodoId = weeklyPeriodos[weeklyPeriodos.length - 1]!.id;
    }
    if (typeof window.updateSwNavBadge === "function") window.updateSwNavBadge();
    console.info(`[cloudHydrate] ${weeklyPeriodos.length} períodos semanales hidratados`);
  }

  // No early-exit aquí. Aunque units.length === 0, semanales puede tener
  // fotos que necesitan pre-fetch. Continuamos con un legacyUnits vacío.

  // Index checklists por placa para lookup O(1).
  const checklistByUnit = new Map<string, Schema["Checklist"]["type"]>();
  for (const c of checklists) {
    const existing = checklistByUnit.get(c.unitUid);
    // Si hay múltiples checklists por unidad (varios meses), tomar el más reciente.
    if (!existing || (c.fecha ?? "") > (existing.fecha ?? "")) {
      checklistByUnit.set(c.unitUid, c);
    }
  }

  const legacyUnits = units.map((u) => mergeUnitWithChecklist(u, checklistByUnit.get(u.placa)));

  // Inyectar al state legacy.
  window.units = legacyUnits;
  if (!window.checklistDB) window.checklistDB = {} as ChecklistDB;
  const db = window.checklistDB;
  for (const u of legacyUnits) {
    if (!db[u.uid]) db[u.uid] = {};
  }

  // Pre-fetch URLs firmadas de S3 para TODAS las fotos (mensual + semanal).
  // Esto evita que imgUrl/weeklyImgUrl (sync) tengan que esperar — las URLs
  // ya están en cache al momento de renderear. Habilita lightbox, gallery,
  // thumbnails para multi-user en ambos modos.
  const allPhotoFnames = new Set<string>();
  for (const u of legacyUnits) {
    for (const p of u.photos ?? []) {
      const fn = (p as { fname?: string }).fname;
      if (fn) allPhotoFnames.add(fn.toLowerCase());
    }
  }
  // Semanales: cada entry tiene array de filenames raw (string[]).
  for (const periodo of window.weeklyPeriodos ?? []) {
    for (const entry of periodo.entries ?? []) {
      for (const fn of entry.photos ?? []) {
        if (fn) allPhotoFnames.add(String(fn).toLowerCase());
      }
    }
  }
  if (allPhotoFnames.size > 0) {
    try {
      // CRÍTICO: indexar S3 ANTES de batchGetCloudPhotoUrls.
      // batchGet usa hasCloudPhoto que consulta el index cache. Sin index
      // cargado, todas las URLs retornan null → map vacío (race condition
      // que dejaba multi-user sin fotos).
      await indexCloudPhotos(tenantId);
      const urlMap = await batchGetCloudPhotoUrls(tenantId, [...allPhotoFnames]);
      window.__cloudPhotoUrlMap = window.__cloudPhotoUrlMap ?? new Map<string, string>();
      let count = 0;
      for (const [fname, url] of urlMap) {
        if (url) {
          window.__cloudPhotoUrlMap.set(fname, url);
          count++;
        }
      }
      console.info(`[cloudHydrate] ${count}/${allPhotoFnames.size} URLs de fotos pre-cacheadas`);
    } catch (err) {
      console.warn("[cloudHydrate] photo URLs prefetch falló:", err);
    }
  }

  // Trigger re-render del legacy. Sin esto, UI sigue vacía aunque state esté lleno.
  if (typeof window.showDash === "function") window.showDash();
  if (typeof window.buildKPIs === "function") window.buildKPIs();
  if (typeof window.renderTable === "function") window.renderTable();
  if (typeof window.buildAlertsSummary === "function") window.buildAlertsSummary();
  if (typeof window.buildAnalytics === "function") window.buildAnalytics();
  // Re-render detail panel si está abierto — sin esto las fotos en panel
  // mantienen src vacío de cuando el URL map todavía no se había poblado.
  if (typeof window.renderDet === "function") window.renderDet();

  console.info(`[cloudHydrate] ${legacyUnits.length} units hidratados del cloud`);
  return { units: legacyUnits.length, source: "cloud" };
}
