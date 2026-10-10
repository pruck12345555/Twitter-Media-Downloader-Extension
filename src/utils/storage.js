/**
 * Twitter Media Downloader - IndexedDB Storage Helper for File Handles
 */

const DB_NAME = 'tmd_file_system_db';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const LAST_HANDLE_KEY = 'last_saved_handle';

/**
 * Opens or initializes the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves the most recent FileSystemHandle from IndexedDB
 * @returns {Promise<FileSystemHandle|null>}
 */
export async function getLastSavedHandle() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(LAST_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Persists the most recent FileSystemHandle in IndexedDB
 * @param {FileSystemHandle} handle
 * @returns {Promise<boolean>}
 */
export async function setLastSavedHandle(handle) {
  if (!handle) return false;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(handle, LAST_HANDLE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
