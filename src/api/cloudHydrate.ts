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
import { listUnits, listChecklists, listSemanales, listTaller } from "./client";
import {
  batchGetCloudPhotoUrls,
  indexCloudPhotos,
  refreshPhotoUrls,
  type PhotoUrlEntry,
} from "./photoFetch";
import { uploadTallerToCloud } from "./batchUpload";
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
  const [units, checklists, semanales, tallerCloud] = await Promise.all([
    listUnits(tenantId),
    listChecklists(tenantId),
    listSemanales(tenantId),
    listTaller(tenantId),
  ]);

  if (units.length === 0 && semanales.length === 0 && tallerCloud.length === 0) {
    console.info("[cloudHydrate] cloud vacío, nada que hidratar");
    return { units: 0, source: "empty" };
  }

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
    const orphans = localTaller.filter((e) => !cloudIds.has(e.id));
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
  if (tallerCloud.length > 0) {
    const tallerEntries: TallerEntry[] = tallerCloud.map((t) => {
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
    console.info(`[cloudHydrate] ${weeklyPeriodos.length} períodos semanales hidratados`);
  }

  // No early-exit aquí. Aunque units.length === 0, semanales puede tener
  // fotos que necesitan pre-fetch. Continuamos con un legacyUnits vacío.

  // ── Inspecciones por fecha → vista de rango (Desde/Hasta) ──
  // Cada checklist es una FILA de inspección con uid sintético único
  // (`placa__fecha`) para que la misma unidad pueda aparecer varias veces sin
  // colisionar en selección/detalle. Preserva eco/plate/fecha reales.
  const unitByPlaca = new Map(units.map((u) => [u.placa, u] as const));
  const inspections: Unit[] = [];
  for (const c of checklists) {
    const fecha = String(c.fecha ?? "");
    if (!monthOf(fecha)) continue; // requiere fecha parseable
    const u =
      unitByPlaca.get(c.unitUid) ?? ({ tenantId, placa: c.unitUid } as Schema["Unit"]["type"]);
    const row = mergeUnitWithChecklist(u, c);
    row.uid = `${row.plate ?? c.unitUid}__${fecha}`; // único por inspección
    inspections.push(row);
  }
  // Desc por fecha (más reciente primero).
  inspections.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));

  // Flota = unidades distintas del catálogo con su ÚLTIMO checklist (estado actual,
  // independiente del rango). Alimenta los KPIs hero + dona Operativa/Taller.
  const latestByUnit = new Map<string, Schema["Checklist"]["type"]>();
  for (const c of checklists) {
    const e = latestByUnit.get(c.unitUid);
    if (!e || (c.fecha ?? "") > (e.fecha ?? "")) latestByUnit.set(c.unitUid, c);
  }
  window.__fleetUnits = units.map((u) => mergeUnitWithChecklist(u, latestByUnit.get(u.placa)));

  let legacyUnits: Unit[];
  if (inspections.length > 0) {
    window.__inspections = inspections;
    const fechas = inspections
      .map((i) => String(i.fecha ?? "").slice(0, 10))
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
        const f = String(i.fecha ?? "").slice(0, 10);
        return f >= from && f <= to;
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
    for (const c of checklists) {
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

  // Pre-fetch URLs firmadas de S3 para TODAS las fotos (mensual + semanal).
  // Esto evita que imgUrl/weeklyImgUrl (sync) tengan que esperar — las URLs
  // ya están en cache al momento de renderear. Habilita lightbox, gallery,
  // thumbnails para multi-user en ambos modos.
  const allPhotoFnames = new Set<string>();
  // Todos los meses (no solo el activo) → al cambiar de período las fotos ya están.
  for (const u of allSnapUnits) {
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
  // FIRMA DE URLS DE FOTOS. Dos costos distintos:
  //  - indexCloudPhotos = list S3 → CARO (red). Solo si hay fotos NUEVAS.
  //  - firmar (getUrl) = LOCAL/barato. Lo usamos para re-firmar las que ya vencen.
  // Las URLs firmadas de S3 expiran ≈15min (acotadas por la credencial Cognito); si no
  // se re-firman, "de la nada" todas las fotos dan 403 → "No disponible" hasta un hard
  // refresh. El auto-refresh (poll 4min) re-firma las próximas a vencer SIN re-listar.
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
        // CRÍTICO: indexar S3 ANTES de batchGetCloudPhotoUrls. batchGet usa
        // hasCloudPhoto (index cache). Sin index → todas null (race multi-user).
        await indexCloudPhotos(tenantId);
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
        // Reusa el índice ya cacheado (no re-lista). Firmado local → barato.
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

  // Trigger re-render del legacy. Sin esto, UI sigue vacía aunque state esté lleno.
  if (typeof window.initRangoBar === "function") window.initRangoBar();
  if (typeof window.showDash === "function") window.showDash();
  if (typeof window.buildKPIs === "function") window.buildKPIs();
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
