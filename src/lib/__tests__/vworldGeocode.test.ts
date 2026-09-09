import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Parcel } from '../../types';
import { makeParcel } from './factories';

/**
 * **PROJ1-1-45.** `geocodeVworld`가 VWORLD 응답을 어떻게 분류하는지는 지금까지
 * 어떤 테스트도 보지 못했다. `jsonp`가 DOM(script 태그)을 요구하는데 이 저장소의
 * vitest는 `environment: 'node'`라, PROJ1-1-43 리뷰어조차 이 경로를 실측하지
 * 못하고 코드를 읽어 추정해야 했다.
 *
 * **네트워크에 닿는 것은 `jsonp` 하나뿐이다.** 그것만 대신하면 응답 분류부터
 * `batchGeocode`의 집계·좌표 기입까지 전 경로가 node에서 그대로 돈다. IndexedDB는
 * node에 없으므로 `geocodeCache`도 대신한다.
 *
 * 오류 클래스는 `instanceof`로 분기하므로 **진짜를 쓴다** — 가짜로 만들면 분기가
 * 전부 else로 떨어져 테스트가 거짓 통과한다.
 */

vi.mock('../geocodeCache', () => ({
  getFromIDB: async () => null,
  setToIDB: async () => {},
  loadAllFromIDB: async () => new Map(),
  bulkSetToIDB: async () => {},
  clearIDBCache: async () => {},
  getIDBCacheSize: async () => 0,
}));

/** jsonp 한 번의 응답을 만들어 내는 함수. 테스트마다 갈아 끼운다 */
let jsonpImpl: (url: string, params: Record<string, string>) => Promise<unknown>;
/** 실제로 나간 요청의 `type` 파라미터 (지번/도로명 순서를 본다) */
let jsonpTypes: string[];

vi.mock('../jsonp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../jsonp')>();
  return {
    ...actual,
    jsonp: (url: string, params: Record<string, string>) => {
      if (params.type) jsonpTypes.push(params.type);
      return jsonpImpl(url, params);
    },
  };
});

// 키가 없으면 geocodeAddress가 VWORLD 경로에 들어가지도 않는다.
vi.stubEnv('VITE_VWORLD_KEY', 'TEST-VWORLD-KEY');
// Kakao 폴백이 살아 있으면 VWORLD 실패가 그쪽에서 덮여 관측이 흐려진다.
vi.stubEnv('VITE_KAKAO_REST_KEY', '');

const {
  geocodeAddress,
  classifyVworldResponse,
  clearGeocodeCache,
  GeocodeServiceError,
  RateLimitError,
} = await import('../kakaoGeocoder');
const { batchGeocode } = await import('../batchGeocoder');

/** 봉화군 안 좌표 (isValidBonghwaCoord를 통과한다) */
const IN_BONGHWA = { x: '128.9', y: '36.9' };

/** VWORLD 정상 응답 (좌표 있음) */
const okResponse = (point = IN_BONGHWA) => ({
  response: { status: 'OK', result: { point } },
});

/** VWORLD 정상 응답 (좌표 없음) — ① 진짜 데이터 문제 */
const notFoundResponse = () => ({ response: { status: 'NOT_FOUND' } });

/** VWORLD ERROR 응답 */
const errorResponse = (code: string, text: string) => ({
  response: { status: 'ERROR', error: { code, text } },
});

/** 주소마다 다른 문자열을 써야 세션 좌표 캐시가 테스트끼리 새지 않는다 */
let addrSeq = 0;
const uniqueAddress = () => `경상북도 봉화군 봉화읍 내성리 ${++addrSeq}`;

beforeEach(async () => {
  jsonpTypes = [];
  jsonpImpl = async () => okResponse();
  await clearGeocodeCache();
});

describe('classifyVworldResponse — 응답 한 건의 분류', () => {
  it('좌표가 있으면 coord', () => {
    expect(classifyVworldResponse(okResponse().response)).toEqual({
      kind: 'coord',
      coord: { lat: 36.9, lng: 128.9 },
    });
  });

  it('정상 응답인데 좌표가 없으면 empty (① 데이터 문제)', () => {
    expect(classifyVworldResponse(notFoundResponse().response)).toEqual({ kind: 'empty' });
  });

  it('한도 초과는 quota', () => {
    const out = classifyVworldResponse(errorResponse('OVER_QUOTA', '일일 허용량 초과').response);
    expect(out.kind).toBe('quota');
  });

  it('code에만 KEY가 있어도 auth', () => {
    const out = classifyVworldResponse(errorResponse('INVALID_KEY', '').response);
    expect(out.kind).toBe('auth');
  });

  it('text에만 인증 문구가 있어도 auth', () => {
    const out = classifyVworldResponse(errorResponse('', '등록되지 않은 인증키입니다').response);
    expect(out.kind).toBe('auth');
  });

  /**
   * **이 티켓의 대상.** 두 술어(`isRateLimited`·`isAuthErrorResponse`)는 키워드
   * 매칭이라 VWORLD가 그 밖의 코드를 돌려주면 어디에도 걸리지 않는다.
   * 그것을 "좌표 없음"과 같은 칸에 넣으면 좌표가 지워진다.
   */
  it('분류되지 않은 ERROR는 empty가 아니라 error다', () => {
    const out = classifyVworldResponse(errorResponse('SYSTEM_ERROR', '시스템 오류').response);
    expect(out.kind).toBe('error');
  });

  it('좌표가 숫자가 아니면 empty로 본다 (서버는 답했다)', () => {
    const out = classifyVworldResponse(okResponse({ x: '', y: '' }).response);
    expect(out.kind).toBe('empty');
  });
});

describe('geocodeAddress — VWORLD 응답별 귀결', () => {
  it('좌표를 받으면 그대로 돌려준다', async () => {
    const coords = await geocodeAddress(uniqueAddress());
    expect(coords).toEqual({ lat: 36.9, lng: 128.9 });
  });

  it('지번이 비면 도로명으로 넘어간다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? notFoundResponse() : okResponse();
    const coords = await geocodeAddress(uniqueAddress());
    expect(coords).toEqual({ lat: 36.9, lng: 128.9 });
    expect(jsonpTypes).toEqual(['parcel', 'road']);
  });

  it('둘 다 정상 응답인데 좌표가 없으면 null이다 (① 데이터 문제)', async () => {
    jsonpImpl = async () => notFoundResponse();
    await expect(geocodeAddress(uniqueAddress())).resolves.toBeNull();
  });

  it('한도 초과는 RateLimitError로 던진다', async () => {
    jsonpImpl = async () => errorResponse('OVER_QUOTA', '일일 허용량 초과');
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(RateLimitError);
  });

  it('인증 거부는 kind=auth로 던진다', async () => {
    jsonpImpl = async () => errorResponse('INVALID_KEY', '등록되지 않은 인증키입니다');
    await expect(geocodeAddress(uniqueAddress())).rejects.toMatchObject({
      name: 'GeocodeServiceError',
      kind: 'auth',
    });
  });

  /**
   * **재현.** 수정 전에는 `responded = true; continue`로 빠져 조용히 null이 됐고,
   * 호출자는 그것을 "이 주소에 좌표가 없다"로 받아들였다.
   */
  it('분류되지 않은 ERROR를 좌표 없음으로 위장하지 않는다', async () => {
    jsonpImpl = async () => errorResponse('SYSTEM_ERROR', '시스템 오류가 발생했습니다');
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('분류되지 않은 ERROR의 원문을 메시지에 싣는다', async () => {
    jsonpImpl = async () => errorResponse('SYSTEM_ERROR', '시스템 오류가 발생했습니다');
    await expect(geocodeAddress(uniqueAddress())).rejects.toThrow(/SYSTEM_ERROR/);
  });

  /**
   * 지번이 서버 오류이고 도로명이 "결과 없음"이어도 데이터 문제로 단정할 수 없다.
   * 지번 주소의 좌표는 지번 조회만이 답할 수 있으므로, 그 조회가 오류로 끝난 이상
   * "이 주소에 좌표가 없다"는 결론은 근거가 없다.
   */
  it('한쪽이 서버 오류면 다른 쪽이 정상 결과없음이어도 서버 오류로 본다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? errorResponse('SYSTEM_ERROR', '시스템 오류') : notFoundResponse();
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('서버 오류가 났어도 다른 쪽이 좌표를 주면 좌표가 이긴다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? errorResponse('SYSTEM_ERROR', '시스템 오류') : okResponse();
    await expect(geocodeAddress(uniqueAddress())).resolves.toEqual({ lat: 36.9, lng: 128.9 });
  });
});

/**
 * `kakaoGeocoder`를 모킹하지 않은 **전 경로** 검증. 응답 분류가 어긋나면
 * 좌표가 실제로 지워지는 데까지 이어진다는 것을 여기서 고정한다.
 */
describe('batchGeocode + 실제 kakaoGeocoder — 좌표 파괴 경로', () => {
  const withCoords = (n: number): Parcel[] =>
    Array.from({ length: n }, (_, i) =>
      makeParcel({
        pnu: '',
        parcelId: `${700 + i}`,
        address: uniqueAddress(),
        coords: { lat: 36.5, lng: 128.5 },
      }),
    );

  const run = (parcels: Parcel[]) =>
    batchGeocode(parcels, {
      force: true,
      skipHealthCheck: true,
      concurrency: 5,
      maxRetries: 0,
    });

  it('분류되지 않은 ERROR가 재변환의 좌표를 파괴하지 않는다', async () => {
    jsonpImpl = async () => errorResponse('SYSTEM_ERROR', '시스템 오류가 발생했습니다');
    const { parcels, diagnostics } = await run(withCoords(3));
    expect(parcels.every((p) => p.coords?.lat === 36.5)).toBe(true);
    expect(diagnostics.notFound).toBe(0);
    expect(diagnostics.unreachable).toBe(3);
  });

  it('① 진짜 좌표 없음은 여전히 좌표를 지운다 (재변환의 초기화 기능)', async () => {
    jsonpImpl = async () => notFoundResponse();
    const { parcels, diagnostics } = await run(withCoords(3));
    expect(parcels.every((p) => p.coords === null)).toBe(true);
    expect(diagnostics.notFound).toBe(3);
    expect(diagnostics.unreachable).toBe(0);
  });

  /**
   * **PROJ1-1-51.** 주소 API가 색인 장애로 전 건에 `NOT_FOUND`를 돌려주면, 서버가
   * 보내는 것이 ①(진짜 좌표 없음)과 **글자 그대로 같다.** 요청 하나로는 구분할 수 없다.
   *
   * 그래서 `answered = true`가 되어 배타 체인의 `notFound` 가지로 가고 좌표가 지워졌다.
   * `sawResponse`가 `chunkNotFound`를 생존 신호로 세므로 조기 중단도 걸리지 않아,
   * **700필지 전량이 사라지는데 화면은 "변환 완료"라고 말했다.** 재변환은 캐시를
   * 먼저 비우므로 되돌릴 수 없다.
   *
   * 요청 단위로 못 가르는 것을 **집계로** 가른다 — 네트워크로 좌표를 한 건도 얻지
   * 못했는데 "좌표 없음"만 대량이면, 주소가 전부 잘못된 파일보다 서버 이상일 확률이
   * 압도적이다. 삭제를 실행 끝으로 미뤄 그 집계를 보고 결정한다.
   */
  describe('전 건이 "좌표 없음"으로 끝나는 장애 (PROJ1-1-51)', () => {
    it('네트워크 성공 0건 + 대량 notFound면 좌표를 지우지 않는다', async () => {
      jsonpImpl = async () => notFoundResponse();
      const { parcels, diagnostics } = await run(withCoords(60));
      expect(parcels.every((p) => p.coords?.lat === 36.5)).toBe(true);
      expect(diagnostics.serviceDown).toBe(true);
      expect(diagnostics.failureKind).toBe('no-results');
      // 서버는 답했다. `unreachable`로 옮기지 않는다 — 사실이 아니고, 파티션도 깨진다.
      expect(diagnostics.notFound).toBe(60);
      expect(diagnostics.unreachable).toBe(0);
    });

    /**
     * **이 티켓의 가장 큰 위험.** 임계값을 잘못 잡으면 재변환의 초기화 기능이 죽는다.
     * 소량은 계속 지워져야 한다 — 몇 건만 골라 다시 돌리는 사용을 막으면 안 된다.
     */
    it('소량(임계값 미만)은 계속 지운다', async () => {
      jsonpImpl = async () => notFoundResponse();
      const { parcels, diagnostics } = await run(withCoords(10));
      expect(parcels.every((p) => p.coords === null)).toBe(true);
      expect(diagnostics.serviceDown).toBe(false);
      expect(diagnostics.notFound).toBe(10);
    });

    /**
     * 서버가 한 건이라도 좌표를 주면 살아 있는 것이다. 나머지 "좌표 없음"은 진짜
     * 데이터 문제이므로 정상적으로 지워져야 한다 — 여기가 깨지면 ①이 죽는다.
     */
    it('네트워크로 좌표를 하나라도 얻으면 나머지는 정상적으로 지운다', async () => {
      let n = 0;
      jsonpImpl = async () => (++n === 1 ? okResponse() : notFoundResponse());
      const { parcels, diagnostics } = await run(withCoords(60));
      expect(diagnostics.serviceDown).toBe(false);
      // 첫 건만 좌표를 얻고 나머지 59건은 지워진다
      expect(parcels.filter((p) => p.coords === null)).toHaveLength(59);
      expect(diagnostics.notFound).toBe(59);
    });

    it('파티션 검산이 성립한다', async () => {
      jsonpImpl = async () => notFoundResponse();
      const { diagnostics: d } = await run(withCoords(60));
      expect(d.notFound + d.quotaBlocked + d.unreachable + d.authBlocked)
        .toBe(d.attemptedFailures);
    });
  });
});

/**
 * **좌표를 지우는 결론에는 긍정적 근거가 있어야 한다.**
 *
 * PROJ1-1-45는 "분류되지 않은 ERROR 응답"이 좌표를 지우던 것을 막았다. 그런데
 * 같은 모양의 구멍이 셋 더 있었다 — 모두 "분류하지 못한 것이 `null`(= 좌표 없음)로
 * 떨어진다"는 같은 구조다.
 *
 * 1. 지번 조회가 **네트워크 오류·타임아웃**으로 죽고 도로명이 `NOT_FOUND`로 답하면
 *    `responded`가 서서 `null`이 됐다. 실 API로 확인한 바, 지번 주소를 `type=road`로
 *    조회하면 `NOT_FOUND`가 **정상 결과**다. 즉 과부하로 지번 조회 하나만 타임아웃
 *    돼도 그 필지의 좌표는 재변환에서 지워졌다. PROJ1-1-45의 논거("지번 좌표는
 *    지번 조회만이 답한다")가 네트워크 경로에는 적용되지 않은 채 남아 있었다.
 * 2. `jsonp`가 `JsonpNetworkError`·`JsonpTimeoutError` 밖의 예외(예: 응답이
 *    `null`이면 `data.response`에서 TypeError)를 내면 어느 카운터도 오르지 않았다.
 * 3. `classifyVworldResponse`가 `status`가 없거나 미지의 값인 응답을 `empty`로
 *    분류했다 — `response` 필드가 빠진 게이트웨이 오류 페이로드가 "좌표 없음"이 된다.
 *
 * 규칙을 뒤집는다: **지번 조회가 정상 응답으로 "결과 없음"을 말했을 때만** null이다.
 * 지번이 답하지 못한 채 어떤 경로로 끝나든 `GeocodeServiceError`다. 도로명 조회는
 * 보조 시도라 그 결과가 지번의 판정을 뒤집지 못한다(아래 "권위 있는 조회" 참조).
 */
const { JsonpNetworkError, JsonpTimeoutError } = await import('../jsonp');

describe('classifyVworldResponse — 미지의 응답은 empty가 아니다', () => {
  it('response 필드가 없으면 error', () => {
    expect(classifyVworldResponse(undefined).kind).toBe('error');
  });

  it('status가 스펙 밖의 값이면 error', () => {
    const res = { status: 'MAINTENANCE' } as unknown as Parameters<typeof classifyVworldResponse>[0];
    expect(classifyVworldResponse(res).kind).toBe('error');
  });
});

describe('geocodeAddress — 좌표 없음(null)은 지번 조회가 정상 응답했을 때만', () => {
  it('지번이 타임아웃이고 도로명이 정상 결과없음이면 서버 오류다', async () => {
    jsonpImpl = async (_url, params) => {
      if (params.type === 'parcel') throw new JsonpTimeoutError('u');
      return notFoundResponse();
    };
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  /**
   * **권위 있는 조회는 지번이다.** 이 데이터의 주소는 본번·부번으로 조립된 지번이고,
   * 도로명 조회는 보조 시도다(실 API: 지번 주소를 `type=road`로 조회하면 `NOT_FOUND`).
   * 지번이 정상 응답으로 "결과 없음"을 말했으면 도로명이 어떻게 끝나든 그 판정을
   * 뒤집지 못한다. 뒤집으면 — 도로명 쪽만 오류를 내는 서버에서 전량이 `unreachable`이
   * 되어 배치 2개 만에 조기 중단되고, 재변환의 초기화 기능이 영영 막힌다(실측: 100건
   * 중 10건만 시도하고 90건 포기, 재실행해도 같다).
   */
  it('지번이 정상 결과없음이면 도로명이 네트워크 오류여도 null이다 (지번이 권위 있는 답)', async () => {
    jsonpImpl = async (_url, params) => {
      if (params.type === 'road') throw new JsonpNetworkError('u');
      return notFoundResponse();
    };
    await expect(geocodeAddress(uniqueAddress())).resolves.toBeNull();
    expect(jsonpTypes).toEqual(['parcel', 'road']);
  });

  it('지번이 정상 결과없음이면 도로명이 ERROR여도 null이다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? notFoundResponse() : errorResponse('SYSTEM_ERROR', '시스템 오류');
    await expect(geocodeAddress(uniqueAddress())).resolves.toBeNull();
  });

  /**
   * 봉화군 밖 좌표. 예전에는 `geocodeVworld`가 좌표를 얻는 순간 지번 조회의 오류를
   * **버리고** 반환했고, `geocodeAddress`가 범위 검사로 탈락시키면 `serviceError`가
   * null인 채 null이 됐다 — 서버 오류가 "좌표 없음"으로 세탁되어 좌표가 지워졌다
   * (실측: 지번 ERROR / 도로명 봉화 밖 → notFound 3, 삭제 3). 도로명 조회도 시도되지
   * 않았다. 범위 밖 좌표는 그 시도에 한해 "결과 없음"이다.
   */
  const OUT_OF_BONGHWA = { x: '129.5', y: '36.9' }; // lngMax 129.21 초과

  it('지번이 ERROR이고 도로명이 봉화 밖 좌표면 서버 오류다 (오류가 세탁되지 않는다)', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? errorResponse('SYSTEM_ERROR', '시스템 오류') : okResponse(OUT_OF_BONGHWA);
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('지번이 봉화 밖 좌표이고 도로명이 ERROR면 null이다 (지번이 확정적으로 딴 곳을 답했다)', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? okResponse(OUT_OF_BONGHWA) : errorResponse('SYSTEM_ERROR', '시스템 오류');
    await expect(geocodeAddress(uniqueAddress())).resolves.toBeNull();
  });

  it('지번이 봉화 밖 좌표면 도로명을 시도하고, 그쪽 좌표가 맞으면 그것을 쓴다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? okResponse(OUT_OF_BONGHWA) : okResponse();
    await expect(geocodeAddress(uniqueAddress())).resolves.toEqual({ lat: 36.9, lng: 128.9 });
    expect(jsonpTypes).toEqual(['parcel', 'road']);
  });

  it('둘 다 봉화 밖 좌표면 null이다', async () => {
    jsonpImpl = async () => okResponse(OUT_OF_BONGHWA);
    await expect(geocodeAddress(uniqueAddress())).resolves.toBeNull();
  });

  it('jsonp가 null을 돌려주면 서버 오류다 (TypeError를 삼키지 않는다)', async () => {
    jsonpImpl = async () => null;
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('jsonp가 분류 밖의 예외를 던지면 서버 오류다', async () => {
    jsonpImpl = async () => {
      throw new Error('boom');
    };
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('지번 오류 뒤에 도로명이 인증 거부면 auth가 이긴다 (첫 오류가 뒤의 분류를 가리지 않는다)', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel'
        ? errorResponse('SYSTEM_ERROR', '시스템 오류')
        : errorResponse('INVALID_KEY', '등록되지 않은 인증키입니다');
    await expect(geocodeAddress(uniqueAddress())).rejects.toMatchObject({ kind: 'auth' });
  });

  /**
   * 실 API: 빈 주소는 `ERROR PARAM_REQUIRED`다. 위 규칙대로면 그것이 서버 오류가
   * 되어 "미응답"으로 집계된다. 주소가 없는 것은 데이터 문제이고 서버에 물을 것도
   * 없다 — 네트워크에 나가기 전에 null로 끝낸다.
   */
  it('빈 주소는 서버에 묻지 않고 null이다', async () => {
    await expect(geocodeAddress('   ')).resolves.toBeNull();
    expect(jsonpTypes).toEqual([]);
  });
});

describe('batchGeocode + 실제 kakaoGeocoder — 미응답이 섞인 재변환', () => {
  const withCoords = (n: number): Parcel[] =>
    Array.from({ length: n }, (_, i) =>
      makeParcel({
        pnu: '',
        parcelId: `${800 + i}`,
        address: uniqueAddress(),
        coords: { lat: 36.5, lng: 128.5 },
      }),
    );
  const partition = (d: { notFound: number; quotaBlocked: number; unreachable: number; authBlocked: number }) =>
    d.notFound + d.quotaBlocked + d.unreachable + d.authBlocked;

  it('지번 타임아웃 + 도로명 결과없음은 좌표를 지우지 않고 미응답으로 센다', async () => {
    jsonpImpl = async (_url, params) => {
      if (params.type === 'parcel') throw new JsonpTimeoutError('u');
      return notFoundResponse();
    };
    const { parcels, diagnostics } = await batchGeocode(withCoords(3), {
      force: true, skipHealthCheck: true, concurrency: 5, maxRetries: 0,
    });
    expect(parcels.every((p) => p.coords?.lat === 36.5)).toBe(true);
    expect(diagnostics.notFound).toBe(0);
    expect(diagnostics.unreachable).toBe(3);
    expect(partition(diagnostics)).toBe(diagnostics.attemptedFailures);
  });

  it('진짜 결과없음과 미응답이 섞이면 앞엣것만 지우고 파티션이 성립한다', async () => {
    const parcels = withCoords(4);
    const dead = new Set([parcels[2].address, parcels[3].address]);
    jsonpImpl = async (_url, params) => {
      if (dead.has(params.address) && params.type === 'parcel') throw new JsonpNetworkError('u');
      return notFoundResponse();
    };
    const { parcels: out, diagnostics } = await batchGeocode(parcels, {
      force: true, skipHealthCheck: true, concurrency: 5, maxRetries: 0,
    });
    expect(out[0].coords).toBeNull();
    expect(out[1].coords).toBeNull();
    expect(out[2].coords?.lat).toBe(36.5);
    expect(out[3].coords?.lat).toBe(36.5);
    expect(diagnostics.notFound).toBe(2);
    expect(diagnostics.unreachable).toBe(2);
    expect(partition(diagnostics)).toBe(diagnostics.attemptedFailures);
  });
});

/**
 * 결함 1의 배치 수준 재현. 도로명 조회만 오류를 내는 서버에서 지번 `NOT_FOUND`가
 * 서버 오류로 뒤집히면 전량 `unreachable` → `sawResponse`가 서지 않아 배치 2개 만에
 * 조기 중단된다. 지번이 답한 이상 데이터 문제이므로 끝까지 돌고, 좌표는 지워진다
 * (재변환의 초기화 기능).
 */
describe('batchGeocode + 실제 kakaoGeocoder — 도로명만 오류인 서버', () => {
  const withCoords = (n: number): Parcel[] =>
    Array.from({ length: n }, (_, i) =>
      makeParcel({
        pnu: '',
        parcelId: `${900 + i}`,
        address: uniqueAddress(),
        coords: { lat: 36.5, lng: 128.5 },
      }),
    );
  const run = (parcels: Parcel[]) =>
    batchGeocode(parcels, { force: true, skipHealthCheck: true, concurrency: 5, maxRetries: 0 });

  it('지번 결과없음 + 도로명 ERROR는 조기 중단 없이 전량 좌표 없음이다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? notFoundResponse() : errorResponse('SYSTEM_ERROR', '시스템 오류');
    const { parcels, diagnostics } = await run(withCoords(15)); // 배치 3개
    expect(diagnostics.serviceDown).toBe(false);
    expect(diagnostics.attemptedFailures).toBe(15);
    expect(diagnostics.notFound).toBe(15);
    expect(diagnostics.unreachable).toBe(0);
    expect(parcels.every((p) => p.coords === null)).toBe(true);
  });

  it('대조군: 양쪽 결과없음도 전량 좌표 없음이다', async () => {
    jsonpImpl = async () => notFoundResponse();
    const { parcels, diagnostics } = await run(withCoords(15));
    expect(diagnostics.serviceDown).toBe(false);
    expect(diagnostics.notFound).toBe(15);
    expect(parcels.every((p) => p.coords === null)).toBe(true);
  });

  it('반대로 지번 ERROR + 도로명 결과없음은 조기 중단하고 좌표를 지킨다', async () => {
    jsonpImpl = async (_url, params) =>
      params.type === 'parcel' ? errorResponse('SYSTEM_ERROR', '시스템 오류') : notFoundResponse();
    const { parcels, diagnostics } = await run(withCoords(15));
    expect(diagnostics.serviceDown).toBe(true);
    expect(diagnostics.notFound).toBe(0);
    expect(parcels.every((p) => p.coords?.lat === 36.5)).toBe(true);
  });
});
