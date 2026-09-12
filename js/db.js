/* db.js — хранилище тренировок (IndexedDB) и настроек (localStorage).
   Всё хранится локально на телефоне, никуда не отправляется. */

const DB = (() => {
  const DB_NAME = 'ritm-db';
  const STORE = 'runs';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('start', 'start');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(mode) {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function saveRun(run) {
    const os = await tx('readwrite');
    return new Promise((res, rej) => {
      const r = os.put(run);
      r.onsuccess = () => res(run);
      r.onerror = () => rej(r.error);
    });
  }

  async function getRun(id) {
    const os = await tx('readonly');
    return new Promise((res, rej) => {
      const r = os.get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function allRuns() {
    const os = await tx('readonly');
    return new Promise((res, rej) => {
      const r = os.getAll();
      r.onsuccess = () => res((r.result || []).sort((a, b) => b.start - a.start));
      r.onerror = () => rej(r.error);
    });
  }

  async function deleteRun(id) {
    const os = await tx('readwrite');
    return new Promise((res, rej) => {
      const r = os.delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async function wipe() {
    const os = await tx('readwrite');
    return new Promise((res, rej) => {
      const r = os.clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  // ---- Настройки ----
  const defaults = {
    name: 'Бегун', city: '', weight: 70, wakelock: 1, geocode: 1, mapStyle: 'sat', unlockedAch: [], plan: null,
    voice: 1, voiceEvery: 'km', voiceContent: 'full', voiceLaps: 1,
    track: 0, lapLen: 400,
  };
  function settings() {
    try {
      return Object.assign({}, defaults, JSON.parse(localStorage.getItem('ritm-settings') || '{}'));
    } catch { return Object.assign({}, defaults); }
  }
  function saveSettings(s) {
    localStorage.setItem('ritm-settings', JSON.stringify(s));
  }
  function setSetting(k, v) {
    const s = settings(); s[k] = v; saveSettings(s); return s;
  }

  return { saveRun, getRun, allRuns, deleteRun, wipe, settings, saveSettings, setSetting };
})();
