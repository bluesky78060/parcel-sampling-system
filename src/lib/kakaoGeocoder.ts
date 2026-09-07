import type { LatLng } from '../types';
import { normalizeAddress, normalizeAddressLotNumber } from './addressParser';
import { loadAllFromIDB, setToIDB, clearIDBCache } from './geocodeCache';
import { jsonp, JsonpNetworkError, JsonpTimeoutError } from './jsonp';
import { BONGHWA_BOUNDS, isInBonghwaBounds } from './bonghwaBounds';
import { riCodePrefix } from './pnuGenerator';

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

/**
 * 서버가 응답하지 않아 좌표를 얻지 못했을 때.
 *
 * "좌표를 못 찾았다"(null)와 반드시 구분해야 한다. 2026-09-06 장애에서 VWORLD가
 * 502를 돌려주는 동안 geocodeVworld가 네트워크 오류를 삼키고 null을 반환했고,
 * 호출자는 그것을 "이 주소에는 좌표가 없다"로 받아들여 4만 건을 끝까지 시도했다.
 *
 * JSONP는 script 태그로 부르므로 HTTP 상태 코드를 볼 수 없다. 502인지 503인지
 * DNS 실패인지 구분이 불가능하다는 뜻이라, 메시지에 특정 상태 코드를 적지 않는다.
 */
export class GeocodeServiceError extends Error {
  // 파라미터 프로퍼티는 erasableSyntaxOnly에서 쓸 수 없어 명시 필드로 둔다
  readonly kind: GeocodeFailureKind;

  constructor(message: string, kind: GeocodeFailureKind = 'unreachable') {
    super(message);
    this.name = 'GeocodeServiceError';
    this.kind = kind;
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
  // 경계값은 lib/bonghwaBounds 하나만 쓴다. 지도 쪽(mapUtils.isInBonghwa)과
  // 갈라져 있던 탓에 여기서 통과한 좌표가 마커에서 버려진 적이 있다.
  return isInBonghwaBounds(coord.lat, coord.lng);
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

/**
 * VWORLD ERROR 응답이 인증 문제인지 — 이 파일의 **유일한** 판정 기준.
 *
 * 예전에는 호출 지점마다 달랐다. Phase 0와 헬스체크는 `isAuthError(text)`를,
 * 주소 지오코딩만 `code.includes('KEY')`를 썼다. VWORLD가 code 없이 text만 보내면
 * 주소 경로만 인증 오류를 놓치고 "이 주소에 좌표가 없다"로 집계했다.
 */
function isAuthErrorResponse(err?: { code?: string; text?: string }): boolean {
  return isAuthError(err?.text ?? '') || (err?.code ?? '').toUpperCase().includes('KEY');
}

/**
 * 한 건도 성공하지 못한 상태에서 서로 다른 리 이만큼이 죽으면 서비스 장애로 본다.
 *
 * 원래는 인증 오류에만 적용했다. 2026-09-06 VWORLD 502 장애에서 그 조건이
 * 무의미했다 — 502는 JSONP script 로드 실패로 나타나므로 인증 오류 문구를
 * 띄우지 않는다. 그래서 앱이 4만 건을 끝까지 시도했다. 사유를 가리지 않는다.
 */
const SERVICE_DOWN_RI_THRESHOLD = 2;

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
  if (coords.length === 0) return { lat: 0, lng: 0 };

  // 원점을 폴리곤 첫 점으로 옮긴 뒤 계산한다.
  //
  // 절대좌표로 바로 계산하면 작은 필지에서 결과가 수 km 날아간다. 봉화군 좌표는
  // lng 128·lat 36 규모라 `x_j*y_i - x_i*y_j`가 4,750쯤 되는 두 수의 차인데,
  // 2m×2m 필지에서 그 차이는 1e-10 수준이다. double의 유효숫자 15~16자리 중
  // 상위 4자리가 같아 상쇄되고, 남은 오차에 (x_j+x_i)≈257을 곱한 뒤 작은 면적으로
  // 나누면서 증폭된다.
  //
  // 실측(2026-09-07, 연속지적도 표본 1,600필지): 이 보정 전에는 **62%**의 centroid가
  // 자기 폴리곤 밖에 떨어졌고 최대 8km까지 벗어났다. 상대좌표로 옮기면 값이 1e-5
  // 규모가 되어 상쇄가 사라진다.
  const [ox, oy] = coords[0];

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xj = coords[j][0] - ox, yj = coords[j][1] - oy;
    const xi = coords[i][0] - ox, yi = coords[i][1] - oy;
    const cross = xj * yi - xi * yj;
    area += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }

  area /= 2;

  // 면적이 0에 가까우면 (직선·점 형태) 단순 평균으로 폴백.
  // 임계값은 상대좌표 기준이다. 봉화군 위도에서 1 deg² ≈ 111,000m × 88,000m이므로
  // 1e-16 deg² ≈ 1e-6 m²(1mm²)다. 실측 최소 필지(2m 삼각형, 면적 ~2m² = 2e-10 deg²)보다
  // 6자리 작아 실제 필지는 걸리지 않고, 점·선·공선(共線) 도형만 걸린다.
  // (옛 임계값 1e-12는 절대좌표 기준이었고 2m 필지 면적보다 커서 폴백이 안 걸렸다)
  if (Math.abs(area) < 1e-16) {
    let sumLng = 0, sumLat = 0;
    for (const [lng, lat] of coords) {
      sumLng += lng;
      sumLat += lat;
    }
    return { lat: sumLat / coords.length, lng: sumLng / coords.length };
  }

  return {
    lng: cx / (6 * area) + ox,
    lat: cy / (6 * area) + oy,
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
          // 경계 상수의 세 번째 사본이 여기 숨어 있었다. 호출처가 없는 코드지만,
          // 되살릴 때 옛 상자가 남단·동단 필지를 잘라내지 않도록 단일 출처를 쓴다.
          geomFilter: `BOX(${BONGHWA_BOUNDS.lngMin},${BONGHWA_BOUNDS.latMin},${BONGHWA_BOUNDS.lngMax},${BONGHWA_BOUNDS.latMax})`,
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
  let serviceError: GeocodeServiceError | null = null;
  if (vworldKey) {
    try {
      const result = await geocodeVworld(address, vworldKey);
      if (result && isValidBonghwaCoord(result)) {
        cacheSet(cacheKey, result);
        setToIDB(cacheKey, result); // fire-and-forget
        return result;
      }
    } catch (err) {
      if (err instanceof GeocodeServiceError) {
        // 아직 던지지 않는다. Kakao 폴백이 살아 있으면 그쪽으로 좌표를 얻을 수 있다.
        serviceError = err;
      } else {
        throw err;
      }
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

  // 모든 경로가 서버 미응답으로 끝났다 — null(좌표 없음)로 위장시키지 않는다
  if (serviceError) throw serviceError;

  return null;
}

/**
 * VWORLD 지오코딩 (국토교통부 무료 API)
 * - 지번 주소 검색 → 도로명 주소 검색 순서
 */
async function geocodeVworld(address: string, apiKey: string): Promise<LatLng | null> {
  // 서버가 응답하지 않은 횟수. 좌표를 못 찾은 것과 구분하려고 따로 센다.
  let unreachable = 0;
  // 서버가 한 번이라도 답했는가. 답했다면 서버는 살아 있는 것이므로,
  // 다른 시도가 네트워크 오류로 죽었더라도 장애로 보고하지 않는다.
  let responded = false;

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
        // 인증키 문제는 도로명으로 재시도해도 같은 결과다. 그리고 이것은 "이 주소에
        // 좌표가 없다"가 아니다 — null로 돌려주면 데이터 문제로 집계되어 4만 건을
        // 끝까지 시도하게 된다. VWORLD는 API별로 키를 따로 등록하므로, 데이터 API가
        // 멀쩡해도 지오코딩 API만 거부될 수 있다.
        if (isAuthErrorResponse(res.error)) {
          throw new GeocodeServiceError(
            `VWORLD 지오코딩이 인증키를 거부했습니다: ${res.error?.text ?? ''}`, 'auth');
        }
        // 그 밖의 ERROR는 서버가 답한 것이므로 생존 신호로 본다
        responded = true;
        continue;
      }

      // 정상 응답 — 결과가 없어도 서버는 살아 있다
      responded = true;

      const point = res?.result?.point;
      if (res?.status === 'OK' && point) {
        if (elapsed > 500) console.info(`  🐢 VWORLD ${label} 느림 (${elapsed}ms): ${address}`);
        return { lat: parseFloat(point.y), lng: parseFloat(point.x) };
      }
      if (elapsed > 500) console.info(`  △ VWORLD ${label} 결과없음 (${elapsed}ms): ${address}`);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      // 키 거부는 도로명으로 바꿔도 같은 답이다. 여기서 삼키면 호출자가
      // "이 주소에 좌표가 없다"로 받아들여 4만 건을 끝까지 시도한다.
      if (err instanceof GeocodeServiceError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof JsonpNetworkError || err instanceof JsonpTimeoutError) unreachable++;
      console.warn(`[vworld] ${label} 검색 오류:`, err);
    }
  }

  // 서버가 한 번도 답하지 않은 채 미응답만 관측됐다면 데이터 문제가 아니다.
  //
  // `unreachable > 0`만 보면 안 된다. 지번 조회가 일시적 패킷 유실로 죽고 도로명은
  // 정상 응답(결과 없음)한 경우까지 서버 장애로 보고하게 되고, 그 오탐이 배치 단위
  // 조기 중단으로 증폭된다. 정상 응답이 한 번이라도 있었으면 서버는 살아 있다.
  if (unreachable > 0 && !responded) {
    throw new GeocodeServiceError('VWORLD 지오코딩 서버가 응답하지 않습니다');
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
export async function clearGeocodeCache(): Promise<void> {
  geocodeCache.clear();
  pnuFailCache.clear();
  pnuAttempts = 0;
  pnuSuccesses = 0;
  pnuDisabled = false;
  // IndexedDB 삭제를 기다린다. 예전에는 fire-and-forget이라, 재변환이 곧바로
  // warmupCache()를 돌리면 아직 지워지지 않은 낡은 좌표를 다시 읽어 들였다.
  // 캐시 회수가 네트워크보다 앞에 있는 지금은 그 낡은 값이 곧장 결과가 된다.
  await clearIDBCache();
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
/** VWORLD가 왜 실패했는가 — 사용자 문구와 조치를 가르는 기준 */
export type GeocodeFailureKind = 'auth' | 'unreachable' | 'quota';

export interface PnuPrefetchResult {
  /** 이번 실행에서 새로 좌표를 얻은 PNU 수 */
  snapped: number;
  /** 조회에 실패한 리 코드 */
  failedRi: string[];
  /** 서비스 장애로 판단해 남은 리를 포기했는가 */
  serviceDown: boolean;
  failureKind: GeocodeFailureKind | null;
  /** 마지막으로 관측한 실패 사유 (로그·디버깅용) */
  lastError: string | null;
}

const EMPTY_PREFETCH: PnuPrefetchResult = {
  snapped: 0, failedRi: [], serviceDown: false, failureKind: null, lastError: null,
};

export async function prefetchPolygonsByPnu(
  pnus: string[],
  options?: {
    signal?: AbortSignal;
    /**
     * 리 완료 수와 함께 **실제로 스냅한 PNU 수**를 준다. 호출자가 리 완료율을 필지
     * 수로 환산해 진행률로 쓰면 지적도에 없는 PNU가 많을 때 확보 0건에 진행률 100%가
     * 뜬다 — 장애 화면에서 "다 됐는데 결과가 없다"로 읽히는 바로 그 표시다.
     */
    onProgress?: (riDone: number, riTotal: number, snapped: number) => void;
  }
): Promise<PnuPrefetchResult> {
  const vworldKey = getVworldKey();
  if (!vworldKey) return EMPTY_PREFETCH;

  // 이미 스냅 캐시에 있거나, 연속지적도에 없다고 판명된 PNU는 제외한다.
  // 후자를 빼지 않으면 미해결 몇 건 때문에 리를 통째로 다시 내려받게 된다.
  const uncached = pnus.filter(
    pnu => pnu && !geocodeCache.has(`snap:${pnu}`) && !pnuFailCache.has(pnu)
  );
  if (uncached.length === 0) return EMPTY_PREFETCH;

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
  let serviceDown = false;
  // 실패 사유별 리 개수. 먼저 온 사유가 굳지 않도록 카운트로 정한다.
  // (auth 우선 규칙은 quota 도입 전의 것이라, 리1이 한도·리2가 인증이면 한도가 묻혔다)
  const kindCounts: Record<GeocodeFailureKind, number> = { auth: 0, quota: 0, unreachable: 0 };
  let lastError: string | null = null;
  const failedRi = new Set<string>();

  /**
   * 서버가 응답하지 않은 채 죽은 리의 **연속** 누적.
   *
   * 청크에서 서버 응답이 한 번이라도 있으면 비운다. 누적 성공 건수로 판정하면
   * "처음부터 죽은" 경우만 잡고 실행 중 장애는 통과시킨다 — 성공 건수는 단조
   * 증가하므로 한 번 성공한 뒤에는 가드가 영영 무장되지 않기 때문이다.
   */
  const deadRiStreak = new Set<string>();

  /**
   * 이번 청크에서 서버가 정상 응답했는가.
   *
   * 판정을 리 콜백 안에서 하면 같은 청크의 늦은 성공이 이미 선 판정을 되돌리지
   * 못한다(리 A·B가 먼저 죽고 C가 곧이어 1,000건을 스냅해도 중단된 채로 끝난다).
   * 그래서 기록만 하고 판정은 `await Promise.all` 뒤 청크 경계에서 한 번만 한다.
   *
   * "결과가 비어 있는 응답"도 생존 신호다. 신규 스냅 건수로 대신하면 캐시가 차 있는
   * 재개 실행에서 서버가 멀쩡해도 장애로 오판한다.
   */
  let chunkSawResponse = false;
  /** 이번 청크에서 미응답으로 죽은 리 */
  let chunkDeadRi: string[] = [];

  /** 리 하나의 조회가 최종 실패했음을 기록한다. 판정은 하지 않는다. */
  const recordRiFailure = (riCode: string, kind: GeocodeFailureKind, message: string) => {
    failedRi.add(riCode);
    lastError = message;
    kindCounts[kind]++;
    chunkDeadRi.push(riCode);
  };

  console.group(`[PNU 스냅] 리 ${byRiCode.size}개 / PNU ${uncached.length.toLocaleString()}건`);

  // 리 단위 조회는 응답이 크므로 동시성을 낮게 유지한다
  const concurrency = 3;
  let cursor = 0;

  while (cursor < entries.length) {
    if (options?.signal?.aborted || serviceDown) break;

    chunkSawResponse = false;
    chunkDeadRi = [];
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
                recordRiFailure(
                  riCode,
                  isRateLimited(res.response.error) ? 'quota'
                    : isAuthErrorResponse(res.response.error) ? 'auth'
                    : 'unreachable',
                  text,
                );
                console.warn(`  ${riCode} p${page} 조회 실패(${PNU_FETCH_RETRIES}회): ${text}`);
                break;
              }
              // 결과가 비어 있어도 서버는 답한 것이다 — 생존 신호로 기록한다
              chunkSawResponse = true;
              data = res;
              break;
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') return;
              if (attempt < PNU_FETCH_RETRIES - 1) {
                await sleep(800 * (attempt + 1), options?.signal);
                continue;
              }
              // 502·타임아웃·DNS 실패가 전부 여기로 온다. 예전에는 이 경로가
              // 실패로 집계되지 않아 서버가 죽어도 4만 건을 끝까지 돌았다.
              recordRiFailure(riCode, 'unreachable', err instanceof Error ? err.message : String(err));
              console.warn(`  ${riCode} p${page} 예외:`, err);
            }
          }

          // recordRiFailure가 이미 기록한 경우가 대부분이지만, 어느 경로로 오든
          // 실패 리 집합에는 반드시 들어가야 한다(Set이므로 중복은 무해).
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
      options?.onProgress?.(done, byRiCode.size, snappedCount);
    }));

    // ── 청크 경계에서 한 번만 판정한다 ──
    if (chunkSawResponse) {
      // 서버가 살아 있다. 이 청크에서 죽은 리는 개별 리의 문제이므로 연속을 끊는다.
      deadRiStreak.clear();
    } else {
      for (const ri of chunkDeadRi) deadRiStreak.add(ri);
      if (deadRiStreak.size >= SERVICE_DOWN_RI_THRESHOLD) {
        serviceDown = true;
        console.error(
          `[vworld] 서버 응답 없이 리 ${deadRiStreak.size}개가 연속 실패 — ` +
          `PNU 일괄 조회를 중단합니다: ${lastError ?? '원인 불명'}`
        );
      }
    }
  }

  console.info(
    `  완료: ${snappedCount.toLocaleString()}/${uncached.length.toLocaleString()}건 스냅` +
    (failedRi.size > 0 ? ` — 조회 실패 리 ${failedRi.size}개: ${[...failedRi].slice(0, 10).join(', ')}` : '')
  );
  console.groupEnd();
  // 사유는 지배적 관측으로 정한다. 동수는 unreachable로 떨어뜨린다 —
  // 한도를 잘못 붙이면 사용자가 하루를 버리고, 미응답은 재시도가 무해하기 때문이다.
  // (VWORLD는 과부하일 때도 인증키 문구를 돌려주므로 최종 안내는 헬스체크와 대조한다)
  const failureKind: GeocodeFailureKind | null =
    kindCounts.quota + kindCounts.auth + kindCounts.unreachable === 0 ? null
      : kindCounts.quota > kindCounts.auth + kindCounts.unreachable ? 'quota'
      : kindCounts.auth > kindCounts.unreachable ? 'auth'
      : 'unreachable';

  return {
    snapped: snappedCount,
    failedRi: [...failedRi],
    serviceDown,
    failureKind,
    lastError,
  };
}

/**
 * 변환을 시작하기 전에 VWORLD가 살아 있는지 1건으로 확인한다.
 *
 * 조기 중단만으로도 장애는 감지되지만, 리 2개가 재시도(45초×3)를 소진해야 하므로
 * 최악 4분이 걸린다. 시작 전 8초짜리 조회 하나면 같은 사실을 알 수 있다.
 *
 * 이 판정은 변환 시작을 실제로 막는다. 그래서 단판으로 끝내지 않는다 — 공유기가
 * 순간 튀는 것만으로 4만 건 작업이 시작조차 못 하면 안 되므로 2회까지 시도한다.
 * 그래도 실패하면 차단하되, 화면에 "다시 시도" 버튼을 남긴다.
 */
const HEALTHCHECK_ATTEMPTS = 2;

/**
 * 헬스체크용 리 코드 — 봉화읍 내성리(4792025031).
 *
 * 예전에는 `'4792025021'`을 손으로 적어 두었는데 **존재하지 않는 코드**였다
 * (봉화읍은 22~31). VWORLD가 늘 빈 결과를 돌려줬고, 빈 응답은 `ok: true`로 처리되므로
 * 헬스체크가 아무것도 검증하지 않은 채 통과하고 있었다(2026-09-07 발견).
 *
 * 그래서 리터럴을 두지 않고 `EUMRI_MAP`에서 파생한다. 그 표는
 * `node scripts/verify-eumri-map.mjs`가 VWorld 실측과 대조하므로, 표가 맞으면 이 값도
 * 맞는다. 표에 없는 이름이면 모듈 로드 시점에 던진다 — 조용히 무력화된 헬스체크보다
 * 낫다.
 */
const HEALTHCHECK_RI_PREFIX = riCodePrefix('봉화읍', '내성리');

export async function checkGeocodingService(
  signal?: AbortSignal,
): Promise<{ ok: boolean; kind: GeocodeFailureKind | null; message: string | null }> {
  const vworldKey = getVworldKey();
  // VWORLD를 쓰지 않는 구성(dev의 Kakao 전용)에서 VWORLD 생존을 물을 이유가 없다.
  // 여기서 false를 돌려주면 멀쩡한 Kakao 폴백까지 차단된다.
  if (!vworldKey) return { ok: true, kind: null, message: null };

  let last: { ok: boolean; kind: GeocodeFailureKind | null; message: string | null } = {
    ok: false, kind: 'unreachable', message: '확인하지 못했습니다',
  };

  for (let attempt = 0; attempt < HEALTHCHECK_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(600, signal);
    last = await probeGeocodingService(vworldKey, signal);
    if (last.ok) return last;
    // 인증 거부라고 해서 여기서 끊지 않는다. VWORLD는 부하가 걸리면 정상 키에도
    // "인증키 정보가 올바르지 않습니다"를 돌려준다(이 파일 아래 재시도 주석 참조).
    // 그 한 번의 응답으로 4만 건 변환을 막으면서 "배포 키를 확인하라"고 안내하면,
    // 사용자는 멀쩡한 키를 고치러 간다.
  }
  return last;
}

async function probeGeocodingService(
  vworldKey: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; kind: GeocodeFailureKind | null; message: string | null }> {
  try {
    const res = await jsonp<VworldResponse>(VWORLD_DATA_URL, {
      service: 'data',
      request: 'GetFeature',
      data: 'LP_PA_CBND_BUBUN',
      key: vworldKey,
      format: 'json',
      geometry: 'false',
      crs: 'EPSG:4326',
      // 리 하나로 좁힌다. 군 전체(`47920%`)를 LIKE로 걸면 size=1이어도 서버가
      // 스캔 비용을 치를 수 있고, 그 지연이 헬스체크 타임아웃으로 오인된다.
      attrFilter: `pnu:like:${HEALTHCHECK_RI_PREFIX}%`,
      size: '1',
      page: '1',
    }, { signal, timeoutMs: 8000 });

    if (res.response?.status === 'ERROR') {
      const text = res.response.error?.text ?? '알 수 없는 오류';
      // 한도 초과에 "잠시 후 다시 시도하세요"라고 안내하면 사용자가 몇 분마다
      // 재시도하며 이미 소진된 한도를 계속 태운다. 세 종류를 여기서 갈라놓는다.
      const kind: GeocodeFailureKind = isRateLimited(res.response.error) ? 'quota'
        : isAuthErrorResponse(res.response.error) ? 'auth'
        : 'unreachable';
      return { ok: false, kind, message: text };
    }
    // 실재하는 리를 조회하므로 결과가 비어 있으면 이상하다. 차단하지는 않되
    // (안전한 방향) 흔적은 남긴다 — 리 코드가 폐지·개편되면 헬스체크가 조용히
    // 무력화되는데, 그 상태를 알아챌 방법이 이 로그뿐이다.
    const probed = res.response?.result?.featureCollection?.features ?? [];
    if (probed.length === 0) {
      console.warn(
        `[vworld] 사전 확인 응답이 비어 있습니다 — 리 코드 ${HEALTHCHECK_RI_PREFIX}가 ` +
        '유효한지 scripts/verify-eumri-map.mjs로 확인하십시오'
      );
    }
    return { ok: true, kind: null, message: null };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // 타임아웃은 "죽었다"가 아니라 "확인하지 못했다"이다. 이걸로 변환을 막으면
    // 서버가 잠깐 느린 것만으로 4만 건 작업이 시작조차 못 한다. 실행 중 감지는
    // 조기 중단이 맡으므로, 여기서는 통과시키고 그쪽에 넘긴다.
    if (err instanceof JsonpTimeoutError) {
      console.warn('[vworld] 사전 확인이 시간 내에 끝나지 않았습니다 — 그대로 진행합니다');
      return { ok: true, kind: null, message: null };
    }
    return {
      ok: false,
      kind: 'unreachable',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
