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
import { showAuthModal } from "../ui/authModal";
import {
  uploadZipToCloud,
  uploadUnitsToCloud,
  uploadSemanalesToCloud,
  uploadTallerToCloud,
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
} from "./client";
import { hydrateFromCloud } from "./cloudHydrate";
import { uploadPhotosToS3, type PhotoUploadResult } from "./photoUpload";
import { getCloudPhotoUrl, indexCloudPhotos } from "./photoFetch";
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
    /** Borra un Taller record del cloud por su entry legacy. */
    __cloudDeleteTaller?: (entry: LegacyTallerEntry) => Promise<void>;
    /** Refetch todos los datos del tenant — overwrite state local. */
    __cloudFetchAll?: () => Promise<CloudSnapshot | null>;
    /** Hidrata window.units desde cloud + trigger re-render UI legacy. */
    __cloudHydrate?: () => Promise<{ units: number; source: "cloud" | "empty" } | null>;
    /** Sube fotos a S3 (Record<filename, Uint8Array>). */
    __cloudSyncPhotos?: (images: Record<string, Uint8Array>) => Promise<PhotoUploadResult>;
    /** Obtiene URL firmada de S3 para una foto (lazy, cacheada hasta su expiresAt real).
     *  opts.force re-firma fresca (usado por el onerror del <img> para auto-sanar 403). */
    __cloudGetPhotoUrl?: (filename: string, opts?: { force?: boolean }) => Promise<string | null>;
    /** Notify wrapper del legado (toast). */
    notify?: (msg: string, kind?: string, ms?: number) => void;
    /** Hook del HTML: re-pinta email + botón logout cuando cambia __cloudSession. */
    __onCloudSession?: () => void;
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
      void hydrateFromCloud(session.tenantId).catch((err) =>
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
      void hydrateFromCloud(session.tenantId).catch((err) =>
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
      void hydrateFromCloud(session.tenantId).catch((err) =>
        console.error("[cloudSyncTaller] re-hydrate falló:", err),
      );
    }
    return res;
  };

  window.__cloudDeleteTaller = async (entry: LegacyTallerEntry): Promise<void> => {
    const session = await ensureSession();
    const unitUid = entry.plate || entry.eco || entry.unitKey || entry.id;
    const fechaEntrada = entry.fentrada || entry.freporte || entry.updatedAt;
    if (!unitUid || !fechaEntrada) {
      throw new Error("deleteTaller: faltan unitUid o fechaEntrada");
    }
    await deleteTaller({
      tenantId: session.tenantId,
      unitUid: String(unitUid),
      fechaEntrada,
    });
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
    return hydrateFromCloud(session.tenantId);
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
    // Refresca índice cloud + URLs pre-fetched para que imgUrl encuentre las nuevas.
    if (res.uploaded > 0) {
      try {
        await indexCloudPhotos(session.tenantId);
        await hydrateFromCloud(session.tenantId);
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
    // hydrateFromCloud ya hace indexCloudPhotos internamente antes de
    // batchGetCloudPhotoUrls para evitar race con URL map.
    if (session) {
      try {
        const result = await hydrateFromCloud(session.tenantId);
        if (result.source === "cloud" && result.units > 0) {
          window.notify?.(`☁ ${result.units} unidades cargadas del servidor`, "ok", 3000);
        }
      } catch (err) {
        console.error("[cloud] Hydrate falló:", err);
        window.notify?.("Cloud sync indisponible — usando datos locales", "warn", 4000);
      }
      // Auto-refresh sin F5: re-hidrata al volver a la pestaña + poll ligero en
      // background (solo cuando la pestaña está visible). Barato porque
      // hydrateFromCloud ahora solo firma fotos NUEVAS. Throttle 60s evita
      // que focus+poll disparen doble.
      setupAutoRefresh(session.tenantId);
    }
  })();
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
      await hydrateFromCloud(tenantId);
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
