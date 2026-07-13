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
import {
  listUnits,
  listChecklists,
  listSemanales,
  listTaller,
  listCheckDone,
  listCombustible,
  listCombustibleRange,
  listValidaciones,
  listComplianceDocs,
  listAnulaciones,
} from "./client";
import {
  buildAnuladasActivas,
  refIdChecklist,
  refIdSemanal,
  type AnulacionInfo,
} from "../anulacion/anulacion";
import { buildFuelEntries } from "../fuel/mapEntry";
import { buildComplianceEntries } from "../compliance/mapEntry";
import type { FuelEntry } from "../fuel/types";
import { batchGetCloudPhotoUrls, refreshPhotoUrls, type PhotoUrlEntry } from "./photoFetch";
import { uploadTallerToCloud } from "./batchUpload";
import { dedupTallerCloudRows } from "./tallerDedup";
import { mergeCheckDones } from "./mergeCheckDones";
import type { DoneMap } from "../analyzer/findingKey";
import type { Unit, Finding, RiskLevel, ChecklistDB, WeeklyEntry } from "../types";
import type { WeeklyPeriodo } from "../weekly/weeklyStore";
import type { TallerEntry, TallerEstado } from "../taller/types";
import { migrateEstado } from "../taller/types";

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
  moreappId?: string;
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
    /** Perf F1-4: firma del último snapshot cloud hidratado (cuenta+max updatedAt por
     *  modelo). Si el siguiente fetch da la misma firma, se omite rebuild+render. */
    __lastHydrateSig?: string;
    buildBranches?: () => void;
    showDash?: () => void;
    renderDet?: () => void;
    // checklistDB (completaciones, bridged al monolito) ya está declarado en main.ts como ChecklistDB.
    weeklyPeriodos?: WeeklyPeriodo[];
    activeWeeklyPeriodoId?: string | null;
    updateSwNavBadge?: () => void;
    tallerEntries?: TallerEntry[];
    updateTallerBadge?: () => void;
    renderTaller?: () => void;
    /** Mapa filename → {url firmada, expires}. Lo lee legacy imgUrl, que descarta las
     *  vencidas (las URLs firmadas de S3 expiran ≈15min). */
    __cloudPhotoUrlMap?: Map<string, PhotoUrlEntry>;
    // periodos / activePeriodoId / renderPeriodoBar / switchPeriodo: declarados en main.ts.
    // Vista de rango de fechas: todas las inspecciones (1 fila por checklist).
    __inspections?: Unit[];
    __inspMinDate?: string;
    __inspMaxDate?: string;
    applyDateRange?: (fromISO: string, toISO: string) => void;
    initRangoBar?: () => void;
    // Flota: unidades distintas (catálogo) con última inspección — para KPIs hero + dona.
    __fleetUnits?: Unit[];
    /** Anulaciones ACTIVAS (refId → info). Overlay admin que excluye registros de los
     *  cálculos; lo consumen combustible (tag en FuelEntry) y los módulos legacy. */
    __anuladasActivas?: Map<string, AnulacionInfo>;
    // Fase C1: registro de toggles locales recientes ("placa key" → ts) que el
    // merge respeta; lo escribe cloudWire.__cloudSetCheck.
    __checkDirty?: Record<string, string>;
    // Funciones globales del script legacy (function declarations → window.*).
    dbPut?: (store: string, key: string, value: unknown) => Promise<unknown>;
    recalcAllRisks?: () => void;
    initRangoSemanal?: () => void;
    renderSemanales?: () => void;
    // Módulo de combustible (Fase B).
    fuelEntries?: FuelEntry[];
    renderCombustible?: () => void;
    updateFuelNavBadge?: () => void;
    initRangoFuel?: () => void;
  }
}

/** Deriva "YYYY-MM" de una fecha de checklist (ISO YYYY-MM-DD o legacy DD/MM/YYYY). */
function monthOf(fecha: string | null | undefined): string | null {
  const s = String(fecha ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}`;
  return null;
}

/** Normaliza una fecha de checklist a ISO YYYY-MM-DD para ORDENAR/COMPARAR.
 * Acepta ISO (passthrough) o legacy DD/MM/YYYY. "" si no parseable. NO se usa
 * para construir uids ni el campo `fecha` mostrado, para no re-keyear los
 * CheckDones existentes (cuya llave depende del uid `placa__fecha`). */
function isoDay(fecha: string | null | undefined): string {
  const s = String(fecha ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return "";
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

// Parseo defensivo de campos AWSJSON (datos de Taller/Semanal). Si el string está
// corrupto (ej. rollback parcial dejó JSON incompleto), devuelve {} en vez de
// tirar toda la hidratación con un throw.
function safeParseObj(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * ¿La unidad es un montacargas? En la flota GPA el producto Gas LP ⇒ montacargas
 * (mismo criterio que el módulo de Combustible, `mapEntry.deriveTipo`). Cubre las grafías
 * "TOKA COMBUSTIBLE GAS LP CHIP" y "EASYGAS LP CHIP" (ambas contienen "gas lp" en minúsculas).
 */
export function esMontacargasProducto(productoToka: string | null | undefined): boolean {
  return String(productoToka ?? "")
    .toLowerCase()
    .includes("gas lp");
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
    folio: r.moreappId ?? "",
    photos: Array.isArray(r.photos) ? r.photos : [],
    hasRefaccion: true,
    esMontacargas: esMontacargasProducto(unit.productoToka),
  };
}

/**
 * Perf F1-4: firma barata del snapshot cloud para detectar "nada cambió" y saltar el
 * rebuild+render (la parte que congela el hilo cada 4min/focus/evento live). Cuenta +
 * max(updatedAt) por modelo detecta altas, bajas y ediciones sin serializar los items
 * (los modelos Amplify siempre tienen updatedAt automático). Exportada para tests.
 */
export function hydrateSignature(
  lists: ReadonlyArray<ReadonlyArray<{ readonly updatedAt?: string | null }>>,
): string {
  return lists
    .map((arr) => {
      let max = "";
      for (const it of arr) {
        const u = it.updatedAt ?? "";
        if (u > max) max = u;
      }
      return `${arr.length}:${max}`;
    })
    .join("|");
}

// ── Perf F3-1: ventana de hidratación de combustible ─────────────────────────
// CargaCombustible es la única tabla que crece a diario (~1k filas/mes). En vez de
// descargar el histórico completo en cada hidratación, se trae solo la ventana
// visible (default: últimos FUEL_WINDOW_DAYS, alineado con el rango default de la
// UI de Combustible) vía Query al GSI byTenantAndFecha. Si el usuario amplía el
// rango de fechas más atrás, ensureFuelWindow() trae el tramo faltante UNA vez y
// la frontera queda ampliada para los siguientes auto-refresh de la sesión.
const FUEL_WINDOW_DAYS = 92;
// Frontera superior fija: incluye cargas con fecha futura por error de captura
// (mismo comportamiento que el Scan completo previo). La ventana solo se acota
// por atrás.
const FUEL_WINDOW_TO = "9999-12-31";
let fuelWindowFrom: string | null = null;
// Insumos del último hydrate — ensureFuelWindow reconstruye fuelEntries sin
// re-descargar validaciones/unidades/anulaciones (cambian poco; el próximo
// hydrate completo las refresca).
let fuelRaw: Schema["CargaCombustible"]["type"][] = [];
let fuelDeps: {
  tenantId: string;
  validaciones: Schema["ValidacionCarga"]["type"][];
  unidadPorEco: Map<string, { submarca?: string; area?: string }>;
  anuladasActivas: Map<string, AnulacionInfo>;
} | null = null;

/** Hoy en zona México menos FUEL_WINDOW_DAYS, en YYYY-MM-DD (formato de `fecha`). */
function defaultFuelWindowFrom(): string {
  const d = new Date(Date.now() - FUEL_WINDOW_DAYS * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

const fuelKey = (r: Schema["CargaCombustible"]["type"]): string =>
  `${r.economicoId}|${r.tipo}|${r.eventoId}`;

// Serializa las ampliaciones (el rango de la UI puede moverse varias veces rápido).
let ensureFuelChain: Promise<boolean> = Promise.resolve(false);

/**
 * Amplía la ventana de combustible hacia atrás hasta cubrir `fromISO` (YYYY-MM-DD).
 * Trae SOLO el tramo faltante, lo mergea al crudo acumulado y reconstruye
 * window.fuelEntries (referencia nueva → el memo del módulo de combustible se
 * invalida solo). Devuelve true si amplió. No-op si la ventana ya cubre la fecha
 * o si aún no corre la primera hidratación.
 */
export function ensureFuelWindow(fromISO: string): Promise<boolean> {
  const next = ensureFuelChain
    .catch(() => false)
    .then(async () => {
      const from = String(fromISO ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return false;
      if (!fuelDeps || fuelWindowFrom === null || from >= fuelWindowFrom) return false;
      // Tramo faltante: [from, fuelWindowFrom) — between es inclusivo, así que el tope
      // es el día anterior a la frontera actual.
      const upper = new Date(new Date(fuelWindowFrom + "T12:00:00Z").getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      let tramo: Schema["CargaCombustible"]["type"][];
      try {
        tramo = await listCombustibleRange(fuelDeps.tenantId, from, upper);
      } catch (e) {
        console.warn("[ensureFuelWindow] fetch del tramo falló (no-fatal):", e);
        return false;
      }
      fuelWindowFrom = from;
      if (tramo.length) {
        const seen = new Set(fuelRaw.map(fuelKey));
        for (const r of tramo) if (!seen.has(fuelKey(r))) fuelRaw.push(r);
      }
      const entries = buildFuelEntries(
        fuelRaw,
        fuelDeps.validaciones,
        fuelDeps.unidadPorEco,
        fuelDeps.anuladasActivas,
      );
      window.fuelEntries = entries;
      if (typeof window.updateFuelNavBadge === "function") window.updateFuelNavBadge();
      if (typeof window.renderCombustible === "function") window.renderCombustible();
      console.info(
        `[ensureFuelWindow] ventana ampliada a ${from} (+${tramo.length} filas, total ${fuelRaw.length})`,
      );
      return true;
    });
  ensureFuelChain = next;
  return next;
}

/**
 * Perf F3-4: refresco EN VIVO solo del módulo de combustible. Cuando el evento live
 * es de CargaCombustible/ValidacionCarga (ráfagas del webhook/puente Ops), no hace
 * falta re-descargar los 9 modelos: se re-consulta la ventana (Query al GSI, barata)
 * + las validaciones, se reconstruye fuelEntries y se re-renderiza el módulo.
 * Devuelve false si aún no corrió la primera hidratación o si falló (el caller debe
 * hacer el hydrate completo como fallback).
 */
export function refreshFuelOnly(): Promise<boolean> {
  const next = ensureFuelChain
    .catch(() => false)
    .then(async () => {
      if (!fuelDeps || fuelWindowFrom === null) return false;
      const deps = fuelDeps;
      try {
        const [combustible, validaciones] = await Promise.all([
          listCombustibleRange(deps.tenantId, fuelWindowFrom, FUEL_WINDOW_TO),
          listValidaciones(deps.tenantId),
        ]);
        fuelRaw = [...combustible];
        fuelDeps = { ...deps, validaciones };
        const entries = buildFuelEntries(
          fuelRaw,
          validaciones,
          deps.unidadPorEco,
          deps.anuladasActivas,
        );
        window.fuelEntries = entries;
        if (typeof window.updateFuelNavBadge === "function") window.updateFuelNavBadge();
        if (typeof window.renderCombustible === "function") window.renderCombustible();
        console.info(`[refreshFuelOnly] ${entries.length} registros (live, ventana)`);
        return true;
      } catch (e) {
        console.warn("[refreshFuelOnly] falló — fallback a hydrate completo:", e);
        return false;
      }
    });
  ensureFuelChain = next;
  return next;
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
  const [
    units,
    checklists,
    semanales,
    tallerCloud,
    checkDones,
    combustible,
    validaciones,
    complianceDocs,
    anulaciones,
  ] = await Promise.all([
    listUnits(tenantId),
    listChecklists(tenantId),
    listSemanales(tenantId),
    listTaller(tenantId),
    // No-fatal: si CheckDone aún no está desplegado o falla, no debe tumbar toda la
    // hidratación de datos (units/checklists). Las completaciones son una mejora encima.
    listCheckDone(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listCheckDone falló (no-fatal):", e);
      return [] as Schema["CheckDone"]["type"][];
    }),
    // No-fatal: el módulo de combustible es independiente; si falla no tumba el resto.
    // Perf F3-1: por VENTANA de fechas (Query al GSI byTenantAndFecha) en vez de Scan
    // del histórico completo — es la tabla más grande (~1k filas/mes). Fallback al
    // Scan completo si la index query falla (p.ej. GSI recién creado aún en backfill
    // durante el primer deploy, o cliente corriendo contra un backend sin el índice).
    listCombustibleRange(tenantId, fuelWindowFrom ?? defaultFuelWindowFrom(), FUEL_WINDOW_TO)
      .catch((e) => {
        console.warn("[cloudHydrate] listCombustibleRange falló — fallback a Scan completo:", e);
        return listCombustible(tenantId);
      })
      .catch((e) => {
        console.warn("[cloudHydrate] listCombustible falló (no-fatal):", e);
        return [] as Schema["CargaCombustible"]["type"][];
      }),
    listValidaciones(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listValidaciones falló (no-fatal):", e);
      return [] as Schema["ValidacionCarga"]["type"][];
    }),
    // No-fatal: el módulo de cumplimiento es independiente y su modelo puede aún NO
    // estar desplegado → devolver [] para no tumbar la hidratación del resto.
    listComplianceDocs(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listComplianceDocs falló (no-fatal):", e);
      return [] as Schema["ComplianceDoc"]["type"][];
    }),
    // No-fatal: las anulaciones son un overlay; si el modelo aún no está desplegado,
    // nada se excluye (comportamiento previo intacto).
    listAnulaciones(tenantId).catch((e) => {
      console.warn("[cloudHydrate] listAnulaciones falló (no-fatal):", e);
      return [] as Schema["Anulacion"]["type"][];
    }),
  ]);

  // Índice refId → info de anulaciones ACTIVAS (las restauradas no excluyen). Se expone
  // en window para los módulos legacy (Inspecciones/Semanales) y se aplica aquí abajo.
  const anuladasActivas = buildAnuladasActivas(anulaciones);
  window.__anuladasActivas = anuladasActivas;
  // Checklists VIGENTES: los anulados por admin salen de TODA construcción de vistas
  // (inspecciones por rango, última inspección por unidad, flota, fallback). Combustible
  // etiqueta en vez de filtrar (tiene vista "Anuladas" propia); semanales filtra en su loop.
  const checklistsVigentes = checklists.filter(
    (c) => !anuladasActivas.has(refIdChecklist(String(c.unitUid), String(c.fecha ?? ""))),
  );

  if (
    units.length === 0 &&
    semanales.length === 0 &&
    tallerCloud.length === 0 &&
    combustible.length === 0
  ) {
    console.info("[cloudHydrate] cloud vacío, nada que hidratar");
    return { units: 0, source: "empty" };
  }

  // Perf F1-4: si el snapshot cloud es IDÉNTICO al de la última hidratación, el estado en
  // window.* y el DOM ya reflejan estos datos → saltar TODO el rebuild + render (parse de
  // miles de blobs + reconstrucción de 6 módulos), que es la tarea síncrona que congela el
  // hilo en cada poll/focus/evento live cuando en realidad nada cambió. Las fotos se
  // re-firman por-demanda al verse (imgUrl → lazyObserver → __cloudGetPhotoUrl), así que
  // omitir el pre-firmado proactivo no rompe evidencias. El primer hydrate (sig undefined)
  // y cualquier cambio real (alta/baja/edición → cambia cuenta o max updatedAt) sí procede.
  const snapshotSig = hydrateSignature([
    units,
    checklists,
    semanales,
    tallerCloud,
    checkDones,
    combustible,
    validaciones,
    complianceDocs,
    anulaciones,
  ]);
  if (window.__lastHydrateSig === snapshotSig) {
    console.info("[cloudHydrate] snapshot sin cambios — omito rebuild+render");
    const wu = (window as unknown as { units?: unknown[] }).units;
    return { units: Array.isArray(wu) ? wu.length : 0, source: "cloud" };
  }
  window.__lastHydrateSig = snapshotSig;

  // ── Auto-migración: tallerEntries locales (IndexedDB) NO en cloud → push ──
  // Si el user creó registros antes de la wire cloud (Taller wire fue Fase 10),
  // los entries viven solo en IndexedDB. Detectamos por id no presente en cloud
  // y los subimos automáticamente. Idempotente: misma key compuesta sobrescribe.
  const localTaller = window.tallerEntries ?? [];
  if (localTaller.length > 0) {
    const cloudIds = new Set<string>();
    for (const t of tallerCloud) {
      const datos = safeParseObj(t.datos);
      const id = String(datos.id ?? t.folio ?? "");
      if (id) cloudIds.add(id);
    }
    // Fase C2 (guarda anti-resurrección): NO re-subir entries que YA estuvieron
    // en el cloud (`_cloud:true`, marcado al hidratar). Sin esto, cuando un
    // usuario A borraba un registro, el usuario B —con la copia en su IndexedDB—
    // lo re-subía como "huérfano" en su próximo hydrate y el registro resucitaba.
    const orphans = localTaller.filter(
      (e) => !cloudIds.has(e.id) && !(e as { _cloud?: boolean })._cloud,
    );
    if (orphans.length > 0) {
      console.info(`[cloudHydrate] migrando ${orphans.length} taller entries locales al cloud`);
      try {
        await uploadTallerToCloud(
          orphans.map((e) => {
            // Cast: legacy entries pueden tener campos extra (km, etc) no en TallerEntry type.
            const raw = e as TallerEntry & Record<string, unknown>;
            return {
              id: raw.id,
              unitKey: raw.unitKey,
              eco: raw.eco,
              plate: raw.plate,
              brand: raw.brand,
              sucursal: raw.sucursal,
              area: raw.area,
              estado: raw.estado,
              tipo: raw.tipo,
              freporte: raw.freporte,
              fentrada: raw.fentrada,
              fsalidaEst: raw.fsalidaEst,
              fsalidaReal: raw.fsalidaReal,
              km: typeof raw.km === "number" ? raw.km : 0,
              gasto: raw.gasto,
              gastoRef: raw.gastoRef,
              gastoMO: raw.gastoMO,
              tecnico: raw.tecnico,
              refacciones: raw.refacciones,
              comentario: raw.comentario,
              updatedAt: raw.updatedAt,
            };
          }),
          tenantId,
        );
        // Re-fetch tallerCloud para incluir los migrados.
        const refreshed = await listTaller(tenantId);
        tallerCloud.length = 0;
        tallerCloud.push(...refreshed);
        window.notify?.(`☁ ${orphans.length} registros de taller migrados al servidor`, "ok", 4000);
      } catch (err) {
        console.error("[cloudHydrate] migración taller falló:", err);
      }
    }
  }

  // ── Hydrate taller → window.tallerEntries ──────────────────
  // Cada Taller row reconstruye TallerEntry legacy desde datos JSON.
  // Fase C2: dedup en lectura — los re-keys históricos dejaron filas duplicadas
  // del mismo registro; la vista muestra UNA por id (gana la más reciente).
  // El reemplazo corre SIEMPRE (incluso con 0 filas): si otro usuario borró el
  // último registro, la copia en RAM de los demás también debe desaparecer.
  // El cloud es autoritativo aquí — la auto-migración (arriba) ya re-subió los
  // huérfanos legítimos pre-cloud, y el early-return de "cloud 100% vacío"
  // protege a tenants nuevos sin tocar su estado local.
  {
    const dedupedTaller = dedupTallerCloudRows(tallerCloud);
    if (dedupedTaller.length < tallerCloud.length) {
      console.info(
        `[cloudHydrate] taller dedup: ${tallerCloud.length - dedupedTaller.length} fila(s) duplicada(s) ocultas`,
      );
    }
    const tallerEntries: TallerEntry[] = dedupedTaller.map((t) => {
      const datos = safeParseObj(t.datos);
      const estadoRaw = datos.estado ?? (t.estatus === "cerrado" ? "Finalizado" : "En Diagnóstico");
      const estado: TallerEstado = migrateEstado(estadoRaw);
      return {
        id: String(datos.id ?? t.folio ?? `${t.unitUid}_${t.fechaEntrada}`),
        unitKey: String(datos.unitKey ?? t.unitUid),
        eco: String(datos.eco ?? ""),
        plate: String(datos.plate ?? t.unitUid),
        brand: String(datos.brand ?? ""),
        sucursal: String(datos.sucursal ?? ""),
        area: String(datos.area ?? ""),
        tipo: String(datos.tipo ?? t.motivo ?? ""),
        estado,
        freporte: String(datos.freporte ?? ""),
        fentrada: String(datos.fentrada ?? t.fechaEntrada),
        fsalidaEst: String(datos.fsalidaEst ?? ""),
        fsalidaReal: String(datos.fsalidaReal ?? t.fechaSalida ?? ""),
        km: Number(datos.km) || 0,
        gasto: Number(datos.gasto) || 0,
        gastoRef: Number(datos.gastoRef) || 0,
        gastoMO: Number(datos.gastoMO) || 0,
        tecnico: String(datos.tecnico ?? ""),
        refacciones: String(datos.refacciones ?? ""),
        comentario: String(datos.comentario ?? ""),
        updatedAt: String(datos.updatedAt ?? ""),
        // Marca "ya estuvo en cloud" — la auto-migración no lo re-sube si otro
        // usuario lo borra (guarda anti-resurrección, Fase C2). Persiste al
        // IndexedDB local junto con el entry.
        _cloud: true,
      };
    });
    window.tallerEntries = tallerEntries;
    if (typeof window.updateTallerBadge === "function") window.updateTallerBadge();
    if (typeof window.renderTaller === "function") window.renderTaller();
    console.info(`[cloudHydrate] ${tallerEntries.length} taller entries hidratados`);
  }

  // ── Hydrate semanales → window.weeklyPeriodos ──────────────────
  // Agrupa entries por periodoId. Cada Semanal row es una entry de una unidad
  // en un período (semana ISO). Reconstruimos el shape legacy {id, label, entries}.
  if (semanales.length > 0) {
    const periodoMap = new Map<string, WeeklyEntry[]>();
    for (const s of semanales) {
      // Reporte semanal anulado por admin → fuera de KPIs/tabla/badges del módulo.
      if (anuladasActivas.has(refIdSemanal(String(s.periodoId), String(s.unitUid)))) continue;
      const datos = safeParseObj(s.datos);
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
    // Fix 2026-06-09: inicializar la barra de rango de fechas y re-render de la
    // vista semanal. Antes solo se actualizaba el badge — si el usuario estaba
    // parado en "Semanales" cuando llegaba el hydrate, la vista (filtro de
    // fechas, KPIs, tabla) quedaba vacía hasta navegar fuera y volver.
    if (typeof window.initRangoSemanal === "function") window.initRangoSemanal();
    if (typeof window.renderSemanales === "function") window.renderSemanales();
    console.info(`[cloudHydrate] ${weeklyPeriodos.length} períodos semanales hidratados`);
  }

  // ── Hydrate combustible → window.fuelEntries ──────────────────
  // CargaCombustible (solicitudes + cargas) + ValidacionCarga (revisión) → FuelEntry[].
  // Las fotos de evidencia se pre-firman junto con las demás (más abajo).
  {
    // Join VIVO con el catálogo de Unidades: submarca (eco.SUBMARCA → Unit.marca) y área
    // (asignada por el admin) por economicoId. buildFuelEntries normaliza las claves
    // (ecoKey "06"↔"6"). Reasignar el área re-clasifica el gasto histórico.
    const unidadPorEco = new Map<string, { submarca?: string; area?: string }>();
    for (const u of units) {
      const eco = String(u.economicoId ?? "");
      const marca = String(u.marca ?? "").trim();
      const area = String(u.area ?? "").trim();
      if (eco && (marca || area) && !unidadPorEco.has(eco))
        unidadPorEco.set(eco, { submarca: marca || undefined, area: area || undefined });
    }
    const fuelEntries = buildFuelEntries(combustible, validaciones, unidadPorEco, anuladasActivas);
    window.fuelEntries = fuelEntries;
    // Perf F3-1: fijar el estado de la ventana (frontera + crudo + insumos) para que
    // ensureFuelWindow pueda ampliar hacia atrás sin re-descargar todo. La frontera
    // persiste entre auto-refreshes de la sesión (una vez ampliada, se mantiene).
    if (fuelWindowFrom === null) fuelWindowFrom = defaultFuelWindowFrom();
    fuelRaw = [...combustible];
    fuelDeps = { tenantId, validaciones, unidadPorEco, anuladasActivas };
    if (typeof window.updateFuelNavBadge === "function") window.updateFuelNavBadge();
    if (typeof window.initRangoFuel === "function") window.initRangoFuel();
    if (typeof window.renderCombustible === "function") window.renderCombustible();
    console.info(
      `[cloudHydrate] ${fuelEntries.length} registros de combustible hidratados (ventana desde ${fuelWindowFrom})`,
    );
  }

  // No early-exit aquí. Aunque units.length === 0, semanales puede tener
  // fotos que necesitan pre-fetch. Continuamos con un legacyUnits vacío.

  // ── Inspecciones por fecha → vista de rango (Desde/Hasta) ──
  // Cada checklist es una FILA de inspección con uid sintético único
  // (`placa__fecha`) para que la misma unidad pueda aparecer varias veces sin
  // colisionar en selección/detalle. Preserva eco/plate/fecha reales.
  const unitByPlaca = new Map(units.map((u) => [u.placa, u] as const));
  const inspections: Unit[] = [];
  for (const c of checklistsVigentes) {
    const fecha = String(c.fecha ?? "");
    if (!monthOf(fecha)) continue; // requiere fecha parseable
    const u =
      unitByPlaca.get(c.unitUid) ?? ({ tenantId, placa: c.unitUid } as Schema["Unit"]["type"]);
    const row = mergeUnitWithChecklist(u, c);
    row.uid = `${row.plate ?? c.unitUid}__${fecha}`; // único por inspección
    inspections.push(row);
  }
  // Desc por fecha (más reciente primero). Normaliza DMY→ISO para ordenar bien.
  inspections.sort((a, b) => isoDay(b.fecha).localeCompare(isoDay(a.fecha)));

  // Flota = unidades distintas del catálogo con su ÚLTIMO checklist (estado actual,
  // independiente del rango). Alimenta los KPIs hero + dona Operativa/Taller.
  const latestByUnit = new Map<string, Schema["Checklist"]["type"]>();
  for (const c of checklistsVigentes) {
    const e = latestByUnit.get(c.unitUid);
    if (!e || isoDay(c.fecha) > isoDay(e.fecha)) latestByUnit.set(c.unitUid, c);
  }
  window.__fleetUnits = units.map((u) => mergeUnitWithChecklist(u, latestByUnit.get(u.placa)));

  // ── Hydrate cumplimiento → window.complianceEntries ───────────
  // ComplianceDoc → ComplianceEntry[] (estado vencido/por-vencer derivado vs hoy). Se
  // resuelve sucursal/placa por economicoId desde el catálogo de Unit. El merge con la
  // flota completa (unidades sin docs = 'desconocido') lo hace el wire al renderizar.
  // Va DESPUÉS de fijar window.__fleetUnits, que renderCumplimiento usa para ese merge.
  {
    // "hoy" en la zona de México (no UTC): el estado vencido/por-vencer se ancla aquí y
    // GPA opera en husos negativos vs UTC; con toISOString() la fecha se adelantaba un día
    // en la ventana nocturna local (off-by-one en el borde de vencimiento). en-CA emite
    // YYYY-MM-DD directo. México sin DST desde 2022; Intl resuelve el offset por timeZone.
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const unitsByEco = new Map<string, { sucursal?: string; placa?: string }>();
    for (const u of units) {
      const eco = String(u.economicoId ?? "").trim();
      if (eco) unitsByEco.set(eco, { sucursal: u.sucursal ?? undefined, placa: u.placa });
    }
    window.complianceEntries = buildComplianceEntries(complianceDocs, hoy, { unitsByEco });
    if (typeof window.updateCumplimientoNavBadge === "function")
      window.updateCumplimientoNavBadge();
    if (typeof window.renderCumplimiento === "function") window.renderCumplimiento();
    console.info(`[cloudHydrate] ${complianceDocs.length} documentos de cumplimiento hidratados`);
  }

  let legacyUnits: Unit[];
  if (inspections.length > 0) {
    window.__inspections = inspections;
    // Min/max en ISO para que __inspMinDate/__inspMaxDate y el datepicker
    // (type=date → ISO) ordenen cronológicamente aunque la fecha venga en DMY.
    const fechas = inspections
      .map((i) => isoDay(i.fecha))
      .filter(Boolean)
      .sort();
    window.__inspMinDate = fechas[0];
    window.__inspMaxDate = fechas[fechas.length - 1];
    // Default: inspecciones del mes más reciente (evita arrancar con cientos).
    const maxMonth = monthOf(window.__inspMaxDate) ?? "";
    legacyUnits = inspections.filter((i) => monthOf(i.fecha) === maxMonth);
    window.units = legacyUnits;
    // Filtro por rango — lo llama el control Desde/Hasta del HTML.
    window.applyDateRange = (fromISO: string, toISO: string) => {
      const from = fromISO || "0000-01-01";
      const to = toISO || "9999-12-31";
      const sel = (window.__inspections ?? []).filter((i) => {
        const f = isoDay(i.fecha); // normaliza DMY→ISO para comparar contra from/to (ISO)
        return f !== "" && f >= from && f <= to;
      });
      window.units = sel;
      if (typeof window.buildKPIs === "function") window.buildKPIs();
      if (typeof window.renderTable === "function") window.renderTable();
      if (typeof window.buildAlertsSummary === "function") window.buildAlertsSummary();
      if (typeof window.buildAnalytics === "function") window.buildAnalytics();
    };
  } else {
    // Fallback: sin checklists con fecha parseable → latest-per-unit plano.
    const checklistByUnit = new Map<string, Schema["Checklist"]["type"]>();
    for (const c of checklistsVigentes) {
      const existing = checklistByUnit.get(c.unitUid);
      if (!existing || (c.fecha ?? "") > (existing.fecha ?? "")) {
        checklistByUnit.set(c.unitUid, c);
      }
    }
    legacyUnits = units.map((u) => mergeUnitWithChecklist(u, checklistByUnit.get(u.placa)));
    window.units = legacyUnits;
  }

  if (!window.checklistDB) window.checklistDB = {} as ChecklistDB;
  const db = window.checklistDB;
  // Init checklistDB para los uids de TODAS las inspecciones.
  const allSnapUnits = window.__inspections ?? legacyUnits;
  for (const u of allSnapUnits) {
    if (!db[u.uid]) db[u.uid] = {};
  }

  // Pre-fetch URLs firmadas de S3 para las fotos del RANGO/PERÍODO ACTIVO.
  // Perf F3-3 (2026-07-10): antes se pre-firmaba TODO el histórico (inspecciones de
  // todos los meses + todos los períodos semanales + todo combustible) — miles de
  // firmas SigV4 en el main thread en cada boot, creciendo con el archivo. Ahora:
  // - Inspecciones: solo el rango visible (window.units, default mes reciente).
  // - Semanales: solo el período activo.
  // - Combustible: ya viene acotado por la ventana de hidratación (F3-1).
  // Las fotos FUERA de lo pre-firmado se firman on-demand al verse: galería vía
  // lazyObserver→__cloudGetPhotoUrl; lightbox/PDF/drawer con fallback async (F3-3).
  const allPhotoFnames = new Set<string>();
  for (const u of window.units ?? legacyUnits) {
    for (const p of u.photos ?? []) {
      const fn = (p as { fname?: string }).fname;
      if (fn) allPhotoFnames.add(fn.toLowerCase());
    }
  }
  // Semanales: cada entry tiene array de filenames raw (string[]).
  const activeWk = window.activeWeeklyPeriodoId;
  for (const periodo of window.weeklyPeriodos ?? []) {
    if (activeWk && periodo.id !== activeWk) continue;
    for (const entry of periodo.entries ?? []) {
      for (const fn of entry.photos ?? []) {
        if (fn) allPhotoFnames.add(String(fn).toLowerCase());
      }
    }
  }
  // Combustible: cada FuelEntry tiene fotos {fname,col,group} (evidencias).
  for (const fe of window.fuelEntries ?? []) {
    for (const p of fe.photos ?? []) {
      if (p.fname) allPhotoFnames.add(p.fname.toLowerCase());
    }
  }
  // FIRMA DE URLS DE FOTOS — por-demanda, sin listar el bucket (fix de raíz 2026-06-15).
  // firmar (getUrl) = LOCAL/barato; se firma cada fname del rango directamente. ANTES se
  // listaba todo S3 (indexCloudPhotos) para "verificar existencia" antes de firmar; ese
  // listado de ~22k fotos fallaba al crecer el bucket y dejaba el mapa VACÍO → "Sin fotos
  // disponibles". Ya no: firmamos directo (el path aísla por tenant; el onerror del <img>
  // cubre las inexistentes). Las URLs expiran ≈15min (acotadas por la credencial Cognito);
  // el auto-refresh (poll 4min) re-firma las próximas a vencer.
  window.__cloudPhotoUrlMap = window.__cloudPhotoUrlMap ?? new Map<string, PhotoUrlEntry>();
  const existingMap = window.__cloudPhotoUrlMap;
  const allFnamesArr = [...allPhotoFnames];
  const newFnames = allFnamesArr.filter((f) => !existingMap.has(f));
  const RESIGN_WINDOW_MS = 5 * 60 * 1000; // re-firmar las que vencen dentro de 5min
  const soon = Date.now() + RESIGN_WINDOW_MS;
  const staleFnames = allFnamesArr.filter((f) => {
    const e = existingMap.get(f);
    return e !== undefined && e.expires <= soon;
  });
  if (newFnames.length > 0 || staleFnames.length > 0) {
    try {
      if (newFnames.length > 0) {
        // Firma directa, sin index previo (getUrl no lista ni valida existencia).
        const urlMap = await batchGetCloudPhotoUrls(tenantId, newFnames);
        let count = 0;
        for (const [fname, entry] of urlMap) {
          if (entry) {
            existingMap.set(fname, entry);
            count++;
          }
        }
        console.info(`[cloudHydrate] ${count}/${newFnames.length} URLs de fotos nuevas firmadas`);
      }
      if (staleFnames.length > 0) {
        // Re-firma local (force:true) → barato, sin red de listado.
        const fresh = await refreshPhotoUrls(tenantId, staleFnames);
        let resigned = 0;
        for (const [fname, entry] of fresh) {
          if (entry) {
            existingMap.set(fname, entry);
            resigned++;
          }
        }
        if (resigned)
          console.info(
            `[cloudHydrate] ${resigned}/${staleFnames.length} URLs re-firmadas (por vencer)`,
          );
      }
    } catch (err) {
      console.warn("[cloudHydrate] photo URLs prefetch falló:", err);
    }
  }

  // Perf F2-5: cota superior del mapa de URLs firmadas. Antes crecía monótonamente (solo
  // .set, nunca .delete) → en sesiones largas (PWA abierta días) acumulaba decenas de miles
  // de {url ~500 chars, expires} (~15-30 MB). Podamos las más antiguas (el Map preserva orden
  // de inserción) al superar el tope; las evictadas se re-firman por-demanda al verse
  // (imgUrl → lazyObserver → __cloudGetPhotoUrl), así que podar es seguro.
  const PHOTO_URL_CAP = 6000;
  if (existingMap.size > PHOTO_URL_CAP) {
    const toDelete: string[] = [];
    const excess = existingMap.size - PHOTO_URL_CAP;
    for (const key of existingMap.keys()) {
      if (toDelete.length >= excess) break;
      toDelete.push(key);
    }
    for (const key of toDelete) existingMap.delete(key);
    console.info(
      `[cloudHydrate] photo URL cache podado: -${toDelete.length} (tope ${PHOTO_URL_CAP})`,
    );
  }

  // Completaciones de checklist COMPARTIDAS (Fase C1): merge puro con fan-out
  // por placa, tombstones (done:false propaga desmarcados) y dirty-skip (no
  // pisa un toggle local más reciente). Ver mergeCheckDones.ts.
  if (checkDones.length) {
    const { cdb, modifiedUids } = mergeCheckDones({
      checkDones,
      rows: (window.__inspections ?? legacyUnits).map((u) => ({ uid: u.uid, plate: u.plate })),
      cdb: (window.checklistDB ?? {}) as Record<string, DoneMap>,
      dirty: window.__checkDirty,
    });
    window.checklistDB = cdb as ChecklistDB;
    // Persistir a IndexedDB (H7): sin esto un arranque offline restaura el
    // snapshot viejo y "revive" desmarcados ya propagados.
    if (typeof window.dbPut === "function") {
      for (const uid of modifiedUids) {
        try {
          void window.dbPut("checklist", uid, cdb[uid]);
        } catch {
          /* persistencia best-effort */
        }
      }
    }
  }
  // Recalcular el riesgo efectivo por fila con las completaciones aplicadas —
  // antes de C1 no se llamaba y el badge de riesgo nunca descontaba atendidos
  // en sesiones cloud.
  if (typeof window.recalcAllRisks === "function") window.recalcAllRisks();

  // Trigger re-render del legacy. Sin esto, UI sigue vacía aunque state esté lleno.
  if (typeof window.initRangoBar === "function") window.initRangoBar();
  if (typeof window.showDash === "function") window.showDash();
  // Header status: sin esto quedaba "Sin datos cargados" en sesiones cloud puras.
  {
    const hstxt = document.getElementById("hstxt");
    if (hstxt && legacyUnits.length > 0) {
      // Etiqueta corta: la larga ("Datos del servidor (nube)") se envolvía a
      // 3 renglones en el header a 1366px (auditoría UX 2026-07 H20).
      hstxt.textContent = "Nube";
      hstxt.title = "Datos del servidor (nube)";
    }
    const hdot = document.getElementById("hdot");
    if (hdot && legacyUnits.length > 0) hdot.className = "hdot live";
  }
  if (typeof window.buildKPIs === "function") window.buildKPIs();
  // Sin esto el filtro de sucursales (#bsel) queda vacío en sesiones cloud.
  if (typeof window.buildBranches === "function") window.buildBranches();
  if (typeof window.renderTable === "function") window.renderTable();
  if (typeof window.buildAlertsSummary === "function") window.buildAlertsSummary();
  if (typeof window.buildAnalytics === "function") window.buildAnalytics();
  // Re-render detail panel si está abierto — sin esto las fotos en panel
  // mantienen src vacío de cuando el URL map todavía no se había poblado.
  if (typeof window.renderDet === "function") window.renderDet();
  // Re-render taller — el primer renderTaller corrió antes de poblar window.units,
  // por lo que el lookup de economicoId regresaba undefined. Ahora units está
  // listo, segundo render usa el ID correcto.
  if (typeof window.renderTaller === "function") window.renderTaller();

  console.info(`[cloudHydrate] ${legacyUnits.length} units hidratados del cloud`);
  return { units: legacyUnits.length, source: "cloud" };
}
