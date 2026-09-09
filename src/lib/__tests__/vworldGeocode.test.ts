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
});
