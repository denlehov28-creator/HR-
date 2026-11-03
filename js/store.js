// Локальное хранилище на IndexedDB. Все данные (бренд-кит, логотипы, тексты,
// история) остаются только в браузере этого компьютера.

const DB_NAME = "hr-assistant";
const STORE = "kv";
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export async function get(key, fallback = null) {
  try {
    const v = await tx("readonly", (s) => s.get(key));
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  return tx("readwrite", (s) => s.put(value, key));
}

export function del(key) {
  return tx("readwrite", (s) => s.delete(key));
}

export async function allEntries() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = {};
    const t = d.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        out[c.key] = c.value;
        c.continue();
      }
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

export async function clearAll() {
  return tx("readwrite", (s) => s.clear());
}

// ---------- Библиотека сохранённых материалов ----------

export async function saveToLibrary(item) {
  const lib = await get("library", []);
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...item,
  };
  lib.unshift(entry);
  await set("library", lib.slice(0, 500));
  return entry;
}

export async function library() {
  return get("library", []);
}

export async function removeFromLibrary(id) {
  const lib = await get("library", []);
  await set("library", lib.filter((x) => x.id !== id));
}
