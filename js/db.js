// Lokale Datenbank (IndexedDB): Fächer, Dateien und von der KI erstellte Lernsets.
const DB_NAME = 'lernomat';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('subjects')) db.createObjectStore('subjects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' }).createIndex('subjectId', 'subjectId');
        }
        if (!db.objectStoreNames.contains('sets')) {
          db.createObjectStore('sets', { keyPath: 'id' }).createIndex('subjectId', 'subjectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  all: store => tx(store, 'readonly', s => s.getAll()),
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)).then(() => value),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  bySubject: (store, subjectId) => tx(store, 'readonly', s => s.index('subjectId').getAll(subjectId)),
  clear: store => tx(store, 'readwrite', s => s.clear()),
  async deleteSubject(id) {
    const [files, sets] = await Promise.all([this.bySubject('files', id), this.bySubject('sets', id)]);
    await Promise.all([
      ...files.map(f => this.del('files', f.id)),
      ...sets.map(x => this.del('sets', x.id)),
      this.del('subjects', id),
    ]);
  },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Speicher dauerhaft anfordern, damit der Browser die Daten nicht automatisch löscht.
export function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
