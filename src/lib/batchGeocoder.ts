import type { Parcel } from '../types';
import {
  geocodeAddress,
  isGeocodingAvailable,
  warmupCache,
  prefetchPolygonsByPnu,
  getSnappedCoord,
  checkGeocodingService,
  getCachedCoords,
  RateLimitError,
  GeocodeServiceError,
} from './kakaoGeocoder';
import type { GeocodeFailureKind } from './kakaoGeocoder';
import { normalizeAddress, normalizeAddressLotNumber } from './addressParser';


export interface BatchGeocodingOptions {
  concurrency?: number;   // 초기 동시 요청 수 (기본: 25)
  maxRetries?: number;    // 실패 시 재시도 횟수 (기본: 1)
  force?: boolean;        // 기존 좌표가 있어도 재지오코딩 (기본: false)
  /**
   * done은 좌표를 **실제로 확보한** 필지 수 + 주소 시도를 마친 필지 수다. 추정치를
   * 섞지 않는다. Phase 0가 진행 중일 때는 note에 "PNU 일괄 조회 n/m리"를 실어 화면이
   * 멈춘 것처럼 보이지 않게 한다 — 진행 바를 추정치로 밀어 올리는 대신이다.
   */
  onProgress?: (done: number, total: number, failed: number, note?: string) => void;
  signal?: AbortSignal;   // 취소 지원
  /** 시작 전 서버 생존 확인을 건너뛴다 (테스트용) */
  skipHealthCheck?: boolean;
}

/**
 * 변환이 어떻게 끝났는지에 대한 진단.
 *
 * 예전에는 batchGeocode가 Parcel[]만 돌려줬고, Phase 0의 authFailed도 failedRi도
 * 호출자에게 도달하지 않았다. 그래서 서버가 죽어 전량 실패해도 UI는 "변환 실패
 * N건"만 보여줬고, 사용자는 그것이 자기 데이터 탓인지 서버 탓인지 알 수 없었다.
 */
export interface BatchGeocodeDiagnostics {
  /** 서버 장애로 판단해 중간에 포기했는가 */
  serviceDown: boolean;
  failureKind: GeocodeDiagnosticKind | null;
  /** 사용자에게 보여줄 한 줄 설명 (serviceDown일 때만 채운다) */
  message: string | null;
  /** 관측한 원인 원문 (로그용) */
  detail: string | null;
  pnuResolved: number;
  addressResolved: number;
  /** 서버는 응답했으나 좌표를 찾지 못한 필지 수 */
  notFound: number;
  /** 호출 한도 초과로 막힌 필지 수 */
  quotaBlocked: number;
  /** 서버가 응답하지 않아 실패한 필지 수 */
  unreachable: number;
  /** 인증 거부로 실패한 필지 수 */
  authBlocked: number;
  /**
   * 주소 지오코딩을 **시도했는데** 실패한 필지 수.
   *
   * "좌표가 없는 필지 수"와 다르다. 조기 중단으로 시도조차 못 한 필지는 여기 없다.
   *
   * 위 네 카테고리(`notFound`/`quotaBlocked`/`unreachable`/`authBlocked`)는 이 값의
   * **파티션**이다. 화면은 이 값을 분모로 삼아 내역을 검산하고, 어긋나면 내역 대신
   * 총량만 보여준다. 뺄셈으로 유도하지 않는 이유: 한 필지가 두 카테고리에 세어지면
   * 뺄셈으로 얻는 항목이 조용히 깎여 실재하는 실패 종류가 목록에서 사라진다.
   */
  attemptedFailures: number;
}

export interface BatchGeocodeResult {
  parcels: Parcel[];
  diagnostics: BatchGeocodeDiagnostics;
}

/** 성공 0건 상태에서 이만큼의 배치가 연달아 서버 미응답이면 중단한다 */
const SERVICE_DOWN_BATCH_THRESHOLD = 2;

/**
 * 진단이 보고하는 사유.
 *
 * `GeocodeFailureKind`(지오코딩이 **던지는** 오류의 종류)에 하나를 더한다.
 * `'no-results'`는 오류가 아니다 — 서버가 정상으로 답했는데 좌표를 한 건도 주지
 * 않은 상태다. `GeocodeServiceError.kind`에는 넣지 않는다. 그 자리에 넣으면
 * "던질 수 있는 오류"라는 뜻이 되는데, 이것은 던져지지 않고 집계로만 판정된다.
 */
export type GeocodeDiagnosticKind = GeocodeFailureKind | 'no-results';

/**
 * 네트워크로 좌표를 **한 건도** 못 얻은 실행에서, 이만큼의 "좌표 없음"이 나오면
 * 서버 이상을 의심해 좌표를 지우지 않는다.
 *
 * 요청 하나로는 ①(진짜 좌표 없음)과 주소 API 색인 장애를 구분할 수 없다 — 서버가
 * 보내는 것이 글자 그대로 같은 `status: "NOT_FOUND"`다. 집계로만 갈린다.
 *
 * **작게 잡으면 재변환의 초기화 기능이 죽는다.** 몇 건만 골라 다시 돌려 좌표를
 * 비우는 사용을 막게 된다. 그래서 소량은 그대로 지운다 — "전부 실패"가 소량에서는
 * 이상하지 않다.
 *
 * 오탐(임계값을 넘겼는데 실제로는 주소가 전부 잘못된 파일)이어도 **손실이 없다.**
 * 그 경우에도 기존 좌표는 이전의 정상 실행에서 온 것이므로 지키는 쪽이 맞다.
 * 반대 방향의 오판(장애인데 지운다)만 복구 불가다.
 */
const SUSPICIOUS_NOTFOUND_ONLY = 50;

function serviceDownMessage(kind: GeocodeDiagnosticKind): string {
  switch (kind) {
    case 'auth':
      // VWORLD는 과부하일 때도 같은 문구를 돌려준다. "키를 고치라"고 단정하면
      // 사용자가 멀쩡한 배포 키를 건드리게 되므로 두 가능성을 함께 적는다.
      return 'VWORLD가 인증키를 거부했습니다. 서버 과부하일 때도 같은 응답이 오므로, '
        + '잠시 후 다시 시도해서 같은 결과라면 배포에 주입된 키를 확인해야 합니다.';
    case 'quota':
      return 'VWORLD 호출 한도를 초과했습니다. 한도는 보통 다음 날 초기화되므로 '
        + '지금 다시 시도해도 같은 결과입니다.';
    case 'no-results':
      // 서버는 응답했다. "응답하지 않는다"고 쓰면 사실이 아니고, 사용자가 원인을
      // 엉뚱한 곳에서 찾는다. 두 가능성을 함께 적고, 무엇을 했는지(지우지 않았다)를 밝힌다.
      return 'VWORLD가 응답은 했지만 좌표를 한 건도 주지 않았습니다. '
        + '서버의 주소 검색이 일시적으로 비어 있거나 주소 데이터에 문제가 있을 수 있습니다. '
        + '기존 좌표는 지우지 않고 그대로 두었습니다.';
    default:
      // JSONP는 script 태그로 호출하므로 HTTP 상태 코드를 읽을 수 없다.
      // 502인지 503인지 알 수 없으므로 특정 코드를 문구에 넣지 않는다.
      return 'VWORLD 서버가 응답하지 않습니다. 서버 장애일 수 있으니 잠시 후 다시 시도해 주세요.';
  }
}

/** 대기. signal이 오면 남은 시간을 기다리지 않고 즉시 깨어난다 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
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
): Promise<BatchGeocodeResult> {
  const initialConcurrency = options?.concurrency ?? 25;
  const maxRetries = options?.maxRetries ?? 1;
  const force = options?.force ?? false;
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  // 진단 상태. 어느 경로로 끝나든 finish()를 거쳐 호출자에게 전달된다.
  let serviceDown = false;
  let failureKind: GeocodeDiagnosticKind | null = null;
  let failureDetail: string | null = null;

  const finish = (
    parcelsOut: Parcel[],
    counts: {
      pnuResolved: number; addressResolved: number; notFound: number;
      quotaBlocked?: number; unreachable?: number; authBlocked?: number;
      attemptedFailures?: number;
    },
  ): BatchGeocodeResult => ({
    parcels: parcelsOut,
    diagnostics: {
      serviceDown,
      failureKind,
      message: serviceDown && failureKind ? serviceDownMessage(failureKind) : null,
      detail: failureDetail,
      quotaBlocked: 0,
      unreachable: 0,
      authBlocked: 0,
      attemptedFailures: 0,
      ...counts,
    },
  });

  const noCounts = {
    pnuResolved: 0, addressResolved: 0, notFound: 0,
    quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0,
  };

  if (!isGeocodingAvailable()) {
    console.warn('[batchGeocoder] Geocoding API 키가 없습니다.');
    failureKind = 'auth';
    failureDetail = '지오코딩 API 키가 빌드에 포함되지 않았습니다';
    return finish(parcels.map((p) => ({ ...p, coords: p.coords ?? null })), noCounts);
  }

  // ① IndexedDB → 메모리 캐시 워밍업
  const warmupCount = await warmupCache();
  if (warmupCount > 0) {
    console.info(`[batchGeocoder] IndexedDB에서 ${warmupCount}건 캐시 로드됨`);
  }

  // `coords`를 `null`로 정규화한다. 키 없음 조기 반환(위)이 이미 같은 규칙을 쓰는데
  // 여기만 원본을 그대로 두면, 서비스 실패로 기입을 건너뛴 필지가 `undefined`로 남아
  // 같은 모듈이 두 가지 부재 표현을 내보낸다.
  const results: Parcel[] = parcels.map((p) => ({ ...p, coords: p.coords ?? null }));

  // 좌표가 없는 필지만 처리 대상 (force=true이면 전체 재변환)
  const needsGeocode: number[] = [];
  for (let i = 0; i < parcels.length; i++) {
    if (force || !parcels[i].coords) {
      needsGeocode.push(i);
    }
  }

  if (needsGeocode.length === 0) {
    onProgress?.(0, 0, 0);
    return finish(results, noCounts);
  }

  const phase0Start = Date.now();

  // Phase 0가 해결한 필지를 명시적으로 기록한다. results[idx].coords 유무로
  // 판단하면 force=true일 때 "원래 있던 낡은 좌표"와 구분되지 않아, 재변환을
  // 눌러도 주소 폴백을 타지 않고 낡은 좌표가 그대로 남는다.
  const pnuResolvedIdx = new Set<number>();
  let pnuResolved = 0;

  /** 스냅 캐시(메모리 = IndexedDB 워밍업분 + 이번 실행 신규분)에서 좌표를 회수한다 */
  const applyCachedSnaps = () => {
    for (const idx of needsGeocode) {
      if (pnuResolvedIdx.has(idx)) continue;
      const pnu = parcels[idx].pnu;
      if (!pnu) continue;
      const snapped = getSnappedCoord(pnu);
      if (snapped) {
        results[idx] = { ...results[idx], coords: snapped };
        pnuResolvedIdx.add(idx);
        pnuResolved++;
      }
    }
  };

  // ===== 캐시 회수를 네트워크보다 먼저 =====
  // 헬스체크를 앞에 두면 서버가 죽은 날 IndexedDB에 남아 있는 좌표까지 못 쓰게 된다.
  // 화면이 "나중에 다시 실행하면 이미 변환된 건은 건너뜁니다"라고 약속하는데,
  // 그 약속을 헬스체크가 깨뜨리면 안 된다. 이 회수는 네트워크를 쓰지 않는다.
  applyCachedSnaps();
  const cachedResolved = pnuResolved;
  if (cachedResolved > 0) {
    console.info(`[batchGeocoder] 캐시에서 ${cachedResolved.toLocaleString()}건 좌표 회수`);
    onProgress?.(cachedResolved, needsGeocode.length, 0);
  }

  const stillNeeded = needsGeocode.filter(i => !pnuResolvedIdx.has(i));
  if (stillNeeded.length === 0) {
    console.info('[batchGeocoder] 전량 캐시로 해결 — 네트워크 호출 없음');
    return finish(results, { pnuResolved, addressResolved: 0, notFound: 0, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0 });
  }

  // ===== 사전 헬스체크 =====
  // 남은 건이 있을 때만. 4만 건을 태우기 전에 1건으로 서버 생존을 확인한다.
  // 조기 중단만으로도 장애는 잡히지만 리 2개가 재시도를 소진해야 하므로 최악 4분이다.
  let healthOk = false;
  if (!options?.skipHealthCheck) {
    // 취소가 여기서 예외로 빠져나가면 방금 회수한 캐시 좌표가 통째로 버려진다
    // (호출자는 원본 배열을 받는다). 모든 종료를 finish() 한 곳으로 모은다.
    let health: Awaited<ReturnType<typeof checkGeocodingService>>;
    try {
      health = await checkGeocodingService(signal);
    } catch {
      console.info('[batchGeocoder] 사전 확인 중 취소 — 회수한 캐시는 유지합니다');
      return finish(results, { pnuResolved, addressResolved: 0, notFound: 0, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0 });
    }
    healthOk = health.ok;
    // 차단은 "서버가 응답하지 않는다"에 한한다. 인증 거부는 서버가 답한 것이고,
    // VWORLD는 과부하일 때도 같은 응답을 준다 — 그 한 번으로 4만 건을 막으면서
    // 잘못된 조치를 지시하게 된다. 진짜 키 문제라면 Phase 0가 리 두 개 만에 잡는다.
    if (!health.ok && health.kind !== 'auth') {
      serviceDown = true;
      failureKind = health.kind ?? 'unreachable';
      failureDetail = health.message;
      console.error(`[batchGeocoder] 사전 확인 실패 — 변환을 시작하지 않습니다: ${health.message}`);
      onProgress?.(cachedResolved, needsGeocode.length, 0);
      return finish(results, { pnuResolved, addressResolved: 0, notFound: 0, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0 });
    }
    if (!health.ok) {
      console.warn(`[batchGeocoder] 사전 확인이 인증 오류를 받았습니다 — 실행 중 가드에 맡깁니다: ${health.message}`);
    }
  }

  // ===== Phase 0: PNU 리 단위 일괄 조회 =====
  // 주소보다 먼저 시도한다. 주소 표기가 어떻든 PNU만 맞으면 좌표가 나온다.
  const pnusToLookup = [
    ...new Set(
      stillNeeded
        .map(i => parcels[i].pnu)
        .filter((v): v is string => !!v && v.trim() !== ''),
    ),
  ];

  if (pnusToLookup.length > 0) {
    // Phase 0가 3만 건 기준 2분쯤 걸린다. 그동안 화면이 멈춘 것처럼 보이지 않도록
    // 리 진행을 note로 알린다. 예전에는 리 완료율을 필지 수로 **환산한 추정치**를
    // done으로 보고했는데, 지적도에 없는 PNU가 많으면 확보 0건에 진행률 100%가 떴다
    // (실측: 전량 미매칭 파일에서 첫 배치부터 "499/500 (100%)"). 추정치를 실제값보다
    // 낮게 묶는 캡과 훅의 단조 클램프는 그 추정치를 떠받치던 장치였다.
    // 스냅 수는 PNU 단위라 필지 수(≥)보다 작거나 같다 — 뒤에 오는 실제값이 이보다
    // 작아지는 일은 없으므로 진행 바가 뒤로 가지 않는다.
    const phase0 = await prefetchPolygonsByPnu(pnusToLookup, {
      signal,
      onProgress: (riDone, riTotal, snapped) => {
        if (riTotal === 0) return;
        onProgress?.(cachedResolved + snapped, needsGeocode.length, 0, `PNU 일괄 조회 ${riDone}/${riTotal}리`);
      },
    });

    // 이번 조회로 새로 들어온 스냅을 회수한다
    applyCachedSnaps();
    const phase0Elapsed = ((Date.now() - phase0Start) / 1000).toFixed(1);
    console.info(
      `[batchGeocoder] Phase 0 완료: PNU ${pnusToLookup.length.toLocaleString()}종으로 ` +
      `${pnuResolved.toLocaleString()}건 좌표 확보 (${phase0Elapsed}초)`
    );

    if (phase0.serviceDown) {
      serviceDown = true;
      // VWORLD는 과부하일 때도 "인증키 정보가 올바르지 않습니다"를 돌려준다
      // (kakaoGeocoder.ts의 재시도 주석 참조). 헬스체크가 통과했다면 키는 유효하므로,
      // 그 문구만 보고 "인증키를 확인하라"고 안내하면 사용자가 고칠 수 없는 조치를
      // 찾아 헤매게 된다. 진짜 키 문제는 헬스체크가 먼저 잡는다.
      failureKind = phase0.failureKind === 'auth' && healthOk
        ? 'unreachable'
        : (phase0.failureKind ?? 'unreachable');
      failureDetail = phase0.lastError;
      // 여기서 멈추지 않는다. Phase 0(Data API)가 죽어도 주소 지오코딩은 살아 있을 수
      // 있고, 재개 실행처럼 조회 대상 리가 두어 개뿐이면 그 둘의 실패가 곧 서버 장애를
      // 뜻하지도 않는다. Phase 1의 가드가 몇십 건 안에 실제 생존을 판정한다.
      console.warn('[batchGeocoder] Phase 0가 서버 장애로 중단 — 주소 폴백으로 실제 생존을 확인합니다');
    }
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
    return finish(results, { pnuResolved, addressResolved: 0, notFound: 0, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0 });
  }

  // Phase 1 대상: PNU로 해결되지 않은 필지만
  const needsAddress = needsGeocode.filter(idx => !pnuResolvedIdx.has(idx));
  onProgress?.(pnuResolved, needsGeocode.length, 0);

  if (needsAddress.length === 0) {
    logSummary(0, 0, ' — 전체가 PNU로 해결되어 주소 지오코딩 생략');
    return finish(results, { pnuResolved, addressResolved: 0, notFound: 0, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0 });
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

  // ===== 주소 캐시 회수를 네트워크보다 먼저 =====
  // Phase 0 스냅과 같은 원칙이다. 예전에는 캐시 적중을 배치 루프 안에서 처리했는데,
  // 그러면 조기 중단이 뒤쪽 배치의 캐시 적중분까지 포기한다 — 네트워크가 필요 없는
  // 건을 서버 장애 때문에 버리는 셈이다(실측: 250건 캐시가 25건 블록으로 섞인 파일에서
  // 중단 시 50건만 회수). 여기서 걷어내면 루프에는 네트워크가 필요한 건만 남으므로,
  // 루프 안의 성공은 전부 서버 생존의 증거다.
  let addressCached = 0;
  const pendingEntries: typeof uniqueEntries = [];
  for (const entry of uniqueEntries) {
    // geocodeAddress와 같은 키(0패딩 정규화 → 주소 정규화)로 찾아야 한다
    const cached = getCachedCoords(normalizeAddressLotNumber(parcels[entry.representative].address));
    if (cached) {
      for (const idx of entry.allIndices) results[idx] = { ...results[idx], coords: cached };
      addressCached += entry.allIndices.length;
    } else {
      pendingEntries.push(entry);
    }
  }
  if (addressCached > 0) {
    console.info(`[batchGeocoder] 주소 캐시에서 ${addressCached.toLocaleString()}건 회수`);
    onProgress?.(pnuResolved + addressCached, needsGeocode.length, 0);
  }
  if (pendingEntries.length === 0) {
    logSummary(addressCached, 0, ' — 남은 주소가 전부 캐시로 해결되어 네트워크 호출 없음');
    return finish(results, { pnuResolved, addressResolved: addressCached, notFound: 0, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 0 });
  }

  // ===== Phase 1: 주소 지오코딩 =====
  let currentConcurrency = initialConcurrency;
  let currentDelay = 10;
  let consecutiveCleanBatches = 0;

  let done = 0;
  let failed = 0;
  // 서버가 응답했는데 좌표가 없었던 건수. 서버 미응답과 반드시 구분한다.
  let notFound = 0;
  /**
   * 좌표를 지울 필지의 인덱스. 루프 안에서 바로 지우지 않고 모아 둔다 —
   * 지워도 되는지는 **실행 전체의 집계**를 봐야 알 수 있다(PROJ1-1-51).
   */
  const pendingErasures: number[] = [];
  // 호출 한도 초과로 실패한 건수. 서버는 살아 있지만 오늘은 회복되지 않으므로
  // notFound(데이터 문제)와 섞으면 안 된다.
  let quotaBlocked = 0;
  // 서버 미응답으로 실패한 누적 건수 (중단 사유 판정과 화면 표시에 쓴다)
  let unreachableTotal = 0;
  // 인증 거부로 실패한 누적 건수
  let authBlocked = 0;
  // 네트워크를 실제로 타서 좌표를 얻은 건수. 캐시 적중은 서버 생존의 증거가
  // 아니므로 여기 넣지 않는다 — 캐시가 조금만 있어도 조기 중단이 무력화된다.
  // (캐시 적중분은 위에서 이미 걷어냈으므로 루프 안의 성공은 전부 네트워크다)
  let networkResolved = 0;
  // 성공 0건인 채로 서버 미응답 배치가 연달아 나온 횟수
  let deadBatches = 0;

  let cursor = 0;
  let batchNum = 0;
  const phase1StartTime = Date.now();

  console.group('[batchGeocoder] Phase 1: 주소 지오코딩');
  console.info(
    `총 ${totalOriginal}건 (고유 주소 ${totalUnique}건, 캐시 ${addressCached}건 제외 → ` +
    `네트워크 ${pendingEntries.length}건), 동시 요청: ${initialConcurrency}`
  );

  while (cursor < pendingEntries.length) {
    if (signal?.aborted) break;

    batchNum++;
    const chunk = pendingEntries.slice(cursor, cursor + currentConcurrency);
    cursor += chunk.length;

    const chunkStart = Date.now();
    let chunkRateLimited = 0;
    let chunkFail = 0;
    let chunkServiceError = 0;
    // 서버가 답했지만 좌표가 없던 건수. 이것도 생존 신호다.
    let chunkNotFound = 0;
    // 네트워크로 좌표를 얻은 건수
    let chunkNetworkOk = 0;
    let chunkQuota = 0;

    await Promise.all(
      chunk.map(async (entry) => {
        if (signal?.aborted) return;

        const parcel = parcels[entry.representative];

        // 주소 지오코딩만 (snap 없이)
        let coords: { lat: number; lng: number } | null = null;
        // 아래 셋은 배타적이다. 마지막으로 관측한 사유 하나만 남는다.
        // 예전에는 `rateLimited`를 별도 if에서 집계해, 첫 시도가 미응답이고 두 번째가
        // 한도로 끝난 필지가 양쪽에 세어졌다. 그러면 화면에서 뺄셈으로 얻는 미응답
        // 건수가 0이 되어, 실재하는 카테고리가 목록에서 사라진다.
        //
        // "미응답"은 플래그가 아니다 — `answered`도 아니고 아래 둘도 아닌 나머지 전부다.
        // 플래그로 두면 아무도 세우지 않은 경로가 생기고, 그 경로가 "좌표 없음"으로
        // 떨어지는 것이 PROJ1-1-45 부류의 사고였다.
        let rateLimited = false;
        let authRejected = false;
        // `geocodeAddress`가 **정상 반환**했는가(좌표든 "없음"이든). 좌표를 지우는
        // 결론은 이것이 참일 때만 허용된다 — 아래 배타 체인 참조.
        let answered = false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            coords = await geocodeAddress(parcel.address);
            answered = true;
            // 서버가 정상 응답했다 — 앞선 시도의 사유 판정을 **모두** 거둔다.
            // `geocodeAddress`는 "좌표 없음"을 throw가 아니라 null로 알리고 그 경로도
            // 여기를 지난다. authRejected를 남겨두면 정상 "결과 없음"이 인증 거부로
            // 집계되고, chunkNotFound가 오르지 않아 살아 있는 서버가 죽은 것으로
            // 판정된다(합계 불변식은 파티션이 성립하므로 이것을 잡지 못한다).
            authRejected = false;
            rateLimited = false;
            break;
          } catch (err) {
            // 취소는 실패가 아니다. 여기서 걸러내지 않으면 sleep 후 무의미한 재시도를
            // 마저 돌고, 그 결과가 "좌표를 찾지 못한 필지"로 집계되어 통계가 부풀려진다.
            if (err instanceof DOMException && err.name === 'AbortError') return;
            if (err instanceof RateLimitError) {
              // 서버가 한도를 알려줬다 = 살아 있다. 앞선 시도의 미응답 판정을 덮는다.
              rateLimited = true;
              authRejected = false;
              break;
            }
            if (err instanceof GeocodeServiceError) {
              rateLimited = false;
              failureDetail = err.message;
              // 인증 거부로 죽은 것을 "서버 미응답"으로 표시하면 안내가 틀린다.
              // VWORLD는 API별로 키를 따로 등록하므로 데이터 API가 멀쩡해도
              // 지오코딩 API만 거부될 수 있다.
              authRejected = err.kind === 'auth';
            } else {
              // 분류하지 못한 예외. 예전에는 어느 플래그도 세우지 않고 조용히 삼켜,
              // 재시도가 소진되면 아래 체인의 `else`에서 "좌표 없음"이 됐다 —
              // 분류하지 못한 것이 곧 좌표 삭제였다. 미응답과 같은 칸에 둔다.
              rateLimited = false;
              authRejected = false;
              failureDetail = err instanceof Error ? err.message : String(err);
              console.warn(`[batchGeocoder] 분류하지 못한 예외 (${parcel.address}):`, err);
            }
            if (attempt < maxRetries) {
              await sleep(200, signal);
              // sleep은 취소되면 즉시 깨어난다. 여기서 멈추지 않으면 다음 시도가 죽은
              // 서버에 그대로 나간다. 위의 AbortError 가드는 이 경로를 막지 못한다 —
              // geocodeAddress의 JSONP는 signal을 받지 않아 AbortError를 던진 적이 없다
              // (실측: 취소 뒤 첫 배치 25건이 attempt 1을 돌아 50요청을 더 냈다).
              if (signal?.aborted) return;
            }
          }
        }

        // 취소 뒤에 도착한 응답은 세지 않는다. 좌표는 geocodeAddress가 이미 캐시에
        // 넣었으므로 다음 실행이 회수한다. 여기서 세면 onProgress가 취소 뒤에 발화하고,
        // 훅의 단조 증가 클램프가 그 옛 값을 **다음 실행**의 진행률로 굳힌다.
        if (signal?.aborted) return;

        // adaptive concurrency 조절용 카운트. 실패 집계는 아래 배타 체인에서 한다.
        if (rateLimited) chunkRateLimited++;

        // 결과를 모든 동일 주소 필지에 복사.
        //
        // **실패가 서버 사정이면 낡은 좌표를 지킨다.** 여기서 구분하지 않으면
        // `force=true`(좌표 재변환)가 이미 확보한 좌표를 파괴한다 — 재변환은
        // 좌표가 있는 필지도 `needsGeocode`에 넣기 때문이다. 캐시는 재변환 직전에
        // 비워지므로 **되돌릴 방법이 없다.**
        //
        //   notFound              서버가 답했고 그 주소에 좌표가 없다  → 지운다
        //   quota/unreachable/auth  서버 사정. 데이터에 대해 무언(無言) → 지킨다
        //
        // 실측(수정 전, 좌표를 다 가진 200건): 도중 사망 200→135, 한도 초과 200→163,
        // 인증 거부 200→150. 수정 후 전부 200. 아래 배타 체인이 쓰는 판정을 그대로 쓴다 —
        // 다시 유도하면 두 곳이 갈라진다.
        //
        // ⚠️ **지우는 쪽이 긍정적 근거를 요구한다.** `answered`(정상 반환)일 때만
        // "좌표 없음"이고, 그 밖의 어떤 끝(한도·인증·미응답·분류하지 못한 예외)도
        // 좌표를 지킨다. 예전에는 반대였다 — 세 플래그 중 하나가 서야 지켰고, 아무것도
        // 서지 않은 미분류 경로는 `else`로 떨어져 지웠다. PROJ1-1-45(분류하지 못한
        // VWORLD `ERROR`가 null로 새던 것)가 그 사고의 한 예였고, 분류 밖의 예외가
        // 여기까지 오는 경로가 또 하나였다. 기본값을 뒤집으면 그 부류가 통째로 닫힌다.
        //
        // ⚠️ **삭제만 실행 끝으로 미룬다** (PROJ1-1-51). 주소 API가 색인 장애로 전 건에
        // `NOT_FOUND`를 돌려주면 서버가 보내는 것이 ①과 글자 그대로 같아, 이 시점에는
        // 구분할 수 없다. 구분에 필요한 값(실행 전체의 네트워크 성공 건수)이 아직
        // 확정되지 않았기 때문이다. 기입은 그대로 하고 삭제만 유보한다.
        if (coords !== null) {
          for (const idx of entry.allIndices) {
            results[idx] = { ...results[idx], coords };
          }
        } else if (answered) {
          // 지울 대상. 실제 삭제는 루프가 끝난 뒤 집계를 보고 결정한다.
          for (const idx of entry.allIndices) pendingErasures.push(idx);
        }
        // 그 밖(한도·인증·미응답·분류 밖 예외)은 아무것도 쓰지 않는다 — 좌표를 지킨다.

        // IndexedDB 저장은 geocodeAddress가 이미 하고 있으므로 여기서 또 쓰지 않는다
        if (coords) {
          chunkNetworkOk++;
          networkResolved++;
        }

        if (coords === null) {
          chunkFail += entry.allIndices.length;
          failed += entry.allIndices.length;
          // 배타 체인 — 한 필지는 정확히 한 카테고리에만 들어간다.
          // 위의 좌표 보존 판정과 같은 술어(`answered`)를 쓴다 — 다시 유도하면 갈라진다.
          if (answered) {
            // 서버는 답했는데 이 주소에 좌표가 없다 — 데이터 쪽 문제다. 좌표를 지우는
            // 유일한 가지이며, 유일하게 긍정적 근거를 요구한다.
            chunkNotFound += entry.allIndices.length;
            notFound += entry.allIndices.length;
          } else if (rateLimited) {
            // 한도 초과는 데이터 문제가 아니다. 오늘 다시 해도 같다.
            chunkQuota += entry.allIndices.length;
            quotaBlocked += entry.allIndices.length;
          } else if (authRejected) {
            chunkServiceError += entry.allIndices.length;
            authBlocked += entry.allIndices.length;
          } else {
            // 미응답, 또는 분류하지 못한 끝. 데이터에 대해 무언(無言)이다 — 지킨다.
            chunkServiceError += entry.allIndices.length;
            unreachableTotal += entry.allIndices.length;
          }
        }
        done += entry.allIndices.length;
        // Phase 0과 캐시에서 이미 해결한 건수를 더해 전체 진행률로 보고한다
        onProgress?.(pnuResolved + addressCached + done, needsGeocode.length, failed);
      })
    );

    const chunkElapsed = Date.now() - chunkStart;
    const totalElapsed = ((Date.now() - phase1StartTime) / 1000).toFixed(1);
    console.info(
      `  배치 #${batchNum}: ${chunk.length}건 → 성공 ${chunkNetworkOk} / 실패 ${chunkFail} / 429 ${chunkRateLimited} (${chunkElapsed}ms) [누적 ${done}/${totalOriginal - addressCached}, ${totalElapsed}s]`
    );

    if (signal?.aborted) break;

    // 배치 안에서 서버가 한 번도 답하지 않았을 때만 장애로 본다.
    //
    // "좌표를 얻었는가"로 판정하면 안 된다. 잘못 기재된 주소가 많은 파일에서는
    // 정상 서버가 전부 "결과 없음"으로 답하는 배치가 흔한데, 그 배치에 네트워크
    // 오류가 한 건만 섞여도 장애로 오인해 남은 전량을 포기하게 된다.
    //
    // 누적 성공 건수는 조건에 넣지 않는다. 그것은 단조 증가하므로 한 번 성공하면
    // 가드가 영영 무장되지 않고, 도중에 서버가 죽는 경우를 통째로 놓친다.
    //
    // 캐시 적중(chunkCached)은 생존 신호가 아니다. 네트워크를 타지 않았으므로
    // 서버가 죽어 있어도 계속 나온다.
    const sawResponse = chunkNetworkOk + chunkNotFound > 0;
    // 응답이 하나도 없는 배치는 원인이 미응답이든 한도든 진행 의미가 없다.
    // (한도는 그날 안에 회복되지 않고, adaptive concurrency가 간격만 늘려 몇 시간을 쓴다)
    const batchDead = (chunkServiceError > 0 || chunkQuota > 0) && !sawResponse;
    if (batchDead) {
      deadBatches++;
      if (deadBatches >= SERVICE_DOWN_BATCH_THRESHOLD) {
        serviceDown = true;
        // 사유는 중단 시점의 마지막 배치가 아니라 **실행 전체의 지배적 원인**으로 정한다.
        // 배치 하나에 한도 1건이 섞였다고 "내일 다시 오세요"라고 안내하면, 10분이면
        // 풀릴 502에 대해 사용자가 하루를 버린다. 순서에 따라 안내가 뒤바뀌는 것도 막는다.
        // 동수는 unreachable로 떨어뜨린다 — 손실이 비대칭이기 때문이다.
        failureKind = quotaBlocked > unreachableTotal + authBlocked ? 'quota'
          : authBlocked > unreachableTotal ? 'auth'
          : 'unreachable';
        failureDetail ??= failureKind === 'quota'
          ? 'VWORLD 호출 한도를 초과했습니다'
          : failureKind === 'auth'
            ? 'VWORLD 지오코딩이 인증키를 거부했습니다'
            : 'VWORLD 주소 지오코딩이 연속으로 응답하지 않았습니다';
        console.error(
          `[batchGeocoder] 배치 ${deadBatches}개가 연속 응답 없음 (미응답 ${unreachableTotal}건 / ` +
          `한도 ${quotaBlocked}건) — 남은 ${(pendingEntries.length - cursor).toLocaleString()}건을 포기합니다`
        );
        break;
      }
    } else if (sawResponse) {
      // 응답이 있었을 때만 연속을 끊는다. 예전에는 `else`였는데, 그때는 캐시 적중을
      // 루프 안에서 처리했으므로 "전부 캐시인 배치"가 네트워크를 타지 않고도 연속을
      // 0으로 되돌렸다 — 캐시 블록과 죽은 블록이 배치 크기로 번갈아 나오면 죽은 서버에
      // 전량을 던졌다(실측 1,006요청). 지금은 캐시를 루프 앞에서 걷어내 그런 배치가
      // 생기지 않지만, 판정 조건 자체가 "응답을 봤다"여야 그 전제가 바뀌어도 안전하다.
      deadBatches = 0;
    }

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

    if (cursor < pendingEntries.length && currentDelay > 0) {
      await sleep(currentDelay, signal);
    }
  }

  const phase1Elapsed = ((Date.now() - phase1StartTime) / 1000).toFixed(1);
  console.info(`Phase 1 완료: ${done}건, 성공 ${done - failed}건, 실패 ${failed}건 (${phase1Elapsed}초)`);
  console.groupEnd();

  // 캐시 회수분도 주소로 해결한 것이다 — 화면의 성공 건수에 들어가야 한다
  const addressResolved = addressCached + (done - failed);
  logSummary(addressResolved, failed);
  // 주소를 **네트워크로** 받아냈다면 서버는 살아 있다. Phase 0(Data API)만 죽은
  // 경우 여기서 장애 판정을 거둔다 — 실제로 좌표를 받아놓고 "서버 응답 없음"이라고
  // 표시하면 사용자가 멀쩡한 결과를 버리고 다시 돌린다.
  // 캐시로 채운 건수로 판정하면 죽은 서버에 수만 건을 계속 던지게 된다.
  if (networkResolved > 0 && deadBatches < SERVICE_DOWN_BATCH_THRESHOLD) {
    serviceDown = false;
    failureKind = null;
  }

  // **미뤄 둔 삭제를 지금 결정한다** (PROJ1-1-51).
  //
  // 네트워크로 좌표를 한 건도 못 얻었는데 "좌표 없음"만 대량이면, 주소가 전부 잘못된
  // 파일보다 주소 API의 색인 장애일 확률이 압도적이다. 요청 하나로는 못 가르지만
  // 집계로는 갈린다 — ①이라면 보통 일부는 좌표를 얻는다.
  //
  // 배치 단위로 판정하지 않는 이유는 바로 위 `sawResponse` 주석에 이미 있다:
  // "잘못 기재된 주소가 많은 파일에서는 정상 서버가 전부 결과 없음으로 답하는 배치가
  // 흔하다." 그래서 실행 전체로 본다.
  //
  // `notFound`를 조건에 쓴다. `pendingErasures.length`와 같은 값이지만(둘 다
  // `coords === null && answered`에서만 는다), 사용자가 화면에서 보는 숫자로 판정해야
  // 안내와 동작이 갈리지 않는다.
  const noResultsOutage = networkResolved === 0 && notFound >= SUSPICIOUS_NOTFOUND_ONLY;
  if (noResultsOutage) {
    serviceDown = true;
    // 이미 정해진 사유가 있으면 덮지 않는다 — 그쪽이 더 확정적인 신호다.
    failureKind ??= 'no-results';
    failureDetail ??=
      `${notFound.toLocaleString()}건이 모두 "좌표 없음"이고 네트워크로 얻은 좌표가 0건입니다 `
      + '— 서버 이상일 수 있어 기존 좌표를 지우지 않았습니다';
    console.error(
      `[batchGeocoder] 네트워크 성공 0건 / "좌표 없음" ${notFound.toLocaleString()}건 — ` +
      `서버 이상을 의심해 ${pendingErasures.length.toLocaleString()}건의 좌표 삭제를 취소합니다`
    );
  } else {
    for (const idx of pendingErasures) {
      results[idx] = { ...results[idx], coords: null };
    }
  }

  return finish(results, {
    pnuResolved, addressResolved, notFound,
    quotaBlocked, unreachable: unreachableTotal, authBlocked,
    attemptedFailures: failed,
  });
}
