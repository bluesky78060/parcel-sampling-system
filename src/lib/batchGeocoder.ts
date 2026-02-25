import type { Parcel } from '../types';
import { geocodeAddress, isGeocodingAvailable, warmupCache, prefetchRegionalPolygons, getSnappedCoord, RateLimitError } from './kakaoGeocoder';
import { normalizeAddress } from './addressParser';
import { bulkSetToIDB } from './geocodeCache';

export interface BatchGeocodingOptions {
  concurrency?: number;   // 초기 동시 요청 수 (기본: 25)
  maxRetries?: number;    // 실패 시 재시도 횟수 (기본: 1)
  force?: boolean;        // 기존 좌표가 있어도 재지오코딩 (기본: false)
  onProgress?: (done: number, total: number, failed: number) => void;
  signal?: AbortSignal;   // 취소 지원
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 배치 Geocoding (2단계 최적화)
 *
 * Phase 1: 주소 지오코딩 (주소 → 대략적 좌표)
 *   - 주소 dedup으로 중복 API 호출 제거
 *   - Adaptive concurrency로 429 자동 대응
 *
 * Phase 2: 리전별 폴리곤 프리페치 (PNU → 정확한 좌표)
 *   - 리(里) 단위 bbox 한 번으로 수백 PNU 일괄 처리
 *   - 개별 쿼리 5000+회 → 리전 쿼리 ~60회로 대폭 감소
 */
export async function batchGeocode(
  parcels: Parcel[],
  options?: BatchGeocodingOptions
): Promise<Parcel[]> {
  const initialConcurrency = options?.concurrency ?? 25;
  const maxRetries = options?.maxRetries ?? 1;
  const force = options?.force ?? false;
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  if (!isGeocodingAvailable()) {
    console.warn('[batchGeocoder] Geocoding API 키가 없습니다.');
    return parcels.map((p) => ({ ...p, coords: p.coords ?? null }));
  }

  // ① IndexedDB → 메모리 캐시 워밍업
  const warmupCount = await warmupCache();
  if (warmupCount > 0) {
    console.info(`[batchGeocoder] IndexedDB에서 ${warmupCount}건 캐시 로드됨`);
  }

  const results: Parcel[] = parcels.map((p) => ({ ...p }));

  // 좌표가 없는 필지만 처리 대상 (force=true이면 전체 재변환)
  const needsGeocode: number[] = [];
  for (let i = 0; i < parcels.length; i++) {
    if (force || !parcels[i].coords) {
      needsGeocode.push(i);
    }
  }

  if (needsGeocode.length === 0) {
    onProgress?.(0, 0, 0);
    return results;
  }

  // ② 주소 기준 중복 제거 (Phase 1은 주소만 사용하므로 주소로 dedup)
  const addressDedupMap = new Map<string, { representative: number; allIndices: number[] }>();

  for (const idx of needsGeocode) {
    const parcel = parcels[idx];
    const key = normalizeAddress(parcel.address);

    const existing = addressDedupMap.get(key);
    if (existing) {
      existing.allIndices.push(idx);
    } else {
      addressDedupMap.set(key, { representative: idx, allIndices: [idx] });
    }
  }

  const uniqueEntries = [...addressDedupMap.values()];
  const totalOriginal = needsGeocode.length;
  const totalUnique = uniqueEntries.length;

  if (totalUnique < totalOriginal) {
    console.info(
      `[batchGeocoder] dedup: ${totalOriginal}건 → ${totalUnique}건 (${totalOriginal - totalUnique}건 중복 제거)`
    );
  }

  // ===== Phase 1: 주소 지오코딩 =====
  let currentConcurrency = initialConcurrency;
  let currentDelay = 10;
  let consecutiveCleanBatches = 0;

  let done = 0;
  let failed = 0;
  const idbWriteBuffer: Array<{ key: string; coord: { lat: number; lng: number } }> = [];

  let cursor = 0;
  let batchNum = 0;
  const batchStartTime = Date.now();

  console.group('[batchGeocoder] Phase 1: 주소 지오코딩');
  console.info(`총 ${totalOriginal}건 (고유 주소 ${totalUnique}건), 동시 요청: ${initialConcurrency}`);

  while (cursor < uniqueEntries.length) {
    if (signal?.aborted) break;

    batchNum++;
    const chunk = uniqueEntries.slice(cursor, cursor + currentConcurrency);
    cursor += chunk.length;

    const chunkStart = Date.now();
    let chunkRateLimited = 0;
    let chunkSuccess = 0;
    let chunkFail = 0;
    let chunkCached = 0;

    await Promise.all(
      chunk.map(async (entry) => {
        if (signal?.aborted) return;

        const parcel = parcels[entry.representative];
        const itemStart = Date.now();

        // 주소 지오코딩만 (snap 없이)
        let coords: { lat: number; lng: number } | null = null;
        let rateLimited = false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            coords = await geocodeAddress(parcel.address);
            break;
          } catch (err) {
            if (err instanceof RateLimitError) {
              rateLimited = true;
              break;
            }
            if (attempt < maxRetries) {
              await sleep(200);
            }
          }
        }

        const itemElapsed = Date.now() - itemStart;
        if (rateLimited) chunkRateLimited++;

        // 결과를 모든 동일 주소 필지에 복사
        for (const idx of entry.allIndices) {
          results[idx] = { ...results[idx], coords };
        }

        // IndexedDB 저장 버퍼
        if (coords) {
          const cacheKey = normalizeAddress(parcel.address);
          idbWriteBuffer.push({ key: cacheKey, coord: coords });
          if (itemElapsed < 5) chunkCached++;
          else chunkSuccess++;
        }

        if (coords === null) {
          chunkFail += entry.allIndices.length;
          failed += entry.allIndices.length;
        }
        done += entry.allIndices.length;
        onProgress?.(done, totalOriginal, failed);
      })
    );

    const chunkElapsed = Date.now() - chunkStart;
    const totalElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    console.info(
      `  배치 #${batchNum}: ${chunk.length}건 → 성공 ${chunkSuccess} / 캐시 ${chunkCached} / 실패 ${chunkFail} / 429 ${chunkRateLimited} (${chunkElapsed}ms) [누적 ${done}/${totalOriginal}, ${totalElapsed}s]`
    );

    if (signal?.aborted) break;

    // Adaptive concurrency 조절
    if (chunkRateLimited > 0) {
      currentConcurrency = Math.max(5, Math.floor(currentConcurrency / 2));
      currentDelay = Math.min(2000, Math.max(200, currentDelay * 2));
      consecutiveCleanBatches = 0;
      console.warn(
        `  ⚠ Rate limit! concurrency: ${currentConcurrency}, delay: ${currentDelay}ms`
      );
    } else {
      consecutiveCleanBatches++;
      if (consecutiveCleanBatches >= 3) {
        const prevConcurrency = currentConcurrency;
        currentConcurrency = Math.min(initialConcurrency, currentConcurrency + 5);
        currentDelay = Math.max(0, currentDelay - 50);
        if (currentConcurrency !== prevConcurrency) {
          console.info(
            `  ↑ 회복: concurrency ${prevConcurrency} → ${currentConcurrency}, delay: ${currentDelay}ms`
          );
        }
      }
    }

    if (cursor < uniqueEntries.length && currentDelay > 0) {
      await sleep(currentDelay);
    }
  }

  const phase1Elapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);
  console.info(`Phase 1 완료: ${done}건, 성공 ${done - failed}건, 실패 ${failed}건 (${phase1Elapsed}초)`);
  console.groupEnd();

  // ===== Phase 2: 리전별 폴리곤 스냅 =====
  if (!signal?.aborted) {
    const phase2Start = Date.now();

    // PNU + 좌표가 있는 필지만 수집
    const parcelsForSnap = results
      .filter(p => p.pnu && p.coords)
      .map(p => ({ pnu: p.pnu!, coords: p.coords!, ri: p.ri }));

    if (parcelsForSnap.length > 0) {
      const snapCount = await prefetchRegionalPolygons(parcelsForSnap, { signal });

      // 스냅 결과 적용
      if (snapCount > 0) {
        let applied = 0;
        for (let i = 0; i < results.length; i++) {
          const p = results[i];
          if (p.pnu) {
            const snapped = getSnappedCoord(p.pnu);
            if (snapped) {
              results[i] = { ...results[i], coords: snapped };
              applied++;
            }
          }
        }
        const phase2Elapsed = ((Date.now() - phase2Start) / 1000).toFixed(1);
        console.info(`[batchGeocoder] Phase 2 완료: ${applied}건 좌표 스냅 적용 (${phase2Elapsed}초)`);
      }
    }
  }

  const totalSeconds = ((Date.now() - batchStartTime) / 1000).toFixed(1);
  console.info(
    `[batchGeocoder] 전체 완료: ${done}건 처리, 성공 ${done - failed}건, 실패 ${failed}건 (${totalSeconds}초)`
  );

  // IndexedDB에 일괄 저장 (fire-and-forget)
  if (idbWriteBuffer.length > 0) {
    bulkSetToIDB(idbWriteBuffer);
  }

  return results;
}
