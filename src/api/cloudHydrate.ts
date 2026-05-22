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
import { listUnits, listChecklists } from "./client";
import type { Unit, Finding, RiskLevel, ChecklistDB } from "../types";

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

declare global {
  interface Window {
    buildAnalytics?: () => void;
    buildAlertsSummary?: () => void;
    buildKPIs?: () => void;
    showDash?: () => void;
  }
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
  return {
    uid: unit.placa,
    eco: unit.placa,
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
  const [units, checklists] = await Promise.all([
    listUnits(tenantId),
    listChecklists(tenantId),
  ]);

  if (units.length === 0) {
    console.info("[cloudHydrate] cloud vacío, nada que hidratar");
    return { units: 0, source: "empty" };
  }

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

  // Trigger re-render del legacy. Sin esto, UI sigue vacía aunque state esté lleno.
  if (typeof window.showDash === "function") window.showDash();
  if (typeof window.buildKPIs === "function") window.buildKPIs();
  if (typeof window.renderTable === "function") window.renderTable();
  if (typeof window.buildAlertsSummary === "function") window.buildAlertsSummary();
  if (typeof window.buildAnalytics === "function") window.buildAnalytics();

  console.info(`[cloudHydrate] ${legacyUnits.length} units hidratados del cloud`);
  return { units: legacyUnits.length, source: "cloud" };
}
