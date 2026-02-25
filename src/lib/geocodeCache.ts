import type { LatLng } from '../types';

/**
 * IndexedDB 기반 영구 지오코드 캐시
 * - 브라우저 새로고침/재시작 후에도 유지
 * - TTL 30일
 * - 메모리 Map과 이중 레이어로 사용
 */

const DB_NAME = 'geocode-cache';
const STORE_NAME = 'coords';
const DB_VERSION = 2; // v2: BONBUN/BUBUN 양쪽 레이어 지원으로 기존 캐시 무효화
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

interface CacheEntry {
  key: string;
  lat: number;
  lng: number;
  ts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 버전 업그레이드 시 기존 스토어 삭제 후 재생성 (잘못된 캐시 무효화)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 단일 항목 조회 */
export async function getFromIDB(key: string): Promise<LatLng | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        if (entry && Date.now() - entry.ts < TTL_MS) {
          resolve({ lat: entry.lat, lng: entry.lng });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** 단일 항목 저장 */
export async function setToIDB(key: string, coord: LatLng): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({
        key,
        lat: coord.lat,
        lng: coord.lng,
        ts: Date.now(),
      } as CacheEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // IndexedDB 실패해도 동작에 영향 없음
  }
}

/** 전체 캐시를 메모리 Map으로 로드 (배치 시작 전 워밍업) */
export async function loadAllFromIDB(): Promise<Map<string, LatLng>> {
  const map = new Map<string, LatLng>();
  try {
    const db = await openDB();
    const now = Date.now();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const entry = cursor.value as CacheEntry;
          if (now - entry.ts < TTL_MS) {
            map.set(entry.key, { lat: entry.lat, lng: entry.lng });
          }
          cursor.continue();
        } else {
          resolve(map);
        }
      };
      req.onerror = () => resolve(map);
    });
  } catch {
    return map;
  }
}

/** 여러 항목 일괄 저장 */
export async function bulkSetToIDB(entries: Array<{ key: string; coord: LatLng }>): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const now = Date.now();
      for (const { key, coord } of entries) {
        store.put({ key, lat: coord.lat, lng: coord.lng, ts: now } as CacheEntry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 무시
  }
}

/** 캐시 초기화 */
export async function clearIDBCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 무시
  }
}

/** 캐시 항목 수 */
export async function getIDBCacheSize(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}
