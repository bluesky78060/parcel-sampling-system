import type { Parcel } from '../types';
import { geocodeAddress, isGeocodingAvailable, warmupCache, prefetchPolygonsByPnu, getSnappedCoord, RateLimitError } from './kakaoGeocoder';
import { normalizeAddress, normalizeAddressLotNumber } from './addressParser';


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
 * 배치 Geocoding — PNU 우선
 *
 * Phase 0: PNU 리(里) 단위 일괄 조회 (PNU → 필지 폴리곤 중심점)
 *   - 주소 표기 흔들림(0패딩·산번지·건물명 후행)에 영향받지 않는다
 *   - 지번 대표점이 아니라 필지 기하 중심점이라 더 정확하다
 *   - 리 하나를 통째로 가져오므로 3만 필지도 수십 회 조회로 끝난다
 *
 * Phase 1: 주소 지오코딩 (폴백)
 *   - PNU가 없거나 Phase 0에서 못 찾은 필지만 처리
 *   - 주소 dedup으로 중복 호출 제거, adaptive concurrency로 제한 대응
 *
 * 예전에는 순서가 반대였다. 주소로 좌표를 먼저 만들고 그 좌표로 bbox를 짜서
 * PNU 폴리곤을 조회했기 때문에, 주소가 실패하면 PNU가 있어도 좌표를 한 건도
 * 얻지 못했다(2027 파일이 그 경우였다).
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

  // ===== Phase 0: PNU 리 단위 일괄 조회 =====
  // 주소보다 먼저 시도한다. 주소 표기가 어떻든 PNU만 맞으면 좌표가 나온다.
  const phase0Start = Date.now();
  const pnusToLookup = [
    ...new Set(
      needsGeocode
        .map(i => parcels[i].pnu)
        .filter((v): v is string => !!v && v.trim() !== ''),
    ),
  ];

  // Phase 0가 해결한 필지를 명시적으로 기록한다. results[idx].coords 유무로
  // 판단하면 force=true일 때 "원래 있던 낡은 좌표"와 구분되지 않아, 재변환을
  // 눌러도 주소 폴백을 타지 않고 낡은 좌표가 그대로 남는다.
  const pnuResolvedIdx = new Set<number>();
  let pnuResolved = 0;
  if (pnusToLookup.length > 0) {
    // Phase 0가 3만 건 기준 2분쯤 걸린다. 리 단위 진행을 필지 수로 환산해
    // 보고하지 않으면 그동안 화면이 0건에 멈춰 있는 것처럼 보인다.
    await prefetchPolygonsByPnu(pnusToLookup, {
      signal,
      onProgress: (riDone, riTotal) => {
        if (riTotal === 0) return;
        // 추정치가 실제값(pnuResolved)을 넘어서면 Phase 1 진입 때 진행 바가
        // 뒤로 물러난다. 마지막 1건을 남겨 단조 증가를 유지한다.
        const cap = Math.max(0, needsGeocode.length - 1);
        const estimated = Math.round((riDone / riTotal) * pnusToLookup.length);
        onProgress?.(Math.min(estimated, cap), needsGeocode.length, 0);
      },
    });

    // 스냅 캐시에서 좌표를 꺼내 채운다
    for (const idx of needsGeocode) {
      const pnu = parcels[idx].pnu;
      if (!pnu) continue;
      const snapped = getSnappedCoord(pnu);
      if (snapped) {
        results[idx] = { ...results[idx], coords: snapped };
        pnuResolvedIdx.add(idx);
        pnuResolved++;
      }
    }
    const phase0Elapsed = ((Date.now() - phase0Start) / 1000).toFixed(1);
    console.info(
      `[batchGeocoder] Phase 0 완료: PNU ${pnusToLookup.length.toLocaleString()}종으로 ` +
      `${pnuResolved.toLocaleString()}건 좌표 확보 (${phase0Elapsed}초)`
    );
  }

  // 어느 경로로 끝나든 같은 형식으로 요약을 남긴다.
  // 조기 return에서 요약이 빠지면 전량 PNU 해결·취소 같은 정상 경로의
  // 소요 시간과 성공 건수가 어디에도 기록되지 않는다.
  const logSummary = (addrOk: number, addrFail: number, note = '') => {
    const seconds = ((Date.now() - phase0Start) / 1000).toFixed(1);
    console.info(
      `[batchGeocoder] 전체 완료 (${seconds}초)${note}: ` +
      `PNU ${pnuResolved.toLocaleString()}건 + 주소 ${addrOk.toLocaleString()}건 = ` +
      `${(pnuResolved + addrOk).toLocaleString()}/${needsGeocode.length.toLocaleString()}건 성공, ` +
      `실패 ${addrFail.toLocaleString()}건`
    );
  };

  if (signal?.aborted) {
    logSummary(0, 0, ' — 사용자 취소');
    return results;
  }

  // Phase 1 대상: PNU로 해결되지 않은 필지만
  const needsAddress = needsGeocode.filter(idx => !pnuResolvedIdx.has(idx));
  onProgress?.(pnuResolved, needsGeocode.length, 0);

  if (needsAddress.length === 0) {
    logSummary(0, 0, ' — 전체가 PNU로 해결되어 주소 지오코딩 생략');
    return results;
  }

  // ② 주소 기준 중복 제거 (Phase 1은 주소만 사용하므로 주소로 dedup)
  const addressDedupMap = new Map<string, { representative: number; allIndices: number[] }>();

  for (const idx of needsAddress) {
    const parcel = parcels[idx];
    // geocodeAddress와 같은 기준으로 묶어야 0패딩 표기 차이가 중복 호출로 새지 않는다
    const key = normalizeAddress(normalizeAddressLotNumber(parcel.address));

    const existing = addressDedupMap.get(key);
    if (existing) {
      existing.allIndices.push(idx);
    } else {
      addressDedupMap.set(key, { representative: idx, allIndices: [idx] });
    }
  }

  const uniqueEntries = [...addressDedupMap.values()];
  const totalOriginal = needsAddress.length;
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

  let cursor = 0;
  let batchNum = 0;
  const phase1StartTime = Date.now();

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

        // IndexedDB 저장은 geocodeAddress가 이미 하고 있으므로 여기서 또 쓰지 않는다
        if (coords) {
          if (itemElapsed < 5) chunkCached++;
          else chunkSuccess++;
        }

        if (coords === null) {
          chunkFail += entry.allIndices.length;
          failed += entry.allIndices.length;
        }
        done += entry.allIndices.length;
        // Phase 0에서 이미 해결한 건수를 더해 전체 진행률로 보고한다
        onProgress?.(pnuResolved + done, needsGeocode.length, failed);
      })
    );

    const chunkElapsed = Date.now() - chunkStart;
    const totalElapsed = ((Date.now() - phase1StartTime) / 1000).toFixed(1);
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

  const phase1Elapsed = ((Date.now() - phase1StartTime) / 1000).toFixed(1);
  console.info(`Phase 1 완료: ${done}건, 성공 ${done - failed}건, 실패 ${failed}건 (${phase1Elapsed}초)`);
  console.groupEnd();

  logSummary(done - failed, failed);

  return results;
}
