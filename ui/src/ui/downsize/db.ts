import type { DownsizeItem } from "./types";

const DB_NAME = "openclaw_downsize";
const DB_VERSION = 1;
const STORE_ITEMS = "items";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ITEMS, mode);
        const store = tx.objectStore(STORE_ITEMS);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB tx failed"));
      }),
  );
}

export async function listItems(): Promise<DownsizeItem[]> {
  const items = await withStore("readonly", (store) => store.getAll());
  return (items as DownsizeItem[]).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function getItem(id: string): Promise<DownsizeItem | null> {
  const item = await withStore("readonly", (store) => store.get(id));
  return (item as DownsizeItem | undefined) ?? null;
}

export async function putItem(item: DownsizeItem): Promise<void> {
  await withStore("readwrite", (store) => store.put(item));
}

export async function removeItem(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function clearAll(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

