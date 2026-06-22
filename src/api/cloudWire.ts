// Cloud wire: expone funciones API a window.* para que el HTML legado
// pueda invocarlas sin refactor del monolito.
//
// Flujo:
// 1. main.ts llama setupCloud() al boot — configureAmplify + window assignments.
// 2. Auth gating: si no hay sesión, modal aparece bloqueante.
// 3. Usuario sube ZIP → legacy doZip parsea + guarda IndexedDB.
//    Después legacy llama window.__cloudSyncUnits para push a DynamoDB.
// 4. Login exitoso → app continúa.
//
// IMPORTANTE: setupCloud() es EXPORTADO + LLAMADO explícitamente desde main.ts.
// Side-effect-only import no funciona — Vite producción tree-shakea las
// assignments a window.* porque no son leídas desde el bundle TS (solo
// el HTML legado las invoca, invisible al tree-shaker).

import { configureAmplify } from "./amplifyClient";
import { isLoggedIn, getSession, logout, type AuthSession } from "./auth";
import { gatingPlan, MODULE_NAV } from "./moduleAccess";
import { showAuthModal } from "../ui/authModal";
import {
  uploadZipToCloud,
  uploadUnitsToCloud,
  uploadSemanalesToCloud,
  uploadTallerToCloud,
  tallerCloudKey,
  type BatchResult,
  type LegacyUnit,
  type LegacySemanalEntry,
  type LegacyTallerEntry,
} from "./batchUpload";
import {
  listUnits,
  listTaller,
  listNotas,
  listChecklists,
  listPeriodos,
  listSemanales,
  deleteTaller,
  findCloudTallerByFolio,
  upsertCheckDone,
  adminCreateUser,
  adminUpdateUser,
  adminSetEnabled,
  adminDeleteUser,
  adminResetPassword,
  adminSetRole,
  adminListUsers,
  listAuditEvents,
  type AdminResult,
  type AdminCreateInput,
} from "./client";
import { isAdmin, forceRefreshSession } from "./auth";
import { hydrateFromCloud } from "./cloudHydrate";
import { uploadPhotosToS3, type PhotoUploadResult } from "./photoUpload";
import { getCloudPhotoUrl } from "./photoFetch";
import type { LoadedZip } from "../io/zipLoader";

declare global {
  interface Window {
    /** Sesión cacheada — null si no logged in. */
    __cloudSession?: AuthSession | null;
    /** Force login. Resuelve cuando user autenticado. */
    __cloudLogin?: () => Promise<AuthSession>;
    /** Cerrar sesión. */
    __cloudLogout?: () => Promise<void>;
    /** Upload ZIP a DynamoDB. Lanza authModal si no hay sesión. */
    __cloudSyncZip?: (zip: LoadedZip) => Promise<BatchResult>;
    /** Upload units YA parseados (window.units del legacy) a DynamoDB. */
    __cloudSyncUnits?: (
      units: LegacyUnit[],
      fname: string,
      kind: "mensual" | "semanal",
    ) => Promise<BatchResult>;
    /** Upload entries de un período semanal a DynamoDB (Semanal model). */
    __cloudSyncSemanales?: (
      periodoId: string,
      entries: LegacySemanalEntry[],
    ) => Promise<BatchResult>;
    /** Upload entries de taller a DynamoDB (Taller model). */
    __cloudSyncTaller?: (entries: LegacyTallerEntry[]) => Promise<BatchResult>;
    /** Borra TODAS las filas cloud de un registro de taller (folio-lookup, Fase C2). */
    __cloudDeleteTaller?: (entry: LegacyTallerEntry) => Promise<void>;
    /** Guarda/edita un registro de taller con re-key seguro: upsert nuevo →
     *  delete de filas viejas del mismo folio (Fase C2). */
    __cloudReplaceTaller?: (entry: LegacyTallerEntry) => Promise<void>;
    /** Refetch todos los datos del tenant — overwrite state local. */
    __cloudFetchAll?: () => Promise<CloudSnapshot | null>;
    /** Hidrata window.units desde cloud + trigger re-render UI legacy. */
    __cloudHydrate?: () => Promise<{ units: number; source: "cloud" | "empty" } | null>;
    /** Sube fotos a S3 (Record<filename, Uint8Array>). */
    __cloudSyncPhotos?: (images: Record<string, Uint8Array>) => Promise<PhotoUploadResult>;
    /** Obtiene URL firmada de S3 para una foto (lazy, cacheada hasta su expiresAt real).
     *  opts.force re-firma fresca (usado por el onerror del <img> para auto-sanar 403). */
    __cloudGetPhotoUrl?: (filename: string, opts?: { force?: boolean }) => Promise<string | null>;
    /** Guarda la completación de un hallazgo en la nube (compartida entre usuarios).
     *  Fase C1: plate = placa cruda (no uid de fila); itemKey = findingKey estable;
     *  done:false = tombstone (propaga desmarcados); ts = timestamp del toggle. */
    __cloudSetCheck?: (plate: string, itemKey: string, done: boolean, ts?: string) => Promise<void>;
    /** Notify wrapper del legado (toast). */
    notify?: (msg: string, kind?: string, ms?: number) => void;
    /** Muestra el drop zone si NO hay datos (lo define el HTML; fix drop-zone 2026-06-09). */
    __showEmptyState?: () => void;
    /** Módulo Admin Usuarios (2026-06-12): API admin expuesta al HTML legacy.
     *  Todas requieren sesión + grupo admin (AppSync lo valida server-side). */
    __admin?: {
      isAdmin: () => Promise<boolean>;
      refreshSession: () => Promise<void>;
      listUsers: () => Promise<AdminResult>;
      createUser: (input: AdminCreateInput) => Promise<AdminResult>;
      updateUser: (input: {
        cognitoSub: string;
        nombre?: string;
        telefono?: string;
        sucursal?: string;
        modulos?: string;
      }) => Promise<AdminResult>;
      setEnabled: (cognitoSub: string, enabled: boolean) => Promise<AdminResult>;
      deleteUser: (cognitoSub: string) => Promise<AdminResult>;
      resetPassword: (cognitoSub: string) => Promise<AdminResult>;
      setRole: (cognitoSub: string, rol: string) => Promise<AdminResult>;
      listAudit: () => Promise<unknown[]>;
    };
    /** Hook del HTML: re-pinta email + botón logout cuando cambia __cloudSession. */
    __onCloudSession?: () => void;
    /** Gating de módulos (lógica pura testeable) para el applyModuleGating inline. */
    __moduleGating?: {
      plan: typeof gatingPlan;
      allNavIds: string[];
    };
  }
}

export interface CloudSnapshot {
  units: Awaited<ReturnType<typeof listUnits>>;
  taller: Awaited<ReturnType<typeof listTaller>>;
  notas: Awaited<ReturnType<typeof listNotas>>;
  checklists: Awaited<ReturnType<typeof listChecklists>>;
  periodos: Awaited<ReturnType<typeof listPeriodos>>;
  semanales: Awaited<ReturnType<typeof listSemanales>>;
}

/** Asegura sesión activa. Si no hay, muestra modal hasta success. */
async function ensureSession(): Promise<AuthSession> {
  // E2E bypass: tests Playwright corren offline-only sin Cognito.
  if (typeof window !== "undefined" && window.location.search.includes("e2e=1")) {
    throw new Error("[cloud] E2E bypass — cloud sync deshabilitado");
  }
  let session = await getSession();
  if (!session) {
    await showAuthModal({ title: "Sincronización Cloud" });
    session = await getSession();
    if (!session) throw new Error("Login falló — sesión sin tenantId");
  }
  window.__cloudSession = session;
  return session;
}

let installed = false;

/**
 * Bootstrap cloud layer: configura Amplify SDK + expone window.* + auth gating.
 * Idempotente — segunda llamada no-op.
 *
 * DEBE ser llamada explícitamente desde main.ts. Side-effect import no funciona
 * en Vite producción (tree-shake elimina las assignments a window.*).
 */
export function setupCloud(): void {
  if (installed) return;
  installed = true;

  configureAmplify();

  window.__cloudLogin = async (): Promise<AuthSession> => {
    return ensureSession();
  };

  window.__cloudLogout = async (): Promise<void> => {
    await logout();
    window.__cloudSession = null;
    window.__onCloudSession?.();
    window.notify?.("Sesión cerrada", "ok");
  };

  window.__cloudSyncZip = async (zip: LoadedZip): Promise<BatchResult> => {
    const session = await ensureSession();
    window.notify?.("Subiendo a DynamoDB…", "info", 2000);
    const res = await uploadZipToCloud(zip, session.tenantId);
    const summary = `Cloud: ${res.units} units · ${res.checklist} checklist · ${res.semanal} semanal · ${res.errors.length} errors`;
    if (res.errors.length > 0) {
      console.warn("[cloudSyncZip] errors:", res.errors);
      window.notify?.(summary, "warn", 5000);
    } else {
      window.notify?.(summary, "ok", 4000);
    }
    return res;
  };

  window.__cloudSyncUnits = async (
    units: LegacyUnit[],
    fname: string,
    kind: "mensual" | "semanal",
  ): Promise<BatchResult> => {
    const session = await ensureSession();
    window.notify?.(`Subiendo ${units.length} ${kind} a DynamoDB…`, "info", 2500);
    const res = await uploadUnitsToCloud(units, fname, kind, session.tenantId);
    const summary =
      kind === "mensual"
        ? `Cloud: ${res.units} units · ${res.checklist} checklist · ${res.errors.length} errors`
        : `Cloud: ${res.semanal} semanal · ${res.errors.length} errors`;
    if (res.errors.length > 0) {
      console.warn("[cloudSyncUnits] errors:", res.errors);
      window.notify?.(summary, "warn", 6000);
    } else {
      window.notify?.(summary, "ok", 4000);
      // Re-hidrata para reflejar el state autoritativo del cloud post-upload.
      // No bloquea — fire-and-forget. Si falla, el state local actual sigue válido.
      void hydrateSerialized(session.tenantId).catch((err) =>
        console.error("[cloudSyncUnits] re-hydrate falló:", err),
      );
    }
    return res;
  };

  window.__cloudSyncSemanales = async (
    periodoId: string,
    entries: LegacySemanalEntry[],
  ): Promise<BatchResult> => {
    const session = await ensureSession();
    window.notify?.(`Subiendo ${entries.length} semanal a DynamoDB…`, "info", 2500);
    const res = await uploadSemanalesToCloud(periodoId, entries, session.tenantId);
    const summary = `Cloud: ${res.semanal} semanal · ${res.errors.length} errors`;
    if (res.errors.length > 0) {
      console.warn("[cloudSyncSemanales] errors:", res.errors);
      window.notify?.(summary, "warn", 6000);
    } else {
      window.notify?.(summary, "ok", 4000);
      // Re-hidrata para reflejar el state autoritativo del cloud post-upload.
      void hydrateSerialized(session.tenantId).catch((err) =>
        console.error("[cloudSyncSemanales] re-hydrate falló:", err),
      );
    }
    return res;
  };

  window.__cloudSyncTaller = async (entries: LegacyTallerEntry[]): Promise<BatchResult> => {
    const session = await ensureSession();
    if (entries.length === 0) {
      return { units: 0, checklist: 0, semanal: 0, skipped: 0, errors: [], duration_ms: 0 };
    }
    window.notify?.(`Subiendo ${entries.length} taller a DynamoDB…`, "info", 2500);
    const res = await uploadTallerToCloud(entries, session.tenantId);
    const summary = `Cloud taller: ${res.semanal} OK · ${res.errors.length} errors`;
    if (res.errors.length > 0) {
      console.warn("[cloudSyncTaller] errors:", res.errors);
      window.notify?.(summary, "warn", 6000);
    } else {
      window.notify?.(summary, "ok", 4000);
      void hydrateSerialized(session.tenantId).catch((err) =>
        console.error("[cloudSyncTaller] re-hydrate falló:", err),
      );
    }
    return res;
  };

  // Fase C2 (audit 2026-06-04 P1 #10): borra TODAS las filas cloud del registro
  // localizándolas por folio (e.id) — NUNCA recomputando la clave (las filas
  // históricas con fallback a updatedAt son irreproducibles; el delete por
  // clave recomputada fallaba silencioso y el registro "resucitaba" en el
  // próximo hydrate). De paso limpia duplicados históricos de ese id.
  window.__cloudDeleteTaller = async (entry: LegacyTallerEntry): Promise<void> => {
    const session = await ensureSession();
    const rows = await findCloudTallerByFolio(session.tenantId, String(entry.id ?? ""));
    for (const t of rows) {
      await deleteTaller({
        tenantId: session.tenantId,
        unitUid: t.unitUid,
        fechaEntrada: t.fechaEntrada,
      });
    }
    if (rows.length) console.info(`[cloudDeleteTaller] ${rows.length} fila(s) borradas (folio)`);
  };

  // Fase C2: guardar/editar un registro de taller con re-key SEGURO.
  // Orden: upsert de la clave nueva PRIMERO → luego borrar las filas viejas del
  // mismo folio cuya clave difiera (un fallo del delete deja un duplicado
  // transitorio que el dedup de lectura absorbe; un fallo del upsert no borra
  // nada — nunca se pierden datos, H12). Si la clave no cambió, el lookup
  // simplemente no encuentra filas que borrar.
  window.__cloudReplaceTaller = async (entry: LegacyTallerEntry): Promise<void> => {
    const session = await ensureSession();
    const res = await uploadTallerToCloud([entry], session.tenantId);
    if (res.errors.length) {
      throw new Error(`replaceTaller upsert falló: ${res.errors[0]?.error ?? "?"}`);
    }
    const nueva = tallerCloudKey(entry);
    const rows = await findCloudTallerByFolio(session.tenantId, String(entry.id ?? ""));
    const viejas = rows.filter(
      (t) => !(t.unitUid === nueva.unitUid && t.fechaEntrada === nueva.fechaEntrada),
    );
    for (const t of viejas) {
      try {
        await deleteTaller({
          tenantId: session.tenantId,
          unitUid: t.unitUid,
          fechaEntrada: t.fechaEntrada,
        });
      } catch (err) {
        console.warn("[cloudReplaceTaller] delete de fila vieja falló (dedup la cubre):", err);
      }
    }
    if (viejas.length)
      console.info(`[cloudReplaceTaller] re-key: ${viejas.length} fila(s) viejas borradas`);
  };

  // ── Módulo de Administración de Usuarios (2026-06-12) ──────────────────────
  // El gate de ROL real es server-side (AppSync exige grupo 'admin'); isAdmin()
  // es solo para mostrar/ocultar la vista. ensureSession garantiza login.
  window.__moduleGating = { plan: gatingPlan, allNavIds: Object.values(MODULE_NAV) };
  window.__admin = {
    isAdmin: () => isAdmin(),
    refreshSession: () => forceRefreshSession(),
    listUsers: async () => {
      await ensureSession();
      return adminListUsers();
    },
    createUser: async (input) => {
      await ensureSession();
      return adminCreateUser(input);
    },
    updateUser: async (input) => {
      await ensureSession();
      return adminUpdateUser(input);
    },
    setEnabled: async (cognitoSub, enabled) => {
      await ensureSession();
      return adminSetEnabled(cognitoSub, enabled);
    },
    deleteUser: async (cognitoSub) => {
      await ensureSession();
      return adminDeleteUser(cognitoSub);
    },
    resetPassword: async (cognitoSub) => {
      await ensureSession();
      return adminResetPassword(cognitoSub);
    },
    setRole: async (cognitoSub, rol) => {
      await ensureSession();
      return adminSetRole(cognitoSub, rol);
    },
    listAudit: async () => {
      const s = await ensureSession();
      return listAuditEvents(s.tenantId);
    },
  };

  window.__cloudFetchAll = async (): Promise<CloudSnapshot | null> => {
    const session = await getSession();
    if (!session) return null;
    const [units, taller, notas, checklists, periodos, semanales] = await Promise.all([
      listUnits(session.tenantId),
      listTaller(session.tenantId),
      listNotas(session.tenantId),
      listChecklists(session.tenantId),
      listPeriodos(session.tenantId),
      listSemanales(session.tenantId),
    ]);
    return { units, taller, notas, checklists, periodos, semanales };
  };

  window.__cloudHydrate = async (): Promise<{
    units: number;
    source: "cloud" | "empty";
  } | null> => {
    const session = await getSession();
    if (!session) return null;
    return hydrateSerialized(session.tenantId);
  };

  window.__cloudSyncPhotos = async (
    images: Record<string, Uint8Array>,
  ): Promise<PhotoUploadResult> => {
    const session = await ensureSession();
    const count = Object.keys(images).length;
    if (count === 0) {
      return { uploaded: 0, skipped: 0, errors: [], duration_ms: 0 };
    }
    window.notify?.(`Subiendo ${count} fotos a S3…`, "info", 3000);
    const res = await uploadPhotosToS3(images, session.tenantId, {
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) {
          console.info(`[cloudSyncPhotos] ${done}/${total}`);
        }
      },
    });
    const summary = `S3: ${res.uploaded}/${count} fotos · ${res.errors.length} errors`;
    if (res.errors.length > 0) {
      console.warn("[cloudSyncPhotos] errors:", res.errors);
      window.notify?.(summary, "warn", 5000);
    } else {
      window.notify?.(summary, "ok", 3000);
    }
    // Re-hidrata para firmar las URLs de las fotos recién subidas (firma directa
    // por-demanda; ya no se re-lista S3 — ver photoFetch.getCloudPhotoUrl).
    if (res.uploaded > 0) {
      try {
        await hydrateSerialized(session.tenantId);
      } catch (err) {
        console.warn("[cloudSyncPhotos] post-upload refresh falló:", err);
      }
    }
    return res;
  };

  window.__cloudGetPhotoUrl = async (
    filename: string,
    opts?: { force?: boolean },
  ): Promise<string | null> => {
    const session = await getSession();
    if (!session) return null;
    return getCloudPhotoUrl(session.tenantId, filename, opts);
  };

  // Completación de hallazgos compartida (Fase C1).
  // - unitUid = PLACA cruda (no uid de fila placa__fecha) — identidad física.
  // - itemKey = findingKey estable (Llanta:/Bin:/… sin valores volátiles).
  // - Desmarcar = TOMBSTONE upsert {done:false} (no delete): conserva el ts para
  //   que el LWW del dual-read mate alias legacy, y propaga el desmarcado a los
  //   demás usuarios vía merge (el merge viejo ignoraba done:false).
  // - Cola serializada por (placa,key): toggles rápidos on/off aterrizan en orden.
  // - __checkDirty: registro {placaKey → ts} del último toggle local; el merge de
  //   hydrate lo respeta para no pisar un toggle reciente con un snapshot viejo.
  // E2E (?e2e=1) → no-op (sin sesión).
  const checkQueues = new Map<string, Promise<void>>();
  const checkDirty: Record<string, string> = {};
  window.__checkDirty = checkDirty;
  window.__cloudSetCheck = async (
    plate: string,
    itemKey: string,
    done: boolean,
    ts?: string,
  ): Promise<void> => {
    const session = await getSession();
    if (!session) return;
    const stamp = ts ?? new Date().toISOString();
    const qk = `${plate} ${itemKey}`;
    checkDirty[qk] = stamp;
    const prev = checkQueues.get(qk) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined) // un fallo previo no bloquea el siguiente toggle
      .then(() =>
        upsertCheckDone({
          tenantId: session.tenantId,
          unitUid: plate,
          itemKey,
          done,
          por: session.email ?? "",
          ts: stamp,
        }),
      )
      .then(() => undefined);
    checkQueues.set(qk, next);
    try {
      await next;
    } finally {
      if (checkQueues.get(qk) === next) checkQueues.delete(qk);
    }
  };

  // Auth gating al boot: si NO hay sesión, modal aparece inmediatamente y
  // bloquea hasta autenticar. Después de login exitoso, app continúa normal.
  // Si SÍ hay sesión activa (refresh, multi-tab), pasa silencioso.
  // Tras login → hidrata state desde cloud (FASE 6) para que multi-usuario vea
  // mismos datos sin re-subir ZIP.
  // E2E bypass: ?e2e=1 en URL salta el modal de auth (tests Playwright).
  // App corre offline-only sin sesión — útil para smoke/UI tests sin Cognito.
  const E2E_BYPASS = typeof window !== "undefined" && window.location.search.includes("e2e=1");

  void (async () => {
    let session: AuthSession | null = null;
    if (E2E_BYPASS) {
      console.info("[cloud] E2E bypass — auth skipped");
      window.__cloudSession = null;
      return;
    }
    if (await isLoggedIn()) {
      session = await getSession();
      window.__cloudSession = session;
      window.__onCloudSession?.();
      console.info("[cloud] Sesión activa:", session?.email);
    } else {
      if (document.readyState === "loading") {
        await new Promise<void>((r) => document.addEventListener("DOMContentLoaded", () => r()));
      }
      try {
        await showAuthModal({ title: "Control Flotilla" });
        session = await getSession();
        window.__cloudSession = session;
        window.__onCloudSession?.();
        console.info("[cloud] Login exitoso:", session?.email);
      } catch (err) {
        console.error("[cloud] Auth gating falló:", err);
        window.__cloudSession = null;
      }
    }
    // Hidrata desde cloud — multi-usuario ve mismos datos.
    // hydrateFromCloud firma las URLs de fotos del rango por-demanda (sin listar S3).
    if (session) {
      try {
        // Garantiza credenciales AUTENTICADAS del Identity Pool ANTES del primer
        // getUrl del hydrate. Cubre la rama de sesión activa al boot (isLoggedIn=true,
        // sin pasar por login()): sin esto Amplify firma las fotos con credenciales
        // GUEST cacheadas → 403. Ver auth.refreshIdentityPoolCreds (incidente 2026-06-17).
        await forceRefreshSession();
        const result = await hydrateSerialized(session.tenantId);
        if (result.source === "cloud" && result.units > 0) {
          window.notify?.(`☁ ${result.units} unidades cargadas del servidor`, "ok", 3000);
        } else {
          // Cloud sin datos y sin datos locales → ahora sí, ofrecer carga manual
          // (el boot del HTML mantiene el loader "Cargando datos del servidor…"
          // cuando hay credenciales Cognito — fix drop-zone 2026-06-09).
          window.__showEmptyState?.();
        }
      } catch (err) {
        console.error("[cloud] Hydrate falló:", err);
        window.notify?.("Cloud sync indisponible — usando datos locales", "warn", 4000);
        window.__showEmptyState?.();
      }
      // Auto-refresh sin F5: re-hidrata al volver a la pestaña + poll ligero en
      // background (solo cuando la pestaña está visible). Barato porque
      // hydrateFromCloud ahora solo firma fotos NUEVAS. Throttle 60s evita
      // que focus+poll disparen doble.
      setupAutoRefresh(session.tenantId);
    }
  })();
}

// Serializa TODAS las hidrataciones (sync fire-and-forget tras upload +
// auto-refresh). Sin esto, 2+ hydrateFromCloud podían correr a la vez mutando
// window.units / __cloudPhotoUrlMap intercaladamente (interleaving con awaits de
// red → KPIs/fotos transitorios incorrectos). Encola: a lo más una a la vez.
type HydrateResult = Awaited<ReturnType<typeof hydrateFromCloud>>;
let hydrateChain: Promise<unknown> = Promise.resolve();
function hydrateSerialized(tenantId: string): Promise<HydrateResult> {
  const next = hydrateChain.catch(() => {}).then(() => hydrateFromCloud(tenantId));
  hydrateChain = next.catch(() => {}); // la cadena nunca queda en estado rechazado
  return next;
}

let autoRefreshWired = false;
function setupAutoRefresh(tenantId: string): void {
  if (autoRefreshWired) return;
  autoRefreshWired = true;
  const MIN_GAP_MS = 60_000; // máx 1 refresh por minuto
  const POLL_MS = 4 * 60_000; // sondeo ligero cada 4 min (solo si visible)
  let last = Date.now();
  let running = false;

  // No refrescar (re-render) mientras el usuario interactúa: drawer/modal abierto
  // o escribiendo en un campo — evita perder scroll/selección/typing.
  const uiBusy = (): boolean => {
    const det = document.getElementById("det");
    if (det && det.classList.contains("open")) return true;
    if (document.querySelector("#taller-modal.open, #hist-modal.open, #periodo-modal.open"))
      return true;
    const fleet = document.getElementById("fleet-modal");
    if (fleet && fleet.style.display === "flex") return true;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return true;
    return false;
  };

  const refresh = async (reason: string): Promise<void> => {
    if (running) return;
    if (!window.__cloudSession) return; // solo con sesión
    if (Date.now() - last < MIN_GAP_MS) return;
    if (uiBusy()) return; // pospone si el usuario está trabajando
    last = Date.now();
    running = true;
    try {
      await hydrateSerialized(tenantId);
      console.info(`[autoRefresh] datos actualizados (${reason})`);
    } catch (err) {
      console.warn(`[autoRefresh] falló (${reason}):`, err);
    } finally {
      running = false;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh("focus");
  });
  window.addEventListener("focus", () => void refresh("focus"));
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh("poll");
  }, POLL_MS);
}
