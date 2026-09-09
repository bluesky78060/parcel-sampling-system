import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * **Kakao 폴백도 좌표를 지우고 있었다** (PROJ1-1-51).
 *
 * `geocodeKakao`는 fetch 예외를 `console.warn` 후 삼키고, 401/403도 `return null`로
 * 끝냈다. 그러면 호출자(`batchGeocoder`)가 `answered = true`로 보아 "이 주소에 좌표가
 * 없다"로 집계하고 **좌표를 지운다** — VWORLD 쪽에서 닫은 것과 정확히 같은 구조다.
 *
 * `KAKAO_REST_USABLE = isDev && !!key`가 **모듈 로드 시점 상수**라, 키를 채운 채로
 * 새로 import해야 이 경로에 닿는다. 그래서 `vworldGeocode.test.ts`(키를 ''로 비운다)와
 * 파일을 나눈다.
 *
 * **VWORLD가 답했으면 Kakao의 실패는 판정을 뒤집지 못한다.** 그쪽이 권위 있는 답이고
 * Kakao는 보조 시도다. 뒤집게 하면 VWORLD가 정당하게 "좌표 없음"이라고 한 필지까지
 * 보존되어 재변환의 초기화 기능이 죽는다 — 아래 마지막 테스트가 그것을 지킨다.
 */

vi.mock('../geocodeCache', () => ({
  getFromIDB: async () => null,
  setToIDB: async () => {},
  loadAllFromIDB: async () => new Map(),
  bulkSetToIDB: async () => {},
  clearIDBCache: async () => {},
  getIDBCacheSize: async () => 0,
}));

/** VWORLD는 jsonp로만 나간다. 테스트마다 갈아 끼운다 */
let jsonpImpl: (url: string, params: Record<string, string>) => Promise<unknown>;
vi.mock('../jsonp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../jsonp')>();
  return { ...actual, jsonp: (u: string, p: Record<string, string>) => jsonpImpl(u, p) };
});

// 이 파일의 핵심 — 키가 있어야 `KAKAO_REST_USABLE`이 참이 된다.
vi.stubEnv('VITE_KAKAO_REST_KEY', 'TEST-KAKAO-KEY');
// VWORLD 키는 테스트마다 갈아 끼운다. 기본은 없음(= Kakao 단독 경로).
vi.stubEnv('VITE_VWORLD_KEY', '');

const { geocodeAddress, clearGeocodeCache, GeocodeServiceError } = await import('../kakaoGeocoder');

let addrSeq = 0;
const uniqueAddress = () => `경상북도 봉화군 봉화읍 내성리 ${++addrSeq}`;

/** Kakao 응답 한 건을 만든다 */
const kakaoRes = (init: { status?: number; documents?: { x: string; y: string }[] }) =>
  ({
    status: init.status ?? 200,
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    json: async () => ({ documents: init.documents ?? [] }),
  }) as unknown as Response;

const IN_BONGHWA = { x: '128.9', y: '36.9' };

beforeEach(async () => {
  // 기본은 "VWORLD 없음". 개별 테스트가 필요하면 켠다.
  jsonpImpl = async () => ({ response: { status: 'NOT_FOUND' } });
  await clearGeocodeCache();
});

describe('Kakao 폴백이 서버 사정을 "좌표 없음"으로 위장하지 않는다', () => {
  it('네트워크 오류는 던진다 (좌표를 지우면 안 된다)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('인증 거부(401)는 던진다 — "이 주소에 좌표가 없다"가 아니다', async () => {
    vi.stubGlobal('fetch', async () => kakaoRes({ status: 401 }));
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('5xx도 던진다', async () => {
    vi.stubGlobal('fetch', async () => kakaoRes({ status: 503 }));
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  /**
   * Kakao는 주소 검색 → 키워드 검색 두 번 시도한다. **둘 중 하나만 죽는 경우**가
   * 있다. 키워드 쪽이 정상으로 "결과 없음"을 답해도, 주소 검색이 서버 사정으로
   * 죽었으면 "이 주소에 좌표가 없다"의 근거가 못 된다.
   *
   * 변이 검증에서 이 조합이 비어 있어 주소 검색 쪽 기록을 지워도 아무 테스트가
   * 죽지 않았다(두 시도가 함께 죽는 경우만 덮고 있었다).
   */
  it('주소 검색만 죽고 키워드는 결과 없음이어도 던진다', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      if (++call === 1) throw new TypeError('Failed to fetch');
      return kakaoRes({ documents: [] });
    });
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('주소 검색이 5xx이고 키워드는 결과 없음이어도 던진다', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () =>
      ++call === 1 ? kakaoRes({ status: 503 }) : kakaoRes({ documents: [] }));
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  it('주소 검색이 401이면 키워드를 보지도 않고 던진다', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => { call++; return kakaoRes({ status: 401 }); });
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
    expect(call).toBe(1);
  });

  /**
   * 반대 조합도 같다. **Kakao에서는 두 시도 중 어느 하나도 단독으로 권위 있지 않다** —
   * 주소 검색은 유효한 지번에도 빈 결과를 자주 내고, 키워드 검색이 존재하는 이유가
   * 바로 그것이다. 따라서 "주소 검색이 결과 없음"만으로는 결론이 못 되고, 키워드가
   * 서버 사정으로 죽었으면 이 주소에 대한 답이 아직 없는 것이다.
   *
   * (VWORLD의 `parcelAnswered`와 다른 지점이다. 그쪽은 지번 조회가 권위 있는 답을
   * 주지만, 여기서는 둘이 함께 정상 응답해야 "좌표 없음"이 성립한다.)
   */
  it('주소 검색은 결과 없음인데 키워드가 죽으면 던진다', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      if (++call === 1) return kakaoRes({ documents: [] });
      throw new TypeError('Failed to fetch');
    });
    await expect(geocodeAddress(uniqueAddress())).rejects.toBeInstanceOf(GeocodeServiceError);
  });

  /** ① 진짜 데이터 문제 — **둘 다** 정상 응답인데 결과가 없다. 이것만 좌표를 지운다 */
  it('정상 응답인데 결과가 없으면 null이다', async () => {
    vi.stubGlobal('fetch', async () => kakaoRes({ documents: [] }));
    await expect(geocodeAddress(uniqueAddress())).resolves.toBeNull();
  });

  it('좌표를 받으면 그대로 돌려준다', async () => {
    vi.stubGlobal('fetch', async () => kakaoRes({ documents: [IN_BONGHWA] }));
    await expect(geocodeAddress(uniqueAddress())).resolves.toEqual({ lat: 36.9, lng: 128.9 });
  });

  /**
   * **가장 중요한 경계.** VWORLD가 정상 응답으로 "좌표 없음"이라고 답했다면 그것이
   * 이 주소의 결론이다. Kakao가 죽었다고 그 판정을 뒤집으면, 재변환이 낡은 좌표를
   * 영영 비우지 못한다.
   */
  it('VWORLD가 답했으면 Kakao가 죽어도 null이다 (① 초기화 기능을 지킨다)', async () => {
    vi.stubEnv('VITE_VWORLD_KEY', 'TEST-VWORLD-KEY');
    vi.resetModules();
    const fresh = await import('../kakaoGeocoder');
    await fresh.clearGeocodeCache();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    // VWORLD는 지번·도로명 모두 정상 NOT_FOUND — 권위 있는 "좌표 없음"
    await expect(fresh.geocodeAddress(uniqueAddress())).resolves.toBeNull();
    vi.stubEnv('VITE_VWORLD_KEY', '');
  });
});
