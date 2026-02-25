import type { LatLng } from '../types';
import { normalizeAddress } from './addressParser';
import { loadAllFromIDB, setToIDB, clearIDBCache } from './geocodeCache';

// 세션 동안 유지되는 캐시: 정규화 주소 → 좌표
const geocodeCache = new Map<string, LatLng>();

export class RateLimitError extends Error {
  constructor(provider: string) {
    super(`Rate limited by ${provider}`);
    this.name = 'RateLimitError';
  }
}

// 개발 환경에서는 Vite 프록시를 통해 CORS 우회
const isDev = import.meta.env.DEV;

// Kakao API
const KAKAO_ADDRESS_URL = isDev
  ? '/api/kakao/v2/local/search/address.json'
  : 'https://dapi.kakao.com/v2/local/search/address.json';
const KAKAO_KEYWORD_URL = isDev
  ? '/api/kakao/v2/local/search/keyword.json'
  : 'https://dapi.kakao.com/v2/local/search/keyword.json';

// VWORLD API (국토교통부)
const VWORLD_GEOCODE_URL = isDev
  ? '/api/vworld/req/address'
  : 'https://api.vworld.kr/req/address';
const VWORLD_DATA_URL = isDev
  ? '/api/vworld/req/data'
  : 'https://api.vworld.kr/req/data';

/**
 * IndexedDB에서 메모리 캐시로 워밍업 (배치 시작 전 호출)
 */
export async function warmupCache(): Promise<number> {
  const persisted = await loadAllFromIDB();
  let loaded = 0;
  for (const [key, coord] of persisted) {
    if (!geocodeCache.has(key)) {
      geocodeCache.set(key, coord);
      loaded++;
    }
  }
  return loaded;
}

/**
 * API 키 존재 여부 확인 (VWORLD 또는 Kakao 중 하나라도 있으면 true)
 */
export function isGeocodingAvailable(): boolean {
  return !!(import.meta.env.VITE_VWORLD_KEY || import.meta.env.VITE_KAKAO_REST_KEY);
}

/**
 * 어떤 Geocoding 서비스를 사용하는지 반환
 */
export function getGeocodingProvider(): 'vworld' | 'kakao' | null {
  if (import.meta.env.VITE_VWORLD_KEY) return 'vworld';
  if (import.meta.env.VITE_KAKAO_REST_KEY) return 'kakao';
  return null;
}

/**
 * 좌표가 봉화군 범위 내인지 검증
 */
function isValidBonghwaCoord(coord: LatLng): boolean {
  return (
    coord.lat >= 36.75 && coord.lat <= 37.15 &&
    coord.lng >= 128.55 && coord.lng <= 129.25
  );
}

// 봉화군 법정동코드 접두사 (경상북도 봉화군 = 47920)
const BONGHWA_PNU_PREFIX = '47920';

// PNU 조회 실패 캐시 (같은 PNU 재조회 방지)
const pnuFailCache = new Set<string>();

// PNU 성공률 추적 → 성공률 낮으면 자동 비활성화
let pnuAttempts = 0;
let pnuSuccesses = 0;
const PNU_SAMPLE_SIZE = 30;    // 최소 시도 후 판정
const PNU_MIN_SUCCESS_RATE = 0.1; // 10% 미만이면 비활성화
let pnuDisabled = false;

/**
 * Shoelace 공식을 이용한 폴리곤 기하학적 중심점(centroid) 계산
 * 단순 꼭짓점 평균 대비 불규칙 필지에서 훨씬 정확한 위치 반환
 * coords: [lng, lat][] (GeoJSON 순서)
 */
export function computePolygonCentroid(coords: number[][]): LatLng {
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const cross = coords[j][0] * coords[i][1] - coords[i][0] * coords[j][1];
    area += cross;
    cx += (coords[j][0] + coords[i][0]) * cross;
    cy += (coords[j][1] + coords[i][1]) * cross;
  }

  area /= 2;

  // 면적이 0에 가까우면 (직선 형태) 단순 평균으로 폴백
  if (Math.abs(area) < 1e-12) {
    let sumLng = 0, sumLat = 0;
    for (const [lng, lat] of coords) {
      sumLng += lng;
      sumLat += lat;
    }
    return { lat: sumLat / coords.length, lng: sumLng / coords.length };
  }

  return {
    lng: cx / (6 * area),
    lat: cy / (6 * area),
  };
}

/**
 * PNU 부번(마지막 4자리)이 0000이면 본번 레이어, 아니면 부번 레이어 우선 조회
 */
function getPnuLayers(pnu: string): string[] {
  const isBonbun = pnu.length >= 19 && pnu.slice(-4) === '0000';
  return isBonbun
    ? ['LP_PA_CBND_BONBUN', 'LP_PA_CBND_BUBUN']
    : ['LP_PA_CBND_BUBUN', 'LP_PA_CBND_BONBUN'];
}

/**
 * PNU 코드로 좌표 변환 (VWORLD 연속지적도 API)
 * 봉화군 PNU만 처리 (47920 접두사)
 * 본번/부번 레이어 모두 조회하여 정확도 향상
 */
export async function geocodePnu(pnu: string): Promise<LatLng | null> {
  // 봉화군 PNU가 아니면 건너뛰기
  if (!pnu.startsWith(BONGHWA_PNU_PREFIX)) return null;

  const cacheKey = `pnu:${pnu}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  // PNU 성공률이 너무 낮으면 API 호출 자체를 스킵
  if (pnuDisabled) return null;

  // 이전에 실패한 PNU는 재조회 스킵
  if (pnuFailCache.has(pnu)) {
    return null;
  }

  const vworldKey = import.meta.env.VITE_VWORLD_KEY;
  if (!vworldKey) return null;

  const layers = getPnuLayers(pnu);
  const pnuStart = Date.now();

  // 두 레이어 병렬 조회 (순차 대비 ~50% 시간 절감)
  const results = await Promise.all(
    layers.map(async (layer) => {
      try {
        const params = new URLSearchParams({
          service: 'data',
          request: 'GetFeature',
          data: layer,
          key: vworldKey,
          format: 'json',
          geometry: 'true',
          crs: 'EPSG:4326',
          attrFilter: `pnu:=:${pnu}`,
          geomFilter: 'BOX(128.55,36.75,129.25,37.15)',
        });

        const res = await fetch(`${VWORLD_DATA_URL}?${params}`);

        if (!res.ok) return null;

        const data = await res.json();
        const features = data.response?.result?.featureCollection?.features;
        if (!features || features.length === 0) return null;

        const geometry = features[0].geometry;
        if (!geometry?.coordinates) return null;

        const coords = geometry.type === 'MultiPolygon'
          ? geometry.coordinates[0][0]
          : geometry.coordinates[0];

        if (!coords || coords.length === 0) return null;

        return computePolygonCentroid(coords);
      } catch {
        return null;
      }
    })
  );

  const pnuElapsed = Date.now() - pnuStart;
  pnuAttempts++;

  // 우선순위 레이어 결과 먼저 사용
  for (const result of results) {
    if (result && isValidBonghwaCoord(result)) {
      pnuSuccesses++;
      geocodeCache.set(cacheKey, result);
      setToIDB(cacheKey, result);
      return result;
    }
  }

  // 두 레이어 모두 실패 → 실패 캐싱
  pnuFailCache.add(pnu);
  if (pnuElapsed > 500) {
    console.info(`  △ PNU 양쪽 레이어 실패 (${pnuElapsed}ms): ${pnu}`);
  }

  // 성공률 판정: 충분히 시도한 후 성공률이 너무 낮으면 PNU 비활성화
  if (pnuAttempts >= PNU_SAMPLE_SIZE && !pnuDisabled) {
    const rate = pnuSuccesses / pnuAttempts;
    if (rate < PNU_MIN_SUCCESS_RATE) {
      pnuDisabled = true;
      console.warn(
        `[geocoder] PNU 자동 비활성화: ${pnuAttempts}건 시도 중 ${pnuSuccesses}건 성공 (${(rate * 100).toFixed(1)}%) → 주소 기반으로 전환`
      );
    }
  }

  return null;
}

/**
 * 단일 필지 좌표 변환
 * Step 1: 주소 기반 지오코딩 (대략적 좌표)
 * Step 2: 폴리곤 스냅 (정확한 필지 중심점) — PNU가 있을 때만
 */
export async function geocodeParcel(address: string, pnu?: string): Promise<LatLng | null> {
  // Step 1: 주소 기반 좌표 (대략적)
  const approxCoord = await geocodeAddress(address);
  if (!approxCoord) return null;

  // Step 2: 폴리곤 중심점 스냅 (PNU가 있으면 정확한 위치로 보정)
  if (pnu) {
    const vworldKey = import.meta.env.VITE_VWORLD_KEY;
    if (vworldKey) {
      const snapped = await snapToPolygonCentroid(approxCoord, pnu, vworldKey);
      if (snapped) {
        // 스냅된 좌표를 캐시에 덮어쓰기
        const cacheKey = normalizeAddress(address);
        geocodeCache.set(cacheKey, snapped);
        setToIDB(cacheKey, snapped);
        return snapped;
      }
    }
  }

  return approxCoord;
}

/**
 * 지오코딩된 좌표를 폴리곤 중심점으로 스냅
 * - 대략적 좌표 주변 소형 BOX로 연속지적도 폴리곤 조회
 * - 반환된 폴리곤 중 PNU 매칭하여 정확한 중심점 계산
 */
async function snapToPolygonCentroid(
  approxCoord: LatLng,
  pnu: string,
  vworldKey: string
): Promise<LatLng | null> {
  // 스냅 캐시 확인
  const snapCacheKey = `snap:${pnu}`;
  if (geocodeCache.has(snapCacheKey)) {
    return geocodeCache.get(snapCacheKey)!;
  }

  // 대략적 좌표 주변 ~500m BOX
  const delta = 0.005;
  const geomFilter = `BOX(${approxCoord.lng - delta},${approxCoord.lat - delta},${approxCoord.lng + delta},${approxCoord.lat + delta})`;

  // PNU 부번으로 레이어 결정
  const isBonbun = pnu.length >= 19 && pnu.slice(-4) === '0000';
  const layers = isBonbun
    ? ['LP_PA_CBND_BONBUN', 'LP_PA_CBND_BUBUN']
    : ['LP_PA_CBND_BUBUN', 'LP_PA_CBND_BONBUN'];

  for (const layer of layers) {
    try {
      const params = new URLSearchParams({
        service: 'data',
        request: 'GetFeature',
        data: layer,
        key: vworldKey,
        format: 'json',
        geometry: 'true',
        crs: 'EPSG:4326',
        geomFilter,
        size: '100',
      });

      const res = await fetch(`${VWORLD_DATA_URL}?${params}`);
      if (!res.ok) continue;

      const data = await res.json();
      const features = data.response?.result?.featureCollection?.features;
      if (!features || features.length === 0) continue;

      // PNU 매칭
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matched = features.find((f: any) => f.properties?.pnu === pnu);
      if (matched) {
        const coords = matched.geometry?.type === 'MultiPolygon'
          ? matched.geometry.coordinates[0][0]
          : matched.geometry.coordinates[0];

        if (coords?.length > 0) {
          const centroid = computePolygonCentroid(coords);
          if (isValidBonghwaCoord(centroid)) {
            // 스냅 결과 캐시
            geocodeCache.set(snapCacheKey, centroid);
            return centroid;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * 단일 주소를 좌표로 변환 (VWORLD 우선, Kakao 폴백)
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const cacheKey = normalizeAddress(address);

  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  // VWORLD 우선 시도
  const vworldKey = import.meta.env.VITE_VWORLD_KEY;
  if (vworldKey) {
    const result = await geocodeVworld(address, vworldKey);
    if (result && isValidBonghwaCoord(result)) {
      geocodeCache.set(cacheKey, result);
      setToIDB(cacheKey, result); // fire-and-forget
      return result;
    }
  }

  // Kakao 폴백
  const kakaoKey = import.meta.env.VITE_KAKAO_REST_KEY;
  if (kakaoKey) {
    const result = await geocodeKakao(address, kakaoKey);
    if (result && isValidBonghwaCoord(result)) {
      geocodeCache.set(cacheKey, result);
      setToIDB(cacheKey, result); // fire-and-forget
      return result;
    }
  }

  return null;
}

/**
 * VWORLD 지오코딩 (국토교통부 무료 API)
 * - 지번 주소 검색 → 도로명 주소 검색 순서
 */
async function geocodeVworld(address: string, apiKey: string): Promise<LatLng | null> {
  // 1. 지번 주소 검색
  try {
    const t1 = Date.now();
    const params = new URLSearchParams({
      service: 'address',
      request: 'getcoord',
      version: '2.0',
      crs: 'epsg:4326',
      address: address,
      format: 'json',
      type: 'parcel',
      key: apiKey,
    });

    const res = await fetch(`${VWORLD_GEOCODE_URL}?${params}`);
    const e1 = Date.now() - t1;

    if (res.status === 429) {
      console.warn(`  ⏳ VWORLD 지번 429 (${e1}ms): ${address}`);
      throw new RateLimitError('vworld');
    }
    if (res.status === 401 || res.status === 403) {
      console.warn('[vworld] API 키 인증 실패:', res.status);
      return null;
    }

    if (res.ok) {
      const data = await res.json();
      if (data.response?.status === 'OK' && data.response?.result?.point) {
        const point = data.response.result.point;
        if (e1 > 500) console.info(`  🐢 VWORLD 지번 느림 (${e1}ms): ${address}`);
        return {
          lat: parseFloat(point.y),
          lng: parseFloat(point.x),
        };
      }
    }
    if (e1 > 500) console.info(`  △ VWORLD 지번 결과없음 (${e1}ms): ${address}`);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn('[vworld] 지번 검색 오류:', err);
  }

  // 2. 도로명 주소 검색
  try {
    const t2 = Date.now();
    const params = new URLSearchParams({
      service: 'address',
      request: 'getcoord',
      version: '2.0',
      crs: 'epsg:4326',
      address: address,
      format: 'json',
      type: 'road',
      key: apiKey,
    });

    const res = await fetch(`${VWORLD_GEOCODE_URL}?${params}`);
    const e2 = Date.now() - t2;

    if (res.status === 429) {
      console.warn(`  ⏳ VWORLD 도로명 429 (${e2}ms): ${address}`);
      throw new RateLimitError('vworld');
    }
    if (res.status === 401 || res.status === 403) {
      console.warn('[vworld] API 키 인증 실패:', res.status);
      return null;
    }

    if (res.ok) {
      const data = await res.json();
      if (data.response?.status === 'OK' && data.response?.result?.point) {
        const point = data.response.result.point;
        if (e2 > 500) console.info(`  🐢 VWORLD 도로명 느림 (${e2}ms): ${address}`);
        return {
          lat: parseFloat(point.y),
          lng: parseFloat(point.x),
        };
      }
    }
    if (e2 > 500) console.info(`  △ VWORLD 도로명 결과없음 (${e2}ms): ${address}`);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn('[vworld] 도로명 검색 오류:', err);
  }

  return null;
}

/**
 * Kakao 지오코딩 (폴백용)
 */
async function geocodeKakao(address: string, apiKey: string): Promise<LatLng | null> {
  const headers = { Authorization: `KakaoAK ${apiKey}` };

  // 1. 주소 검색
  try {
    const res = await fetch(
      `${KAKAO_ADDRESS_URL}?query=${encodeURIComponent(address)}`,
      { headers }
    );

    if (res.status === 429) {
      throw new RateLimitError('kakao');
    }
    if (res.status === 401 || res.status === 403) {
      console.warn('[kakao] API 인증/권한 실패:', res.status);
      return null;
    }

    if (res.ok) {
      const data = await res.json();
      if (data.documents?.length > 0) {
        return {
          lat: parseFloat(data.documents[0].y),
          lng: parseFloat(data.documents[0].x),
        };
      }
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn('[kakao] 주소 검색 오류:', err);
  }

  // 2. 키워드 검색
  try {
    const res = await fetch(
      `${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(address)}`,
      { headers }
    );

    if (res.status === 429) {
      throw new RateLimitError('kakao');
    }
    if (res.status === 401 || res.status === 403) {
      console.warn('[kakao] API 인증/권한 실패:', res.status);
      return null;
    }

    if (res.ok) {
      const data = await res.json();
      if (data.documents?.length > 0) {
        return {
          lat: parseFloat(data.documents[0].y),
          lng: parseFloat(data.documents[0].x),
        };
      }
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn('[kakao] 키워드 검색 오류:', err);
  }

  return null;
}

/**
 * 캐시에서 좌표 조회 (API 호출 없이)
 */
export function getCachedCoords(address: string): LatLng | null {
  const key = normalizeAddress(address);
  return geocodeCache.get(key) ?? null;
}

/**
 * 캐시 초기화
 */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
  pnuFailCache.clear();
  pnuAttempts = 0;
  pnuSuccesses = 0;
  pnuDisabled = false;
  clearIDBCache(); // fire-and-forget
}

/**
 * 캐시된 항목 수
 */
export function getCacheSize(): number {
  return geocodeCache.size;
}

/**
 * 스냅 캐시에서 PNU별 좌표 조회
 */
export function getSnappedCoord(pnu: string): LatLng | null {
  return geocodeCache.get(`snap:${pnu}`) ?? null;
}

/**
 * 리전별 폴리곤 일괄 프리페치
 * - 리(里) 단위 bbox 한 번으로 해당 리의 모든 폴리곤 조회
 * - PNU 매칭 → centroid 계산 → snap 캐시에 일괄 저장
 * - 개별 snap 쿼리 5000+회 → 리전 쿼리 ~60회로 대폭 감소
 */
export async function prefetchRegionalPolygons(
  parcelsWithCoords: Array<{ pnu: string; coords: LatLng; ri: string }>,
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<number> {
  const vworldKey = import.meta.env.VITE_VWORLD_KEY;
  if (!vworldKey) return 0;

  // 이미 스냅 캐시에 있는 PNU 제외
  const uncached = parcelsWithCoords.filter(
    p => p.pnu && !geocodeCache.has(`snap:${p.pnu}`)
  );
  if (uncached.length === 0) return 0;

  // 리별 그룹핑
  const byRi = new Map<string, typeof uncached>();
  for (const p of uncached) {
    const group = byRi.get(p.ri) ?? [];
    group.push(p);
    byRi.set(p.ri, group);
  }

  const layers = ['LP_PA_CBND_BONBUN', 'LP_PA_CBND_BUBUN'];
  const riEntries = [...byRi.entries()];
  let snappedCount = 0;
  let riDone = 0;

  console.group(`[prefetch] 리전별 폴리곤 프리페치 (${byRi.size}개 리, ${uncached.length}개 PNU)`);

  // 리별 조회 (concurrency 5로 429 방지)
  const concurrency = 5;
  let cursor = 0;

  while (cursor < riEntries.length) {
    if (options?.signal?.aborted) break;

    const chunk = riEntries.slice(cursor, cursor + concurrency);
    cursor += chunk.length;

    await Promise.all(chunk.map(async ([ri, parcels]) => {
      if (options?.signal?.aborted) return;

      // 리 내 필지들의 bounding box 계산
      let minLat = Infinity, maxLat = -Infinity;
      let minLng = Infinity, maxLng = -Infinity;
      for (const p of parcels) {
        minLat = Math.min(minLat, p.coords.lat);
        maxLat = Math.max(maxLat, p.coords.lat);
        minLng = Math.min(minLng, p.coords.lng);
        maxLng = Math.max(maxLng, p.coords.lng);
      }

      // ~500m 여유
      const delta = 0.005;
      const geomFilter = `BOX(${minLng - delta},${minLat - delta},${maxLng + delta},${maxLat + delta})`;
      const neededPnus = new Set(parcels.map(p => p.pnu));
      let riSnapped = 0;

      for (const layer of layers) {
        if (neededPnus.size === 0) break;

        try {
          // 페이지네이션: 1000건씩 조회
          let page = 1;
          let hasMore = true;

          while (hasMore && neededPnus.size > 0) {
            const params = new URLSearchParams({
              service: 'data',
              request: 'GetFeature',
              data: layer,
              key: vworldKey,
              format: 'json',
              geometry: 'true',
              crs: 'EPSG:4326',
              geomFilter,
              size: '1000',
              page: String(page),
            });

            const res = await fetch(`${VWORLD_DATA_URL}?${params}`);
            if (!res.ok) break;

            const data = await res.json();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const features: any[] = data.response?.result?.featureCollection?.features ?? [];
            if (features.length === 0) break;

            for (const feature of features) {
              const pnu = feature.properties?.pnu;
              if (!pnu || !neededPnus.has(pnu)) continue;

              const ring = feature.geometry?.type === 'MultiPolygon'
                ? feature.geometry.coordinates[0][0]
                : feature.geometry.coordinates[0];

              if (ring?.length > 0) {
                const centroid = computePolygonCentroid(ring);
                if (isValidBonghwaCoord(centroid)) {
                  geocodeCache.set(`snap:${pnu}`, centroid);
                  setToIDB(`snap:${pnu}`, centroid);
                  neededPnus.delete(pnu);
                  snappedCount++;
                  riSnapped++;
                }
              }
            }

            hasMore = features.length >= 1000;
            page++;
          }
        } catch {
          continue;
        }
      }

      riDone++;
      console.info(`  ${ri}: ${riSnapped}/${parcels.length} PNU 스냅 ${neededPnus.size > 0 ? `(미매칭 ${neededPnus.size})` : ''}`);
      options?.onProgress?.(riDone, byRi.size);
    }));
  }

  console.info(`  완료: ${snappedCount}/${uncached.length}개 PNU 스냅됨`);
  console.groupEnd();
  return snappedCount;
}
