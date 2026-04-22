// Estado de la aplicación — instancia de Store<AppState> con el shape tipado
// del dominio legado. Usado por módulos nuevos para evitar acoplamiento a
// `window.*`.
//
// Sincronización con legado: `bindLegacyWindow(store)` monta espejos
// bidireccionales entre el store y propiedades específicas de `window`. El
// legado sigue escribiendo a `window.units` etc.; el store se actualiza via
// MutationObserver-like (re-escritura de las props como getters/setters).

import type { ChecklistDB, Unit } from "../types";
import { Store } from "./store";

export type AppState = {
  units: Unit[];
  selectedUid: string | null;
  checklistDB: ChecklistDB;
  hasZip: boolean;
  zipImgs: Record<string, Uint8Array>;
  /** Filename del último archivo cargado (para restore session). */
  lastFilename: string | null;
};

export const INITIAL_STATE: AppState = {
  units: [],
  selectedUid: null,
  checklistDB: {},
  hasZip: false,
  zipImgs: {},
  lastFilename: null,
};

/** Instancia singleton — import y usa directamente desde consumidores. */
export const appStore = new Store<AppState>(INITIAL_STATE);

// ─── Bridge con window global del legado ─────────────────────────────

type WindowMirror = {
  units?: Unit[];
  selId?: string | null;
  checklistDB?: ChecklistDB;
  hasZip?: boolean;
  zipImgs?: Record<string, Uint8Array>;
};

/** Claves bridged: propiedad del legado → campo en AppState */
const BRIDGES: Array<[keyof WindowMirror, keyof AppState]> = [
  ["units", "units"],
  ["selId", "selectedUid"],
  ["checklistDB", "checklistDB"],
  ["hasZip", "hasZip"],
  ["zipImgs", "zipImgs"],
];

/**
 * Instala getters/setters en `window` que hacen espejo con el store.
 * Devuelve función de desmontaje. Diseñado para llamarse UNA vez desde main.ts.
 *
 * Limitación: el legado asigna `window.units = [...]`. Sin sintético, el store
 * no se enteraría. Con este bridge, cualquier `window.units = X` emite al store.
 * Tampoco tocamos mutaciones in-place (`window.units.push(...)`) — el legado
 * típicamente re-asigna, así que OK en práctica.
 */
export function bindLegacyWindow(
  target: Window & WindowMirror = window as Window & WindowMirror,
): () => void {
  const descriptors: Array<[string, PropertyDescriptor | undefined]> = [];

  for (const [winKey, stateKey] of BRIDGES) {
    const k = winKey as string;
    const existing = Object.getOwnPropertyDescriptor(target, k);
    descriptors.push([k, existing]);
    // Si el legado ya expuso un getter/setter (p.ej. bridge dentro del HTML
    // que lee `let units` via closure), encadenamos: el getter legado es la
    // fuente de verdad, y sincronizamos el store en cada lectura/escritura.
    const legacyGet = existing?.get;
    const legacySet = existing?.set;
    const initial = (target as unknown as Record<string, unknown>)[k];
    if (initial !== undefined) {
      // Bootstrap inicial via setter público — dispara subscribers desde el primer valor
      appStore.set(stateKey, initial as AppState[typeof stateKey]);
    }
    Object.defineProperty(target, k, {
      configurable: true,
      enumerable: true,
      get() {
        if (legacyGet) {
          const val = legacyGet.call(target);
          // Sync via setter público para mantener subscribers notificados si cambió
          if (appStore.get(stateKey) !== val) {
            appStore.set(stateKey, val as AppState[typeof stateKey]);
          }
          return val;
        }
        return appStore.get(stateKey) as unknown;
      },
      set(v: unknown) {
        if (legacySet) legacySet.call(target, v);
        appStore.set(stateKey, v as AppState[typeof stateKey]);
      },
    });
  }

  return function unbind() {
    for (const [k, desc] of descriptors) {
      delete (target as unknown as Record<string, unknown>)[k];
      if (desc) Object.defineProperty(target, k, desc);
    }
  };
}
