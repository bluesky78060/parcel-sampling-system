import type { Parcel } from '../types';
import { geocodeAddress, isGeocodingAvailable } from './kakaoGeocoder';

export interface BatchGeocodingOptions {
  concurrency?: number;   // 동시 요청 수 (기본: 5)
  delayMs?: number;       // 배치 간 딜레이 ms (기본: 100)
  maxRetries?: number;    // 실패 시 재시도 횟수 (기본: 2)
  onProgress?: (done: number, total: number, failed: number) => void;
  signal?: AbortSignal;   // 취소 지원
}

/**
 * 배열을 n개씩 나누기
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * ms만큼 대기
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 포함 단일 필지 Geocoding
 */
async function geocodeWithRetry(
  address: string,
  maxRetries: number
): Promise<{ lat: number; lng: number } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await geocodeAddress(address);
    if (result !== null) return result;
    if (attempt < maxRetries) {
      await sleep(500);
    }
  }
  return null;
}

/**
 * 필지 배열에 대해 배치 Geocoding 수행
 * - 좌표가 이미 있는 필지는 건너뜀
 * - parcel.coords에 직접 할당하지 않고 새 배열 반환
 * - 실패한 필지는 coords: null
 */
export async function batchGeocode(
  parcels: Parcel[],
  options?: BatchGeocodingOptions
): Promise<Parcel[]> {
  const concurrency = options?.concurrency ?? 5;
  const delayMs = options?.delayMs ?? 100;
  const maxRetries = options?.maxRetries ?? 2;
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  if (!isGeocodingAvailable()) {
    console.warn('[batchGeocoder] Geocoding API 키가 없습니다. 모든 필지의 coords를 null로 반환합니다.');
    return parcels.map((p) => ({ ...p, coords: p.coords ?? null }));
  }

  // 결과 배열을 원본과 동일한 순서로 유지
  const results: Parcel[] = parcels.map((p) => ({ ...p }));

  // 좌표가 없는 필지의 인덱스만 처리 대상
  const needsGeocode: number[] = [];
  for (let i = 0; i < parcels.length; i++) {
    if (!parcels[i].coords) {
      needsGeocode.push(i);
    }
  }

  const total = needsGeocode.length;
  let done = 0;
  let failed = 0;

  const chunks = chunkArray(needsGeocode, concurrency);

  for (const chunk of chunks) {
    // 취소 신호 확인
    if (signal?.aborted) {
      console.info('[batchGeocoder] 작업이 취소되었습니다.');
      break;
    }

    await Promise.all(
      chunk.map(async (idx) => {
        // 청크 내 개별 항목 처리 전 취소 확인
        if (signal?.aborted) return;

        const parcel = parcels[idx];
        const coords = await geocodeWithRetry(parcel.address, maxRetries);
        results[idx] = { ...results[idx], coords };

        if (coords === null) {
          failed++;
        }
        done++;

        onProgress?.(done, total, failed);
      })
    );

    // 취소된 경우 딜레이 없이 종료
    if (signal?.aborted) break;

    // 마지막 청크가 아닌 경우 rate limit 방지 딜레이
    if (chunk !== chunks[chunks.length - 1]) {
      await sleep(delayMs);
    }
  }

  return results;
}
