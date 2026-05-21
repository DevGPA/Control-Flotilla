// Cloud wire: expone funciones API a window.* para que el HTML legado
// pueda invocarlas sin refactor del monolito.
//
// Flujo:
// 1. configureAmplify() corre al import (side effect).
// 2. Sin gating: app boot normal con IndexedDB local.
// 3. Usuario sube ZIP → legacy doZip parsea + guarda IndexedDB.
//    Después llama window.__cloudSyncZip(zip) para push a DynamoDB.
// 4. Si no logged in, __cloudSyncZip muestra authModal automáticamente.
// 5. Login exitoso → reintenta upload → toast con resultado.

import { configureAmplify } from "./amplifyClient";
import { isLoggedIn, getSession, logout, type AuthSession } from "./auth";
import { showAuthModal } from "../ui/authModal";
import {
  uploadZipToCloud,
  uploadUnitsToCloud,
  type BatchResult,
  type LegacyUnit,
} from "./batchUpload";
import {
  listUnits,
  listTaller,
  listNotas,
  listChecklists,
  listPeriodos,
  listSemanales,
} from "./client";
import type { LoadedZip } from "../io/zipLoader";

// Configura SDK Amplify al cargar este módulo.
configureAmplify();

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
    /** Refetch todos los datos del tenant — overwrite state local. */
    __cloudFetchAll?: () => Promise<CloudSnapshot | null>;
    /** Notify wrapper del legado (toast). */
    notify?: (msg: string, kind?: string, ms?: number) => void;
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
  let session = await getSession();
  if (!session) {
    await showAuthModal({ title: "Sincronización Cloud" });
    session = await getSession();
    if (!session) throw new Error("Login falló — sesión sin tenantId");
  }
  window.__cloudSession = session;
  return session;
}

window.__cloudLogin = async (): Promise<AuthSession> => {
  return ensureSession();
};

window.__cloudLogout = async (): Promise<void> => {
  await logout();
  window.__cloudSession = null;
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
  }
  return res;
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

// Auth gating al boot: si NO hay sesión, modal aparece inmediatamente y
// bloquea hasta autenticar. Después de login exitoso, app continúa normal.
// Si SÍ hay sesión activa (refresh, multi-tab), pasa silencioso.
void (async () => {
  if (await isLoggedIn()) {
    window.__cloudSession = await getSession();
    console.info("[cloud] Sesión activa:", window.__cloudSession?.email);
    return;
  }
  // Esperar un tick para que el DOM esté listo antes de inyectar el modal.
  if (document.readyState === "loading") {
    await new Promise<void>((r) => document.addEventListener("DOMContentLoaded", () => r()));
  }
  try {
    await showAuthModal({ title: "Control Flotilla" });
    window.__cloudSession = await getSession();
    console.info("[cloud] Login exitoso:", window.__cloudSession?.email);
  } catch (err) {
    console.error("[cloud] Auth gating falló:", err);
    window.__cloudSession = null;
  }
})();
