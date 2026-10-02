import type { Project } from "../models/project";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("editmap", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveProject(project: Project) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function listProjects(): Promise<Project[]> {
  const db = await database();
  try {
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
  } finally {
    db.close();
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readonly");
      const r = tx.objectStore("projects").get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

