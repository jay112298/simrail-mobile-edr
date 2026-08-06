// Minimal IndexedDB key/value store.
//
// Timetables are ~10 KB per train and static for the life of a server
// session, so they are worth persisting: a cold start re-reads them instead
// of re-fetching ~150 trains. localStorage is the wrong tool here — it is
// synchronous and caps out around 5 MB, which a full server's timetables
// would blow through.

const DB_NAME = 'simrail-edr'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    // A blocked or unavailable IndexedDB (private mode, quota) must not take
    // the app down — callers fall back to fetching.
    req.onerror = () => resolve(null)
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDB().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export function idbGet<T>(key: string): Promise<T | null> {
  return tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>)
}

export function idbSet(key: string, value: unknown): Promise<unknown> {
  return tx('readwrite', (s) => s.put(value, key) as IDBRequest<unknown>)
}

/** Drop every cached entry whose key starts with `prefix`. */
export async function idbClearPrefix(prefix: string): Promise<void> {
  const db = await openDB()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      const req = store.openKeyCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        if (String(cursor.key).startsWith(prefix)) store.delete(cursor.key)
        cursor.continue()
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
