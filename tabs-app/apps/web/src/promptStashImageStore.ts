/**
 * Where Stash keeps the pixels of saved screenshots.
 *
 * localStorage holds about 5 MB for the whole app and stores strings, so a few screenshots filled
 * it and Stash refused the draft. Images go to IndexedDB instead: it survives closing the app, has
 * room for many images, and each image is deleted the moment its draft is used, removed or cleared.
 * The draft itself (text and image names) stays in localStorage and points at the images by key.
 */

export interface StashImageBackend {
  put: (key: string, dataUrl: string) => Promise<void>;
  getMany: (keys: ReadonlyArray<string>) => Promise<Map<string, string>>;
  deleteMany: (keys: ReadonlyArray<string>) => Promise<void>;
  keys: () => Promise<ReadonlyArray<string>>;
}

const DATABASE_NAME = "tabs-prompt-stash";
const STORE_NAME = "images";

/** One image of one saved draft. Includes the draft id so re-saving a restored image never collides. */
export function stashImageKey(entryId: string, attachmentId: string): string {
  return `${entryId}/${attachmentId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function createIndexedDbBackend(): StashImageBackend | null {
  if (typeof indexedDB === "undefined") return null;
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opened = null;
        reject(request.error);
      };
    });
    return opened;
  };
  return {
    put: async (key, dataUrl) => {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(dataUrl, key);
      await transactionDone(transaction);
    },
    getMany: async (keys) => {
      const db = await open();
      const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
      const found = new Map<string, string>();
      await Promise.all(
        keys.map(async (key) => {
          const value = await requestResult(store.get(key));
          if (typeof value === "string") found.set(key, value);
        }),
      );
      return found;
    },
    deleteMany: async (keys) => {
      if (keys.length === 0) return;
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const key of keys) store.delete(key);
      await transactionDone(transaction);
    },
    keys: async () => {
      const db = await open();
      const all = await requestResult(
        db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys(),
      );
      return all.filter((key): key is string => typeof key === "string");
    },
  };
}

export function createMemoryStashImageBackend(): StashImageBackend & {
  readonly size: () => number;
} {
  const data = new Map<string, string>();
  return {
    put: async (key, dataUrl) => void data.set(key, dataUrl),
    getMany: async (keys) =>
      new Map(keys.flatMap((key) => (data.has(key) ? [[key, data.get(key)!] as const] : []))),
    deleteMany: async (keys) => void keys.forEach((key) => data.delete(key)),
    keys: async () => [...data.keys()],
    size: () => data.size,
  };
}

let backend: StashImageBackend | null | undefined;

/** The backend images are stored in, or null when the browser has no IndexedDB. */
export function stashImageBackend(): StashImageBackend | null {
  if (backend === undefined) {
    try {
      backend = createIndexedDbBackend();
    } catch {
      backend = null;
    }
  }
  return backend;
}

export function setStashImageBackendForTest(next: StashImageBackend | null): void {
  backend = next;
}
