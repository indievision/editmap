import type { Project } from "../models/project";

const DB_NAME = "editmap";
/**
 * Bump DB_VERSION and add a migration below to change the schema. Migrations
 * run in order for every version between the stored one and DB_VERSION.
 * (Browser tests open this database by version number; update them together.)
 */
export const DB_VERSION = 1;
const migrations: Record<number, (db: IDBDatabase, tx: IDBTransaction) => void> = {
  1: (db) => {
    db.createObjectStore("projects", { keyPath: "id" });
  },
};

export type StorageErrorKind = "quota" | "unavailable" | "unknown";
export class StorageError extends Error {
  constructor(public kind: StorageErrorKind, message: string, public cause?: unknown) {
    super(message);
    this.name = "StorageError";
  }
}

/** Maps a raw IndexedDB/DOM failure to something the UI can explain. */
export function classifyStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "QuotaExceededError")
    return new StorageError("quota", "Browser storage is full.", error);
  if (["SecurityError", "InvalidStateError", "VersionError", "AbortError", "UnknownError"].includes(name))
    return new StorageError("unavailable", "Browser storage is unavailable.", error);
  return new StorageError("unknown", (error as Error | null)?.message || "Browser storage failed.", error);
}

// One long-lived connection instead of open/close per operation. It is dropped
// when another tab upgrades the schema or the browser closes it, and reopened
// on next use.
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (connection) return connection;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(classifyStorageError(error));
      return;
    }
    request.onupgradeneeded = (event) => {
      const tx = request.transaction!;
      for (let v = event.oldVersion + 1; v <= (event.newVersion ?? DB_VERSION); v++) migrations[v]?.(request.result, tx);
    };
    request.onsuccess = () => {
      const db = request.result;
      const drop = () => {
        if (connection === opening) connection = undefined;
      };
      db.onversionchange = () => {
        db.close();
        drop();
      };
      db.onclose = drop;
      resolve(db);
    };
    request.onerror = () => reject(classifyStorageError(request.error));
    request.onblocked = () => reject(new StorageError("unavailable", "Close other EditMap tabs to finish updating storage."));
  });
  connection = opening;
  opening.catch(() => {
    if (connection === opening) connection = undefined;
  });
  return opening;
}

/** Asks the browser not to evict this origin's data under storage pressure. */
export async function requestPersistentStorage(): Promise<"granted" | "denied" | "unsupported"> {
  try {
    if (!navigator.storage?.persist) return "unsupported";
    if (await navigator.storage.persisted?.()) return "granted";
    return (await navigator.storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage != null && estimate.quota ? { usage: estimate.usage, quota: estimate.quota } : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project) {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    throw classifyStorageError(error);
  }
}
export async function listProjects(): Promise<Project[]> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const r = db.transaction("projects").objectStore("projects").getAll();
      r.onsuccess = () =>
        resolve(
          r.result.sort((a: Project, b: Project) =>
            b.updatedAt.localeCompare(a.updatedAt),
          ),
        );
      r.onerror = () => reject(r.error);
    });
  } catch (error) {
    throw classifyStorageError(error);
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readonly");
      const r = tx.objectStore("projects").get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch (error) {
    throw classifyStorageError(error);
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    throw classifyStorageError(error);
  }
}
