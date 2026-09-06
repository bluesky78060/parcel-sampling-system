import type { LatLng } from '../types';
import { normalizeAddress, normalizeAddressLotNumber } from './addressParser';
import { loadAllFromIDB, setToIDB, clearIDBCache } from './geocodeCache';
import { jsonp } from './jsonp';

// 세션 동안 유지되는 캐시: 정규화 주소 → 좌표
const geocodeCache = new Map<string, LatLng>();

// 3만~4만 필지 파일이 실사용 규모다. 예전 상한(1만)으로는 한 번의 배치도 담지
// 못해, Phase 0가 스냅한 좌표가 회수되기 전에 밀려나 주소 폴백으로 새어나갔다.
// 항목당 Map 엔트리 + 키 문자열 + {lat,lng} 객체로 대략 120~160바이트이므로
// 20만 건이면 24~32MB 수준이다.
const MAX_COORD_CACHE_SIZE = 200000;

/** 실패 PNU 집합 상한 (좌표 캐시와 성격이 달라 따로 둔다) */
const MAX_PNU_FAIL_CACHE_SIZE = 100000;

/** 캐시에 항목 추가 (크기 초과 시 가장 오래된 항목 제거) */
function cacheSet(key: string, value: LatLng): void {
  if (geocodeCache.size >= MAX_COORD_CACHE_SIZE) {
    const firstKey = geocodeCache.keys().next().value;
    if (firstKey !== undefined) geocodeCache.delete(firstKey);
  }
  geocodeCache.set(key, value);
}

/** pnuFailCache에 항목 추가 (크기 초과 시 가장 오래된 항목 제거) */
function pnuFailCacheAdd(pnu: string): void {
  if (pnuFailCache.size >= MAX_PNU_FAIL_CACHE_SIZE) {
    const firstKey = pnuFailCache.keys().next().value;
    if (firstKey !== undefined) pnuFailCache.delete(firstKey);
  }
  pnuFailCache.add(pnu);
}

export class RateLimitError extends Error {
  constructor(provider: string) {
    super(`Rate limited by ${provider}`);
    this.name = 'RateLimitError';
  }
}

// 개발 환경에서는 Vite 프록시를 통해 CORS 우회
// 프로덕션에서는 직접 호출 (VWORLD: CORS 허용, Kakao REST: 서버 전용이므로 프로덕션에서 사용 불가)
const isDev = import.meta.env.DEV;

// Kakao API — 아래 경로는 vite dev 서버 프록시 전용이다.
// 프로덕션(GitHub Pages)에서는 상대경로가 되어 404이고, Kakao REST는 CORS상
// 브라우저에서 직접 호출할 수도 없다. 프로덕션에서 쓰려면 서버 프록시가 필요하다(후속 과제).
const KAKAO_ADDRESS_URL = '/api/kakao/v2/local/search/address.json';
const KAKAO_KEYWORD_URL = '/api/kakao/v2/local/search/keyword.json';

// Kakao REST 사용 가능 여부 판정은 이 상수 한 곳에서만 한다.
const KAKAO_REST_USABLE = isDev && !!import.meta.env.VITE_KAKAO_REST_KEY;

// VWORLD API (국토교통부)
// 주의: VWORLD는 Access-Control-Allow-Origin 헤더를 보내지 않는다. fetch로 부르면
// 서버는 200 OK를 주지만 브라우저가 응답을 차단한다(타일·WMS는 <img>라서 무관).
// VWORLD가 callback 파라미터로 JSONP를 지원하므로 데이터 조회는 전부 jsonp()로 한다.
// dev/prod 모두 같은 경로를 쓰므로 vite 프록시에 의존하지 않는다.
const VWORLD_GEOCODE_URL = 'https://api.vworld.kr/req/address';
const VWORLD_DATA_URL = 'https://api.vworld.kr/req/data';

/**
 * VWORLD 인증키. 반드시 이 함수를 거쳐 읽는다.
 *
 * 2026-09-06 프로덕션 장애: GitHub Secret에 키를 넣을 때 앞에 공백이 들어갔고,
 * 빌드가 `" EF3461DD-…"`를 그대로 번들에 박았다. URL에 실리면 `key=+EF3461DD-…`가
 * 되어(`+`는 공백) VWORLD가 전 요청에 `INVALID_KEY 등록되지 않은 인증키입니다`를
 * 돌려줬다. 4만 건이 통째로 실패했고, 원인이 화면에 드러나지 않아 한참을 헤맸다.
 *
 * 환경변수는 사람이 복사·붙여넣기로 채우는 값이므로 앞뒤 공백·따옴표를 걷어낸다.
 */
export function getVworldKey(): string {
  const raw = import.meta.env.VITE_VWORLD_KEY;
  if (!raw) return '';
  return String(raw).trim().replace(/^["']|["']$/g, '');
}

/** VWORLD 응답 공통 형태 */
interface VworldResponse {
  response?: {
    status?: string;
    error?: { code?: string; text?: string };
    result?: { point?: { x: string; y: string }; featureCollection?: { features?: unknown[] } };
  };
}

/** 쿼터 초과·과다요청 계열 오류 코드 판정 (JSONP는 HTTP 상태를 볼 수 없다) */
function isRateLimited(err?: { code?: string; text?: string }): boolean {
  const code = (err?.code ?? '').toUpperCase();
  const text = err?.text ?? '';
  return code.includes('QUOTA') || code.includes('LIMIT') || code.includes('OVER')
    || text.includes('초과') || text.includes('제한');
}

/**
 * IndexedDB에서 메모리 캐시로 워밍업 (배치 시작 전 호출)
 */
export async function warmupCache(): Promise<number> {
  const persisted = await loadAllFromIDB();
  let loaded = 0;
  for (const [key, coord] of persisted) {
    if (!geocodeCache.has(key)) {
      // cacheSet을 거쳐야 상한이 실제로 지켜진다. IDB는 TTL 30일 동안 여러
      // 파일의 스냅 좌표가 누적되므로 직접 set하면 상한이 무의미해진다.
      cacheSet(key, coord);
      loaded++;
    }
  }
  return loaded;
}

/**
 * 실제로 호출 가능한 Geocoding 경로가 있는지 확인
 * (VWORLD 키가 있거나, dev 프록시에서 Kakao REST를 쓸 수 있을 때만 true)
 */
export function isGeocodingAvailable(): boolean {
  return !!getVworldKey() || KAKAO_REST_USABLE;
}

/**
 * 어떤 Geocoding 서비스를 사용하는지 반환
 */
export function getGeocodingProvider(): 'vworld' | 'kakao' | null {
  if (getVworldKey()) return 'vworld';
  if (KAKAO_REST_USABLE) return 'kakao';
  return null;
}

/**
 * 좌표가 봉화군 범위 내인지 검증
 */
function isValidBonghwaCoord(coord: LatLng): boolean {
  // 연속지적도 표본 14,400필지 실측(2026-09-04): lat 36.74782~37.08306,
  // lng 128.62637~129.37416. 예전 범위(36.75~37.15 / 128.55~129.25)는
  // 남단(봉성면)과 동단(소천면) 필지를 실제로 잘라냈다. 여유를 둔다.
  return (
    coord.lat >= 36.70 && coord.lat <= 37.15 &&
    coord.lng >= 128.55 && coord.lng <= 129.45
  );
}

// 봉화군 법정동코드 접두사 (경상북도 봉화군 = 47920)
const BONGHWA_PNU_PREFIX = '47920';

/** VWORLD 부하로 실패했을 때 재시도 횟수 */
const PNU_FETCH_RETRIES = 3;

/** 대기. signal이 오면 남은 시간을 기다리지 않고 즉시 깨어난다 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * PNU 앞 10자리 = 리(里)까지의 법정동코드
 * [시도2][시군구3][읍면동3][리2] — 이 단위로 묶어 일괄 조회한다
 */
const PNU_RI_PREFIX_LENGTH = 10;

/** PNU 정규 길이 (시도2+시군구3+읍면동3+리2+산1+본번4+부번4) */
const PNU_LENGTH = 19;

/** VWORLD가 키·권한 문제로 거절했는지 (부하 시에도 같은 문구가 나올 수 있다) */
function isAuthError(text: string): boolean {
  // 영문 메시지에 key가 부분 문자열로 섞여 들어오는 오탐을 막으려고 단어 경계를 둔다
  return /인증키|인증|권한|\bAPI_?KEY\b|\bAUTH\w*\b/i.test(text);
}

/** 서로 다른 리 이만큼이 같은 인증 오류로 죽으면 영구 실패로 본다 */
const AUTH_FAIL_RI_THRESHOLD = 2;

/** 리 하나에서 넘길 최대 페이지 수 (실측 최대 5페이지) */
const MAX_PAGES_PER_RI = 20;

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

/** @deprecated 호출처 없음. 되살리려면 fetch를 jsonp()로 바꿔야 한다 (VWORLD는 CORS 미허용). */
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

  const vworldKey = getVworldKey();
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
      cacheSet(cacheKey, result);
      setToIDB(cacheKey, result);
      return result;
    }
  }

  // 두 레이어 모두 실패 → 실패 캐싱
  pnuFailCacheAdd(pnu);
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
    const vworldKey = getVworldKey();
    if (vworldKey) {
      const snapped = await snapToPolygonCentroid(approxCoord, pnu, vworldKey);
      if (snapped) {
        // 스냅된 좌표를 캐시에 덮어쓰기
        const cacheKey = normalizeAddress(address);
        cacheSet(cacheKey, snapped);
        setToIDB(cacheKey, snapped);
        return snapped;
      }
    }
  }

  return approxCoord;
}

/** @deprecated geocodeParcel에서만 쓰였고 그것도 호출처가 없다. 되살리려면 jsonp() 필요. */
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
            cacheSet(snapCacheKey, centroid);
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
export async function geocodeAddress(rawAddress: string): Promise<LatLng | null> {
  // 원본 파일에 따라 지번이 0으로 채워져 있다(운계리 0165-0001).
  // VWORLD가 선행 0을 인식하지 못하므로 조회용으로만 정규화한다.
  // (표시·엑셀에 나가는 주소는 원본 그대로 둔다)
  const address = normalizeAddressLotNumber(rawAddress);
  const cacheKey = normalizeAddress(address);

  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  // VWORLD 우선 시도
  const vworldKey = getVworldKey();
  if (vworldKey) {
    const result = await geocodeVworld(address, vworldKey);
    if (result && isValidBonghwaCoord(result)) {
      cacheSet(cacheKey, result);
      setToIDB(cacheKey, result); // fire-and-forget
      return result;
    }
  }

  // Kakao 폴백 (dev 프록시에서만 동작)
  const kakaoKey = import.meta.env.VITE_KAKAO_REST_KEY;
  if (KAKAO_REST_USABLE && kakaoKey) {
    const result = await geocodeKakao(address, kakaoKey);
    if (result && isValidBonghwaCoord(result)) {
      cacheSet(cacheKey, result);
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
  // 지번 → 도로명 순으로 시도한다
  for (const type of ['parcel', 'road'] as const) {
    const label = type === 'parcel' ? '지번' : '도로명';
    const t0 = Date.now();
    try {
      const data = await jsonp<VworldResponse>(VWORLD_GEOCODE_URL, {
        service: 'address',
        request: 'getcoord',
        version: '2.0',
        crs: 'epsg:4326',
        address,
        format: 'json',
        type,
        key: apiKey,
      });
      const elapsed = Date.now() - t0;
      const res = data.response;

      if (res?.status === 'ERROR') {
        if (isRateLimited(res.error)) {
          console.warn(`  ⏳ VWORLD ${label} 쿼터 초과 (${elapsed}ms): ${res.error?.text ?? ''}`);
          throw new RateLimitError('vworld');
        }
        console.warn(`[vworld] ${label} 오류: ${res.error?.code ?? ''} ${res.error?.text ?? ''}`);
        // 인증키 문제라면 도로명으로 재시도해도 같은 결과다
        if ((res.error?.code ?? '').toUpperCase().includes('KEY')) return null;
        continue;
      }

      const point = res?.result?.point;
      if (res?.status === 'OK' && point) {
        if (elapsed > 500) console.info(`  🐢 VWORLD ${label} 느림 (${elapsed}ms): ${address}`);
        return { lat: parseFloat(point.y), lng: parseFloat(point.x) };
      }
      if (elapsed > 500) console.info(`  △ VWORLD ${label} 결과없음 (${elapsed}ms): ${address}`);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      console.warn(`[vworld] ${label} 검색 오류:`, err);
    }
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
 * PNU 리(里) 단위 일괄 조회로 필지 중심점을 채운다.
 *
 * 기존 방식은 주소 지오코딩이 준 좌표로 bbox를 만들어 조회했기 때문에,
 * 주소가 실패하면 PNU가 있어도 좌표를 한 건도 얻지 못했다.
 * 여기서는 좌표 없이 **PNU만으로** 조회한다.
 *
 * PNU 19자리 구조: [시도2][시군구3][읍면동3][리2][산1][본번4][부번4]
 * 앞 10자리가 리(里)까지의 코드이므로 `pnu:like:<10자리>%` 로 리 하나를
 * 통째로 가져온다. 봉화군 리가 60여 개이므로 3만 필지도 수십 회 조회로 끝난다.
 *
 * 주의: VWORLD 데이터 API는 Referer(등록 도메인)를 검증한다. 브라우저에서는
 * 자동으로 붙지만, 서버에서 호출하면 "인증키 정보가 올바르지 않습니다"가 나온다.
 */
export async function prefetchPolygonsByPnu(
  pnus: string[],
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<number> {
  const vworldKey = getVworldKey();
  if (!vworldKey) return 0;

  // 이미 스냅 캐시에 있거나, 연속지적도에 없다고 판명된 PNU는 제외한다.
  // 후자를 빼지 않으면 미해결 몇 건 때문에 리를 통째로 다시 내려받게 된다.
  const uncached = pnus.filter(
    pnu => pnu && !geocodeCache.has(`snap:${pnu}`) && !pnuFailCache.has(pnu)
  );
  if (uncached.length === 0) return 0;

  // 리(里) 코드(앞 10자리)로 묶는다
  const byRiCode = new Map<string, Set<string>>();
  for (const pnu of uncached) {
    // VWORLD가 돌려주는 pnu는 항상 19자리다. 길이가 다르면 조회해봐야
    // 매칭이 안 되므로 조회 자체를 하지 않는다.
    if (pnu.length !== PNU_LENGTH) continue;
    // 오타로 다른 시군 코드가 섞이면 그 리를 통째로 내려받고도 좌표 검증에서
    // 전량 버려진다. 조회 전에 잘라낸다.
    if (!pnu.startsWith(BONGHWA_PNU_PREFIX)) continue;
    const code = pnu.slice(0, PNU_RI_PREFIX_LENGTH);
    const set = byRiCode.get(code) ?? new Set<string>();
    set.add(pnu);
    byRiCode.set(code, set);
  }

  // LP_PA_CBND_BUBUN 하나가 본번 필지까지 전부 포함한다(리별 실측 매칭률 100%).
  // LP_PA_CBND_BONBUN은 VWORLD에 존재하지 않는 레이어명이라 호출할수록 낭비다.
  const LAYER = 'LP_PA_CBND_BUBUN';
  const entries = [...byRiCode.entries()];
  let snappedCount = 0;
  let done = 0;
  let authFailed = false;
  const failedRi = new Set<string>();
  const authErrorRis = new Set<string>();

  console.group(`[PNU 스냅] 리 ${byRiCode.size}개 / PNU ${uncached.length.toLocaleString()}건`);

  // 리 단위 조회는 응답이 크므로 동시성을 낮게 유지한다
  const concurrency = 3;
  let cursor = 0;

  while (cursor < entries.length) {
    if (options?.signal?.aborted || authFailed) break;

    const chunk = entries.slice(cursor, cursor + concurrency);
    cursor += chunk.length;
    if (cursor > chunk.length) await sleep(150, options?.signal); // 연속 호출 사이 짧은 간격

    await Promise.all(chunk.map(async ([riCode, needed]) => {
      if (options?.signal?.aborted) return;
      try {
        const wanted = new Set(needed);
        let riSnapped = 0;
        let page = 1;
        let hasMore = true;

        while (hasMore && wanted.size > 0) {
          if (options?.signal?.aborted) return;

          // VWORLD는 부하가 걸리면 "인증키 정보가 올바르지 않습니다"를 돌려준다.
          // 영구 실패로 보고 포기하면 리 하나가 통째로 누락되므로 물러섰다 재시도한다.
          let data: VworldResponse | null = null;
          for (let attempt = 0; attempt < PNU_FETCH_RETRIES; attempt++) {
            if (options?.signal?.aborted) return;
            try {
              const res = await jsonp<VworldResponse>(VWORLD_DATA_URL, {
                service: 'data',
                request: 'GetFeature',
                data: LAYER,
                key: vworldKey,
                format: 'json',
                geometry: 'true',
                crs: 'EPSG:4326',
                // 앞 10자리(리 코드)로 시작하는 모든 필지
                attrFilter: `pnu:like:${riCode}%`,
                size: '1000',
                page: String(page),
              }, { signal: options?.signal, timeoutMs: 45000 });

              if (res.response?.status === 'ERROR') {
                const text = res.response.error?.text ?? '';
                if (attempt < PNU_FETCH_RETRIES - 1) {
                  await sleep(800 * (attempt + 1), options?.signal);
                  continue;
                }
                // 여기까지 왔으면 재시도를 다 쓴 것이다.
                // 키가 죽었거나 도메인이 미등록이면 남은 리를 다 돌아도 같은 답이지만,
                // VWORLD는 과부하일 때도 같은 문구를 돌려주므로 메시지만으로 단정할 수
                // 없다. 한 건도 성공하지 못한 상태에서 서로 다른 리 2개가 같은 이유로
                // 죽었을 때만 영구 실패로 보고 접는다.
                if (isAuthError(text) && snappedCount === 0) {
                  authErrorRis.add(riCode);
                  if (authErrorRis.size >= AUTH_FAIL_RI_THRESHOLD) {
                    console.error(
                      `[vworld] 리 ${authErrorRis.size}개가 연속 인증 오류 — PNU 일괄 조회를 중단합니다: ${text}`
                    );
                    authFailed = true;
                    failedRi.add(riCode);
                    return;
                  }
                }
                console.warn(`  ${riCode} p${page} 조회 실패(${PNU_FETCH_RETRIES}회): ${text}`);
                break;
              }
              data = res;
              break;
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') return;
              if (attempt < PNU_FETCH_RETRIES - 1) {
                await sleep(800 * (attempt + 1), options?.signal);
                continue;
              }
              console.warn(`  ${riCode} p${page} 예외:`, err);
            }
          }

          if (!data) { failedRi.add(riCode); break; }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const features: any[] = (data.response?.result?.featureCollection?.features ?? []) as any[];
          if (features.length === 0) break;

          for (const feature of features) {
            const pnu = feature.properties?.pnu;
            if (!pnu || !wanted.has(pnu)) continue;

            const ring = feature.geometry?.type === 'MultiPolygon'
              ? feature.geometry.coordinates[0][0]
              : feature.geometry.coordinates[0];

            if (ring?.length > 0) {
              const centroid = computePolygonCentroid(ring);
              if (isValidBonghwaCoord(centroid)) {
                cacheSet(`snap:${pnu}`, centroid);
                setToIDB(`snap:${pnu}`, centroid);
                wanted.delete(pnu);
                snappedCount++;
                riSnapped++;
              }
            }
          }

          hasMore = features.length >= 1000;
          page++;
          // 서버가 page를 무시하면 종료 조건이 영영 성립하지 않는다.
          // 가장 큰 리가 5페이지(4,356필지)이므로 20이면 충분히 여유롭다.
          if (page > MAX_PAGES_PER_RI) {
            console.warn(`  ${riCode} 페이지 상한(${MAX_PAGES_PER_RI}) 초과 — 중단`);
            failedRi.add(riCode);
            break;
          }
          // 큰 리는 페이지가 여러 장이다. 연속으로 몰아치면 502를 부른다.
          if (hasMore) await sleep(100, options?.signal);
        }

        // 조회 자체가 성공했는데도 안 나온 PNU는 연속지적도에 없는 것이 증명된
        // 셈이다. 기록해두지 않으면 재실행 때마다 이 리를 통째로 다시 받는다.
        if (!failedRi.has(riCode)) {
          for (const missing of wanted) pnuFailCacheAdd(missing);
        }

        if (wanted.size > 0) {
          console.info(`  ${riCode}: ${riSnapped}/${needed.size} (미매칭 ${wanted.size})`);
        } else {
          console.info(`  ${riCode}: ${riSnapped}/${needed.size}`);
        }
      } catch (err) {
        // 파싱에서 예기치 못한 예외가 나도 배치 전체가 죽지 않게 한다
        failedRi.add(riCode);
        console.warn(`  ${riCode} 처리 중 예외:`, err);
      }

      // 진행 보고는 try 밖에 둔다. 호출자 콜백(React setState)이 던졌을 때
      // 이미 성공한 리가 실패로 기록되면 안 된다.
      done++;
      options?.onProgress?.(done, byRiCode.size);
    }));
  }

  console.info(
    `  완료: ${snappedCount.toLocaleString()}/${uncached.length.toLocaleString()}건 스냅` +
    (failedRi.size > 0 ? ` — 조회 실패 리 ${failedRi.size}개: ${[...failedRi].slice(0, 10).join(', ')}` : '')
  );
  console.groupEnd();
  return snappedCount;
}
