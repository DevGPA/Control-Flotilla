// Wrapper mínimo sobre IndexedDB tipado. Migración iterativa desde
// `Control de flotilla.html` (funciones openDB, dbPut, dbGet).

const DB_NAME = "gpa_fleet";
const DB_VER = 8;
const STORES = ["meta", "images", "notes", "actions", "checklist", "manualPhotos", "taller", "weekly"] as const;
type Store = (typeof STORES)[number];

let _db: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => {
      _db = req.result;
      // Si otra pestaña hace upgrade (bump DB_VER), esta conexión queda stale.
      // Cierra + resetea cache para que próxima operación reabra con schema nuevo.
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      _db.onclose = () => {
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut<T>(store: Store, key: IDBValidKey, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value as unknown, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGet<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

export async function dbDelete(store: Store, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
